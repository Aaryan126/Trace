import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  BranchRepository,
  CommitRepository,
  DecisionOutcomeRepository,
  SourceItemRepository,
  ThreadRepository,
  WorkingStateRepository,
  loadConfig,
  type Commit,
  type Thread,
} from '@trace/core';

export class TraceMcpQueries {
  private readonly threads: ThreadRepository;
  private readonly branches: BranchRepository;
  private readonly commits: CommitRepository;
  private readonly sources: SourceItemRepository;
  private readonly states: WorkingStateRepository;
  private readonly outcomes: DecisionOutcomeRepository;

  constructor(private readonly db: Database.Database) {
    this.threads = new ThreadRepository(db);
    this.branches = new BranchRepository(db);
    this.commits = new CommitRepository(db);
    this.sources = new SourceItemRepository(db);
    this.states = new WorkingStateRepository(db);
    this.outcomes = new DecisionOutcomeRepository(db);
  }

  searchDecisions(query: string, limit = 10) {
    const terms = searchTerms(query);
    return this.threads.list().map((thread) => {
      const latest = this.commits.getLatestByThread(thread.id);
      const states = this.statesForThread(thread.id);
      const text = [thread.title, latest?.verdict_summary, latest?.reasoning, ...states.flatMap((state) => [state.research_question, state.summary, ...state.constraints])].filter(Boolean).join(' ');
      const score = terms.length ? terms.filter((term) => text.toLowerCase().includes(term)).length / terms.length : 0;
      return { id: thread.id, title: thread.title, status: thread.status, currentAnswer: latest?.verdict_summary ?? states[0]?.tentative_direction ?? null, lastUpdated: latest?.created_at ?? states[0]?.last_event_at ?? thread.updated_at, score };
    }).filter((result) => !terms.length || result.score > 0).sort((a, b) => b.score - a.score || b.lastUpdated.localeCompare(a.lastUpdated)).slice(0, limit);
  }

  getDecisionTrace(id: string) {
    const thread = this.requireThread(id);
    const branches = this.branches.listByThread(id).map((branch) => ({
      id: branch.id,
      context: branch.context_label,
      parentCommitId: branch.parent_commit_id,
      commits: this.commits.listByBranch(branch.id).map((commit) => ({
        id: commit.id,
        kind: commit.kind,
        status: commit.resolution_status,
        verdict: commit.verdict_summary,
        reasoning: commit.reasoning,
        createdAt: commit.created_at,
        outcome: this.outcomes.getByCommit(commit.id) ?? (commit.regret ? { status: 'regretted', note: commit.regret_note } : null),
        sources: commit.source_item_ids.map((sourceId) => this.sources.getById(sourceId)).filter(Boolean).map((source) => ({ id: source!.id, title: source!.raw_text, url: source!.url, capturedAt: source!.captured_at })),
      })),
    }));
    return { id: thread.id, title: thread.title, status: thread.status, branches };
  }

  getCurrentAnswer(id: string) {
    const thread = this.requireThread(id);
    const latest = this.commits.getLatestByThread(id);
    const state = this.statesForThread(id)[0];
    if (state?.tentative_direction && (!latest || state.last_event_at >= latest.created_at)) {
      return { id, title: thread.title, answer: state.tentative_direction, reasoning: state.summary, status: 'working', updatedAt: state.last_event_at };
    }
    return { id, title: thread.title, answer: latest?.verdict_summary ?? null, reasoning: latest?.reasoning ?? null, status: latest ? 'committed' : 'unanswered', updatedAt: latest?.created_at ?? thread.updated_at };
  }

  getRelevantConstraints(topic: string) {
    return this.searchDecisions(topic, 8).map((match) => {
      const branches = this.branches.listByThread(match.id);
      const states = this.statesForThread(match.id);
      return {
        decisionId: match.id,
        title: match.title,
        constraints: [...new Set([...branches.map((branch) => branch.context_label).filter(Boolean), ...states.flatMap((state) => state.constraints)])],
        openQuestions: [...new Set(states.flatMap((state) => state.open_questions))],
      };
    }).filter((result) => result.constraints.length || result.openQuestions.length);
  }

  getPriorRegrets(topic: string) {
    return this.searchDecisions(topic, 12).flatMap((match) => this.commitsForThread(match.id)
      .map((commit) => ({ commit, outcome: this.outcomes.getByCommit(commit.id) }))
      .filter(({ commit, outcome }) => commit.regret || outcome?.status === 'regretted')
      .map(({ commit, outcome }) => ({ decisionId: match.id, title: match.title, commitId: commit.id, decision: commit.verdict_summary, note: outcome?.note ?? commit.regret_note ?? '', recordedAt: outcome?.updated_at ?? commit.created_at })));
  }

  private requireThread(id: string): Thread {
    const thread = this.threads.getById(id);
    if (!thread) throw new Error(`Decision not found: ${id}`);
    return thread;
  }

  private statesForThread(threadId: string) {
    const branchIds = new Set(this.branches.listByThread(threadId).map((branch) => branch.id));
    return this.states.listRecent(500).filter((state) => branchIds.has(state.branch_id));
  }

  private commitsForThread(threadId: string): Commit[] {
    return this.branches.listByThread(threadId).flatMap((branch) => this.commits.listByBranch(branch.id));
  }
}

export function createTraceMcpServer(db: Database.Database): McpServer {
  const queries = new TraceMcpQueries(db);
  const server = new McpServer({ name: 'trace', version: '0.1.0' });
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
  server.registerTool('search_decisions', {
    description: 'Search prior Trace research decisions before making a technical or product choice.',
    inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(20).optional() }, annotations: readOnly,
  }, ({ query, limit }) => jsonResult(queries.searchDecisions(query, limit)));
  server.registerTool('get_decision_trace', {
    description: 'Get the branches, checkpoints, evidence links, and recorded outcomes for one Trace decision.',
    inputSchema: { id: z.string().min(1) }, annotations: readOnly,
  }, ({ id }) => jsonResult(queries.getDecisionTrace(id)));
  server.registerTool('get_current_answer', {
    description: 'Get the latest committed or working answer for one Trace decision.',
    inputSchema: { id: z.string().min(1) }, annotations: readOnly,
  }, ({ id }) => jsonResult(queries.getCurrentAnswer(id)));
  server.registerTool('get_relevant_constraints', {
    description: 'Find constraints and open questions from earlier decisions relevant to a topic.',
    inputSchema: { topic: z.string().min(1) }, annotations: readOnly,
  }, ({ topic }) => jsonResult(queries.getRelevantConstraints(topic)));
  server.registerTool('get_prior_regrets', {
    description: 'Find prior regretted decisions and their outcome notes for a topic.',
    inputSchema: { topic: z.string().min(1) }, annotations: readOnly,
  }, ({ topic }) => jsonResult(queries.getPriorRegrets(topic)));
  return server;
}

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function searchTerms(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((term) => term.length > 2 && !SEARCH_STOP_WORDS.has(term)) ?? [])];
}

const SEARCH_STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'choose', 'before', 'whether']);

async function main(): Promise<void> {
  const db = new Database(loadConfig().db.path, { readonly: true, fileMustExist: true });
  const server = createTraceMcpServer(db);
  const transport = new StdioServerTransport();
  const close = () => { void server.close().finally(() => db.close()); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}

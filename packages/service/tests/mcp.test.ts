import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  BranchRepository,
  CommitRepository,
  DecisionOutcomeRepository,
  SourceItemRepository,
  ThreadRepository,
  WorkingStateRepository,
  createInMemoryDatabase,
} from '@trace/core';
import { createTraceMcpServer } from '../src/mcp.js';

describe('Trace MCP server', () => {
  let db: Database;

  beforeEach(() => { db = createInMemoryDatabase(); });
  afterEach(() => db.close());

  it('exposes the five focused read-only tools and returns prior decision context', async () => {
    const thread = new ThreadRepository(db).create({ title: 'Choose application database', tags: ['database'], status: 'closed' });
    const branch = new BranchRepository(db).create({ thread_id: thread.id, parent_commit_id: null, context_label: 'Offline-first desktop app' });
    const source = new SourceItemRepository(db).create({ type: 'browser_history', raw_text: 'SQLite comparison', extracted_entities: null, url: 'https://example.com/sqlite', captured_at: new Date().toISOString(), thread_id: thread.id });
    const commit = new CommitRepository(db).create({ branch_id: branch.id, verdict_summary: 'Use SQLite for the local-first application', reasoning: 'It keeps storage embedded and simple.', source_item_ids: [source.id], resolution_status: 'resolved' });
    new DecisionOutcomeRepository(db).upsert(commit.id, 'regretted', 'Cross-device sync became a requirement.');
    new WorkingStateRepository(db).upsert({ branch_id: branch.id, research_question: 'Which database fits?', summary: 'Local storage research', options: ['SQLite'], constraints: ['Must work offline'], open_questions: [], tentative_direction: 'Use SQLite', evidence_ids: [source.id], changed_factors: [], status: 'active', last_event_at: commit.created_at, checkpoint_due_at: commit.created_at, comparison: { options: [], criteria: [], cells: [] } });

    const server = createTraceMcpServer(db);
    const client = new Client({ name: 'trace-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(['get_current_answer', 'get_decision_trace', 'get_prior_regrets', 'get_relevant_constraints', 'search_decisions']);
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);

    const search = await client.callTool({ name: 'search_decisions', arguments: { query: 'database' } });
    expect(JSON.stringify(search.content)).toContain(thread.id);
    const trace = await client.callTool({ name: 'get_decision_trace', arguments: { id: thread.id } });
    expect(JSON.stringify(trace.content)).toContain('SQLite comparison');
    const regrets = await client.callTool({ name: 'get_prior_regrets', arguments: { topic: 'database' } });
    expect(JSON.stringify(regrets.content)).toContain('Cross-device sync');
    const constraints = await client.callTool({ name: 'get_relevant_constraints', arguments: { topic: 'database' } });
    expect(JSON.stringify(constraints.content)).toContain('Must work offline');

    await client.close();
    await server.close();
  });
});

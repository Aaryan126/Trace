import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import type { Database } from 'better-sqlite3';
import {
  createDatabase,
  ThreadRepository,
  BranchRepository,
  CommitRepository,
  SourceItemRepository,
  MergeEventRepository,
  FeedEventRepository,
  CorrectionAgent,
  WorkingStateRepository,
  AutomationActionRepository,
  CaptureAssetRepository,
  ComparisonOverrideRepository,
  DecisionOutcomeRepository,
} from '@trace/core';
import type {
  ApiCaptureItem,
  ApiFeedEvent,
  ApiThread,
  ApiThreadDetail,
  ApiWorkingState,
  ApiTreeEdge,
  ApiTreeNode,
  ApiComparisonMatrix,
  ApiResearchStoryNode,
  ApiSearchResult,
  Branch,
  Commit,
  FeedEvent,
  MergeEvent,
  SourceItem,
  Thread,
  ComparisonMatrix,
  ComparisonOverride,
  BranchWorkingState,
  DecisionOutcomeStatus,
  DecisionOutcome,
} from '@trace/core';
import type { AutonomousCoordinator, TraceLiveEvent } from './automation.js';
import type { BrowserCaptureCoordinator, BrowserCaptureFailureReason, BrowserCapturePayload, BrowserExtensionVisit } from './browser-capture.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
}

export type TreeNode = ApiTreeNode;
export type TreeEdge = ApiTreeEdge;
export type CaptureItem = ApiCaptureItem;

// Internal: allow injecting a Database instance for tests
export interface CreateServerOptions extends Partial<ServerConfig> {
  _db?: Database;
  _automation?: AutonomousCoordinator;
  _captures?: BrowserCaptureCoordinator;
  _captureToken?: string;
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export async function createServer(options: CreateServerOptions = {}): Promise<FastifyInstance> {
  // -- Database ---------------------------------------------------------------
  let db: Database;
  if (options._db) {
    db = options._db;
  } else {
    const dbPath = options.dbPath ?? join(homedir(), '.trace', 'trace.sqlite');
    mkdirSync(dirname(dbPath), { recursive: true });
    db = createDatabase(dbPath);
  }

  // -- Repos & agents ---------------------------------------------------------
  const threadRepo = new ThreadRepository(db);
  const branchRepo = new BranchRepository(db);
  const commitRepo = new CommitRepository(db);
  const sourceItemRepo = new SourceItemRepository(db);
  const mergeEventRepo = new MergeEventRepository(db);
  const feedEventRepo = new FeedEventRepository(db);
  const workingStateRepo = new WorkingStateRepository(db);
  const automationActionRepo = new AutomationActionRepository(db);
  const captureAssetRepo = new CaptureAssetRepository(db);
  const comparisonOverrideRepo = new ComparisonOverrideRepository(db);
  const decisionOutcomeRepo = new DecisionOutcomeRepository(db);
  const toApiThread = (thread: Thread): ApiThread => {
    const items = sourceItemRepo.listByThread(thread.id);
    const lastActivity = items.length > 0
      ? items.reduce(
        (latest, item) => item.captured_at > latest ? item.captured_at : latest,
        items[0].captured_at,
      )
      : thread.updated_at;
    return {
      id: thread.id,
      title: thread.title,
      status: thread.status,
      tags: thread.tags,
      lastActivity,
      itemCount: items.length,
      createdAt: thread.created_at,
    };
  };

  const correctionAgent = new CorrectionAgent(threadRepo, branchRepo, sourceItemRepo);

  // -- Fastify ----------------------------------------------------------------
  const app = Fastify({ logger: false });
  await app.register(cors, {
    origin(origin, callback) {
      const allowed = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      callback(null, allowed);
    },
  });
  const dashboardRoot = resolve(process.cwd(), 'packages', 'dashboard', 'dist');
  if (existsSync(dashboardRoot)) {
    await app.register(fastifyStatic, { root: dashboardRoot });
    app.get('/threads/:threadId', async (_request, reply) => reply.sendFile('index.html'));
    app.get('/decisions', async (_request, reply) => reply.sendFile('index.html'));
    app.get('/capture', async (_request, reply) => reply.sendFile('index.html'));
    app.get('/activity', async (_request, reply) => reply.sendFile('index.html'));
  }

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
  }));

  const captureAuthorized = (headers: Record<string, unknown>) => {
    const expected = options._captureToken ?? process.env.TRACE_CAPTURE_TOKEN;
    return Boolean(expected && headers['x-trace-capture-token'] === expected);
  };

  app.post('/api/browser-capture/status', async (request, reply) => {
    if (!captureAuthorized(request.headers)) return reply.status(401).send({ error: 'Unauthorized' });
    if (!options._captures) return reply.status(503).send({ error: 'Capture is unavailable' });
    const body = request.body as { enabled?: boolean; authorized?: boolean; agent?: string };
    if (body.agent === 'chrome_extension') {
      options._captures.reportAgent('chrome_extension', body.authorized === true);
    } else {
      options._captures.reportAgentStatus(body.enabled === true, body.authorized === true);
    }
    return { success: true };
  });

  app.get('/api/browser-capture/policy', async (_request, reply) => {
    if (!options._captures) return reply.status(503).send({ error: 'Capture is unavailable' });
    return { enabled: options._captures.health().enabled };
  });

  app.post('/api/browser-capture/policy', async (request, reply) => {
    if (!captureAuthorized(request.headers)) return reply.status(401).send({ error: 'Unauthorized' });
    if (!options._captures) return reply.status(503).send({ error: 'Capture is unavailable' });
    const body = request.body as { enabled?: boolean };
    if (typeof body.enabled !== 'boolean') return reply.status(400).send({ error: 'enabled must be boolean' });
    options._captures.setPolicyEnabled(body.enabled);
    return { success: true, enabled: body.enabled };
  });

  app.post('/api/browser-extension/visit', async (request, reply) => {
    if (!captureAuthorized(request.headers)) return reply.status(401).send({ error: 'Unauthorized' });
    if (!options._captures) return reply.status(503).send({ error: 'Capture is unavailable' });
    const body = request.body as Partial<BrowserExtensionVisit>;
    if (typeof body.url !== 'string' || typeof body.title !== 'string' || typeof body.capturedAt !== 'string') {
      return reply.status(400).send({ error: 'url, title, and capturedAt are required' });
    }
    return options._captures.considerExtensionVisit({
      url: body.url,
      title: body.title,
      capturedAt: body.capturedAt,
      pageText: typeof body.pageText === 'string' ? body.pageText : undefined,
      manual: body.manual === true,
    });
  });

  app.post('/api/browser-capture/next', async (request, reply) => {
    if (!captureAuthorized(request.headers)) return reply.status(401).send({ error: 'Unauthorized' });
    if (!options._captures) return reply.status(503).send({ error: 'Capture is unavailable' });
    reply.header('Cache-Control', 'no-store');
    const capture = options._captures.next();
    return capture ?? reply.status(204).send();
  });

  app.post('/api/browser-capture/:id/complete', { bodyLimit: 8_000_000 }, async (request, reply) => {
    if (!captureAuthorized(request.headers)) return reply.status(401).send({ error: 'Unauthorized' });
    if (!options._captures) return reply.status(503).send({ error: 'Capture is unavailable' });
    const { id } = request.params as { id: string };
    return options._captures.complete(id, request.body as BrowserCapturePayload)
      ? { success: true }
      : reply.status(400).send({ error: 'Invalid or expired capture' });
  });

  app.post('/api/browser-capture/:id/stage', async (request, reply) => {
    if (!captureAuthorized(request.headers)) return reply.status(401).send({ error: 'Unauthorized' });
    if (!options._captures) return reply.status(503).send({ error: 'Capture is unavailable' });
    const { id } = request.params as { id: string };
    const body = request.body as { stage?: string };
    if (body.stage !== 'native_started') return reply.status(400).send({ error: 'Invalid capture stage' });
    return options._captures.stage(id, body.stage)
      ? { success: true }
      : reply.status(404).send({ error: 'Capture not found' });
  });

  app.post('/api/browser-capture/:id/skip', async (request, reply) => {
    if (!captureAuthorized(request.headers)) return reply.status(401).send({ error: 'Unauthorized' });
    if (!options._captures) return reply.status(503).send({ error: 'Capture is unavailable' });
    const { id } = request.params as { id: string };
    const body = request.body as { reason?: string };
    const allowed = new Set<BrowserCaptureFailureReason>([
      'unsupported_system', 'browser_not_frontmost', 'private_window', 'no_matching_window',
      'capture_failed', 'encoding_failed', 'upload_failed',
    ]);
    const reason = allowed.has(body.reason as BrowserCaptureFailureReason)
      ? body.reason as BrowserCaptureFailureReason
      : 'capture_failed';
    return options._captures.skip(id, reason) ? { success: true } : reply.status(404).send({ error: 'Capture not found' });
  });

  app.get('/api/source-items/:id/capture/:variant', async (request, reply) => {
    const { id, variant } = request.params as { id: string; variant: string };
    if (!['thumbnail', 'full'].includes(variant)) return reply.status(404).send({ error: 'Capture not found' });
    const asset = captureAssetRepo.getBySourceItem(id);
    const path = variant === 'full' ? asset?.full_path : asset?.thumbnail_path;
    if (!asset || !path || !existsSync(path)) return reply.status(404).send({ error: 'Capture not found' });
    reply.header('Content-Type', asset.mime_type);
    reply.header('Cache-Control', 'private, no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(createReadStream(path));
  });

  app.get('/api/events', async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    const listener = (event: TraceLiveEvent) => {
      reply.raw.write(`event: trace\ndata: ${JSON.stringify(event)}\n\n`);
    };
    options._automation?.events.on('event', listener);
    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 20_000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      options._automation?.events.off('event', listener);
    });
  });

  app.get('/api/live', async () => {
    const states: ApiWorkingState[] = workingStateRepo.listRecent(50).map((state) => {
      const branch = branchRepo.getById(state.branch_id);
      const thread = branch ? threadRepo.getById(branch.thread_id) : undefined;
      return {
        id: state.id, branchId: state.branch_id, threadId: thread?.id ?? '', threadTitle: thread?.title ?? 'Unknown decision',
        researchQuestion: state.research_question, summary: state.summary, options: state.options,
        constraints: state.constraints, openQuestions: state.open_questions,
        tentativeDirection: state.tentative_direction ?? undefined, changedFactors: state.changed_factors,
        evidenceIds: state.evidence_ids,
        evidence: state.evidence_ids.map((id) => sourceItemRepo.getById(id)).filter((item): item is SourceItem => Boolean(item)).map((item) => toApiSourceItem(item, captureAssetRepo)),
        status: state.status, lastEventAt: state.last_event_at,
        checkpointDueAt: state.checkpoint_due_at,
        comparison: toApiComparison(state.comparison, comparisonOverrideRepo.listByBranch(state.branch_id)),
      };
    });
    const actions = automationActionRepo.list(100).map((action) => ({
      id: action.id, action: action.action, sourceItemId: action.source_item_id ?? undefined,
      threadId: action.thread_id ?? undefined, branchId: action.branch_id ?? undefined,
      threadTitle: action.thread_id ? threadRepo.getById(action.thread_id)?.title : undefined,
      confidence: action.confidence ?? undefined, rationale: action.rationale,
      latencyMs: action.latency_ms ?? undefined, status: action.status, undoable: action.undoable,
      createdAt: action.created_at,
    }));
    const sources = sourceItemRepo.listRecent(100)
      .filter((item) => ['pending', 'processing', 'error'].includes(item.automation_status))
      .map((item) => toApiSourceItem(item, captureAssetRepo));
    return { states, actions, sources, capture: options._captures?.health() ?? null };
  });

  app.post('/api/automation/:itemId/retry', async (request, reply) => {
    if (!options._automation) return reply.status(503).send({ error: 'Automation is not running' });
    const { itemId } = request.params as { itemId: string };
    return (await options._automation.retry(itemId)) ? { success: true } : reply.status(409).send({ error: 'Item is not retryable' });
  });

  app.post('/api/automation/actions/:actionId/undo', async (request, reply) => {
    if (!options._automation) return reply.status(503).send({ error: 'Automation is not running' });
    const { actionId } = request.params as { actionId: string };
    const result = await options._automation.undo(actionId);
    return result.ok ? { success: true } : reply.status(409).send({ error: result.reason });
  });

  // ---------------------------------------------------------------------------
  // Feed
  // ---------------------------------------------------------------------------

  app.get('/api/feed', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 20, minimum: 1 },
          offset: { type: 'integer', default: 0, minimum: 0 },
          unreadOnly: { type: 'boolean' },
        },
      },
    },
  }, async (request) => {
    const { limit = 20, offset = 0, unreadOnly = false } = request.query as {
      limit?: number;
      offset?: number;
      unreadOnly?: boolean;
    };

    const grouped = groupFeedEvents(feedEventRepo.listAll(), threadRepo, commitRepo);
    const visible = unreadOnly ? grouped.filter((event) => !event.read) : grouped;
    return {
      events: visible.slice(offset, offset + limit),
      total: visible.length,
      unread: grouped.filter((event) => !event.read).length,
    };
  });

  app.patch('/api/feed/read', {
    schema: {
      body: {
        type: 'object', required: ['eventIds'], additionalProperties: false,
        properties: { eventIds: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string' } } },
      },
    },
  }, async (request) => {
    const { eventIds } = request.body as { eventIds: string[] };
    return { success: true, updated: feedEventRepo.markReadMany([...new Set(eventIds)]) };
  });

  // ---------------------------------------------------------------------------
  // Threads – list
  // ---------------------------------------------------------------------------

  app.get('/api/threads', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'closed', 'all'] },
          search: { type: 'string' },
          sort: { type: 'string', enum: ['recent', 'stale'] },
          limit: { type: 'integer', default: 20, minimum: 1 },
          offset: { type: 'integer', default: 0, minimum: 0 },
        },
      },
    },
  }, async (request) => {
    const {
      status = 'all',
      search,
      sort = 'recent',
      limit = 20,
      offset = 0,
    } = request.query as {
      status?: string;
      search?: string;
      sort?: string;
      limit?: number;
      offset?: number;
    };

    const statusFilter = status === 'all' ? undefined : (status as 'open' | 'closed');
    let threads = threadRepo.list({ status: statusFilter });

    if (search) {
      const q = search.toLowerCase();
      threads = threads.filter((t) => t.title.toLowerCase().includes(q));
    }

    const total = threads.length;
    const sortedThreads = threads
      .map(toApiThread)
      .sort((a, b) => sort === 'stale'
        ? a.lastActivity.localeCompare(b.lastActivity)
        : b.lastActivity.localeCompare(a.lastActivity));
    const page = sortedThreads.slice(offset, offset + limit);

    return { threads: page, total };
  });

  app.get('/api/search', {
    schema: {
      querystring: {
        type: 'object', required: ['q'], additionalProperties: false,
        properties: { q: { type: 'string', minLength: 1, maxLength: 160 }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
      },
    },
  }, async (request) => {
    const { q, limit = 20 } = request.query as { q: string; limit?: number };
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const results: ApiSearchResult[] = threadRepo.list().map((thread) => {
      const apiThread = toApiThread(thread);
      const commits = branchRepo.listByThread(thread.id).flatMap((branch) => commitRepo.listByBranch(branch.id));
      const evidence = sourceItemRepo.listByThread(thread.id);
      const titleText = `${thread.title} ${thread.tags.join(' ')}`.toLowerCase();
      const verdictText = commits.map((commit) => `${commit.verdict_summary} ${commit.reasoning}`).join(' ').toLowerCase();
      const evidenceText = evidence.map((item) => `${item.raw_text ?? ''} ${item.url ?? ''}`).join(' ').toLowerCase();
      const titleHits = tokens.filter((token) => titleText.includes(token)).length;
      const verdictHits = tokens.filter((token) => verdictText.includes(token)).length;
      const evidenceHits = tokens.filter((token) => evidenceText.includes(token)).length;
      const score = titleHits * 5 + verdictHits * 3 + evidenceHits;
      const latestCommit = commits.at(-1);
      const matchingEvidence = evidence.find((item) => tokens.some((token) => `${item.raw_text ?? ''} ${item.url ?? ''}`.toLowerCase().includes(token)));
      const matchType: ApiSearchResult['matchType'] = titleHits ? 'decision' : verdictHits ? 'verdict' : 'evidence';
      const excerpt = matchType === 'decision' ? (latestCommit?.verdict_summary ?? 'Open decision')
        : matchType === 'verdict' ? (latestCommit?.verdict_summary ?? latestCommit?.reasoning ?? '')
          : (matchingEvidence?.raw_text ?? matchingEvidence?.url ?? 'Matching evidence');
      return { threadId: thread.id, threadTitle: thread.title, status: thread.status, lastActivity: apiThread.lastActivity, matchType, excerpt: excerpt.slice(0, 220), score };
    }).filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || b.lastActivity.localeCompare(a.lastActivity))
      .slice(0, limit);
    return { results };
  });

  // ---------------------------------------------------------------------------
  // Threads – detail
  // ---------------------------------------------------------------------------

  app.get('/api/threads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const thread = threadRepo.getById(id);

    if (!thread) {
      return reply.status(404).send({ error: 'Thread not found' });
    }

    const branches = branchRepo.listByThread(id);
    const items = sourceItemRepo.listByThread(id);
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const apiThread = toApiThread(thread);
    const apiBranches = branches.map((branch) => {
      const commits = commitRepo.listByBranch(branch.id);
      return {
        id: branch.id,
        contextLabel: branch.context_label ?? 'Original decision',
        commits: commits.map((commit, index) => ({
          id: commit.id,
          parentId: index === 0 ? branch.parent_commit_id : commits[index - 1].id,
          branchId: branch.parent_commit_id === null ? null : branch.id,
          verdictSummary: commit.verdict_summary,
          reasoning: commit.reasoning,
          createdAt: commit.created_at,
          regret: commit.regret,
          kind: commit.kind,
          resolutionStatus: commit.resolution_status,
          comparison: toApiComparison(commit.comparison, comparisonOverrideRepo.listByBranch(branch.id)),
          outcome: toApiOutcome(decisionOutcomeRepo.getByCommit(commit.id)),
          sourceItems: commit.source_item_ids
            .map((itemId) => itemMap.get(itemId))
            .filter((item): item is SourceItem => Boolean(item))
            .map((item) => toApiSourceItem(item, captureAssetRepo)),
        })),
      };
    });
    const latest = commitRepo.getLatestByThread(id);
    const response: ApiThreadDetail = {
      ...apiThread,
      verdictSummary: latest?.verdict_summary,
      reasoning: latest?.reasoning,
      branches: apiBranches,
      workingStates: workingStateRepo.listRecent(100)
        .filter((state) => branches.some((branch) => branch.id === state.branch_id))
        .map((state) => ({
          id: state.id, branchId: state.branch_id, threadId: thread.id, threadTitle: thread.title,
          researchQuestion: state.research_question, summary: state.summary, options: state.options,
          constraints: state.constraints, openQuestions: state.open_questions,
          tentativeDirection: state.tentative_direction ?? undefined, changedFactors: state.changed_factors,
          evidenceIds: state.evidence_ids,
          evidence: state.evidence_ids.map((itemId) => itemMap.get(itemId)).filter((item): item is SourceItem => Boolean(item)).map((item) => toApiSourceItem(item, captureAssetRepo)),
          status: state.status, lastEventAt: state.last_event_at,
          checkpointDueAt: state.checkpoint_due_at,
          comparison: toApiComparison(state.comparison, comparisonOverrideRepo.listByBranch(state.branch_id)),
        })),
      story: buildResearchStory(branches, apiBranches, workingStateRepo.listRecent(100).filter((state) => branches.some((branch) => branch.id === state.branch_id)), itemMap, captureAssetRepo, mergeEventRepo.listByThread(id)),
      currentAnswer: buildCurrentAnswer(latest, workingStateRepo.listRecent(100).filter((state) => branches.some((branch) => branch.id === state.branch_id))),
      comparison: buildCurrentComparison(latest, workingStateRepo.listRecent(100).filter((state) => branches.some((branch) => branch.id === state.branch_id)), comparisonOverrideRepo),
      resume: buildResume(branches, workingStateRepo.listRecent(100).filter((state) => branches.some((branch) => branch.id === state.branch_id)), items, captureAssetRepo),
      outcomeReview: buildOutcomeReview(branches.flatMap((branch) => commitRepo.listByBranch(branch.id)), decisionOutcomeRepo),
    };
    return response;
  });

  app.get('/api/threads/:id/export', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { format = 'markdown' } = request.query as { format?: 'markdown' | 'adr' };
    const thread = threadRepo.getById(id);
    if (!thread) return reply.status(404).send({ error: 'Thread not found' });
    const branches = branchRepo.listByThread(id);
    const commits = branches.flatMap((branch) => commitRepo.listByBranch(branch.id).map((commit) => ({ branch, commit })));
    const latest = commits.sort((a, b) => a.commit.created_at.localeCompare(b.commit.created_at)).at(-1)?.commit;
    const title = format === 'adr' ? `ADR: ${thread.title}` : thread.title;
    const lines = [`# ${title}`, '', `Status: ${thread.status}`, `Last updated: ${toApiThread(thread).lastActivity}`, ''];
    if (latest) lines.push('## Current answer', '', latest.verdict_summary, '', '## Why', '', latest.reasoning, '');
    lines.push('## Research history', '');
    for (const { branch, commit } of commits) {
      lines.push(`### ${commit.created_at.slice(0, 10)} · ${branch.context_label ?? 'Original context'}`, '', commit.verdict_summary, '', commit.reasoning, '');
      for (const itemId of commit.source_item_ids) {
        const item = sourceItemRepo.getById(itemId);
        if (item?.url) lines.push(`- [${(item.raw_text ?? item.url).slice(0, 100)}](${item.url})`);
      }
      lines.push('');
    }
    reply.type('text/markdown; charset=utf-8').header('Content-Disposition', `attachment; filename="trace-${id.slice(0, 8)}.md"`);
    return lines.join('\n');
  });

  app.patch('/api/branches/:branchId/comparison-overrides/:optionId/:criterionId', {
    schema: {
      body: {
        type: 'object', required: ['value', 'status'], additionalProperties: false,
        properties: {
          value: { type: 'string', maxLength: 500 },
          status: { type: 'string', enum: ['supported', 'unknown', 'conflicting', 'assumption'] },
          pinned: { type: 'boolean', default: false },
        },
      },
    },
  }, async (request, reply) => {
    const { branchId, optionId, criterionId } = request.params as { branchId: string; optionId: string; criterionId: string };
    if (!branchRepo.getById(branchId)) return reply.status(404).send({ error: 'Branch not found' });
    const body = request.body as { value: string; status: 'supported' | 'unknown' | 'conflicting' | 'assumption'; pinned?: boolean };
    const override = comparisonOverrideRepo.upsert({ branch_id: branchId, option_id: optionId, criterion_id: criterionId, value: body.value.trim(), status: body.status, pinned: body.pinned ?? false });
    automationActionRepo.create({ action: 'comparison_corrected', source_item_id: null, thread_id: branchRepo.getById(branchId)!.thread_id, branch_id: branchId, model: null, confidence: null, rationale: 'User corrected a comparison cell.', context_snapshot: { optionId, criterionId }, before_snapshot: {}, after_snapshot: { value: override.value, status: override.status, pinned: override.pinned }, latency_ms: null, status: 'applied', undoable: false });
    return { success: true, override };
  });

  app.delete('/api/branches/:branchId/comparison-overrides/:optionId/:criterionId', async (request, reply) => {
    const { branchId, optionId, criterionId } = request.params as { branchId: string; optionId: string; criterionId: string };
    if (!branchRepo.getById(branchId)) return reply.status(404).send({ error: 'Branch not found' });
    return { success: true, deleted: comparisonOverrideRepo.delete(branchId, optionId, criterionId) };
  });

  // ---------------------------------------------------------------------------
  // Threads – tree
  // ---------------------------------------------------------------------------

  app.get('/api/threads/:id/tree', async (request, reply) => {
    const { id } = request.params as { id: string };
    const thread = threadRepo.getById(id);

    if (!thread) {
      return reply.status(404).send({ error: 'Thread not found' });
    }

    const branches = branchRepo.listByThread(id);
    const commitsByBranch = new Map<string, Commit[]>();
    for (const branch of branches) {
      commitsByBranch.set(branch.id, commitRepo.listByBranch(branch.id));
    }
    const mergeEvents = mergeEventRepo.listByThread(id);

    return buildTree(branches, commitsByBranch, mergeEvents);
  });

  // ---------------------------------------------------------------------------
  // Capture
  // ---------------------------------------------------------------------------

  app.get('/api/capture', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 20, minimum: 1 },
        },
      },
    },
  }, async (request) => {
    const { limit = 20 } = request.query as { limit?: number };
    const items = sourceItemRepo.listUnprocessed({ newestFirst: true, limit });

    const captureItems: CaptureItem[] = items.map((item) => {
      let suggestion: CaptureItem['suggestion'];
      if (item.thread_id) {
        const thread = threadRepo.getById(item.thread_id);
        if (thread) {
          suggestion = {
            threadId: thread.id,
            threadTitle: thread.title,
            confidence: item.clustering_confidence ?? 0,
          };
        }
      }
      return { ...toApiSourceItem(item, captureAssetRepo), suggestion };
    });

    return { items: captureItems };
  });

  // ---------------------------------------------------------------------------
  // Corrections
  // ---------------------------------------------------------------------------

  app.post('/api/corrections/reassign', {
    schema: {
      body: {
        type: 'object',
        required: ['itemId', 'targetThreadId'],
        properties: {
          itemId: { type: 'string' },
          targetThreadId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { itemId, targetThreadId } = request.body as {
      itemId: string;
      targetThreadId: string;
    };

    if (!sourceItemRepo.getById(itemId)) {
      return reply.status(404).send({ error: 'Item not found' });
    }
    if (!threadRepo.getById(targetThreadId)) {
      return reply.status(404).send({ error: 'Target thread not found' });
    }

    correctionAgent.reassign(itemId, targetThreadId);
    return { success: true };
  });

  app.post('/api/corrections/merge-threads', {
    schema: {
      body: {
        type: 'object',
        required: ['sourceThreadId', 'targetThreadId'],
        properties: {
          sourceThreadId: { type: 'string' },
          targetThreadId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { sourceThreadId, targetThreadId } = request.body as {
      sourceThreadId: string;
      targetThreadId: string;
    };

    if (!threadRepo.getById(sourceThreadId)) {
      return reply.status(404).send({ error: 'Source thread not found' });
    }
    if (!threadRepo.getById(targetThreadId)) {
      return reply.status(404).send({ error: 'Target thread not found' });
    }

    correctionAgent.mergeThreads(sourceThreadId, targetThreadId);
    return { success: true };
  });

  app.post('/api/corrections/new-thread', {
    schema: {
      body: {
        type: 'object',
        required: ['itemId', 'title'],
        properties: {
          itemId: { type: 'string' },
          title: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { itemId, title } = request.body as { itemId: string; title: string };

    if (!sourceItemRepo.getById(itemId)) {
      return reply.status(404).send({ error: 'Item not found' });
    }

    return correctionAgent.splitToNewThread(itemId, title);
  });

  app.post('/api/corrections/confirm', {
    schema: {
      body: {
        type: 'object',
        required: ['itemId'],
        properties: {
          itemId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { itemId } = request.body as { itemId: string };

    if (!sourceItemRepo.getById(itemId)) {
      return reply.status(404).send({ error: 'Item not found' });
    }

    correctionAgent.confirm(itemId);
    return { success: true };
  });

  app.post('/api/corrections/ignore', {
    schema: {
      body: {
        type: 'object',
        required: ['itemId'],
        properties: {
          itemId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { itemId } = request.body as { itemId: string };

    if (!sourceItemRepo.getById(itemId)) {
      return reply.status(404).send({ error: 'Item not found' });
    }

    sourceItemRepo.markIgnored(itemId, null);
    return { success: true };
  });

  // ---------------------------------------------------------------------------
  // Actions – commit regret
  // ---------------------------------------------------------------------------

  app.post('/api/commits/:id/regret', {
    schema: {
      body: {
        type: 'object',
        properties: {
          note: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { note = '' } = request.body as { note?: string };

    if (!commitRepo.getById(id)) {
      return reply.status(404).send({ error: 'Commit not found' });
    }

    commitRepo.addRegret(id, note);
    decisionOutcomeRepo.upsert(id, 'regretted', note);
    return { success: true };
  });

  app.put('/api/commits/:id/outcome', {
    schema: {
      body: {
        type: 'object', required: ['status'], additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['worked', 'mixed', 'regretted', 'superseded'] },
          note: { type: 'string', maxLength: 1000 },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const commit = commitRepo.getById(id);
    if (!commit || commit.resolution_status !== 'resolved') {
      return reply.status(404).send({ error: 'Resolved decision not found' });
    }
    const { status, note = '' } = request.body as { status: DecisionOutcomeStatus; note?: string };
    const outcome = decisionOutcomeRepo.upsert(id, status, note);
    commitRepo.setRegret(id, status === 'regretted', note);
    const branch = branchRepo.getById(commit.branch_id);
    automationActionRepo.create({
      action: 'outcome_recorded', source_item_id: null, thread_id: branch?.thread_id ?? null,
      branch_id: commit.branch_id, model: null, confidence: null,
      rationale: `Decision outcome recorded as ${status}.`, context_snapshot: { commitId: id },
      before_snapshot: {}, after_snapshot: { status, note: note.trim() }, latency_ms: null,
      status: 'applied', undoable: false,
    });
    return { success: true, outcome: toApiOutcome(outcome) };
  });

  // ---------------------------------------------------------------------------
  // Actions – thread merge
  // ---------------------------------------------------------------------------

  app.post('/api/threads/:id/merge', {
    schema: {
      body: {
        type: 'object',
        required: ['sourceBranchIds', 'resolvedRule'],
        properties: {
          sourceBranchIds: { type: 'array', items: { type: 'string' } },
          resolvedRule: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { sourceBranchIds, resolvedRule } = request.body as {
      sourceBranchIds: string[];
      resolvedRule: string;
    };

    if (!threadRepo.getById(id)) {
      return reply.status(404).send({ error: 'Thread not found' });
    }

    const uniqueBranchIds = [...new Set(sourceBranchIds)];
    if (uniqueBranchIds.length < 2) {
      return reply.status(400).send({ error: 'At least two distinct source branches are required' });
    }
    if (!resolvedRule.trim()) {
      return reply.status(400).send({ error: 'resolvedRule is required' });
    }
    const validBranches = branchRepo.listByThread(id);
    if (uniqueBranchIds.some((branchId) => !validBranches.some((branch) => branch.id === branchId))) {
      return reply.status(400).send({ error: 'All source branches must belong to this thread' });
    }

    // Create the resulting commit on the first source branch
    const commit = commitRepo.create({
      branch_id: uniqueBranchIds[0],
      verdict_summary: `Merge of ${uniqueBranchIds.length} branches`,
      reasoning: resolvedRule,
    source_item_ids: [],
      kind: 'merge',
      resolution_status: 'resolved',
    });

    const mergeEvent = mergeEventRepo.create({
      thread_id: id,
      source_branch_ids: uniqueBranchIds,
      resulting_commit_id: commit.id,
      resolved_rule: resolvedRule,
      origin: 'manual',
    });

    threadRepo.updateStatus(id, 'closed');
    return { mergeEventId: mergeEvent.id, commitId: commit.id };
  });

  // ---------------------------------------------------------------------------
  // Actions – mark feed event read
  // ---------------------------------------------------------------------------

  app.patch('/api/feed/:id/read', async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = feedEventRepo.markRead(id);

    if (!event) {
      return reply.status(404).send({ error: 'Feed event not found' });
    }

    return { success: true };
  });

  return app;
}

// ---------------------------------------------------------------------------
// Tree builder helper
// ---------------------------------------------------------------------------

export function buildTree(
  branches: Branch[],
  commitsByBranch: Map<string, Commit[]>,
  mergeEvents: MergeEvent[],
): { nodes: TreeNode[]; edges: TreeEdge[] } {
  const nodes: TreeNode[] = [];
  const edges: TreeEdge[] = [];

  const trunkIds = new Set(branches.filter((branch) => branch.parent_commit_id === null).map((branch) => branch.id));
  const mergeResultIds = new Set(mergeEvents.map((event) => event.resulting_commit_id));

  for (const branch of branches) {
    const commits = commitsByBranch.get(branch.id) ?? [];
    for (const commit of commits) {
      nodes.push({
        id: commit.id,
        type: 'commit',
        branchId: trunkIds.has(branch.id) ? null : branch.id,
        contextLabel: branch.context_label ?? undefined,
        regret: commit.regret,
        createdAt: commit.created_at,
      });
    }
  }

  // Merge event nodes
  for (const me of mergeEvents) {
    const firstBranch = branches.find((b) => b.id === me.source_branch_ids[0]);
    nodes.push({
      id: me.id,
      type: 'merge',
      branchId: firstBranch && trunkIds.has(firstBranch.id) ? null : firstBranch?.id ?? null,
      contextLabel: `Merge: ${me.resolved_rule}`,
      regret: false,
      createdAt: me.created_at,
    });
  }

  // Sequential edges (within each branch, commit → next commit)
  for (const branch of branches) {
    const commits = (commitsByBranch.get(branch.id) ?? []).filter((commit) => !mergeResultIds.has(commit.id));
    for (let i = 0; i < commits.length - 1; i++) {
      edges.push({ from: commits[i].id, to: commits[i + 1].id, type: 'sequential' });
    }
  }

  // Branch edges (parent_commit_id → first commit of branch)
  for (const branch of branches) {
    if (branch.parent_commit_id) {
      const commits = commitsByBranch.get(branch.id) ?? [];
      if (commits.length > 0) {
        edges.push({
          from: branch.parent_commit_id,
          to: commits[0].id,
          type: 'branch',
        });
      }
    }
  }

  // Merge edges (last commit of each source branch → merge event → resulting commit)
  for (const me of mergeEvents) {
    for (const branchId of me.source_branch_ids) {
      const commits = (commitsByBranch.get(branchId) ?? [])
        .filter((commit) => commit.id !== me.resulting_commit_id);
      if (commits.length > 0) {
        edges.push({
          from: commits[commits.length - 1].id,
          to: me.id,
          type: 'merge',
        });
      }
    }
    edges.push({ from: me.id, to: me.resulting_commit_id, type: 'merge' });
  }

  return { nodes, edges };
}

function toApiSourceItem(item: SourceItem, captureAssets: CaptureAssetRepository) {
  const asset = captureAssets.getBySourceItem(item.id);
  const hasThumbnail = Boolean(asset && existsSync(asset.thumbnail_path));
  const hasFull = Boolean(asset?.full_path && existsSync(asset.full_path));
  return {
    id: item.id,
    type: item.type,
    rawText: item.raw_text ?? '',
    url: item.url ?? undefined,
    capturedAt: item.captured_at,
    automationStatus: item.automation_status,
    contentStatus: item.content_status,
    errorMessage: item.error_message ?? undefined,
    captureStatus: item.capture_status,
    captureReason: item.capture_reason ?? undefined,
    capture: asset && hasThumbnail ? {
      thumbnailUrl: `/api/source-items/${item.id}/capture/thumbnail`,
      fullUrl: hasFull ? `/api/source-items/${item.id}/capture/full` : undefined,
      width: asset.width,
      height: asset.height,
      capturedAt: asset.captured_at,
    } : undefined,
  };
}

function toApiComparison(matrix: ComparisonMatrix, overrides: ComparisonOverride[] = []): ApiComparisonMatrix {
  const cells = matrix.cells.map((cell) => ({
    optionId: cell.option_id,
    criterionId: cell.criterion_id,
    value: cell.value,
    status: cell.status,
    sourceItemIds: cell.source_item_ids,
  }));
  for (const override of overrides) {
    const existing = cells.find((cell) => cell.optionId === override.option_id && cell.criterionId === override.criterion_id);
    const replacement = {
      optionId: override.option_id, criterionId: override.criterion_id, value: override.value,
      status: override.status, sourceItemIds: existing?.sourceItemIds ?? [], corrected: true, pinned: override.pinned,
    };
    if (existing) Object.assign(existing, replacement);
    else cells.push(replacement);
  }
  return { options: matrix.options, criteria: matrix.criteria, cells };
}

function buildCurrentComparison(latest: Commit | undefined, states: BranchWorkingState[], overrides: ComparisonOverrideRepository): ApiComparisonMatrix {
  const state = [...states].sort((a, b) => b.last_event_at.localeCompare(a.last_event_at))[0];
  if (state && (!latest || state.last_event_at >= latest.created_at)) return toApiComparison(state.comparison, overrides.listByBranch(state.branch_id));
  return latest ? toApiComparison(latest.comparison, overrides.listByBranch(latest.branch_id)) : { options: [], criteria: [], cells: [] };
}

function buildCurrentAnswer(latest: Commit | undefined, states: BranchWorkingState[]): ApiThreadDetail['currentAnswer'] {
  const state = [...states].sort((a, b) => b.last_event_at.localeCompare(a.last_event_at))[0];
  if (state?.tentative_direction && (!latest || state.last_event_at >= latest.created_at)) {
    return { text: state.tentative_direction, reasoning: state.summary, status: 'working', branchId: state.branch_id, updatedAt: state.last_event_at, sourceCount: state.evidence_ids.length };
  }
  if (!latest) return undefined;
  return { text: latest.verdict_summary, reasoning: latest.reasoning, status: 'committed', branchId: latest.branch_id, updatedAt: latest.created_at, sourceCount: latest.source_item_ids.length };
}

function toApiOutcome(outcome: DecisionOutcome | undefined): NonNullable<ApiThreadDetail['outcomeReview']>['outcome'] {
  if (!outcome) return undefined;
  return { status: outcome.status, note: outcome.note, updatedAt: outcome.updated_at };
}

function buildOutcomeReview(commits: Commit[], outcomes: DecisionOutcomeRepository): ApiThreadDetail['outcomeReview'] {
  const decision = commits
    .filter((commit) => commit.resolution_status === 'resolved')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .at(-1);
  if (!decision) return undefined;
  return {
    commitId: decision.id,
    branchId: decision.branch_id,
    decision: decision.verdict_summary,
    decidedAt: decision.created_at,
    outcome: toApiOutcome(outcomes.getByCommit(decision.id)) ?? (decision.regret
      ? { status: 'regretted', note: decision.regret_note ?? '', updatedAt: decision.created_at }
      : undefined),
  };
}

function buildResume(
  branches: Branch[],
  states: BranchWorkingState[],
  items: SourceItem[],
  captures: CaptureAssetRepository,
): ApiThreadDetail['resume'] {
  const state = [...states].sort((a, b) => b.last_event_at.localeCompare(a.last_event_at))[0];
  const branchId = state?.branch_id ?? branches.at(-1)?.id;
  const preferredIds = new Set(state?.evidence_ids ?? []);
  const candidates = [...items]
    .filter((item) => item.url && (!branchId || item.branch_id === branchId || preferredIds.has(item.id)))
    .sort((a, b) => b.captured_at.localeCompare(a.captured_at));
  const seen = new Set<string>();
  const pages = candidates.filter((item) => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, 3).map((item) => {
    const capture = captures.getBySourceItem(item.id);
    return {
      id: item.id, title: (item.raw_text ?? item.url!).split('\n')[0].slice(0, 120), url: item.url!, capturedAt: item.captured_at,
      thumbnailUrl: capture && existsSync(capture.thumbnail_path) ? `/api/source-items/${item.id}/capture/thumbnail` : undefined,
    };
  });
  return {
    branchId,
    nextQuestion: state?.open_questions[0],
    summary: state?.summary ?? 'Review the latest checkpoint and continue from the most recent supporting evidence.',
    pages,
  };
}

function buildResearchStory(
  branches: Branch[],
  apiBranches: ApiThreadDetail['branches'],
  states: BranchWorkingState[],
  itemMap: Map<string, SourceItem>,
  captures: CaptureAssetRepository,
  mergeEvents: MergeEvent[],
): ApiThreadDetail['story'] {
  const commitsByBranch = new Map<string, Commit[]>();
  for (const branch of branches) commitsByBranch.set(branch.id, branch.id ? [] : []);
  for (const apiBranch of apiBranches) {
    commitsByBranch.set(apiBranch.id, apiBranch.commits.map((commit) => ({
      id: commit.id, branch_id: apiBranch.id, verdict_summary: commit.verdictSummary, reasoning: commit.reasoning,
      source_item_ids: commit.sourceItems.map((item) => item.id), created_at: commit.createdAt, regret: commit.regret,
      regret_note: null, kind: commit.kind ?? 'checkpoint', resolution_status: commit.resolutionStatus ?? 'in_progress', comparison: { options: [], criteria: [], cells: [] },
    })));
  }
  const tree = buildTree(branches, commitsByBranch, mergeEvents);
  const nodes: ApiResearchStoryNode[] = apiBranches.flatMap((apiBranch) => apiBranch.commits.map((commit) => ({
    id: commit.id,
    kind: commit.kind === 'merge' ? 'merge' : commit.resolutionStatus === 'resolved' ? 'decision' : 'checkpoint',
    branchId: apiBranch.id,
    contextLabel: apiBranch.contextLabel,
    title: commit.verdictSummary,
    summary: commit.reasoning,
    createdAt: commit.createdAt,
    status: commit.resolutionStatus ?? 'in_progress',
    sourceItems: commit.sourceItems,
    commitId: commit.id,
    origin: commit.kind === 'merge' ? mergeEvents.find((event) => event.resulting_commit_id === commit.id)?.origin : undefined,
  } satisfies ApiResearchStoryNode)));
  for (const event of mergeEvents) {
    if (nodes.some((node) => node.id === event.id)) continue;
    nodes.push({ id: event.id, kind: 'merge', branchId: event.source_branch_ids[0] ?? '', contextLabel: 'Reconciled contexts', title: event.origin === 'automatic' ? 'Automatically reconciled' : 'Manual override reconciliation', summary: event.resolved_rule, createdAt: event.created_at, status: 'resolved', sourceItems: [], origin: event.origin });
  }
  const edges = [...tree.edges];
  for (const state of states) {
    const branch = branches.find((candidate) => candidate.id === state.branch_id);
    if (!branch) continue;
    const sourceItems = state.evidence_ids.map((id) => itemMap.get(id)).filter((item): item is SourceItem => Boolean(item)).map((item) => toApiSourceItem(item, captures));
    const id = `working:${state.id}`;
    nodes.push({ id, kind: 'working', branchId: state.branch_id, contextLabel: branch.context_label ?? 'Original research context', title: state.research_question, summary: state.summary, createdAt: state.last_event_at, status: 'working', sourceItems });
    const prior = apiBranches.find((candidate) => candidate.id === state.branch_id)?.commits.at(-1)?.id ?? branch.parent_commit_id;
    if (prior) edges.push({ from: prior, to: id, type: branch.parent_commit_id && !apiBranches.find((candidate) => candidate.id === state.branch_id)?.commits.length ? 'branch' : 'sequential' });
  }
  return { nodes: nodes.sort((a, b) => a.createdAt.localeCompare(b.createdAt)), edges };
}

function groupFeedEvents(
  events: FeedEvent[],
  threads: ThreadRepository,
  commits: CommitRepository,
): ApiFeedEvent[] {
  const grouped: ApiFeedEvent[] = [];
  const openGroups = new Map<string, ApiFeedEvent>();
  const windowMs = 30 * 60 * 1_000;
  for (const event of events) {
    const thread = event.thread_id ? threads.getById(event.thread_id) : undefined;
    const commitId = typeof event.payload.commitId === 'string' ? event.payload.commitId : undefined;
    const commit = commitId ? commits.getById(commitId) : undefined;
    const diff = event.payload.diff as { summary?: string; changedFactors?: string[] } | undefined;
    const resolutionStatus = commit?.resolution_status ?? (
      event.payload.resolutionStatus === 'resolved' ? 'resolved' :
        event.payload.resolutionStatus === 'in_progress' ? 'in_progress' : undefined
    );
    const kind = commit?.kind ?? (
      ['checkpoint', 'resolved', 'merge', 'revert'].includes(String(event.payload.kind))
        ? event.payload.kind as ApiFeedEvent['kind']
        : undefined
    );
    const branchId = commit?.branch_id ?? (typeof event.payload.branchId === 'string' ? event.payload.branchId : undefined);
    const verdict = String(event.payload.verdict ?? event.payload.verdictSummary ?? 'No details');
    const normalized: ApiFeedEvent = {
      id: event.id,
      type: event.type,
      threadId: event.thread_id ?? '',
      threadTitle: thread?.title ?? (event.payload.threadTitle as string | undefined) ?? 'Trace',
      createdAt: event.created_at,
      read: event.read,
      eventIds: [event.id],
      updateCount: 1,
      branchId,
      kind,
      resolutionStatus,
      updates: event.type === 'commit_closed' ? [{ id: event.id, createdAt: event.created_at, verdictSummary: verdict }] : undefined,
      data: {
        ...event.payload,
        diffSummary: diff?.summary,
        changedFactors: diff?.changedFactors,
        verdictSummary: verdict,
      },
    };
    const groupKey = normalized.threadId && normalized.branchId
      ? `${normalized.threadId}:${normalized.branchId}`
      : undefined;
    const newer = groupKey ? openGroups.get(groupKey) : undefined;
    const canGroup = newer && normalized.type === 'commit_closed' && newer.type === 'commit_closed' &&
      normalized.resolutionStatus === 'in_progress' && newer.resolutionStatus === 'in_progress' &&
      new Date(newer.updates?.at(-1)?.createdAt ?? newer.createdAt).getTime() - new Date(normalized.createdAt).getTime() <= windowMs;
    if (canGroup) {
      newer.eventIds.push(event.id);
      newer.updateCount += 1;
      newer.read = newer.read && event.read;
      newer.updates?.push({ id: event.id, createdAt: event.created_at, verdictSummary: verdict });
    } else {
      grouped.push(normalized);
      if (groupKey && normalized.type === 'commit_closed') {
        if (normalized.resolutionStatus === 'in_progress') {
          openGroups.set(groupKey, normalized);
        } else {
          openGroups.delete(groupKey);
        }
      } else if (normalized.type === 'reopen') {
        for (const key of openGroups.keys()) {
          if (key.startsWith(`${normalized.threadId}:`)) openGroups.delete(key);
        }
      }
    }
  }
  return grouped;
}

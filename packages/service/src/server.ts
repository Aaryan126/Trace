import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Database } from 'better-sqlite3';
import {
  createDatabase,
  createInMemoryDatabase,
  ThreadRepository,
  BranchRepository,
  CommitRepository,
  SourceItemRepository,
  MergeEventRepository,
  FeedEventRepository,
  CorrectionAgent,
} from '@trace/core';
import type { Branch, Commit, MergeEvent, SourceItem } from '@trace/core';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
}

export interface TreeNode {
  id: string;
  type: 'commit' | 'merge';
  branchId: string;
  branchLabel: string | null;
  data: Commit | MergeEvent;
}

export interface TreeEdge {
  from: string;
  to: string;
  type: 'sequential' | 'branch' | 'merge';
}

export interface CaptureItem extends SourceItem {
  suggestedThread: { id: string; title: string } | null;
}

// Internal: allow injecting a Database instance for tests
interface CreateServerOptions extends Partial<ServerConfig> {
  _db?: Database;
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

  const correctionAgent = new CorrectionAgent(
    db,
    threadRepo,
    branchRepo,
    sourceItemRepo,
    feedEventRepo,
  );

  // -- Fastify ----------------------------------------------------------------
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
  }));

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

    const events = feedEventRepo.list({ limit, offset, unreadOnly });

    const countSql = unreadOnly
      ? 'SELECT COUNT(*) as count FROM feed_events WHERE read = 0'
      : 'SELECT COUNT(*) as count FROM feed_events';
    const total = (db.prepare(countSql).get() as { count: number }).count;
    const unread = feedEventRepo.countUnread();

    return { events, total, unread };
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

    if (sort === 'stale') {
      threads = [...threads].sort((a, b) => a.created_at.localeCompare(b.created_at));
    }
    // 'recent' is the default order from the repo (ORDER BY created_at DESC)

    const total = threads.length;
    threads = threads.slice(offset, offset + limit);

    return { threads, total };
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
    const commits: Commit[] = [];
    for (const branch of branches) {
      commits.push(...commitRepo.listByBranch(branch.id));
    }

    return { thread, branches, commits };
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
    const items = sourceItemRepo.listUnprocessed().slice(0, limit);

    const captureItems: CaptureItem[] = items.map((item) => {
      let suggestedThread: { id: string; title: string } | null = null;
      if (item.thread_id) {
        const thread = threadRepo.getById(item.thread_id);
        if (thread) {
          suggestedThread = { id: thread.id, title: thread.title };
        }
      }
      return { ...item, suggestedThread };
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
    return { success: true };
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

    if (!Array.isArray(sourceBranchIds) || sourceBranchIds.length === 0) {
      return reply.status(400).send({ error: 'sourceBranchIds must be a non-empty array' });
    }

    // Create the resulting commit on the first source branch
    const commit = commitRepo.create({
      branch_id: sourceBranchIds[0],
      verdict_summary: `Merge of ${sourceBranchIds.length} branches`,
      reasoning: resolvedRule,
      source_item_ids: [],
    });

    const mergeEvent = mergeEventRepo.create({
      thread_id: id,
      source_branch_ids: sourceBranchIds,
      resulting_commit_id: commit.id,
      resolved_rule: resolvedRule,
    });

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

function buildTree(
  branches: Branch[],
  commitsByBranch: Map<string, Commit[]>,
  mergeEvents: MergeEvent[],
): { nodes: TreeNode[]; edges: TreeEdge[] } {
  const nodes: TreeNode[] = [];
  const edges: TreeEdge[] = [];

  // Commit nodes
  for (const branch of branches) {
    const commits = commitsByBranch.get(branch.id) ?? [];
    for (const commit of commits) {
      nodes.push({
        id: commit.id,
        type: 'commit',
        branchId: branch.id,
        branchLabel: branch.context_label,
        data: commit,
      });
    }
  }

  // Merge event nodes
  for (const me of mergeEvents) {
    const firstBranch = branches.find((b) => b.id === me.source_branch_ids[0]);
    nodes.push({
      id: me.id,
      type: 'merge',
      branchId: me.source_branch_ids[0] ?? '',
      branchLabel: firstBranch?.context_label ?? null,
      data: me,
    });
  }

  // Sequential edges (within each branch, commit → next commit)
  for (const branch of branches) {
    const commits = commitsByBranch.get(branch.id) ?? [];
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
      const commits = commitsByBranch.get(branchId) ?? [];
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

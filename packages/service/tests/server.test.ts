import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import {
  createInMemoryDatabase,
  ThreadRepository,
  BranchRepository,
  CommitRepository,
  SourceItemRepository,
  MergeEventRepository,
  FeedEventRepository,
} from '@trace/core';
import { createServer } from '../src/server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let db: Database;
let app: FastifyInstance;

let threadRepo: ThreadRepository;
let branchRepo: BranchRepository;
let commitRepo: CommitRepository;
let sourceItemRepo: SourceItemRepository;
let mergeEventRepo: MergeEventRepository;
let feedEventRepo: FeedEventRepository;

// Shared seed IDs (populated in beforeEach)
let threadOpenId: string;
let threadClosedId: string;
let branchAId: string;
let branchBId: string;
let commitA1Id: string;
let commitA2Id: string;
let commitB1Id: string;
let itemUnprocessedId: string;
let itemAssignedId: string;
let feedEventId: string;

async function seed() {
  // Threads
  const threadOpen = threadRepo.create({ title: 'Open Thread', tags: [], status: 'open' });
  const threadClosed = threadRepo.create({ title: 'Closed Thread', tags: [], status: 'closed' });
  threadOpenId = threadOpen.id;
  threadClosedId = threadClosed.id;

  // Branches
  const branchA = branchRepo.create({
    thread_id: threadOpenId,
    parent_commit_id: null,
    context_label: 'trunk',
  });
  const branchB = branchRepo.create({
    thread_id: threadClosedId,
    parent_commit_id: null,
    context_label: null,
  });
  branchAId = branchA.id;
  branchBId = branchB.id;

  // Commits
  const commitA1 = commitRepo.create({
    branch_id: branchAId,
    verdict_summary: 'First verdict',
    reasoning: 'First reasoning',
    source_item_ids: [],
  });
  const commitA2 = commitRepo.create({
    branch_id: branchAId,
    verdict_summary: 'Second verdict',
    reasoning: 'Second reasoning',
    source_item_ids: [],
  });
  const commitB1 = commitRepo.create({
    branch_id: branchBId,
    verdict_summary: 'Branch B verdict',
    reasoning: 'Branch B reasoning',
    source_item_ids: [],
  });
  commitA1Id = commitA1.id;
  commitA2Id = commitA2.id;
  commitB1Id = commitB1.id;

  // Source items
  const itemUnprocessed = sourceItemRepo.create({
    type: 'browser_history',
    raw_text: 'some history text',
    extracted_entities: null,
    url: 'https://example.com',
    captured_at: new Date().toISOString(),
    thread_id: null,
  });
  const itemAssigned = sourceItemRepo.create({
    type: 'screenshot',
    raw_text: 'screenshot text',
    extracted_entities: null,
    url: null,
    captured_at: new Date().toISOString(),
    thread_id: threadOpenId,
  });
  itemUnprocessedId = itemUnprocessed.id;
  itemAssignedId = itemAssigned.id;

  // Feed events
  const feedEvent = feedEventRepo.create({
    type: 'digest',
    thread_id: threadOpenId,
    payload: { summary: 'test digest' },
  });
  feedEventRepo.create({
    type: 'nudge',
    thread_id: threadOpenId,
    payload: { message: 'review needed' },
  });
  feedEventId = feedEvent.id;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(async () => {
  db = createInMemoryDatabase();
  threadRepo = new ThreadRepository(db);
  branchRepo = new BranchRepository(db);
  commitRepo = new CommitRepository(db);
  sourceItemRepo = new SourceItemRepository(db);
  mergeEventRepo = new MergeEventRepository(db);
  feedEventRepo = new FeedEventRepository(db);

  app = await createServer({ _db: db });
  await app.ready();

  await seed();
});

afterEach(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });
});

describe('GET /api/feed', () => {
  it('returns events with total and unread count', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/feed' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.events).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.unread).toBe(2); // both events are unread
  });

  it('returns empty list when no events exist', async () => {
    // Delete all feed events
    db.prepare('DELETE FROM feed_events').run();
    const res = await app.inject({ method: 'GET', url: '/api/feed' });
    const body = JSON.parse(res.body);
    expect(body.events).toHaveLength(0);
    expect(body.total).toBe(0);
    expect(body.unread).toBe(0);
  });

  it('filters unread events with unreadOnly=true', async () => {
    // Mark one as read
    feedEventRepo.markRead(feedEventId);
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed?unreadOnly=true',
    });
    const body = JSON.parse(res.body);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].read).toBe(false);
    expect(body.unread).toBe(1);
  });

  it('respects limit and offset', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed?limit=1&offset=0',
    });
    const body = JSON.parse(res.body);
    expect(body.events).toHaveLength(1);
    expect(body.total).toBe(2);
  });
});

describe('GET /api/threads', () => {
  it('returns empty list when no threads', async () => {
    db.prepare('DELETE FROM threads').run();
    const res = await app.inject({ method: 'GET', url: '/api/threads' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.threads).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('returns all threads by default', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/threads' });
    const body = JSON.parse(res.body);
    expect(body.threads).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('filters by status=open', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/threads?status=open',
    });
    const body = JSON.parse(res.body);
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0].title).toBe('Open Thread');
  });

  it('filters by status=closed', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/threads?status=closed',
    });
    const body = JSON.parse(res.body);
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0].title).toBe('Closed Thread');
  });

  it('filters by search text', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/threads?search=Open',
    });
    const body = JSON.parse(res.body);
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0].title).toBe('Open Thread');
  });

  it('sorts by stale (oldest first)', async () => {
    // Create threads with a time gap
    db.prepare('DELETE FROM threads').run();
    const old = threadRepo.create({ title: 'Old Thread', tags: [], status: 'open' });
    // Force older timestamp
    db.prepare('UPDATE threads SET created_at = ? WHERE id = ?').run(
      '2020-01-01T00:00:00.000Z',
      old.id,
    );
    threadRepo.create({ title: 'New Thread', tags: [], status: 'open' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/threads?sort=stale',
    });
    const body = JSON.parse(res.body);
    expect(body.threads[0].title).toBe('Old Thread');
    expect(body.threads[1].title).toBe('New Thread');
  });
});

describe('GET /api/threads/:id', () => {
  it('returns 404 for non-existent thread', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/threads/non-existent-id',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns full thread data with branches and commits', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/threads/${threadOpenId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.thread.id).toBe(threadOpenId);
    expect(body.thread.title).toBe('Open Thread');
    expect(body.branches).toHaveLength(1);
    expect(body.branches[0].id).toBe(branchAId);
    expect(body.commits).toHaveLength(2);
  });
});

describe('GET /api/threads/:id/tree', () => {
  it('returns 404 for non-existent thread', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/threads/non-existent-id/tree',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns correct node/edge structure', async () => {
    // Add a branch from commitA1 (branching point)
    const childBranch = branchRepo.create({
      thread_id: threadOpenId,
      parent_commit_id: commitA1Id,
      context_label: 'child',
    });
    const childCommit = commitRepo.create({
      branch_id: childBranch.id,
      verdict_summary: 'Child verdict',
      reasoning: 'Child reasoning',
      source_item_ids: [],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/threads/${threadOpenId}/tree`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // 3 commits + 0 merge events = 3 nodes
    expect(body.nodes).toHaveLength(3);

    // Sequential edge: commitA1 → commitA2
    const sequentialEdge = body.edges.find(
      (e: { from: string; to: string; type: string }) =>
        e.from === commitA1Id && e.to === commitA2Id && e.type === 'sequential',
    );
    expect(sequentialEdge).toBeDefined();

    // Branch edge: commitA1 → childCommit
    const branchEdge = body.edges.find(
      (e: { from: string; to: string; type: string }) =>
        e.from === commitA1Id && e.to === childCommit.id && e.type === 'branch',
    );
    expect(branchEdge).toBeDefined();
  });

  it('returns empty tree for thread with no branches', async () => {
    const emptyThread = threadRepo.create({ title: 'Empty', tags: [], status: 'open' });
    const res = await app.inject({
      method: 'GET',
      url: `/api/threads/${emptyThread.id}/tree`,
    });
    const body = JSON.parse(res.body);
    expect(body.nodes).toHaveLength(0);
    expect(body.edges).toHaveLength(0);
  });
});

describe('GET /api/capture', () => {
  it('returns unprocessed items with suggested thread', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/capture' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Both items are unprocessed
    expect(body.items).toHaveLength(2);

    // The assigned item should have a suggestedThread
    const assignedItem = body.items.find(
      (i: { id: string }) => i.id === itemAssignedId,
    );
    expect(assignedItem).toBeDefined();
    expect(assignedItem.suggestedThread).toEqual({
      id: threadOpenId,
      title: 'Open Thread',
    });

    // The unassigned item should have null suggestedThread
    const unassignedItem = body.items.find(
      (i: { id: string }) => i.id === itemUnprocessedId,
    );
    expect(unassignedItem).toBeDefined();
    expect(unassignedItem.suggestedThread).toBeNull();
  });

  it('respects limit parameter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/capture?limit=1',
    });
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(1);
  });
});

describe('POST /api/corrections/reassign', () => {
  it('reassigns an item to a target thread', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/corrections/reassign',
      payload: { itemId: itemUnprocessedId, targetThreadId: threadOpenId },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);

    // Verify the item was reassigned
    const item = sourceItemRepo.getById(itemUnprocessedId);
    expect(item?.thread_id).toBe(threadOpenId);
    expect(item?.processed).toBe(true);
  });

  it('returns 404 for missing item', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/corrections/reassign',
      payload: { itemId: 'nonexistent', targetThreadId: threadOpenId },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for missing target thread', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/corrections/reassign',
      payload: { itemId: itemUnprocessedId, targetThreadId: 'nonexistent' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/corrections/confirm', () => {
  it('marks item as processed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/corrections/confirm',
      payload: { itemId: itemUnprocessedId },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);

    const item = sourceItemRepo.getById(itemUnprocessedId);
    expect(item?.processed).toBe(true);
  });

  it('returns 404 for missing item', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/corrections/confirm',
      payload: { itemId: 'nonexistent' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/corrections/new-thread', () => {
  it('creates a new thread from an item', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/corrections/new-thread',
      payload: { itemId: itemUnprocessedId, title: 'Split Thread' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.threadId).toBeDefined();
    expect(body.branchId).toBeDefined();

    // Verify the new thread exists
    const thread = threadRepo.getById(body.threadId);
    expect(thread?.title).toBe('Split Thread');

    // Verify the item was assigned and processed
    const item = sourceItemRepo.getById(itemUnprocessedId);
    expect(item?.thread_id).toBe(body.threadId);
    expect(item?.processed).toBe(true);
  });
});

describe('POST /api/corrections/merge-threads', () => {
  it('merges source thread into target', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/corrections/merge-threads',
      payload: { sourceThreadId: threadClosedId, targetThreadId: threadOpenId },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);

    // Source thread should be deleted
    expect(threadRepo.getById(threadClosedId)).toBeUndefined();

    // Target thread should still exist
    expect(threadRepo.getById(threadOpenId)).toBeDefined();
  });
});

describe('POST /api/commits/:id/regret', () => {
  it('adds a regret marker to a commit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/commits/${commitA1Id}/regret`,
      payload: { note: 'Was wrong about this' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);

    const commit = commitRepo.getById(commitA1Id);
    expect(commit?.regret).toBe(true);
    expect(commit?.regret_note).toBe('Was wrong about this');
  });

  it('works without a note', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/commits/${commitA1Id}/regret`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    const commit = commitRepo.getById(commitA1Id);
    expect(commit?.regret).toBe(true);
  });

  it('returns 404 for missing commit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/commits/nonexistent/regret',
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/threads/:id/merge', () => {
  it('creates a merge event and resulting commit', async () => {
    // Create a second branch on the open thread
    const branch2 = branchRepo.create({
      thread_id: threadOpenId,
      parent_commit_id: commitA1Id,
      context_label: 'alt',
    });
    commitRepo.create({
      branch_id: branch2.id,
      verdict_summary: 'Alt verdict',
      reasoning: 'Alt reasoning',
      source_item_ids: [],
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${threadOpenId}/merge`,
      payload: {
        sourceBranchIds: [branchAId, branch2.id],
        resolvedRule: 'Take the most recent',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.mergeEventId).toBeDefined();
    expect(body.commitId).toBeDefined();

    // Verify merge event
    const mergeEvents = mergeEventRepo.listByThread(threadOpenId);
    expect(mergeEvents).toHaveLength(1);
    expect(mergeEvents[0].resolved_rule).toBe('Take the most recent');
  });

  it('returns 404 for missing thread', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/threads/nonexistent/merge',
      payload: { sourceBranchIds: [branchAId], resolvedRule: 'rule' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for empty sourceBranchIds', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${threadOpenId}/merge`,
      payload: { sourceBranchIds: [], resolvedRule: 'rule' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /api/feed/:id/read', () => {
  it('marks a feed event as read', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/feed/${feedEventId}/read`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);

    // Verify it's read
    const events = feedEventRepo.list({ limit: 10, offset: 0 });
    const evt = events.find((e) => e.id === feedEventId);
    expect(evt?.read).toBe(true);
  });

  it('returns 404 for missing feed event', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/feed/nonexistent/read',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('Schema validation', () => {
  it('returns 400 for invalid correction body (missing fields)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/corrections/reassign',
      payload: { itemId: 'foo' }, // missing targetThreadId
    });
    // Fastify returns 400 for schema validation failures
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid merge-threads body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/corrections/merge-threads',
      payload: { sourceThreadId: 'foo' }, // missing targetThreadId
    });
    expect(res.statusCode).toBe(400);
  });
});

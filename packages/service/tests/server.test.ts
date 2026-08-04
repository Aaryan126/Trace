import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import {
  CaptureAssetRepository,
  createInMemoryDatabase,
  ThreadRepository,
  BranchRepository,
  CommitRepository,
  SourceItemRepository,
  MergeEventRepository,
  FeedEventRepository,
  WorkingStateRepository,
} from '@trace/core';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.js';
import type { BrowserCaptureCoordinator } from '../src/browser-capture.js';

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
let captureNext: ReturnType<typeof vi.fn>;
let captureStatus: ReturnType<typeof vi.fn>;
let captureComplete: ReturnType<typeof vi.fn>;
let captureSkip: ReturnType<typeof vi.fn>;
let captureHealth: ReturnType<typeof vi.fn>;
let captureAgent: ReturnType<typeof vi.fn>;
let capturePolicy: ReturnType<typeof vi.fn>;
let captureVisit: ReturnType<typeof vi.fn>;
let tempDirectories: string[];

// Shared seed IDs (populated in beforeEach)
let threadOpenId: string;
let threadClosedId: string;
let branchAId: string;
let branchBId: string;
let commitA1Id: string;
let commitA2Id: string;
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
  commitRepo.create({
    branch_id: branchBId,
    verdict_summary: 'Branch B verdict',
    reasoning: 'Branch B reasoning',
    source_item_ids: [],
  });
  commitA1Id = commitA1.id;
  commitA2Id = commitA2.id;

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

  captureNext = vi.fn();
  captureStatus = vi.fn();
  captureComplete = vi.fn();
  captureSkip = vi.fn();
  captureHealth = vi.fn().mockReturnValue({ enabled: true, authorized: true, connected: true, lastHeartbeatAt: null, lastAttemptAt: null, lastResult: null, lastReason: null, agents: [] });
  captureAgent = vi.fn();
  capturePolicy = vi.fn();
  captureVisit = vi.fn();
  tempDirectories = [];
  const captures = {
    next: captureNext,
    reportAgentStatus: captureStatus,
    reportAgent: captureAgent,
    setPolicyEnabled: capturePolicy,
    considerExtensionVisit: captureVisit,
    complete: captureComplete,
    skip: captureSkip,
    health: captureHealth,
  } as unknown as BrowserCaptureCoordinator;
  app = await createServer({ _db: db, _captures: captures, _captureToken: 'capture-test-token' });
  await app.ready();

  await seed();
});

afterEach(async () => {
  await app.close();
  for (const directory of tempDirectories) rmSync(directory, { recursive: true, force: true });
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

  it('allows localhost CORS and omits CORS headers for other origins', async () => {
    const local = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://127.0.0.1:5173' },
    });
    expect(local.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');

    const remote = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://example.com' },
    });
    expect(remote.statusCode).toBe(200);
    expect(remote.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('Browser capture bridge', () => {
  const headers = { 'x-trace-capture-token': 'capture-test-token' };

  it('requires the private launch token', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/browser-capture/next' });
    expect(response.statusCode).toBe(401);
    expect(captureNext).not.toHaveBeenCalled();
  });

  it('reports permission status and leases the next request', async () => {
    const status = await app.inject({
      method: 'POST', url: '/api/browser-capture/status', headers,
      payload: { enabled: true, authorized: true },
    });
    expect(status.statusCode).toBe(200);
    expect(captureStatus).toHaveBeenCalledWith(true, true);

    captureNext.mockReturnValue({ id: 'capture-1', sourceItemId: 'item-1' });
    const next = await app.inject({ method: 'POST', url: '/api/browser-capture/next', headers });
    expect(next.statusCode).toBe(200);
    expect(next.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(next.body).id).toBe('capture-1');
  });

  it('accepts immediate Chrome visits and updates extension health', async () => {
    captureVisit.mockReturnValue({ status: 'capture', request: { id: 'capture-extension', sourceItemId: 'source-extension', url: 'https://example.com/research', title: 'Research', availableAt: new Date().toISOString() } });
    const status = await app.inject({
      method: 'POST', url: '/api/browser-capture/status', headers,
      payload: { agent: 'chrome_extension', authorized: true },
    });
    expect(status.statusCode).toBe(200);
    expect(captureAgent).toHaveBeenCalledWith('chrome_extension', true);

    const visit = await app.inject({
      method: 'POST', url: '/api/browser-extension/visit', headers,
      payload: { url: 'https://example.com/research', title: 'Research', capturedAt: new Date().toISOString(), pageText: 'Compare A and B' },
    });
    expect(visit.statusCode).toBe(200);
    expect(JSON.parse(visit.body).request.id).toBe('capture-extension');
    expect(captureVisit).toHaveBeenCalledOnce();
  });

  it('persists capture policy through the private bridge', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/browser-capture/policy', headers, payload: { enabled: false } });
    expect(response.statusCode).toBe(200);
    expect(capturePolicy).toHaveBeenCalledWith(false);
  });

  it('accepts capture payloads larger than Fastify\'s default one-megabyte limit', async () => {
    captureComplete.mockReturnValue(true);
    const response = await app.inject({
      method: 'POST', url: '/api/browser-capture/capture-1/complete', headers,
      payload: {
        fullImageBase64: 'a'.repeat(1_100_000), thumbnailBase64: '/9j/', ocrText: '',
        width: 1200, height: 800, visualHash: '0123456789abcdef',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(captureComplete).toHaveBeenCalledOnce();
  });

  it('serves capture images by source ID without exposing file paths', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'trace-server-capture-'));
    tempDirectories.push(directory);
    const fullPath = join(directory, 'full.jpg');
    const thumbnailPath = join(directory, 'thumb.jpg');
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    writeFileSync(fullPath, jpeg);
    writeFileSync(thumbnailPath, jpeg);
    new CaptureAssetRepository(db).create({
      source_item_id: itemUnprocessedId, full_path: fullPath, thumbnail_path: thumbnailPath,
      mime_type: 'image/jpeg', byte_size: jpeg.length, width: 100, height: 80,
      visual_hash: '0123456789abcdef', captured_at: new Date().toISOString(),
      full_expires_at: '9999-12-31T23:59:59.999Z',
    });

    const image = await app.inject({ method: 'GET', url: `/api/source-items/${itemUnprocessedId}/capture/thumbnail` });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toContain('image/jpeg');
    expect(image.headers['cache-control']).toBe('private, no-store');
    const captureItems = JSON.parse((await app.inject({ method: 'GET', url: '/api/capture' })).body).items;
    const capture = captureItems.find((item: { id: string }) => item.id === itemUnprocessedId).capture;
    expect(capture.thumbnailUrl).toBe(`/api/source-items/${itemUnprocessedId}/capture/thumbnail`);
    expect(JSON.stringify(capture)).not.toContain(directory);
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

  it('groups nearby in-progress checkpoints and marks the group read together', async () => {
    const first = commitRepo.create({ branch_id: branchAId, verdict_summary: 'First checkpoint', reasoning: 'One', source_item_ids: [], kind: 'checkpoint', resolution_status: 'in_progress' });
    const second = commitRepo.create({ branch_id: branchAId, verdict_summary: 'Second checkpoint', reasoning: 'Two', source_item_ids: [], kind: 'checkpoint', resolution_status: 'in_progress' });
    feedEventRepo.create({ type: 'commit_closed', thread_id: threadOpenId, payload: { commitId: first.id, verdict: first.verdict_summary, resolutionStatus: 'in_progress' } });
    feedEventRepo.create({ type: 'commit_closed', thread_id: threadOpenId, payload: { commitId: second.id, verdict: second.verdict_summary, resolutionStatus: 'in_progress' } });

    const body = JSON.parse((await app.inject({ method: 'GET', url: '/api/feed' })).body);
    const group = body.events.find((event: { threadId: string; type: string }) => event.threadId === threadOpenId && event.type === 'commit_closed');
    expect(group.updateCount).toBe(2);
    expect(group.eventIds).toHaveLength(2);
    expect(group.resolutionStatus).toBe('in_progress');

    const marked = await app.inject({ method: 'PATCH', url: '/api/feed/read', payload: { eventIds: group.eventIds } });
    expect(marked.statusCode).toBe(200);
    expect(JSON.parse(marked.body).updated).toBe(2);
  });

  it('groups same-branch checkpoints even when another thread is interleaved', async () => {
    const first = commitRepo.create({ branch_id: branchAId, verdict_summary: 'First checkpoint', reasoning: 'One', source_item_ids: [], kind: 'checkpoint', resolution_status: 'in_progress' });
    feedEventRepo.create({ type: 'commit_closed', thread_id: threadOpenId, payload: { commitId: first.id, verdict: first.verdict_summary, resolutionStatus: 'in_progress' } });
    feedEventRepo.create({ type: 'nudge', thread_id: threadClosedId, payload: { message: 'Interleaved update' } });
    const second = commitRepo.create({ branch_id: branchAId, verdict_summary: 'Second checkpoint', reasoning: 'Two', source_item_ids: [], kind: 'checkpoint', resolution_status: 'in_progress' });
    feedEventRepo.create({ type: 'commit_closed', thread_id: threadOpenId, payload: { commitId: second.id, verdict: second.verdict_summary, resolutionStatus: 'in_progress' } });

    const body = JSON.parse((await app.inject({ method: 'GET', url: '/api/feed' })).body);
    const groups = body.events.filter((event: { threadId: string; type: string }) => event.threadId === threadOpenId && event.type === 'commit_closed');
    expect(groups).toHaveLength(1);
    expect(groups[0].updateCount).toBe(2);
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
    db.prepare('UPDATE threads SET created_at = ?, updated_at = ? WHERE id = ?').run(
      '2020-01-01T00:00:00.000Z',
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

  it('uses evidence capture time for Last Activity and recent sorting', async () => {
    db.prepare('DELETE FROM threads').run();
    const freshEvidence = threadRepo.create({ title: 'Fresh Evidence', tags: [], status: 'open' });
    db.prepare('UPDATE threads SET created_at = ?, updated_at = ? WHERE id = ?').run(
      '2020-01-01T00:00:00.000Z',
      '2020-01-01T00:00:00.000Z',
      freshEvidence.id,
    );
    sourceItemRepo.create({
      type: 'browser_history',
      raw_text: 'Fresh research',
      extracted_entities: null,
      url: null,
      captured_at: '2026-02-01T00:00:00.000Z',
      thread_id: freshEvidence.id,
    });

    const oldEvidence = threadRepo.create({ title: 'Old Evidence', tags: [], status: 'open' });
    sourceItemRepo.create({
      type: 'browser_history',
      raw_text: 'Old research',
      extracted_entities: null,
      url: null,
      captured_at: '2021-02-01T00:00:00.000Z',
      thread_id: oldEvidence.id,
    });

    const res = await app.inject({ method: 'GET', url: '/api/threads?sort=recent' });
    const body = JSON.parse(res.body);

    expect(body.threads.map((thread: { title: string }) => thread.title)).toEqual([
      'Fresh Evidence',
      'Old Evidence',
    ]);
    expect(body.threads[0].lastActivity).toBe('2026-02-01T00:00:00.000Z');
    expect(body.threads[1].lastActivity).toBe('2021-02-01T00:00:00.000Z');
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
    expect(body.id).toBe(threadOpenId);
    expect(body.title).toBe('Open Thread');
    expect(body.branches).toHaveLength(1);
    expect(body.branches[0].id).toBe(branchAId);
    expect(body.branches[0].commits).toHaveLength(2);
    expect(body.story.nodes).toHaveLength(2);
    expect(body.currentAnswer.text).toBe('Second verdict');
    expect(body.resume).toBeDefined();
    expect(body.comparison).toEqual({ options: [], criteria: [], cells: [] });
  });

  it('returns source-backed comparisons and preserves a user correction', async () => {
    const now = new Date().toISOString();
    sourceItemRepo.assignToThread(itemAssignedId, threadOpenId, branchAId, 1);
    new WorkingStateRepository(db).upsert({
      branch_id: branchAId, research_question: 'Plus or SeedVR2?', summary: 'Comparing batch output.',
      options: ['Plus', 'SeedVR2'], constraints: ['Quality'], open_questions: ['What is the credit cost?'],
      tentative_direction: 'Use Plus by default.', evidence_ids: [itemAssignedId], changed_factors: [], status: 'active',
      last_event_at: now, checkpoint_due_at: now,
      comparison: {
        options: [{ id: 'plus', label: 'Plus' }, { id: 'seedvr2', label: 'SeedVR2' }],
        criteria: [{ id: 'quality', label: 'Quality' }],
        cells: [{ option_id: 'plus', criterion_id: 'quality', value: 'Strong', status: 'supported', source_item_ids: [itemAssignedId] }],
      },
    });
    const correction = await app.inject({ method: 'PATCH', url: `/api/branches/${branchAId}/comparison-overrides/plus/quality`, payload: { value: 'Needs testing', status: 'assumption', pinned: true } });
    expect(correction.statusCode).toBe(200);
    const body = JSON.parse((await app.inject({ method: 'GET', url: `/api/threads/${threadOpenId}` })).body);
    expect(body.currentAnswer.status).toBe('working');
    expect(body.resume.nextQuestion).toBe('What is the credit cost?');
    expect(body.comparison.cells[0]).toMatchObject({ value: 'Needs testing', status: 'assumption', corrected: true, pinned: true });
    expect(body.story.nodes.some((node: { kind: string }) => node.kind === 'working')).toBe(true);
  });
});

describe('Research retrieval and export', () => {
  it('searches verdicts and exports the chronological decision history', async () => {
    const search = await app.inject({ method: 'GET', url: '/api/search?q=Second%20verdict' });
    expect(search.statusCode).toBe(200);
    expect(JSON.parse(search.body).results[0]).toMatchObject({ threadId: threadOpenId, matchType: 'verdict' });
    const exported = await app.inject({ method: 'GET', url: `/api/threads/${threadOpenId}/export?format=adr` });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toContain('text/markdown');
    expect(exported.body).toContain('# ADR: Open Thread');
    expect(exported.body).toContain('## Current answer');
    expect(exported.body).toContain('Second verdict');
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

    // The assigned item should have a typed suggestion.
    const assignedItem = body.items.find(
      (i: { id: string }) => i.id === itemAssignedId,
    );
    expect(assignedItem).toBeDefined();
    expect(assignedItem.suggestion).toEqual({
      threadId: threadOpenId,
      threadTitle: 'Open Thread',
      confidence: 0,
    });

    // The unassigned item should omit suggestion.
    const unassignedItem = body.items.find(
      (i: { id: string }) => i.id === itemUnprocessedId,
    );
    expect(unassignedItem).toBeDefined();
    expect(unassignedItem.suggestion).toBeUndefined();
  });

  it('returns the newest evidence first', async () => {
    db.prepare('UPDATE source_items SET captured_at = ? WHERE id = ?')
      .run('2026-08-03T10:00:00.000Z', itemUnprocessedId);
    db.prepare('UPDATE source_items SET captured_at = ? WHERE id = ?')
      .run('2026-08-03T11:00:00.000Z', itemAssignedId);

    const res = await app.inject({ method: 'GET', url: '/api/capture' });
    const body = JSON.parse(res.body);

    expect(body.items.map((item: { id: string }) => item.id)).toEqual([
      itemAssignedId,
      itemUnprocessedId,
    ]);
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

describe('POST /api/corrections/ignore', () => {
  it('marks item processed without creating or assigning a thread', async () => {
    const threadCountBefore = threadRepo.list().length;
    const res = await app.inject({
      method: 'POST',
      url: '/api/corrections/ignore',
      payload: { itemId: itemUnprocessedId },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
    expect(sourceItemRepo.getById(itemUnprocessedId)).toMatchObject({
      processed: true,
      thread_id: null,
      branch_id: null,
    });
    expect(threadRepo.list()).toHaveLength(threadCountBefore);
  });

  it('returns 404 for missing item', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/corrections/ignore',
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

describe('PUT /api/commits/:id/outcome', () => {
  it('records an outcome only for a resolved decision and exposes it in the decision detail', async () => {
    const resolved = commitRepo.create({ branch_id: branchAId, verdict_summary: 'Use SQLite', reasoning: 'Fits the constraints.', source_item_ids: [], resolution_status: 'resolved' });
    const response = await app.inject({ method: 'PUT', url: `/api/commits/${resolved.id}/outcome`, payload: { status: 'worked', note: 'The app stayed reliable.' } });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).outcome).toMatchObject({ status: 'worked', note: 'The app stayed reliable.' });
    const detail = JSON.parse((await app.inject({ method: 'GET', url: `/api/threads/${threadOpenId}` })).body);
    expect(detail.outcomeReview).toMatchObject({ commitId: resolved.id, decision: 'Use SQLite', outcome: { status: 'worked' } });
    expect(commitRepo.getById(resolved.id)?.regret).toBe(false);
  });

  it('rejects an unresolved checkpoint', async () => {
    const response = await app.inject({ method: 'PUT', url: `/api/commits/${commitA2Id}/outcome`, payload: { status: 'mixed' } });
    expect(response.statusCode).toBe(404);
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
    expect(mergeEvents[0].origin).toBe('manual');
    expect(threadRepo.getById(threadOpenId)?.status).toBe('closed');

    const detail = JSON.parse((await app.inject({ method: 'GET', url: `/api/threads/${threadOpenId}` })).body);
    expect(detail.story.nodes).toContainEqual(expect.objectContaining({ id: body.mergeEventId, title: 'Manual override reconciliation', origin: 'manual' }));

    const treeResponse = await app.inject({ method: 'GET', url: `/api/threads/${threadOpenId}/tree` });
    const tree = JSON.parse(treeResponse.body);
    expect(tree.edges).not.toContainEqual(expect.objectContaining({
      from: body.commitId,
      to: body.mergeEventId,
    }));
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

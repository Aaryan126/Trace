import { describe, it, expect, beforeEach } from 'vitest';
import Sqlite, { type Database as DatabaseType } from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, createInMemoryDatabase } from '../src/db/database.js';
import { ThreadRepository } from '../src/db/repositories/thread-repository.js';
import { BranchRepository } from '../src/db/repositories/branch-repository.js';
import { CommitRepository } from '../src/db/repositories/commit-repository.js';
import { SourceItemRepository } from '../src/db/repositories/source-item-repository.js';
import { MergeEventRepository } from '../src/db/repositories/merge-event-repository.js';
import { FeedEventRepository } from '../src/db/repositories/feed-event-repository.js';
import { DecisionOutcomeRepository } from '../src/db/repositories/decision-outcome-repository.js';

let db: DatabaseType;
let threads: ThreadRepository;
let branches: BranchRepository;
let commits: CommitRepository;
let sourceItems: SourceItemRepository;
let mergeEvents: MergeEventRepository;
let feedEvents: FeedEventRepository;

beforeEach(() => {
  db = createInMemoryDatabase();
  threads = new ThreadRepository(db);
  branches = new BranchRepository(db);
  commits = new CommitRepository(db);
  sourceItems = new SourceItemRepository(db);
  mergeEvents = new MergeEventRepository(db);
  feedEvents = new FeedEventRepository(db);
});

describe('Schema creation', () => {
  it('creates all tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name).sort();
    expect(names).toEqual(
      ['automation_actions', 'branch_working_states', 'branches', 'capture_assets', 'commits', 'comparison_overrides', 'decision_outcomes', 'feed_events', 'merge_events', 'metadata', 'semantic_embeddings', 'source_items', 'threads']
    );
  });

  it('can be called multiple times (IF NOT EXISTS)', () => {
    expect(() => db.exec(`CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY)`)).not.toThrow();
  });

  it('migrates legacy source items and backfills their branch', () => {
    const directory = mkdtempSync(join(tmpdir(), 'trace-migration-'));
    const path = join(directory, 'trace.sqlite');
    const legacy = new Sqlite(path);
    legacy.exec(`
      CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL, tags TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE branches (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, parent_commit_id TEXT, context_label TEXT, created_at TEXT NOT NULL);
      CREATE TABLE source_items (id TEXT PRIMARY KEY, type TEXT NOT NULL, raw_text TEXT, extracted_entities TEXT, url TEXT, captured_at TEXT NOT NULL, thread_id TEXT, processed INTEGER NOT NULL DEFAULT 0);
      INSERT INTO threads VALUES ('thread-1', 'Decision', '[]', 'open', '2026-01-01', '2026-01-01');
      INSERT INTO branches VALUES ('branch-1', 'thread-1', NULL, NULL, '2026-01-01');
      INSERT INTO source_items VALUES ('item-1', 'browser_history', 'Research', NULL, NULL, '2026-01-01', 'thread-1', 0);
    `);
    legacy.close();

    const migrated = createDatabase(path);
    const row = migrated.prepare('SELECT branch_id, clustering_confidence, automation_status FROM source_items WHERE id = ?').get('item-1') as {
      branch_id: string;
      clustering_confidence: number | null;
      automation_status: string;
    };
    expect(row).toEqual({ branch_id: 'branch-1', clustering_confidence: null, automation_status: 'legacy_unresolved' });
    const capture = migrated.prepare('SELECT capture_status, capture_reason FROM source_items WHERE id = ?').get('item-1');
    expect(capture).toEqual({ capture_status: 'not_requested', capture_reason: null });
    expect(migrated.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").pluck().get()).toBe('7');
    expect(migrated.pragma('table_info(commits)').some((column: { name: string }) => column.name === 'comparison_json')).toBe(true);
    expect(migrated.pragma('table_info(branch_working_states)').some((column: { name: string }) => column.name === 'comparison_json')).toBe(true);
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  });
});

describe('DecisionOutcomeRepository', () => {
  it('records and updates the result of a resolved decision', () => {
    const thread = threads.create({ title: 'Choose database', tags: [], status: 'closed' });
    const branch = branches.create({ thread_id: thread.id, parent_commit_id: null, context_label: 'Local app' });
    const commit = commits.create({ branch_id: branch.id, verdict_summary: 'Use SQLite', reasoning: 'Local first.', source_item_ids: [], resolution_status: 'resolved' });
    const outcomes = new DecisionOutcomeRepository(db);

    outcomes.upsert(commit.id, 'worked', 'Fast and reliable.');
    outcomes.upsert(commit.id, 'mixed', 'Sync later became difficult.');

    expect(outcomes.getByCommit(commit.id)).toMatchObject({ status: 'mixed', note: 'Sync later became difficult.' });
    expect(outcomes.listByThread(thread.id)).toHaveLength(1);
  });
});

describe('ThreadRepository', () => {
  it('creates and retrieves a thread', () => {
    const t = threads.create({ title: 'Test thread', tags: ['work', 'urgent'], status: 'open' });
    expect(t.id).toBeDefined();
    expect(t.title).toBe('Test thread');
    expect(t.tags).toEqual(['work', 'urgent']);
    expect(t.status).toBe('open');

    const fetched = threads.getById(t.id);
    expect(fetched).toEqual(t);
  });

  it('returns undefined for missing thread', () => {
    expect(threads.getById('nonexistent')).toBeUndefined();
  });

  it('lists threads with filters', () => {
    threads.create({ title: 'Open thread', tags: ['a'], status: 'open' });
    threads.create({ title: 'Closed thread', tags: ['b'], status: 'closed' });
    threads.create({ title: 'Another open', tags: ['a', 'c'], status: 'open' });

    expect(threads.list().length).toBe(3);
    expect(threads.list({ status: 'open' }).length).toBe(2);
    expect(threads.list({ status: 'closed' }).length).toBe(1);
    expect(threads.list({ tag: 'a' }).length).toBe(2);
  });

  it('updates status', () => {
    const t = threads.create({ title: 'T', tags: [], status: 'open' });
    const updated = threads.updateStatus(t.id, 'closed');
    expect(updated!.status).toBe('closed');
  });

  it('updates partial fields', () => {
    const t = threads.create({ title: 'Original', tags: ['x'], status: 'open' });
    const updated = threads.update(t.id, { title: 'Updated', tags: ['y', 'z'] });
    expect(updated!.title).toBe('Updated');
    expect(updated!.tags).toEqual(['y', 'z']);
  });

  it('handles JSON tags round-trip', () => {
    const tags = ['tag1', 'tag with spaces', 'special!@#$%'];
    const t = threads.create({ title: 'Tags test', tags, status: 'open' });
    const fetched = threads.getById(t.id);
    expect(fetched!.tags).toEqual(tags);
  });
});

describe('BranchRepository', () => {
  it('creates and retrieves a branch', () => {
    const t = threads.create({ title: 'Thread', tags: [], status: 'open' });
    const b = branches.create({ thread_id: t.id, parent_commit_id: null, context_label: 'trunk' });

    expect(b.id).toBeDefined();
    expect(b.thread_id).toBe(t.id);
    expect(b.parent_commit_id).toBeNull();
    expect(b.context_label).toBe('trunk');

    const fetched = branches.getById(b.id);
    expect(fetched).toEqual(b);
  });

  it('lists branches by thread', () => {
    const t1 = threads.create({ title: 'T1', tags: [], status: 'open' });
    const t2 = threads.create({ title: 'T2', tags: [], status: 'open' });

    branches.create({ thread_id: t1.id, parent_commit_id: null, context_label: null });
    branches.create({ thread_id: t1.id, parent_commit_id: null, context_label: 'alt' });
    branches.create({ thread_id: t2.id, parent_commit_id: null, context_label: null });

    expect(branches.listByThread(t1.id).length).toBe(2);
    expect(branches.listByThread(t2.id).length).toBe(1);
  });

  it('enforces FK constraint on thread_id', () => {
    expect(() =>
      branches.create({ thread_id: 'nonexistent', parent_commit_id: null, context_label: null })
    ).toThrow();
  });
});

describe('CommitRepository', () => {
  it('creates and retrieves a commit', () => {
    const t = threads.create({ title: 'T', tags: [], status: 'open' });
    const b = branches.create({ thread_id: t.id, parent_commit_id: null, context_label: null });

    const c = commits.create({
      branch_id: b.id,
      verdict_summary: 'Good decision',
      reasoning: 'Because reasons',
      source_item_ids: ['item1', 'item2'],
    });

    expect(c.id).toBeDefined();
    expect(c.regret).toBe(false);
    expect(c.regret_note).toBeNull();
    expect(c.source_item_ids).toEqual(['item1', 'item2']);

    const fetched = commits.getById(c.id);
    expect(fetched).toEqual(c);
  });

  it('lists commits by branch', () => {
    const t = threads.create({ title: 'T', tags: [], status: 'open' });
    const b1 = branches.create({ thread_id: t.id, parent_commit_id: null, context_label: null });
    const b2 = branches.create({ thread_id: t.id, parent_commit_id: null, context_label: null });

    commits.create({ branch_id: b1.id, verdict_summary: 'C1', reasoning: 'R1', source_item_ids: [] });
    commits.create({ branch_id: b1.id, verdict_summary: 'C2', reasoning: 'R2', source_item_ids: [] });
    commits.create({ branch_id: b2.id, verdict_summary: 'C3', reasoning: 'R3', source_item_ids: [] });

    expect(commits.listByBranch(b1.id).length).toBe(2);
    expect(commits.listByBranch(b2.id).length).toBe(1);
  });

  it('adds regret to a commit', () => {
    const t = threads.create({ title: 'T', tags: [], status: 'open' });
    const b = branches.create({ thread_id: t.id, parent_commit_id: null, context_label: null });
    const c = commits.create({ branch_id: b.id, verdict_summary: 'V', reasoning: 'R', source_item_ids: [] });

    const regretted = commits.addRegret(c.id, 'Changed my mind');
    expect(regretted!.regret).toBe(true);
    expect(regretted!.regret_note).toBe('Changed my mind');
  });

  it('handles JSON source_item_ids round-trip', () => {
    const t = threads.create({ title: 'T', tags: [], status: 'open' });
    const b = branches.create({ thread_id: t.id, parent_commit_id: null, context_label: null });
    const ids = ['abc-123', 'def-456', 'ghi-789'];
    const c = commits.create({ branch_id: b.id, verdict_summary: 'V', reasoning: 'R', source_item_ids: ids });
    const fetched = commits.getById(c.id);
    expect(fetched!.source_item_ids).toEqual(ids);
  });

  it('enforces FK constraint on branch_id', () => {
    expect(() =>
      commits.create({ branch_id: 'nonexistent', verdict_summary: 'V', reasoning: 'R', source_item_ids: [] })
    ).toThrow();
  });
});

describe('SourceItemRepository', () => {
  it('creates and retrieves a source item', () => {
    const item = sourceItems.create({
      type: 'screenshot',
      raw_text: 'Some text from screenshot',
      extracted_entities: { people: ['Alice', 'Bob'], topic: 'meeting' },
      url: null,
      captured_at: new Date().toISOString(),
      thread_id: null,
    });

    expect(item.id).toBeDefined();
    expect(item.processed).toBe(false);
    expect(item.extracted_entities).toEqual({ people: ['Alice', 'Bob'], topic: 'meeting' });

    const fetched = sourceItems.getById(item.id);
    expect(fetched).toEqual(item);
  });

  it('lists only unprocessed items', () => {
    const i1 = sourceItems.create({ type: 'screenshot', raw_text: 'T1', extracted_entities: null, url: null, captured_at: new Date().toISOString(), thread_id: null });
    const i2 = sourceItems.create({ type: 'browser_history', raw_text: 'T2', extracted_entities: null, url: 'https://example.com', captured_at: new Date().toISOString(), thread_id: null });
    sourceItems.create({ type: 'screenshot', raw_text: 'T3', extracted_entities: null, url: null, captured_at: new Date().toISOString(), thread_id: null });

    sourceItems.markProcessed(i1.id);

    const unprocessed = sourceItems.listUnprocessed();
    expect(unprocessed.length).toBe(2);
    expect(unprocessed.find((i) => i.id === i1.id)).toBeUndefined();
    expect(unprocessed.find((i) => i.id === i2.id)).toBeDefined();
  });

  it('stops automatic recovery after three processing attempts', () => {
    const item = sourceItems.create({ type: 'screenshot', raw_text: 'Retry me', extracted_entities: null, url: null, captured_at: new Date().toISOString(), thread_id: null });
    for (let attempt = 0; attempt < 3; attempt++) {
      sourceItems.markAutomationStatus(item.id, 'processing');
      sourceItems.markAutomationStatus(item.id, 'error', 'timeout');
    }
    expect(sourceItems.listForAutomation()).toHaveLength(0);
    expect(sourceItems.getById(item.id)).toMatchObject({ automation_status: 'error', automation_attempts: 3 });
  });

  it('assigns to thread and marks processed', () => {
    const t = threads.create({ title: 'T', tags: [], status: 'open' });
    const item = sourceItems.create({
      type: 'browser_history',
      raw_text: 'Visited page',
      extracted_entities: null,
      url: 'https://example.com',
      captured_at: new Date().toISOString(),
      thread_id: null,
    });

    expect(item.thread_id).toBeNull();

    const assigned = sourceItems.assignToThread(item.id, t.id);
    expect(assigned!.thread_id).toBe(t.id);

    const processed = sourceItems.markProcessed(item.id);
    expect(processed!.processed).toBe(true);
  });

  it('marks an irrelevant item processed without assigning it to a thread', () => {
    const item = sourceItems.create({
      type: 'browser_history',
      raw_text: 'Generic social feed',
      extracted_entities: null,
      url: 'https://example.com/feed',
      captured_at: new Date().toISOString(),
      thread_id: null,
    });

    const ignored = sourceItems.markIgnored(item.id, 0.97);

    expect(ignored).toMatchObject({
      processed: true,
      thread_id: null,
      branch_id: null,
      clustering_confidence: 0.97,
    });
    expect(sourceItems.listUnprocessed()).toHaveLength(0);
  });

  it('lists by thread', () => {
    const t1 = threads.create({ title: 'T1', tags: [], status: 'open' });
    const t2 = threads.create({ title: 'T2', tags: [], status: 'open' });

    sourceItems.create({ type: 'screenshot', raw_text: 'A', extracted_entities: null, url: null, captured_at: new Date().toISOString(), thread_id: t1.id });
    sourceItems.create({ type: 'screenshot', raw_text: 'B', extracted_entities: null, url: null, captured_at: new Date().toISOString(), thread_id: t1.id });
    sourceItems.create({ type: 'screenshot', raw_text: 'C', extracted_entities: null, url: null, captured_at: new Date().toISOString(), thread_id: t2.id });

    expect(sourceItems.listByThread(t1.id).length).toBe(2);
    expect(sourceItems.listByThread(t2.id).length).toBe(1);
  });

  it('handles JSON extracted_entities round-trip', () => {
    const entities = { key: 'value', nested: { arr: [1, 2, 3] } };
    const item = sourceItems.create({
      type: 'screenshot',
      raw_text: null,
      extracted_entities: entities,
      url: null,
      captured_at: new Date().toISOString(),
      thread_id: null,
    });
    const fetched = sourceItems.getById(item.id);
    expect(fetched!.extracted_entities).toEqual(entities);
  });

  it('fails screenshot jobs interrupted by a service restart', () => {
    const item = sourceItems.create({
      type: 'browser_history', raw_text: 'Interrupted capture', extracted_entities: null,
      url: 'https://example.com/research', captured_at: new Date().toISOString(), thread_id: null,
    });
    sourceItems.updateCaptureStatus(item.id, 'capturing');

    expect(sourceItems.failInterruptedCaptures()).toBe(1);
    expect(sourceItems.getById(item.id)).toMatchObject({
      capture_status: 'failed',
      capture_reason: 'capture_agent_offline',
    });
  });
});

describe('MergeEventRepository', () => {
  it('creates and lists merge events by thread', () => {
    const t = threads.create({ title: 'T', tags: [], status: 'open' });
    const b1 = branches.create({ thread_id: t.id, parent_commit_id: null, context_label: null });
    const b2 = branches.create({ thread_id: t.id, parent_commit_id: null, context_label: null });
    const c = commits.create({ branch_id: b1.id, verdict_summary: 'V', reasoning: 'R', source_item_ids: [] });

    const me = mergeEvents.create({
      thread_id: t.id,
      source_branch_ids: [b1.id, b2.id],
      resulting_commit_id: c.id,
      resolved_rule: 'latest-wins',
    });

    expect(me.id).toBeDefined();
    expect(me.source_branch_ids).toEqual([b1.id, b2.id]);

    const listed = mergeEvents.listByThread(t.id);
    expect(listed.length).toBe(1);
    expect(listed[0].source_branch_ids).toEqual([b1.id, b2.id]);
  });

  it('handles JSON source_branch_ids round-trip', () => {
    const t = threads.create({ title: 'T', tags: [], status: 'open' });
    const b = branches.create({ thread_id: t.id, parent_commit_id: null, context_label: null });
    const c = commits.create({ branch_id: b.id, verdict_summary: 'V', reasoning: 'R', source_item_ids: [] });

    const branchIds = ['branch-a', 'branch-b', 'branch-c'];
    mergeEvents.create({
      thread_id: t.id,
      source_branch_ids: branchIds,
      resulting_commit_id: c.id,
      resolved_rule: 'consensus',
    });

    const listed = mergeEvents.listByThread(t.id);
    expect(listed[0].source_branch_ids).toEqual(branchIds);
  });
});

describe('FeedEventRepository', () => {
  it('creates and lists feed events with pagination', () => {
    // Create events with distinct timestamps so ordering is deterministic
    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      db.prepare(
        `INSERT INTO feed_events (id, type, thread_id, payload, created_at, read)
         VALUES (?, 'digest', NULL, ?, ?, 0)`
      ).run(`evt-${i}`, JSON.stringify({ index: i }), new Date(base + i * 1000).toISOString());
    }

    const page1 = feedEvents.list({ limit: 2, offset: 0 });
    expect(page1.length).toBe(2);

    const page2 = feedEvents.list({ limit: 2, offset: 2 });
    expect(page2.length).toBe(2);

    const page3 = feedEvents.list({ limit: 2, offset: 4 });
    expect(page3.length).toBe(1);

    // Events are ordered DESC by created_at
    expect(page1[0].payload.index).toBe(4);
    expect(page1[1].payload.index).toBe(3);
  });

  it('filters unread events', () => {
    const e1 = feedEvents.create({ type: 'reopen', thread_id: null, payload: {} });
    feedEvents.create({ type: 'nudge', thread_id: null, payload: {} });
    feedEvents.create({ type: 'commit_closed', thread_id: null, payload: {} });

    feedEvents.markRead(e1.id);

    const unread = feedEvents.list({ limit: 10, offset: 0, unreadOnly: true });
    expect(unread.length).toBe(2);
    expect(unread.every((e) => !e.read)).toBe(true);
  });

  it('marks event as read', () => {
    const e = feedEvents.create({ type: 'digest', thread_id: null, payload: { key: 'val' } });
    expect(e.read).toBe(false);

    const updated = feedEvents.markRead(e.id);
    expect(updated!.read).toBe(true);
  });

  it('counts unread events', () => {
    expect(feedEvents.countUnread()).toBe(0);

    feedEvents.create({ type: 'digest', thread_id: null, payload: {} });
    feedEvents.create({ type: 'nudge', thread_id: null, payload: {} });
    expect(feedEvents.countUnread()).toBe(2);

    const e = feedEvents.create({ type: 'reopen', thread_id: null, payload: {} });
    expect(feedEvents.countUnread()).toBe(3);

    feedEvents.markRead(e.id);
    expect(feedEvents.countUnread()).toBe(2);
  });

  it('handles JSON payload round-trip', () => {
    const payload = { nested: { deep: true }, arr: [1, 'two', 3] };
    feedEvents.create({ type: 'digest', thread_id: null, payload });
    const fetched = feedEvents.list({ limit: 1, offset: 0 });
    expect(fetched[0].payload).toEqual(payload);
  });
});

describe('Status transitions', () => {
  it('transitions thread from open to closed and back', () => {
    const t = threads.create({ title: 'T', tags: [], status: 'open' });
    expect(t.status).toBe('open');

    const closed = threads.updateStatus(t.id, 'closed');
    expect(closed!.status).toBe('closed');

    const reopened = threads.updateStatus(t.id, 'open');
    expect(reopened!.status).toBe('open');
  });

  it('rejects invalid status values', () => {
    const t = threads.create({ title: 'T', tags: [], status: 'open' });
    expect(() => threads.updateStatus(t.id, 'invalid' as unknown as 'open')).toThrow();
  });
});

describe('Boolean storage as INTEGER', () => {
  it('stores regret as 0/1 in commits', () => {
    const t = threads.create({ title: 'T', tags: [], status: 'open' });
    const b = branches.create({ thread_id: t.id, parent_commit_id: null, context_label: null });
    const c = commits.create({ branch_id: b.id, verdict_summary: 'V', reasoning: 'R', source_item_ids: [] });

    const raw = db.prepare('SELECT regret FROM commits WHERE id = ?').get(c.id) as { regret: number };
    expect(raw.regret).toBe(0);

    commits.addRegret(c.id, 'oops');
    const rawAfter = db.prepare('SELECT regret FROM commits WHERE id = ?').get(c.id) as { regret: number };
    expect(rawAfter.regret).toBe(1);
  });

  it('stores processed as 0/1 in source_items', () => {
    const item = sourceItems.create({ type: 'screenshot', raw_text: null, extracted_entities: null, url: null, captured_at: new Date().toISOString(), thread_id: null });

    const raw = db.prepare('SELECT processed FROM source_items WHERE id = ?').get(item.id) as { processed: number };
    expect(raw.processed).toBe(0);

    sourceItems.markProcessed(item.id);
    const rawAfter = db.prepare('SELECT processed FROM source_items WHERE id = ?').get(item.id) as { processed: number };
    expect(rawAfter.processed).toBe(1);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createInMemoryDatabase } from '../src/db/database.js';
import { ThreadRepository } from '../src/db/repositories/thread-repository.js';
import { BranchRepository } from '../src/db/repositories/branch-repository.js';
import { CommitRepository } from '../src/db/repositories/commit-repository.js';
import { SourceItemRepository } from '../src/db/repositories/source-item-repository.js';
import { FeedEventRepository } from '../src/db/repositories/feed-event-repository.js';
import { ClusteringAgent } from '../src/agents/clustering.js';
import { SynthesisAgent } from '../src/agents/synthesis.js';
import { CorrectionAgent } from '../src/agents/correction.js';
import type { BrainchAI } from '../src/ai/openai-client.js';

let db: Database.Database;
let threadRepo: ThreadRepository;
let branchRepo: BranchRepository;
let commitRepo: CommitRepository;
let sourceItemRepo: SourceItemRepository;
let feedEventRepo: FeedEventRepository;

function mockAI(overrides: Partial<BrainchAI> = {}): BrainchAI {
  return {
    clusterItem: vi.fn(),
    synthesizeCommit: vi.fn(),
    generateDiff: vi.fn(),
    extractFromScreenshot: vi.fn(),
    ...overrides,
  } as unknown as BrainchAI;
}

function createItem(opts: { rawText?: string; capturedAt?: string; threadId?: string; processed?: boolean } = {}) {
  const item = sourceItemRepo.create({
    type: 'browser_history',
    raw_text: opts.rawText ?? 'test item',
    extracted_entities: null,
    url: null,
    captured_at: opts.capturedAt ?? new Date().toISOString(),
    thread_id: opts.threadId ?? null,
  });
  if (opts.processed) sourceItemRepo.markProcessed(item.id);
  return sourceItemRepo.getById(item.id)!;
}

function createThreadWithTrunk(title = 'Test thread', status: 'open' | 'closed' = 'open') {
  const thread = threadRepo.create({ title, tags: [], status });
  const branch = branchRepo.create({ thread_id: thread.id, parent_commit_id: null, context_label: null });
  return { thread, branch };
}

beforeEach(() => {
  db = createInMemoryDatabase();
  threadRepo = new ThreadRepository(db);
  branchRepo = new BranchRepository(db);
  commitRepo = new CommitRepository(db);
  sourceItemRepo = new SourceItemRepository(db);
  feedEventRepo = new FeedEventRepository(db);
});

// ─── ClusteringAgent ─────────────────────────────────────────────────────────

describe('ClusteringAgent', () => {
  it('assigns item to existing open thread (high confidence) and marks processed', async () => {
    const { thread } = createThreadWithTrunk('React vs Vue');
    const item = createItem({ rawText: 'Comparing React and Vue for our app' });

    const ai = mockAI({
      clusterItem: vi.fn().mockResolvedValue({
        decision: 'existing',
        threadId: thread.id,
        confidence: 0.9,
      }),
    });

    const agent = new ClusteringAgent(db, ai, threadRepo, branchRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.run();

    expect(result).toEqual({ processed: 1, newThreads: 0, reopened: 0 });

    const updated = sourceItemRepo.getById(item.id)!;
    expect(updated.thread_id).toBe(thread.id);
    expect(updated.processed).toBe(true);
  });

  it('assigns item to existing open thread (low confidence) but does NOT mark processed', async () => {
    const { thread } = createThreadWithTrunk('React vs Vue');
    const item = createItem({ rawText: 'Maybe related to frameworks' });

    const ai = mockAI({
      clusterItem: vi.fn().mockResolvedValue({
        decision: 'existing',
        threadId: thread.id,
        confidence: 0.3,
      }),
    });

    const agent = new ClusteringAgent(db, ai, threadRepo, branchRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.run();

    expect(result).toEqual({ processed: 0, newThreads: 0, reopened: 0 });

    const updated = sourceItemRepo.getById(item.id)!;
    expect(updated.thread_id).toBe(thread.id);
    expect(updated.processed).toBe(false);
  });

  it('creates a new thread (high confidence)', async () => {
    const item = createItem({ rawText: 'Entirely new topic about databases' });

    const ai = mockAI({
      clusterItem: vi.fn().mockResolvedValue({
        decision: 'new',
        threadId: null,
        confidence: 0.9,
        suggestedTitle: 'Database Selection',
      }),
    });

    const agent = new ClusteringAgent(db, ai, threadRepo, branchRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.run();

    expect(result).toEqual({ processed: 1, newThreads: 1, reopened: 0 });

    const threads = threadRepo.list();
    expect(threads).toHaveLength(1);
    expect(threads[0].title).toBe('Database Selection');

    const branches = branchRepo.listByThread(threads[0].id);
    expect(branches).toHaveLength(1);
    expect(branches[0].parent_commit_id).toBeNull();

    const updated = sourceItemRepo.getById(item.id)!;
    expect(updated.thread_id).toBe(threads[0].id);
    expect(updated.processed).toBe(true);
  });

  it('reopens a closed thread and emits a reopen feed event', async () => {
    const { thread } = createThreadWithTrunk('Old decision', 'closed');
    const item = createItem({ rawText: 'New info about old decision' });

    const ai = mockAI({
      clusterItem: vi.fn().mockResolvedValue({
        decision: 'existing',
        threadId: thread.id,
        confidence: 0.9,
      }),
    });

    const agent = new ClusteringAgent(db, ai, threadRepo, branchRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.run();

    expect(result).toEqual({ processed: 1, newThreads: 0, reopened: 1 });

    const reopened = threadRepo.getById(thread.id)!;
    expect(reopened.status).toBe('open');

    const events = feedEventRepo.list({ limit: 10, offset: 0 });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('reopen');
    expect(events[0].payload).toEqual({
      threadId: thread.id,
      itemId: item.id,
      reason: 'New activity detected',
    });
  });

  it('returns zero stats when there are no unprocessed items', async () => {
    const ai = mockAI();
    const agent = new ClusteringAgent(db, ai, threadRepo, branchRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.run();
    expect(result).toEqual({ processed: 0, newThreads: 0, reopened: 0 });
    expect(ai.clusterItem).not.toHaveBeenCalled();
  });

  it('AI error for one item does not crash the agent (skips it, continues)', async () => {
    createThreadWithTrunk('Thread A');
    const item1 = createItem({ rawText: 'item 1' });
    const item2 = createItem({ rawText: 'item 2' });

    let callCount = 0;
    const ai = mockAI({
      clusterItem: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('AI failure');
        return { decision: 'new', threadId: null, confidence: 0.9, suggestedTitle: 'New Topic' };
      }),
    });

    const agent = new ClusteringAgent(db, ai, threadRepo, branchRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.run();

    // item1 was skipped (error), item2 was processed
    expect(result.processed).toBe(1);
    expect(result.newThreads).toBe(1);

    // item1 remains unprocessed and unassigned
    const stillUnprocessed = sourceItemRepo.getById(item1.id)!;
    expect(stillUnprocessed.processed).toBe(false);
    expect(stillUnprocessed.thread_id).toBeNull();

    // item2 was processed
    const processed = sourceItemRepo.getById(item2.id)!;
    expect(processed.processed).toBe(true);
    expect(processed.thread_id).not.toBeNull();
  });
});

// ─── SynthesisAgent ──────────────────────────────────────────────────────────

describe('SynthesisAgent', () => {
  const oldDate = (hoursAgo: number) =>
    new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

  it('synthesizes a commit for a quiet thread with 3 items, closes thread, emits feed event', async () => {
    const { thread, branch } = createThreadWithTrunk('Framework Choice');
    const items = [
      createItem({ rawText: 'React has good ecosystem', capturedAt: oldDate(72), threadId: thread.id, processed: true }),
      createItem({ rawText: 'Vue is simpler', capturedAt: oldDate(48), threadId: thread.id, processed: true }),
      createItem({ rawText: 'Angular is heavy', capturedAt: oldDate(25), threadId: thread.id, processed: true }),
    ];

    const ai = mockAI({
      synthesizeCommit: vi.fn().mockResolvedValue({
        verdict: 'Use React for the project',
        reasoning: 'Best ecosystem fit and team familiarity',
      }),
    });

    const agent = new SynthesisAgent(db, ai, { quietWindowHours: 24 }, threadRepo, branchRepo, commitRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.run();

    expect(result).toEqual({ synthesized: 1, skipped: 0 });

    const commits = commitRepo.listByBranch(branch.id);
    expect(commits).toHaveLength(1);
    expect(commits[0].verdict_summary).toBe('Use React for the project');
    expect(commits[0].reasoning).toBe('Best ecosystem fit and team familiarity');
    expect(commits[0].source_item_ids).toEqual(expect.arrayContaining(items.map((i) => i.id)));

    const updated = threadRepo.getById(thread.id)!;
    expect(updated.status).toBe('closed');

    const events = feedEventRepo.list({ limit: 10, offset: 0 });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('commit_closed');
    expect(events[0].payload.verdict).toBe('Use React for the project');
  });

  it('skips thread with recent activity (within quiet window)', async () => {
    const { thread } = createThreadWithTrunk('Active thread');
    // Most recent item is only 2 hours ago (within 24h quiet window)
    createItem({ rawText: 'old item', capturedAt: oldDate(48), threadId: thread.id, processed: true });
    createItem({ rawText: 'recent item', capturedAt: oldDate(2), threadId: thread.id, processed: true });

    const ai = mockAI();
    const agent = new SynthesisAgent(db, ai, { quietWindowHours: 24 }, threadRepo, branchRepo, commitRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.run();

    expect(result).toEqual({ synthesized: 0, skipped: 1 });
    expect(ai.synthesizeCommit).not.toHaveBeenCalled();
  });

  it('skips thread with fewer than minItems uncommitted items', async () => {
    const { thread } = createThreadWithTrunk('Sparse thread');
    createItem({ rawText: 'only item', capturedAt: oldDate(48), threadId: thread.id, processed: true });

    const ai = mockAI();
    const agent = new SynthesisAgent(db, ai, { quietWindowHours: 24, minItems: 2 }, threadRepo, branchRepo, commitRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.run();

    expect(result).toEqual({ synthesized: 0, skipped: 1 });
    expect(ai.synthesizeCommit).not.toHaveBeenCalled();
  });

  it('commit source_item_ids contains exactly the uncommitted item IDs', async () => {
    const { thread, branch } = createThreadWithTrunk('Precise commit');
    const items = [
      createItem({ rawText: 'a', capturedAt: oldDate(72), threadId: thread.id, processed: true }),
      createItem({ rawText: 'b', capturedAt: oldDate(48), threadId: thread.id, processed: true }),
      createItem({ rawText: 'c', capturedAt: oldDate(30), threadId: thread.id, processed: true }),
    ];

    const ai = mockAI({
      synthesizeCommit: vi.fn().mockResolvedValue({ verdict: 'v', reasoning: 'r' }),
    });

    const agent = new SynthesisAgent(db, ai, { quietWindowHours: 24 }, threadRepo, branchRepo, commitRepo, sourceItemRepo, feedEventRepo);
    await agent.run();

    const commits = commitRepo.listByBranch(branch.id);
    expect(commits).toHaveLength(1);
    expect(commits[0].source_item_ids.sort()).toEqual(items.map((i) => i.id).sort());
  });

  it('does not re-include previously committed items', async () => {
    const { thread, branch } = createThreadWithTrunk('No re-include');

    const already = [
      createItem({ rawText: 'old1', capturedAt: oldDate(96), threadId: thread.id, processed: true }),
      createItem({ rawText: 'old2', capturedAt: oldDate(80), threadId: thread.id, processed: true }),
    ];
    // Create a prior commit that includes these two items
    commitRepo.create({
      branch_id: branch.id,
      verdict_summary: 'Old decision',
      reasoning: 'old reasoning',
      source_item_ids: already.map((i) => i.id),
    });

    // New uncommitted items
    const newItems = [
      createItem({ rawText: 'new1', capturedAt: oldDate(48), threadId: thread.id, processed: true }),
      createItem({ rawText: 'new2', capturedAt: oldDate(30), threadId: thread.id, processed: true }),
    ];

    const ai = mockAI({
      synthesizeCommit: vi.fn().mockResolvedValue({ verdict: 'new verdict', reasoning: 'new reasoning' }),
    });

    const agent = new SynthesisAgent(db, ai, { quietWindowHours: 24 }, threadRepo, branchRepo, commitRepo, sourceItemRepo, feedEventRepo);
    await agent.run();

    const commits = commitRepo.listByBranch(branch.id);
    // Should have 2 commits: the old one + the new one
    expect(commits).toHaveLength(2);

    const newCommit = commits[commits.length - 1];
    // Only the new items should be in the new commit
    expect(newCommit.source_item_ids.sort()).toEqual(newItems.map((i) => i.id).sort());
    // The already-committed items should NOT appear
    for (const id of already.map((i) => i.id)) {
      expect(newCommit.source_item_ids).not.toContain(id);
    }
  });
});

// ─── CorrectionAgent ─────────────────────────────────────────────────────────

describe('CorrectionAgent', () => {
  let correctionAgent: CorrectionAgent;

  beforeEach(() => {
    correctionAgent = new CorrectionAgent(db, threadRepo, branchRepo, sourceItemRepo, feedEventRepo);
  });

  it('reassign updates item thread_id and marks processed', () => {
    const { thread: sourceThread } = createThreadWithTrunk('Source');
    const { thread: targetThread } = createThreadWithTrunk('Target');
    const item = createItem({ rawText: 'move me', threadId: sourceThread.id });

    correctionAgent.reassign(item.id, targetThread.id);

    const updated = sourceItemRepo.getById(item.id)!;
    expect(updated.thread_id).toBe(targetThread.id);
    expect(updated.processed).toBe(true);
  });

  it('mergeThreads moves items and branches to target, deletes source', () => {
    const { thread: source } = createThreadWithTrunk('Source Thread');
    const { thread: target } = createThreadWithTrunk('Target Thread');

    const item1 = createItem({ rawText: 'item1', threadId: source.id });
    const item2 = createItem({ rawText: 'item2', threadId: source.id });
    // source already has a trunk branch; add another branch to source
    const extraBranch = branchRepo.create({ thread_id: source.id, parent_commit_id: null, context_label: 'alt' });

    correctionAgent.mergeThreads(source.id, target.id);

    // Source thread deleted
    expect(threadRepo.getById(source.id)).toBeUndefined();

    // Items moved to target
    expect(sourceItemRepo.getById(item1.id)!.thread_id).toBe(target.id);
    expect(sourceItemRepo.getById(item2.id)!.thread_id).toBe(target.id);

    // Branches moved to target
    const targetBranches = branchRepo.listByThread(target.id);
    // target had 1 trunk branch + 2 moved from source = 3 total
    expect(targetBranches).toHaveLength(3);
    const movedIds = targetBranches.map((b) => b.id);
    expect(movedIds).toContain(extraBranch.id);
  });

  it('splitToNewThread creates thread + branch, reassigns item', () => {
    const { thread: original } = createThreadWithTrunk('Original');
    const item = createItem({ rawText: 'split me', threadId: original.id });

    const result = correctionAgent.splitToNewThread(item.id, 'New Topic');

    // New thread exists
    const newThread = threadRepo.getById(result.threadId)!;
    expect(newThread).toBeDefined();
    expect(newThread.title).toBe('New Topic');

    // New trunk branch exists
    const newBranch = branchRepo.getById(result.branchId)!;
    expect(newBranch).toBeDefined();
    expect(newBranch.thread_id).toBe(result.threadId);
    expect(newBranch.parent_commit_id).toBeNull();

    // Item reassigned and marked processed
    const updated = sourceItemRepo.getById(item.id)!;
    expect(updated.thread_id).toBe(result.threadId);
    expect(updated.processed).toBe(true);
  });

  it('confirm marks item as processed', () => {
    const item = createItem({ rawText: 'confirm me' }); // processed=false by default
    expect(sourceItemRepo.getById(item.id)!.processed).toBe(false);

    correctionAgent.confirm(item.id);

    expect(sourceItemRepo.getById(item.id)!.processed).toBe(true);
  });
});

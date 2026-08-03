import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createInMemoryDatabase } from '../src/db/database.js';
import { ThreadRepository } from '../src/db/repositories/thread-repository.js';
import { BranchRepository } from '../src/db/repositories/branch-repository.js';
import { CommitRepository } from '../src/db/repositories/commit-repository.js';
import { SourceItemRepository } from '../src/db/repositories/source-item-repository.js';
import { FeedEventRepository } from '../src/db/repositories/feed-event-repository.js';
import { ResurfacingAgent } from '../src/agents/resurfacing.js';
import type { TraceAI } from '../src/ai/openai-client.js';

let db: Database.Database;
let threadRepo: ThreadRepository;
let branchRepo: BranchRepository;
let commitRepo: CommitRepository;
let sourceItemRepo: SourceItemRepository;
let feedEventRepo: FeedEventRepository;

function mockAI(overrides: Partial<TraceAI> = {}): TraceAI {
  return {
    clusterItem: vi.fn(),
    synthesizeCommit: vi.fn(),
    generateDiff: vi.fn(),
    extractFromScreenshot: vi.fn(),
    ...overrides,
  } as unknown as TraceAI;
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

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

beforeEach(() => {
  db = createInMemoryDatabase();
  threadRepo = new ThreadRepository(db);
  branchRepo = new BranchRepository(db);
  commitRepo = new CommitRepository(db);
  sourceItemRepo = new SourceItemRepository(db);
  feedEventRepo = new FeedEventRepository(db);
});

// ─── generateReopenDiffs ──────────────────────────────────────────────────────

describe('ResurfacingAgent.generateReopenDiffs', () => {
  it('generates diff for reopen event without existing nudge', async () => {
    const { thread, branch } = createThreadWithTrunk('React vs Vue', 'open');

    // Create a prior commit on trunk
    commitRepo.create({
      branch_id: branch.id,
      verdict_summary: 'Use React for the project',
      reasoning: 'Best ecosystem fit',
      source_item_ids: [],
    });

    // Create a source item that triggered the reopen
    const item = createItem({ rawText: 'Vue 4.0 released with major improvements', threadId: thread.id });

    // Create a reopen event (recent, within 24h)
    feedEventRepo.create({
      type: 'reopen',
      thread_id: thread.id,
      payload: { threadId: thread.id, itemId: item.id, reason: 'New activity detected' },
    });

    const ai = mockAI({
      generateDiff: vi.fn().mockResolvedValue({
        summary: 'Vue 4.0 introduces breaking changes that may affect React decision',
        changedFactors: ['Vue performance improvements', 'New Vue features'],
      }),
    });

    const agent = new ResurfacingAgent(ai, {}, threadRepo, branchRepo, commitRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.generateReopenDiffs();

    expect(result.diffsGenerated).toBe(1);
    expect(ai.generateDiff).toHaveBeenCalledOnce();

    const nudges = feedEventRepo.listByThreadAndType(thread.id, 'nudge');
    expect(nudges).toHaveLength(1);
    expect(nudges[0].payload.diff).toEqual({
      summary: 'Vue 4.0 introduces breaking changes that may affect React decision',
      changedFactors: ['Vue performance improvements', 'New Vue features'],
    });
    expect(nudges[0].payload.previousVerdict).toBe('Use React for the project');
  });

  it('skips reopen event when nudge already exists', async () => {
    const { thread, branch } = createThreadWithTrunk('Thread with nudge');

    commitRepo.create({
      branch_id: branch.id,
      verdict_summary: 'Old verdict',
      reasoning: 'Old reasoning',
      source_item_ids: [],
    });

    const item = createItem({ rawText: 'New info', threadId: thread.id });

    feedEventRepo.create({
      type: 'reopen',
      thread_id: thread.id,
      payload: { threadId: thread.id, itemId: item.id, reason: 'Activity' },
    });

    // Pre-existing nudge for this thread
    feedEventRepo.create({
      type: 'nudge',
      thread_id: thread.id,
      payload: { threadId: thread.id, diff: { summary: 'existing', changedFactors: [] } },
    });

    const ai = mockAI({
      generateDiff: vi.fn().mockResolvedValue({ summary: 'new', changedFactors: [] }),
    });

    const agent = new ResurfacingAgent(ai, {}, threadRepo, branchRepo, commitRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.generateReopenDiffs();

    expect(result.diffsGenerated).toBe(0);
    expect(ai.generateDiff).not.toHaveBeenCalled();
  });

  it('handles AI failure gracefully without crashing', async () => {
    const { thread, branch } = createThreadWithTrunk('Thread with AI failure');

    commitRepo.create({
      branch_id: branch.id,
      verdict_summary: 'Verdict',
      reasoning: 'Reasoning',
      source_item_ids: [],
    });

    const item = createItem({ rawText: 'Trigger item', threadId: thread.id });

    feedEventRepo.create({
      type: 'reopen',
      thread_id: thread.id,
      payload: { threadId: thread.id, itemId: item.id, reason: 'Activity' },
    });

    const ai = mockAI({
      generateDiff: vi.fn().mockRejectedValue(new Error('AI service unavailable')),
    });

    const agent = new ResurfacingAgent(ai, {}, threadRepo, branchRepo, commitRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.generateReopenDiffs();

    expect(result.diffsGenerated).toBe(0);
    // Should not crash, should return gracefully
  });

  it('skips thread with no prior commits', async () => {
    const { thread } = createThreadWithTrunk('Thread without commits');

    const item = createItem({ rawText: 'New info', threadId: thread.id });

    feedEventRepo.create({
      type: 'reopen',
      thread_id: thread.id,
      payload: { threadId: thread.id, itemId: item.id, reason: 'Activity' },
    });

    const ai = mockAI({
      generateDiff: vi.fn().mockResolvedValue({ summary: 'diff', changedFactors: [] }),
    });

    const agent = new ResurfacingAgent(ai, {}, threadRepo, branchRepo, commitRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.generateReopenDiffs();

    expect(result.diffsGenerated).toBe(0);
    expect(ai.generateDiff).not.toHaveBeenCalled();
  });
});

// ─── generateDigest ───────────────────────────────────────────────────────────

describe('ResurfacingAgent.generateDigest', () => {
  it('creates digest for open thread with 3 items this week', async () => {
    const { thread } = createThreadWithTrunk('Active thread', 'open');

    createItem({ rawText: 'Item 1', capturedAt: daysAgo(2), threadId: thread.id });
    createItem({ rawText: 'Item 2', capturedAt: daysAgo(3), threadId: thread.id });
    createItem({ rawText: 'Item 3', capturedAt: daysAgo(5), threadId: thread.id });

    const ai = mockAI();
    const agent = new ResurfacingAgent(ai, { digestWindowDays: 7 }, threadRepo, branchRepo, commitRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.generateDigest();

    expect(result.digestsGenerated).toBe(1);

    const digests = feedEventRepo.listByThreadAndType(thread.id, 'digest');
    expect(digests).toHaveLength(1);
    expect(digests[0].payload.threadId).toBe(thread.id);
    expect(digests[0].payload.threadTitle).toBe('Active thread');
    expect(digests[0].payload.itemCount).toBe(3);
    expect(digests[0].payload.timespan).toBe('this week');
  });

  it('does not create digest for thread with only 1 item this week', async () => {
    const { thread } = createThreadWithTrunk('Sparse thread', 'open');

    createItem({ rawText: 'Only item', capturedAt: daysAgo(2), threadId: thread.id });

    const ai = mockAI();
    const agent = new ResurfacingAgent(ai, { digestWindowDays: 7 }, threadRepo, branchRepo, commitRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.generateDigest();

    expect(result.digestsGenerated).toBe(0);

    const digests = feedEventRepo.listByThreadAndType(thread.id, 'digest');
    expect(digests).toHaveLength(0);
  });

  it('does not create digest for closed thread with activity', async () => {
    const { thread } = createThreadWithTrunk('Closed thread', 'closed');

    createItem({ rawText: 'Item 1', capturedAt: daysAgo(2), threadId: thread.id });
    createItem({ rawText: 'Item 2', capturedAt: daysAgo(3), threadId: thread.id });

    const ai = mockAI();
    const agent = new ResurfacingAgent(ai, { digestWindowDays: 7 }, threadRepo, branchRepo, commitRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.generateDigest();

    expect(result.digestsGenerated).toBe(0);
  });

  it('does not create duplicate digest for same thread this week', async () => {
    const { thread } = createThreadWithTrunk('Thread with digest', 'open');

    createItem({ rawText: 'Item 1', capturedAt: daysAgo(2), threadId: thread.id });
    createItem({ rawText: 'Item 2', capturedAt: daysAgo(3), threadId: thread.id });

    // Pre-existing digest for this thread this week
    feedEventRepo.create({
      type: 'digest',
      thread_id: thread.id,
      payload: { threadId: thread.id, threadTitle: 'Thread with digest', itemCount: 2 },
    });

    const ai = mockAI();
    const agent = new ResurfacingAgent(ai, { digestWindowDays: 7 }, threadRepo, branchRepo, commitRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.generateDigest();

    expect(result.digestsGenerated).toBe(0);

    const digests = feedEventRepo.listByThreadAndType(thread.id, 'digest');
    expect(digests).toHaveLength(1); // Only the pre-existing one
  });

  it('creates digests for multiple qualifying threads', async () => {
    const { thread: thread1 } = createThreadWithTrunk('Thread A', 'open');
    const { thread: thread2 } = createThreadWithTrunk('Thread B', 'open');

    createItem({ rawText: 'A1', capturedAt: daysAgo(2), threadId: thread1.id });
    createItem({ rawText: 'A2', capturedAt: daysAgo(3), threadId: thread1.id });

    createItem({ rawText: 'B1', capturedAt: daysAgo(1), threadId: thread2.id });
    createItem({ rawText: 'B2', capturedAt: daysAgo(4), threadId: thread2.id });

    const ai = mockAI();
    const agent = new ResurfacingAgent(ai, { digestWindowDays: 7 }, threadRepo, branchRepo, commitRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.generateDigest();

    expect(result.digestsGenerated).toBe(2);

    const digests1 = feedEventRepo.listByThreadAndType(thread1.id, 'digest');
    const digests2 = feedEventRepo.listByThreadAndType(thread2.id, 'digest');
    expect(digests1).toHaveLength(1);
    expect(digests2).toHaveLength(1);
  });
});

// ─── run ──────────────────────────────────────────────────────────────────────

describe('ResurfacingAgent.run', () => {
  it('calls both jobs and returns combined stats', async () => {
    const { thread: thread1, branch: branch1 } = createThreadWithTrunk('Reopened thread', 'open');
    const { thread: thread2 } = createThreadWithTrunk('Active thread', 'open');

    // Setup for reopen diff
    commitRepo.create({
      branch_id: branch1.id,
      verdict_summary: 'Old verdict',
      reasoning: 'Old reasoning',
      source_item_ids: [],
    });
    const item = createItem({ rawText: 'New info', threadId: thread1.id });
    feedEventRepo.create({
      type: 'reopen',
      thread_id: thread1.id,
      payload: { threadId: thread1.id, itemId: item.id, reason: 'Activity' },
    });

    // Setup for digest
    createItem({ rawText: 'D1', capturedAt: daysAgo(2), threadId: thread2.id });
    createItem({ rawText: 'D2', capturedAt: daysAgo(3), threadId: thread2.id });

    const ai = mockAI({
      generateDiff: vi.fn().mockResolvedValue({
        summary: 'Things changed',
        changedFactors: ['factor1'],
      }),
    });

    const agent = new ResurfacingAgent(ai, { digestWindowDays: 7 }, threadRepo, branchRepo, commitRepo, sourceItemRepo, feedEventRepo);
    const result = await agent.run();

    expect(result.diffsGenerated).toBe(1);
    expect(result.digestsGenerated).toBe(1);
  });
});

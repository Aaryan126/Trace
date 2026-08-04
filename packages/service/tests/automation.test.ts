import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from 'better-sqlite3';
import {
  AutomationActionRepository,
  BranchRepository,
  CommitRepository,
  createInMemoryDatabase,
  EmbeddingRepository,
  SourceItemRepository,
  MergeEventRepository,
  ThreadRepository,
  TraceAI,
  WorkingStateRepository,
  type AutonomousRouteDecision,
} from '@trace/core';
import { AutonomousCoordinator, mergeComparison } from '../src/automation.js';

let db: Database;
let items: SourceItemRepository;
let threads: ThreadRepository;
let branches: BranchRepository;
let states: WorkingStateRepository;
let actions: AutomationActionRepository;
let coordinator: AutonomousCoordinator;
let routeResearch: ReturnType<typeof vi.fn>;
let reconcileBranches: ReturnType<typeof vi.fn>;
let synthesizeCheckpoint: ReturnType<typeof vi.fn>;

const baseDecision: AutonomousRouteDecision = {
  action: 'new_thread', threadId: null, branchId: null, confidence: 0.94,
  rationale: 'This evidence compares concrete options.', title: 'Choose local storage', contextLabel: null,
  researchQuestion: 'SQLite or Postgres for local storage?', summary: 'Comparing database fit.',
  options: ['SQLite', 'Postgres'], constraints: ['Offline-first'], openQuestions: ['Need sync?'],
  tentativeDirection: 'SQLite', changedFactors: [], checkpointNow: false,
};

beforeEach(() => {
  db = createInMemoryDatabase();
  items = new SourceItemRepository(db);
  threads = new ThreadRepository(db);
  branches = new BranchRepository(db);
  states = new WorkingStateRepository(db);
  actions = new AutomationActionRepository(db);
  routeResearch = vi.fn().mockResolvedValue(baseDecision);
  reconcileBranches = vi.fn().mockResolvedValue({ action: 'none', confidence: 0.5, rationale: 'Contexts still differ.', sourceBranchIds: [], targetBranchId: null, durableRule: null });
  synthesizeCheckpoint = vi.fn().mockResolvedValue({ verdict: 'Use SQLite', reasoning: 'Local-first.', resolutionStatus: 'resolved' });
  const ai = {
    routeResearch,
    embed: vi.fn().mockResolvedValue([]),
    synthesizeCheckpoint,
    reconcileBranches,
  } as unknown as TraceAI;
  coordinator = new AutonomousCoordinator(db, ai, { debounceMs: 1, checkpointQuietSeconds: 3_600 });
});

afterEach(async () => {
  await coordinator.close();
  db.close();
});

function createEvidence() {
  return items.create({ type: 'screenshot', raw_text: 'SQLite versus Postgres comparison', extracted_entities: null, url: null, captured_at: new Date().toISOString(), thread_id: null });
}

describe('AutonomousCoordinator', () => {
  it('creates a thread, branch, live working state, and audit action without review', async () => {
    const item = createEvidence();
    await coordinator.recover();

    const stored = items.getById(item.id)!;
    expect(stored.automation_status).toBe('filed');
    expect(stored.processed).toBe(true);
    const thread = threads.list()[0];
    const branch = branches.listByThread(thread.id)[0];
    expect(thread.title).toBe('Choose local storage');
    expect(states.getByBranch(branch.id)).toMatchObject({ research_question: 'SQLite or Postgres for local storage?', evidence_ids: [item.id] });
    expect(actions.list()[0]).toMatchObject({ action: 'new_thread', source_item_id: item.id, status: 'applied' });
  });

  it('ignores casual evidence explicitly and records why', async () => {
    routeResearch.mockResolvedValue({ ...baseDecision, action: 'ignore', title: null, confidence: 0.99, rationale: 'Casual entertainment with no decision evidence.' });
    const item = createEvidence();
    await coordinator.recover();

    expect(items.getById(item.id)).toMatchObject({ automation_status: 'ignored', thread_id: null, processed: true });
    expect(threads.list()).toHaveLength(0);
    expect(actions.list()[0].rationale).toContain('Casual entertainment');
  });

  it('rejects obvious feed/media noise locally without spending an AI call', async () => {
    const item = items.create({ type: 'browser_history', raw_text: 'A random short', extracted_entities: null, url: 'https://www.youtube.com/shorts/example', captured_at: new Date().toISOString(), thread_id: null });
    await coordinator.recover();

    expect(routeResearch).not.toHaveBeenCalled();
    expect(items.getById(item.id)?.automation_status).toBe('ignored');
    expect(actions.list()[0]).toMatchObject({ action: 'ignore', model: null, confidence: 1 });
  });

  it('suppresses the same normalized URL within one research session', async () => {
    const earlier = items.create({ type: 'browser_history', raw_text: 'Database comparison', extracted_entities: null, url: 'https://example.com/compare?utm_source=newsletter', captured_at: new Date().toISOString(), thread_id: null });
    items.markProcessed(earlier.id);
    const duplicate = items.create({ type: 'browser_history', raw_text: 'Same comparison again', extracted_entities: null, url: 'https://example.com/compare?utm_source=other#section', captured_at: new Date().toISOString(), thread_id: null });

    await coordinator.recover();

    expect(routeResearch).not.toHaveBeenCalled();
    expect(items.getById(duplicate.id)?.automation_status).toBe('ignored');
    expect(actions.list()[0].rationale).toContain('already filed this page');
  });

  it('routes a semantically equivalent core question into the existing thread', async () => {
    await coordinator.close();
    const thread = threads.create({ title: 'Determine the best LLM', tags: [], status: 'open' });
    const branch = branches.create({ thread_id: thread.id, parent_commit_id: null, context_label: 'General evaluation' });
    new EmbeddingRepository(db).upsert('thread', thread.id, 'text-embedding-3-small', [1, 0]);
    routeResearch.mockResolvedValue({ ...baseDecision, action: 'new_thread', title: 'Compare LLMs across cost and intelligence', researchQuestion: 'Which LLM is best across cost and intelligence?' });
    const ai = { routeResearch, embed: vi.fn().mockResolvedValue([1, 0]), synthesizeCheckpoint, reconcileBranches } as unknown as TraceAI;
    coordinator = new AutonomousCoordinator(db, ai, { debounceMs: 1, checkpointQuietSeconds: 3_600 });
    const item = createEvidence();

    await coordinator.recover();

    expect(threads.list()).toHaveLength(1);
    expect(items.getById(item.id)).toMatchObject({ thread_id: thread.id, branch_id: branch.id });
    expect(actions.list()[0].rationale).toContain('matched this to the existing decision');
  });

  it('automatically retries failed routing after the short in-process delay', async () => {
    await coordinator.close();
    routeResearch.mockRejectedValueOnce(new Error('temporary routing failure')).mockResolvedValue(baseDecision);
    const ai = {
      routeResearch,
      embed: vi.fn().mockResolvedValue([]),
      synthesizeCheckpoint,
      reconcileBranches,
    } as unknown as TraceAI;
    coordinator = new AutonomousCoordinator(db, ai, { debounceMs: 1, checkpointQuietSeconds: 3_600, routingRetryDelayMs: 10 });
    const item = createEvidence();

    await coordinator.recover();
    expect(items.getById(item.id)).toMatchObject({ automation_status: 'error', automation_attempts: 1 });

    await vi.waitFor(() => {
      expect(items.getById(item.id)).toMatchObject({ automation_status: 'filed', automation_attempts: 2 });
    });
    expect(routeResearch).toHaveBeenCalledTimes(2);
  });

  it('resets the quiet checkpoint timer when more evidence arrives', async () => {
    await coordinator.close();
    const ai = {
      routeResearch,
      embed: vi.fn().mockResolvedValue([]),
      synthesizeCheckpoint,
      reconcileBranches,
    } as unknown as TraceAI;
    coordinator = new AutonomousCoordinator(db, ai, { debounceMs: 1, checkpointQuietSeconds: 0.2 });
    createEvidence();
    await coordinator.recover();
    const thread = threads.list()[0];
    const branch = branches.listByThread(thread.id)[0];

    await new Promise((resolve) => setTimeout(resolve, 50));
    routeResearch.mockResolvedValue({ ...baseDecision, action: 'continue_branch', threadId: thread.id, branchId: branch.id, title: null });
    createEvidence();
    await coordinator.recover();

    await new Promise((resolve) => setTimeout(resolve, 170));
    expect(synthesizeCheckpoint).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(synthesizeCheckpoint).toHaveBeenCalledTimes(1));
  });

  it('reconciles the affected thread immediately after a checkpoint', async () => {
    await coordinator.close();
    const thread = threads.create({ title: 'Choose database', tags: [], status: 'open' });
    const branchA = branches.create({ thread_id: thread.id, parent_commit_id: null, context_label: 'Local app' });
    const commits = new CommitRepository(db);
    const first = commits.create({ branch_id: branchA.id, verdict_summary: 'Use SQLite locally', reasoning: 'Embedded storage.', source_item_ids: [] });
    const branchB = branches.create({ thread_id: thread.id, parent_commit_id: first.id, context_label: 'Hosted app' });
    routeResearch.mockResolvedValue({ ...baseDecision, action: 'continue_branch', threadId: thread.id, branchId: branchB.id, title: null });
    reconcileBranches.mockResolvedValue({ action: 'merge', confidence: 0.97, rationale: 'The contexts form a stable boundary.', sourceBranchIds: [branchA.id, branchB.id], targetBranchId: branchA.id, durableRule: 'Use SQLite locally; Postgres for hosted multi-user services.' });
    const ai = {
      routeResearch,
      embed: vi.fn().mockResolvedValue([]),
      synthesizeCheckpoint,
      reconcileBranches,
    } as unknown as TraceAI;
    coordinator = new AutonomousCoordinator(db, ai, { debounceMs: 1, checkpointQuietSeconds: 0.01 });
    createEvidence();

    await coordinator.recover();

    await vi.waitFor(() => expect(new MergeEventRepository(db).listByThread(thread.id)).toHaveLength(1));
    expect(reconcileBranches).toHaveBeenCalledTimes(1);
  });

  it('resolves an actionable recommendation when only minor validation remains', async () => {
    await coordinator.close();
    routeResearch.mockResolvedValue({ ...baseDecision, tentativeDirection: 'Use SQLite by default.', openQuestions: ['Verify exact write performance in a later benchmark.'] });
    synthesizeCheckpoint.mockResolvedValue({ verdict: 'Use SQLite by default', reasoning: 'It satisfies the current local-first constraints; benchmark performance later.', resolutionStatus: 'in_progress' });
    const ai = { routeResearch, embed: vi.fn().mockResolvedValue([]), synthesizeCheckpoint, reconcileBranches } as unknown as TraceAI;
    coordinator = new AutonomousCoordinator(db, ai, { debounceMs: 1, checkpointQuietSeconds: 0.01 });
    createEvidence();

    await coordinator.recover();

    await vi.waitFor(() => expect(new CommitRepository(db).getLatestByThread(threads.list()[0].id)?.resolution_status).toBe('resolved'));
    expect(threads.list()[0].status).toBe('closed');
    expect(actions.list().find((action) => action.action === 'checkpoint')?.after_snapshot).toMatchObject({ policyPromoted: true });
  });

  it('continues the same branch when a closed decision is revisited in the same context', async () => {
    const thread = threads.create({ title: 'Choose database', tags: [], status: 'closed' });
    const branch = branches.create({ thread_id: thread.id, parent_commit_id: null, context_label: 'Original context' });
    routeResearch.mockResolvedValue({ ...baseDecision, action: 'continue_branch', threadId: thread.id, branchId: branch.id, title: null });
    const item = createEvidence();
    await coordinator.recover();

    expect(threads.getById(thread.id)?.status).toBe('open');
    expect(branches.listByThread(thread.id)).toHaveLength(1);
    expect(items.getById(item.id)).toMatchObject({ thread_id: thread.id, branch_id: branch.id, automation_status: 'filed' });
  });

  it('undoes an isolated automatic thread creation and restores the item to pending', async () => {
    const item = createEvidence();
    await coordinator.recover();
    const action = actions.list()[0];

    expect(await coordinator.undo(action.id)).toEqual({ ok: true });
    expect(threads.list()).toHaveLength(0);
    expect(items.getById(item.id)).toMatchObject({ automation_status: 'pending', processed: false, thread_id: null });
    expect(actions.getById(action.id)?.status).toBe('reverted');
  });

  it('automatically merges compatible branches only above the confidence gate', async () => {
    const thread = threads.create({ title: 'Choose database', tags: [], status: 'open' });
    const branchA = branches.create({ thread_id: thread.id, parent_commit_id: null, context_label: 'Local app' });
    const commits = new CommitRepository(db);
    const first = commits.create({ branch_id: branchA.id, verdict_summary: 'Use SQLite locally', reasoning: 'Embedded storage.', source_item_ids: [] });
    const branchB = branches.create({ thread_id: thread.id, parent_commit_id: first.id, context_label: 'Hosted app' });
    commits.create({ branch_id: branchB.id, verdict_summary: 'Use Postgres when hosted', reasoning: 'Concurrent service.', source_item_ids: [] });
    reconcileBranches.mockResolvedValue({ action: 'merge', confidence: 0.97, rationale: 'The contexts form a stable boundary.', sourceBranchIds: [branchA.id, branchB.id], targetBranchId: branchA.id, durableRule: 'Use SQLite locally; Postgres for hosted multi-user services.' });

    expect(await coordinator.reconcile()).toEqual({ checkpointed: 0, merged: 1 });
    expect(new MergeEventRepository(db).listByThread(thread.id)).toEqual([expect.objectContaining({ origin: 'automatic' })]);
    expect(commits.listByBranch(branchA.id).at(-1)).toMatchObject({ kind: 'merge', resolution_status: 'resolved' });
    expect(threads.getById(thread.id)?.status).toBe('closed');
  });

  it('does not re-run unchanged branch reconciliation after a no-merge decision', async () => {
    const thread = threads.create({ title: 'Choose queue', tags: [], status: 'open' });
    const branchA = branches.create({ thread_id: thread.id, parent_commit_id: null, context_label: 'Small workload' });
    const commits = new CommitRepository(db);
    const first = commits.create({ branch_id: branchA.id, verdict_summary: 'Use an in-process queue', reasoning: 'Small scale.', source_item_ids: [] });
    const branchB = branches.create({ thread_id: thread.id, parent_commit_id: first.id, context_label: 'Large workload' });
    commits.create({ branch_id: branchB.id, verdict_summary: 'Evaluate a broker', reasoning: 'Scale differs.', source_item_ids: [] });

    expect(await coordinator.reconcile()).toEqual({ checkpointed: 0, merged: 0 });
    expect(await coordinator.reconcile()).toEqual({ checkpointed: 0, merged: 0 });
    expect(reconcileBranches).toHaveBeenCalledTimes(1);
    expect(actions.list().filter((action) => action.action === 'reconcile_none')).toHaveLength(1);
  });
});

describe('mergeComparison', () => {
  it('keeps equivalent supported claims supported and does not duplicate their text', () => {
    const previous = { options: [{ id: 'sqlite', label: 'SQLite' }], criteria: [{ id: 'deployment', label: 'Deployment' }], cells: [{ option_id: 'sqlite', criterion_id: 'deployment', value: 'SQLite uses a single local database file', status: 'supported' as const, source_item_ids: ['source-1'] }] };
    const result = mergeComparison(previous, ['SQLite'], [{ option: 'SQLite', criterion: 'Deployment', value: 'A single local database file is used by SQLite', status: 'supported' }], 'source-2');

    expect(result.cells[0].status).toBe('supported');
    expect(result.cells[0].value).not.toContain(' · ');
    expect(result.cells[0].source_item_ids).toEqual(['source-1', 'source-2']);
  });

  it('retains distinct compatible supported facts without labelling them conflicting', () => {
    const previous = { options: [{ id: 'sqlite', label: 'SQLite' }], criteria: [{ id: 'cost', label: 'Cost' }], cells: [{ option_id: 'sqlite', criterion_id: 'cost', value: 'No server license', status: 'supported' as const, source_item_ids: ['source-1'] }] };
    const result = mergeComparison(previous, ['SQLite'], [{ option: 'SQLite', criterion: 'Cost', value: 'Hosting cost depends on deployment', status: 'supported' }], 'source-2');

    expect(result.cells[0].status).toBe('supported');
    expect(result.cells[0].value).toContain(' · ');
  });
});

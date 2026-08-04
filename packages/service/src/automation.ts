import { EventEmitter } from 'node:events';
import { lookup } from 'node:dns/promises';
import { readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import {
  AutomationActionRepository,
  BranchRepository,
  CaptureAssetRepository,
  CommitRepository,
  EmbeddingRepository,
  FeedEventRepository,
  MergeEventRepository,
  SourceItemRepository,
  ThreadRepository,
  TraceAI,
  WorkingStateRepository,
  type AutonomousRouteDecision,
  type ComparisonMatrix,
  type SourceItem,
} from '@trace/core';

export interface TraceLiveEvent {
  type: 'source.pending' | 'source.processing' | 'source.filed' | 'source.ignored' | 'source.error' | 'working.updated' | 'checkpoint.created' | 'merge.created' | 'action.reverted';
  at: string;
  sourceItemId?: string;
  threadId?: string;
  branchId?: string;
  actionId?: string;
}

export class TraceEventBus extends EventEmitter {
  publish(event: Omit<TraceLiveEvent, 'at'>): void {
    this.emit('event', { ...event, at: new Date().toISOString() } satisfies TraceLiveEvent);
  }
}

export interface AutomationConfig {
  debounceMs: number;
  checkpointQuietSeconds: number;
  maxBatchSize: number;
  routingRetryDelayMs: number;
}

const DEFAULT_CONFIG: AutomationConfig = { debounceMs: 1_000, checkpointQuietSeconds: 25, maxBatchSize: 5, routingRetryDelayMs: 20_000 };
const EMBEDDING_MODEL = 'text-embedding-3-small';

function readCaptureDataUrl(assetPath: string | null): string | undefined {
  if (!assetPath) return undefined;
  try { return `data:image/jpeg;base64,${readFileSync(assetPath).toString('base64')}`; } catch { return undefined; }
}

export class AutonomousCoordinator {
  readonly events: TraceEventBus;
  private readonly config: AutomationConfig;
  private readonly threads: ThreadRepository;
  private readonly branches: BranchRepository;
  private readonly commits: CommitRepository;
  private readonly items: SourceItemRepository;
  private readonly states: WorkingStateRepository;
  private readonly actions: AutomationActionRepository;
  private readonly embeddings: EmbeddingRepository;
  private readonly feed: FeedEventRepository;
  private readonly merges: MergeEventRepository;
  private readonly captureAssets: CaptureAssetRepository;
  private queued = new Set<string>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private checkpointTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reconciliationQueues = new Map<string, Promise<number>>();
  private inFlight = new Set<Promise<unknown>>();
  private stopped = false;

  constructor(
    private readonly db: Database.Database,
    private readonly ai: TraceAI,
    config: Partial<AutomationConfig> = {},
    events = new TraceEventBus(),
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.events = events;
    this.threads = new ThreadRepository(db);
    this.branches = new BranchRepository(db);
    this.commits = new CommitRepository(db);
    this.items = new SourceItemRepository(db);
    this.states = new WorkingStateRepository(db);
    this.actions = new AutomationActionRepository(db);
    this.embeddings = new EmbeddingRepository(db);
    this.feed = new FeedEventRepository(db);
    this.merges = new MergeEventRepository(db);
    this.captureAssets = new CaptureAssetRepository(db);
  }

  start(): void {
    this.stopped = false;
    for (const item of this.items.listForAutomation()) this.enqueue(item.id, false);
    for (const state of this.states.listDue()) this.scheduleCheckpoint(state.branch_id, 0);
  }

  async recover(): Promise<{ recovered: number }> {
    const pending = this.items.listForAutomation();
    await Promise.all(pending.map((item) => this.process(item.id)));
    return { recovered: pending.length };
  }

  async reconcile(): Promise<{ checkpointed: number; merged: number }> {
    const due = this.states.listDue();
    await Promise.all(due.map((state) => this.checkpoint(state.branch_id)));
    let merged = 0;
    for (const thread of this.threads.list({ status: 'open' })) {
      merged += await this.queueReconciliation(thread.id);
    }
    return { checkpointed: due.length, merged };
  }

  enqueue(sourceItemId: string, announce = true): void {
    if (this.stopped) return;
    this.queued.add(sourceItemId);
    if (announce) this.events.publish({ type: 'source.pending', sourceItemId });
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.track(this.flush());
    }, this.config.debounceMs);
  }

  async retry(sourceItemId: string): Promise<boolean> {
    const item = this.items.getById(sourceItemId);
    if (!item || !['error', 'pending'].includes(item.automation_status)) return false;
    const timer = this.retryTimers.get(sourceItemId);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(sourceItemId);
    this.items.markAutomationStatus(sourceItemId, 'pending');
    this.enqueue(sourceItemId);
    return true;
  }

  async undo(actionId: string): Promise<{ ok: boolean; reason?: string }> {
    const action = this.actions.getById(actionId);
    if (!action || action.status !== 'applied' || !action.undoable || !action.source_item_id) {
      return { ok: false, reason: 'Action is not undoable' };
    }
    const later = this.actions.list(500).some((candidate) =>
      candidate.status === 'applied' && candidate.created_at > action.created_at &&
      (candidate.source_item_id === action.source_item_id || (action.thread_id && candidate.thread_id === action.thread_id)),
    );
    if (later) return { ok: false, reason: 'A later action depends on this result' };

    this.db.transaction(() => {
      if (action.branch_id) {
        const state = this.states.getByBranch(action.branch_id);
        if (state?.evidence_ids.includes(action.source_item_id!)) {
          this.states.upsert({ ...state, evidence_ids: state.evidence_ids.filter((id) => id !== action.source_item_id) });
        }
      }
      if (action.action === 'new_thread' && action.thread_id) {
        const commitCount = this.db.prepare(`SELECT COUNT(*) AS count FROM commits JOIN branches ON branches.id = commits.branch_id WHERE branches.thread_id = ?`).get(action.thread_id) as { count: number };
        if (commitCount.count === 0) this.threads.delete(action.thread_id);
      } else if (action.action === 'new_branch' && action.branch_id) {
        const commitCount = this.db.prepare('SELECT COUNT(*) AS count FROM commits WHERE branch_id = ?').get(action.branch_id) as { count: number };
        if (commitCount.count === 0) this.db.prepare('DELETE FROM branches WHERE id = ?').run(action.branch_id);
      }
      this.items.restorePending(action.source_item_id!);
      this.actions.markReverted(actionId);
    })();
    this.events.publish({ type: 'action.reverted', actionId, sourceItemId: action.source_item_id });
    return { ok: true };
  }

  async close(): Promise<void> {
    this.stopped = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    for (const timer of this.checkpointTimers.values()) clearTimeout(timer);
    this.checkpointTimers.clear();
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    await Promise.allSettled([...this.inFlight]);
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.inFlight.add(promise);
    void promise.finally(() => this.inFlight.delete(promise));
    return promise;
  }

  private async flush(): Promise<void> {
    if (this.stopped) return;
    const batch = [...this.queued].slice(0, this.config.maxBatchSize);
    batch.forEach((id) => this.queued.delete(id));
    for (let index = 0; index < batch.length; index += 2) {
      await Promise.all(batch.slice(index, index + 2).map((id) => this.process(id)));
    }
    if (this.queued.size > 0 && !this.stopped) this.enqueue([...this.queued][0], false);
  }

  private async process(sourceItemId: string): Promise<void> {
    const started = Date.now();
    let item = this.items.getById(sourceItemId);
    if (!item || !['pending', 'error'].includes(item.automation_status) || this.stopped) return;
    this.items.markAutomationStatus(item.id, 'processing');
    this.events.publish({ type: 'source.processing', sourceItemId: item.id });
    try {
      const deterministicIgnore = obviousNoiseReason(item) ?? this.recentDuplicateReason(item);
      if (deterministicIgnore) {
        const decision: AutonomousRouteDecision = {
          action: 'ignore', threadId: null, branchId: null, confidence: 1, rationale: deterministicIgnore,
          title: null, contextLabel: null, researchQuestion: '', summary: '', options: [], constraints: [],
          openQuestions: [], tentativeDirection: null, changedFactors: [], checkpointNow: false,
          comparisonUpdates: [],
        };
        const result = this.applyDecision(item, decision, [], Date.now() - started, null);
        this.events.publish({ type: 'source.ignored', sourceItemId: item.id, actionId: result.actionId });
        return;
      }
      item = await this.enrich(item);
      const text = [item.raw_text, item.content_text, item.visual_context].filter(Boolean).join('\n').slice(0, 12_000);
      const vector = await deadline(this.ai.embed(text || item.url || ''), 2_500).catch(() => [] as number[]);
      if (vector.length) this.embeddings.upsert('source_item', item.id, EMBEDDING_MODEL, vector);
      const candidates = this.buildCandidates(vector);
      const imageDataUrl = readCaptureDataUrl(this.captureAssets.getBySourceItem(item.id)?.full_path ?? null);
      let decision = await this.ai.routeResearch({ text, url: item.url, entities: entityStrings(item) }, candidates, imageDataUrl);
      decision = this.validateDecision(decision, candidates, item);
      const result = this.applyDecision(item, decision, candidates, Date.now() - started);
      if (result.branchId && vector.length) this.embeddings.upsert('thread', result.threadId!, EMBEDDING_MODEL, vector);
      this.events.publish({
        type: decision.action === 'ignore' ? 'source.ignored' : 'source.filed',
        sourceItemId: item.id, threadId: result.threadId ?? undefined, branchId: result.branchId ?? undefined,
        actionId: result.actionId,
      });
      if (result.branchId) {
        this.events.publish({ type: 'working.updated', sourceItemId: item.id, threadId: result.threadId!, branchId: result.branchId });
        this.scheduleCheckpoint(result.branchId, decision.checkpointNow ? 0 : this.config.checkpointQuietSeconds * 1_000);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = this.items.markAutomationStatus(sourceItemId, 'error', message.slice(0, 500));
      this.actions.create({ action: 'route_error', source_item_id: sourceItemId, thread_id: null, branch_id: null, model: 'gpt-5.6-terra', confidence: null, rationale: message, context_snapshot: {}, before_snapshot: {}, after_snapshot: {}, latency_ms: Date.now() - started, status: 'failed', undoable: false });
      this.events.publish({ type: 'source.error', sourceItemId });
      if (failed && failed.automation_attempts < 3) this.scheduleRetry(sourceItemId);
    }
  }

  private async enrich(item: SourceItem): Promise<SourceItem> {
    if (item.type !== 'browser_history' || !item.url || item.content_status !== 'not_requested') return item;
    try {
      const content = await fetchPublicPage(item.url);
      return this.items.updateEnrichment(item.id, content, content ? 'fetched' : 'metadata_only') ?? item;
    } catch {
      return this.items.updateEnrichment(item.id, null, 'failed') ?? item;
    }
  }

  private recentDuplicateReason(item: SourceItem): string | null {
    if (item.type !== 'browser_history' || !item.url) return null;
    const cutoff = new Date(new Date(item.captured_at).getTime() - 30 * 60_000).toISOString();
    const prior = this.db.prepare(`
      SELECT url FROM source_items
      WHERE rowid < (SELECT rowid FROM source_items WHERE id = ?)
        AND type = 'browser_history' AND url IS NOT NULL AND captured_at >= ?
        AND automation_status IN ('processing', 'filed')
      ORDER BY rowid DESC LIMIT 100
    `).all(item.id, cutoff) as Array<{ url: string }>;
    const normalized = normalizeResearchUrl(item.url);
    return prior.some((candidate) => normalizeResearchUrl(candidate.url) === normalized)
      ? 'Trace already filed this page in the current 30-minute research session.'
      : null;
  }

  private buildCandidates(vector: number[]) {
    const semanticMatches = vector.length ? this.embeddings.nearestThreads(vector, EMBEDDING_MODEL, 8) : [];
    const semanticIds = semanticMatches.map((match) => match.threadId);
    const similarityById = new Map(semanticMatches.map((match) => [match.threadId, match.similarity]));
    const recentIds = this.threads.list().slice(0, 12).map((thread) => thread.id);
    return [...new Set([...semanticIds, ...recentIds])].slice(0, 12).map((id) => this.threads.getById(id)).filter(Boolean).map((thread) => ({
      id: thread!.id, title: thread!.title, status: thread!.status, similarity: similarityById.get(thread!.id) ?? 0,
      branches: this.branches.listByThread(thread!.id).map((branch) => ({
        id: branch.id, contextLabel: branch.context_label,
        workingSummary: this.states.getByBranch(branch.id)?.summary ?? '',
        latestVerdict: this.commits.listByBranch(branch.id).at(-1)?.verdict_summary ?? '',
        comparison: this.states.getByBranch(branch.id)?.comparison ?? { options: [], criteria: [], cells: [] },
      })),
    }));
  }

  private validateDecision(decision: AutonomousRouteDecision, candidates: ReturnType<AutonomousCoordinator['buildCandidates']>, item: SourceItem): AutonomousRouteDecision {
    if (decision.action === 'ignore') return decision;
    if (decision.action === 'new_thread') {
      const equivalent = candidates.find((thread) => thread.similarity >= 0.94 && thread.branches.length === 1 && semanticAnchorOverlap(thread.title, `${decision.title ?? ''} ${decision.researchQuestion}`));
      if (equivalent) {
        return { ...decision, action: 'continue_branch', threadId: equivalent.id, branchId: equivalent.branches[0].id, title: null, rationale: `${decision.rationale} Trace matched this to the existing decision “${equivalent.title}”.` };
      }
    }
    const candidate = candidates.find((thread) => thread.id === decision.threadId);
    if (decision.action === 'new_thread' || !candidate) {
      return { ...decision, action: 'new_thread', threadId: null, branchId: null, title: decision.title?.trim() || decision.researchQuestion.trim() || item.raw_text?.slice(0, 100) || 'New research decision' };
    }
    const branch = candidate.branches.find((entry) => entry.id === decision.branchId);
    if (decision.action === 'continue_branch' && !branch) {
      return { ...decision, branchId: candidate.branches.at(-1)?.id ?? null, action: candidate.branches.length ? 'continue_branch' : 'new_branch' };
    }
    return decision;
  }

  private applyDecision(item: SourceItem, decision: AutonomousRouteDecision, candidates: ReturnType<AutonomousCoordinator['buildCandidates']>, latencyMs: number, model: string | null = 'gpt-5.6-terra') {
    return this.db.transaction(() => {
      if (decision.action === 'ignore') {
        this.items.markIgnored(item.id, decision.confidence);
        const action = this.actions.create({ action: 'ignore', source_item_id: item.id, thread_id: null, branch_id: null, model, confidence: decision.confidence, rationale: decision.rationale, context_snapshot: { candidateIds: candidates.map((candidate) => candidate.id) }, before_snapshot: { automationStatus: item.automation_status }, after_snapshot: { automationStatus: 'ignored' }, latency_ms: latencyMs, status: 'applied', undoable: true });
        return { actionId: action.id, threadId: null as string | null, branchId: null as string | null };
      }

      let threadId = decision.threadId;
      let branchId = decision.branchId;
      let createdThread = false;
      let createdBranch = false;
      if (decision.action === 'new_thread') {
        const thread = this.threads.create({ title: decision.title!, tags: [], status: 'open' });
        const branch = this.branches.create({ thread_id: thread.id, parent_commit_id: null, context_label: decision.contextLabel ?? 'Original research context' });
        threadId = thread.id; branchId = branch.id; createdThread = true; createdBranch = true;
      } else {
        const thread = this.threads.getById(threadId!);
        if (thread?.status === 'closed') this.threads.updateStatus(thread.id, 'open');
        if (decision.action === 'new_branch') {
          const parent = this.commits.getLatestByThread(threadId!);
          const branch = this.branches.create({ thread_id: threadId!, parent_commit_id: parent?.id ?? null, context_label: decision.contextLabel ?? 'Changed research context' });
          branchId = branch.id; createdBranch = true;
        }
      }
      if (!threadId || !branchId) throw new Error('Router did not resolve a valid thread and branch');
      this.items.assignToThread(item.id, threadId, branchId, decision.confidence);
      this.items.markProcessed(item.id);
      const now = new Date().toISOString();
      const previous = this.states.getByBranch(branchId);
      const comparison = mergeComparison(previous?.comparison, decision.options, decision.comparisonUpdates ?? [], item.id);
      const state = this.states.upsert({
        branch_id: branchId, research_question: decision.researchQuestion, summary: decision.summary,
        options: decision.options, constraints: decision.constraints, open_questions: decision.openQuestions,
        tentative_direction: decision.tentativeDirection,
        evidence_ids: [...new Set([...(previous?.evidence_ids ?? []), item.id])],
        changed_factors: decision.changedFactors, status: 'active', last_event_at: now,
        checkpoint_due_at: new Date(Date.now() + this.config.checkpointQuietSeconds * 1_000).toISOString(),
        comparison,
      });
      const action = this.actions.create({ action: decision.action, source_item_id: item.id, thread_id: threadId, branch_id: branchId, model: 'gpt-5.6-terra', confidence: decision.confidence, rationale: decision.rationale, context_snapshot: { candidateIds: candidates.map((candidate) => candidate.id) }, before_snapshot: { automationStatus: item.automation_status }, after_snapshot: { createdThread, createdBranch, workingStateId: state.id }, latency_ms: latencyMs, status: 'applied', undoable: true });
      return { actionId: action.id, threadId, branchId };
    })();
  }

  private scheduleCheckpoint(branchId: string, delayMs: number): void {
    if (this.stopped) return;
    const existing = this.checkpointTimers.get(branchId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.checkpointTimers.delete(branchId);
      if (!this.stopped) this.track(this.checkpoint(branchId));
    }, Math.max(0, delayMs));
    this.checkpointTimers.set(branchId, timer);
  }

  private scheduleRetry(sourceItemId: string): void {
    if (this.stopped) return;
    const existing = this.retryTimers.get(sourceItemId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.retryTimers.delete(sourceItemId);
      if (!this.stopped) this.track(this.retry(sourceItemId));
    }, this.config.routingRetryDelayMs);
    this.retryTimers.set(sourceItemId, timer);
  }

  private async checkpoint(branchId: string): Promise<void> {
    const state = this.states.getByBranch(branchId);
    const branch = this.branches.getById(branchId);
    if (!state || !branch || state.status !== 'active') return;
    const existingIds = new Set(this.commits.listByBranch(branchId).flatMap((commit) => commit.source_item_ids));
    const sourceIds = state.evidence_ids.filter((id) => !existingIds.has(id));
    if (sourceIds.length === 0) return;
    if (!this.states.claimCheckpoint(branchId)) return;
    try {
      const thread = this.threads.getById(branch.thread_id)!;
      const evidence = sourceIds.map((id) => this.items.getById(id)).filter(Boolean).map((item) => ({ text: [item!.raw_text, item!.content_text, item!.visual_context].filter(Boolean).join('\n').slice(0, 12_000), url: item!.url }));
      const prior = this.commits.listByBranch(branchId);
      const synthesis = await this.ai.synthesizeCheckpoint({ threadTitle: thread.title, workingState: { ...state }, evidence, previousVerdicts: prior.map((commit) => commit.verdict_summary) });
      const resolutionStatus = shouldPromoteActionableDecision(synthesis, state) ? 'resolved' : synthesis.resolutionStatus;
      const commit = this.commits.create({ branch_id: branchId, verdict_summary: synthesis.verdict, reasoning: synthesis.reasoning, source_item_ids: sourceIds, kind: resolutionStatus === 'resolved' ? 'resolved' : 'checkpoint', resolution_status: resolutionStatus, comparison: state.comparison });
      if (resolutionStatus === 'resolved') this.threads.updateStatus(thread.id, 'closed');
      this.states.setStatus(branchId, 'active');
      this.feed.create({
        type: 'commit_closed',
        thread_id: thread.id,
        payload: {
          verdict: synthesis.verdict,
          resolutionStatus,
          kind: commit.kind,
          branchId,
          commitId: commit.id,
        },
      });
      this.actions.create({ action: 'checkpoint', source_item_id: null, thread_id: thread.id, branch_id: branchId, model: 'gpt-5.6-sol', confidence: null, rationale: synthesis.reasoning, context_snapshot: { evidenceIds: sourceIds }, before_snapshot: {}, after_snapshot: { commitId: commit.id, resolutionStatus, policyPromoted: synthesis.resolutionStatus !== resolutionStatus }, latency_ms: null, status: 'applied', undoable: false });
      this.events.publish({ type: 'checkpoint.created', threadId: thread.id, branchId });
      await this.queueReconciliation(thread.id).catch(() => 0);
    } catch {
      this.states.setStatus(branchId, 'error');
      this.events.publish({ type: 'source.error', branchId });
    }
  }

  private queueReconciliation(threadId: string): Promise<number> {
    const previous = this.reconciliationQueues.get(threadId) ?? Promise.resolve(0);
    const next = previous.catch(() => 0).then(() => this.reconcileThread(threadId));
    this.reconciliationQueues.set(threadId, next);
    void next.then(() => {
      if (this.reconciliationQueues.get(threadId) === next) this.reconciliationQueues.delete(threadId);
    }, () => {
      if (this.reconciliationQueues.get(threadId) === next) this.reconciliationQueues.delete(threadId);
    });
    return next;
  }

  private async reconcileThread(threadId: string): Promise<number> {
    const thread = this.threads.getById(threadId);
    if (!thread) return 0;
    const branches = this.branches.listByThread(thread.id);
    if (branches.length < 2) return 0;
    const existingMerges = this.merges.listByThread(thread.id);
    const branchInput = branches.map((branch) => ({
      id: branch.id, contextLabel: branch.context_label,
      workingSummary: this.states.getByBranch(branch.id)?.summary ?? '',
      latestVerdict: this.commits.listByBranch(branch.id).at(-1)?.verdict_summary ?? '',
    })).filter((branch) => branch.latestVerdict);
    if (branchInput.length < 2) return 0;
    const latestCommitAt = branches.flatMap((branch) => this.commits.listByBranch(branch.id)).map((commit) => commit.created_at).sort().at(-1)!;
    const lastCheckAt = this.db.prepare("SELECT created_at FROM automation_actions WHERE thread_id = ? AND action IN ('merge', 'reconcile_none') ORDER BY created_at DESC, rowid DESC LIMIT 1").pluck().get(thread.id) as string | undefined;
    if (lastCheckAt && lastCheckAt >= latestCommitAt) return 0;
    const decision = await this.ai.reconcileBranches({ threadTitle: thread.title, branches: branchInput });
    const ids = [...new Set(decision.sourceBranchIds)];
    const valid = ids.length >= 2 && ids.every((id) => branchInput.some((branch) => branch.id === id));
    const alreadyMerged = existingMerges.some((event) => ids.every((id) => event.source_branch_ids.includes(id)));
    if (decision.action !== 'merge' || decision.confidence < 0.95 || !decision.durableRule || !decision.targetBranchId || !valid || !ids.includes(decision.targetBranchId) || alreadyMerged) {
      this.actions.create({ action: 'reconcile_none', source_item_id: null, thread_id: thread.id, branch_id: null, model: 'gpt-5.6-sol', confidence: decision.confidence, rationale: decision.rationale, context_snapshot: { latestCommitAt }, before_snapshot: {}, after_snapshot: {}, latency_ms: null, status: 'applied', undoable: false });
      return 0;
    }
    const commit = this.commits.create({ branch_id: decision.targetBranchId, verdict_summary: decision.durableRule, reasoning: decision.rationale, source_item_ids: [], kind: 'merge', resolution_status: 'resolved' });
    this.merges.create({ thread_id: thread.id, source_branch_ids: ids, resulting_commit_id: commit.id, resolved_rule: decision.durableRule, origin: 'automatic' });
    this.threads.updateStatus(thread.id, 'closed');
    const action = this.actions.create({ action: 'merge', source_item_id: null, thread_id: thread.id, branch_id: decision.targetBranchId, model: 'gpt-5.6-sol', confidence: decision.confidence, rationale: decision.rationale, context_snapshot: { sourceBranchIds: ids }, before_snapshot: {}, after_snapshot: { commitId: commit.id, durableRule: decision.durableRule }, latency_ms: null, status: 'applied', undoable: false });
    this.events.publish({ type: 'merge.created', threadId: thread.id, branchId: decision.targetBranchId, actionId: action.id });
    return 1;
  }
}

async function deadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('deadline exceeded')), ms))]);
}

function entityStrings(item: SourceItem): string[] {
  const entities = item.extracted_entities?.entities;
  return Array.isArray(entities) ? entities.filter((value): value is string => typeof value === 'string') : [];
}

function comparisonKey(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'unknown';
}

export function mergeComparison(
  previous: ComparisonMatrix | undefined,
  optionLabels: string[],
  updates: NonNullable<AutonomousRouteDecision['comparisonUpdates']>,
  sourceItemId: string,
): ComparisonMatrix {
  const matrix: ComparisonMatrix = previous
    ? JSON.parse(JSON.stringify(previous)) as ComparisonMatrix
    : { options: [], criteria: [], cells: [] };
  for (const label of optionLabels) {
    const id = comparisonKey(label);
    if (!matrix.options.some((option) => option.id === id)) matrix.options.push({ id, label: label.trim() });
  }
  for (const update of updates) {
    const optionId = comparisonKey(update.option);
    const criterionId = comparisonKey(update.criterion);
    if (!matrix.options.some((option) => option.id === optionId)) matrix.options.push({ id: optionId, label: update.option.trim() });
    if (!matrix.criteria.some((criterion) => criterion.id === criterionId)) matrix.criteria.push({ id: criterionId, label: update.criterion.trim() });
    const existing = matrix.cells.find((cell) => cell.option_id === optionId && cell.criterion_id === criterionId);
    if (!existing) {
      matrix.cells.push({ option_id: optionId, criterion_id: criterionId, value: update.value.trim(), status: update.status, source_item_ids: update.status === 'unknown' ? [] : [sourceItemId] });
      continue;
    }
    const nextValue = update.value.trim();
    const explicitConflict = existing.status === 'conflicting' || update.status === 'conflicting';
    if (existing.status === 'supported' && update.status === 'supported') {
      if (semanticallyEquivalent(existing.value, nextValue)) existing.value = existing.value.length >= nextValue.length ? existing.value : nextValue;
      else existing.value = [existing.value, nextValue].filter(Boolean).join(' · ');
      existing.status = 'supported';
    } else if (update.status !== 'unknown') {
      existing.value = explicitConflict && existing.value && !semanticallyEquivalent(existing.value, nextValue)
        ? `${existing.value} · ${nextValue}`
        : nextValue;
      existing.status = explicitConflict ? 'conflicting' : update.status;
    }
    existing.source_item_ids = [...new Set([...existing.source_item_ids, ...(update.status === 'unknown' ? [] : [sourceItemId])])];
  }
  return matrix;
}

function semanticallyEquivalent(left: string, right: string): boolean {
  const negated = (value: string) => /\b(no|not|never|without|cannot|can't|doesn't|isn't)\b/i.test(value);
  if (negated(left) !== negated(right)) return false;
  const numbers = (value: string) => value.match(/\b\d+(?:\.\d+)?%?\b/g)?.join('|') ?? '';
  if (numbers(left) && numbers(right) && numbers(left) !== numbers(right)) return false;
  const tokens = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 2 && !COMPARISON_STOP_WORDS.has(token)) ?? []);
  const a = tokens(left); const b = tokens(right);
  if (!a.size || !b.size) return left.trim().toLowerCase() === right.trim().toLowerCase();
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.min(a.size, b.size) >= 0.72;
}

const COMPARISON_STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'than', 'but', 'use', 'uses']);

function semanticAnchorOverlap(left: string, right: string): boolean {
  const anchors = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.map((token) => token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token).filter((token) => token.length >= 3 && !THREAD_STOP_WORDS.has(token)) ?? []);
  const a = anchors(left); const b = anchors(right);
  return [...a].some((token) => b.has(token));
}

const THREAD_STOP_WORDS = new Set(['choose', 'compare', 'determine', 'best', 'across', 'model', 'models', 'service', 'services', 'option', 'options', 'tool', 'tools']);

function shouldPromoteActionableDecision(
  synthesis: { verdict: string; resolutionStatus: 'in_progress' | 'resolved' },
  state: { tentative_direction: string | null; open_questions: string[] },
): boolean {
  if (synthesis.resolutionStatus === 'resolved') return true;
  const direction = `${state.tentative_direction ?? ''} ${synthesis.verdict}`.toLowerCase();
  if (!/\b(use|choose|prefer|keep|default|recommend|select|adopt|avoid)\b/.test(direction)) return false;
  return state.open_questions.every((question) => /\b(confirm|verify|validate|monitor|measure|test|benchmark|exact|follow.?up|later|edge case|nice to have)\b/i.test(question));
}

function normalizeResearchUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_.*|fbclid|gclid|ref|source)$/i.test(key)) url.searchParams.delete(key);
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    return url.toString();
  } catch { return value.trim(); }
}

function obviousNoiseReason(item: SourceItem): string | null {
  if (item.type !== 'browser_history' || !item.url) return null;
  let url: URL;
  try { url = new URL(item.url); } catch { return null; }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'Trace ignores its own localhost dashboard activity.';
  if ((host === 'youtube.com' || host.endsWith('.youtube.com')) && (path === '/' || path.startsWith('/shorts/'))) return 'YouTube home and Shorts activity is casual media, not durable decision evidence.';
  if (host === 'mail.google.com' && path.startsWith('/mail/')) return 'Inbox navigation is private communication activity, not research evidence.';
  if (host.endsWith('linkedin.com') && (path === '/feed' || path.startsWith('/notifications'))) return 'A social feed or notification page has no explicit decision evidence.';
  if ((host === 'reddit.com' || host === 'www.reddit.com') && path === '/') return 'A generic social homepage has no explicit decision evidence.';
  if (host.startsWith('accounts.google.') || host === 'accounts.youtube.com') return 'Authentication redirects are operational browser noise.';
  return null;
}

async function fetchPublicPage(initialUrl: string): Promise<string | null> {
  let url = new URL(initialUrl);
  for (let redirect = 0; redirect < 4; redirect++) {
    await assertPublicUrl(url);
    const response = await deadline(fetch(url, { redirect: 'manual', headers: { Accept: 'text/html,text/plain;q=0.9', 'User-Agent': 'Trace/0.1 local research indexer' } }), 4_000);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return null;
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) return null;
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('text/html') && !type.includes('text/plain')) return null;
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > 1_000_000) return null;
    const buffer = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder().decode(buffer.slice(0, 1_000_000));
    return type.includes('text/html') ? readableText(text).slice(0, 50_000) : text.slice(0, 50_000);
  }
  return null;
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported page URL');
  if (isPrivateHost(url.hostname)) throw new Error('Private page URL');
  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.some((entry) => isPrivateHost(entry.address))) throw new Error('Private page address');
}

function isPrivateHost(host: string): boolean {
  const value = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === 'localhost' || value === '::1' || value === '0.0.0.0' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) return true;
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

function readableText(html: string): string {
  return html.replace(/<(script|style|noscript|svg|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'").replace(/\s+/g, ' ').trim();
}

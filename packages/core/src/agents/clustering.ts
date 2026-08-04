import type { Database } from 'better-sqlite3';
import type { TraceAI } from '../ai/openai-client.js';
import type { ThreadRepository } from '../db/repositories/thread-repository.js';
import type { BranchRepository } from '../db/repositories/branch-repository.js';
import { CommitRepository } from '../db/repositories/commit-repository.js';
import type { SourceItemRepository } from '../db/repositories/source-item-repository.js';
import type { FeedEventRepository } from '../db/repositories/feed-event-repository.js';
import type { SourceItem, Thread } from '../models/index.js';

const RECENTLY_CLOSED_DAYS = 30;
const DEFAULT_BROWSER_HISTORY_CONFIDENCE_THRESHOLD = 0.9;

interface ClusteringStats {
  processed: number;
  newThreads: number;
  reopened: number;
  ignored: number;
  needsReview: number;
}

export class ClusteringAgent {
  private commitRepo: CommitRepository;

  constructor(
    private db: Database,
    private ai: TraceAI,
    private threadRepo: ThreadRepository,
    private branchRepo: BranchRepository,
    private sourceItemRepo: SourceItemRepository,
    private feedEventRepo: FeedEventRepository,
    private confidenceThreshold = 0.6,
    private browserHistoryConfidenceThreshold = DEFAULT_BROWSER_HISTORY_CONFIDENCE_THRESHOLD,
  ) {
    this.commitRepo = new CommitRepository(db);
  }

  async run(): Promise<ClusteringStats> {
    const stats: ClusteringStats = {
      processed: 0,
      newThreads: 0,
      reopened: 0,
      ignored: 0,
      needsReview: 0,
    };

    const unprocessed = this.sourceItemRepo.listUnprocessed();
    if (unprocessed.length === 0) return stats;

    for (const item of unprocessed) {
      try {
        await this.processItem(item, this.buildThreadContext(), stats);
      } catch (err) {
        console.error(`ClusteringAgent: error processing item ${item.id}:`, err);
      }
    }

    return stats;
  }

  private buildThreadContext(): Array<{ id: string; title: string; summary: string; status: 'open' | 'closed' }> {
    const openThreads = this.threadRepo.list({ status: 'open' });

    const cutoff = new Date(Date.now() - RECENTLY_CLOSED_DAYS * 86_400_000).toISOString();
    const recentlyClosed = this.threadRepo
      .list({ status: 'closed' })
      .filter((t) => t.updated_at >= cutoff);

    return [...openThreads, ...recentlyClosed].map((t) => ({
      id: t.id,
      title: t.title,
      summary: this.getLatestCommitSummary(t),
      status: t.status,
    }));
  }

  private getLatestCommitSummary(thread: Thread): string {
    const branches = this.branchRepo.listByThread(thread.id);
    let latest: { verdict_summary: string; created_at: string } | null = null;

    for (const branch of branches) {
      const commits = this.commitRepo.listByBranch(branch.id);
      for (const c of commits) {
        if (!latest || c.created_at > latest.created_at) {
          latest = { verdict_summary: c.verdict_summary, created_at: c.created_at };
        }
      }
    }

    return latest ? latest.verdict_summary : 'No commits yet';
  }

  private async processItem(
    item: SourceItem,
    threadContext: Array<{ id: string; title: string; summary: string; status: 'open' | 'closed' }>,
    stats: ClusteringStats,
  ): Promise<void> {
    const itemSummary = {
      text: item.raw_text ?? '',
      entities: extractEntities(item.extracted_entities),
      url: item.url,
    };

    const result = await this.ai.clusterItem(itemSummary, threadContext);
    if (result.decision === 'ignore') {
      const ignoreThreshold = item.type === 'browser_history'
        ? Math.max(this.confidenceThreshold, this.browserHistoryConfidenceThreshold)
        : this.confidenceThreshold;
      if (result.confidence >= ignoreThreshold) {
        this.sourceItemRepo.markIgnored(item.id, result.confidence);
        stats.processed++;
        stats.ignored++;
      } else {
        stats.needsReview++;
      }
      return;
    }

    const requiredConfidence = item.type === 'browser_history'
      ? Math.max(this.confidenceThreshold, this.browserHistoryConfidenceThreshold)
      : this.confidenceThreshold;
    const highConfidence = result.confidence >= requiredConfidence;

    if (result.decision === 'existing' && result.threadId) {
      const thread = this.threadRepo.getById(result.threadId);
      if (!thread) return;

      const wasClosed = thread.status === 'closed';
      let branch = this.branchRepo.getNewestByThread(thread.id);
      let priorCommitId: string | null = null;
      if (wasClosed) {
        const priorCommit = this.commitRepo.getLatestByThread(thread.id);
        priorCommitId = priorCommit?.id ?? null;
        branch = this.branchRepo.create({
          thread_id: thread.id,
          parent_commit_id: priorCommitId,
          context_label: result.contextLabel?.trim() || 'New context detected',
        });
        this.threadRepo.updateStatus(thread.id, 'open');
        stats.reopened++;
      }

      if (!branch) {
        branch = this.branchRepo.create({
          thread_id: thread.id,
          parent_commit_id: null,
          context_label: null,
        });
      }

      this.sourceItemRepo.assignToThread(item.id, thread.id, branch.id, result.confidence);

      if (highConfidence) {
        this.sourceItemRepo.markProcessed(item.id);
        stats.processed++;
      } else {
        stats.needsReview++;
      }
      // low confidence → assigned but not processed (flagged for review)

      if (wasClosed) {
        this.feedEventRepo.create({
          type: 'reopen',
          thread_id: thread.id,
          payload: {
            threadId: thread.id,
            branchId: branch.id,
            itemId: item.id,
            priorCommitId,
            reason: branch.context_label ?? 'New activity detected',
          },
        });
      }
    } else if (result.decision === 'new') {
      if (!highConfidence) {
        stats.needsReview++;
        return;
      }

      const title = result.suggestedTitle ?? item.raw_text?.slice(0, 60) ?? 'Untitled thread';
      const newThread = this.threadRepo.create({ title, tags: [], status: 'open' });
      const branch = this.branchRepo.create({
        thread_id: newThread.id,
        parent_commit_id: null,
        context_label: null,
      });
      this.sourceItemRepo.assignToThread(item.id, newThread.id, branch.id, result.confidence);
      stats.newThreads++;

      this.sourceItemRepo.markProcessed(item.id);
      stats.processed++;
    }
  }
}

function extractEntities(value: Record<string, unknown> | null): string[] {
  if (!value) return [];
  const entities = new Set<string>();
  for (const entry of Object.values(value)) {
    if (typeof entry === 'string') entities.add(entry);
    if (Array.isArray(entry)) {
      for (const item of entry) if (typeof item === 'string') entities.add(item);
    }
  }
  return [...entities];
}

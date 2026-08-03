import type { Database } from 'better-sqlite3';
import type { TraceAI } from '../ai/openai-client.js';
import type { ThreadRepository } from '../db/repositories/thread-repository.js';
import type { BranchRepository } from '../db/repositories/branch-repository.js';
import { CommitRepository } from '../db/repositories/commit-repository.js';
import type { SourceItemRepository } from '../db/repositories/source-item-repository.js';
import type { FeedEventRepository } from '../db/repositories/feed-event-repository.js';
import type { SourceItem, Thread } from '../models/index.js';

const CONFIDENCE_THRESHOLD = 0.6;
const RECENTLY_CLOSED_DAYS = 30;

export class ClusteringAgent {
  private commitRepo: CommitRepository;

  constructor(
    private db: Database,
    private ai: TraceAI,
    private threadRepo: ThreadRepository,
    private branchRepo: BranchRepository,
    private sourceItemRepo: SourceItemRepository,
    private feedEventRepo: FeedEventRepository,
  ) {
    this.commitRepo = new CommitRepository(db);
  }

  async run(): Promise<{ processed: number; newThreads: number; reopened: number }> {
    const stats = { processed: 0, newThreads: 0, reopened: 0 };

    const unprocessed = this.sourceItemRepo.listUnprocessed();
    if (unprocessed.length === 0) return stats;

    const threadContext = this.buildThreadContext();

    for (const item of unprocessed) {
      try {
        await this.processItem(item, threadContext, stats);
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
    stats: { processed: number; newThreads: number; reopened: number },
  ): Promise<void> {
    const itemSummary = {
      text: item.raw_text ?? '',
      entities: (item.extracted_entities ? Object.keys(item.extracted_entities) : []) as string[],
      url: item.url,
    };

    const result = await this.ai.clusterItem(itemSummary, threadContext);
    const highConfidence = result.confidence >= CONFIDENCE_THRESHOLD;

    if (result.decision === 'existing' && result.threadId) {
      const thread = this.threadRepo.getById(result.threadId);
      if (!thread) return;

      const wasClosed = thread.status === 'closed';
      if (wasClosed) {
        this.threadRepo.updateStatus(thread.id, 'open');
        stats.reopened++;
      }

      this.sourceItemRepo.assignToThread(item.id, thread.id);

      if (highConfidence) {
        this.sourceItemRepo.markProcessed(item.id);
        stats.processed++;
      }
      // low confidence → assigned but not processed (flagged for review)

      if (wasClosed) {
        this.feedEventRepo.create({
          type: 'reopen',
          thread_id: thread.id,
          payload: { threadId: thread.id, itemId: item.id, reason: 'New activity detected' },
        });
      }
    } else if (result.decision === 'new') {
      const title = result.suggestedTitle ?? item.raw_text?.slice(0, 60) ?? 'Untitled thread';
      const newThread = this.threadRepo.create({ title, tags: [], status: 'open' });
      this.branchRepo.create({ thread_id: newThread.id, parent_commit_id: null, context_label: null });
      this.sourceItemRepo.assignToThread(item.id, newThread.id);
      stats.newThreads++;

      if (highConfidence) {
        this.sourceItemRepo.markProcessed(item.id);
        stats.processed++;
      }
      // low confidence → assigned but not processed (flagged for review)
    }
  }
}

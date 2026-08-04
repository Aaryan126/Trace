import type { Database } from 'better-sqlite3';
import type { TraceAI } from '../ai/openai-client.js';
import type { ThreadRepository } from '../db/repositories/thread-repository.js';
import type { BranchRepository } from '../db/repositories/branch-repository.js';
import type { CommitRepository } from '../db/repositories/commit-repository.js';
import type { SourceItemRepository } from '../db/repositories/source-item-repository.js';
import type { FeedEventRepository } from '../db/repositories/feed-event-repository.js';
import type { SourceItem } from '../models/index.js';

export interface SynthesisConfig {
  quietWindowHours: number;
  minItems: number;
}

const DEFAULT_CONFIG: SynthesisConfig = {
  quietWindowHours: 24,
  minItems: 2,
};

export class SynthesisAgent {
  constructor(
    private db: Database,
    private ai: TraceAI,
    private config: Partial<SynthesisConfig> = {},
    private threadRepo: ThreadRepository,
    private branchRepo: BranchRepository,
    private commitRepo: CommitRepository,
    private sourceItemRepo: SourceItemRepository,
    private feedEventRepo: FeedEventRepository,
  ) {}

  private get cfg(): SynthesisConfig {
    return { ...DEFAULT_CONFIG, ...this.config };
  }

  async run(): Promise<{ synthesized: number; skipped: number }> {
    const stats = { synthesized: 0, skipped: 0 };
    const openThreads = this.threadRepo.list({ status: 'open' });

    for (const thread of openThreads) {
      try {
        const result = await this.processThread(thread);
        if (result === 'synthesized') stats.synthesized++;
        else stats.skipped++;
      } catch (err) {
        console.error(`SynthesisAgent: error processing thread ${thread.id}:`, err);
        stats.skipped++;
      }
    }

    return stats;
  }

  private async processThread(thread: { id: string; title: string; status: 'open' | 'closed' }): Promise<'synthesized' | 'skipped'> {
    const { quietWindowHours, minItems } = this.cfg;

    // All items assigned to this thread
    const allItems = this.sourceItemRepo.listByThread(thread.id);

    // Collect IDs of items already included in any commit on this thread's branches.
    const committedIds = new Set<string>();
    const branches = this.branchRepo.listByThread(thread.id);
    for (const branch of branches) {
      const commits = this.commitRepo.listByBranch(branch.id);
      for (const c of commits) {
        for (const id of c.source_item_ids) committedIds.add(id);
      }
    }

    // Uncommitted items: processed and not already in a commit.
    const uncommitted = allItems.filter((item) => item.processed && !committedIds.has(item.id));
    const fallbackBranch = this.branchRepo.getNewestByThread(thread.id);
    const itemsByBranch = new Map<string, SourceItem[]>();
    for (const item of uncommitted) {
      const branchId = item.branch_id ?? fallbackBranch?.id;
      if (!branchId) continue;
      const group = itemsByBranch.get(branchId) ?? [];
      group.push(item);
      itemsByBranch.set(branchId, group);
    }

    let synthesized = false;
    const synthesizedItemIds = new Set<string>();
    for (const [branchId, items] of itemsByBranch) {
      if (items.length < minItems) continue;
      const mostRecent = items.reduce<SourceItem>((latest, item) =>
        item.captured_at > latest.captured_at ? item : latest,
        items[0],
      );
      const hoursSinceLastItem = (Date.now() - new Date(mostRecent.captured_at).getTime()) / 3_600_000;
      if (hoursSinceLastItem < quietWindowHours) continue;

      const previousCommits = this.commitRepo.listByBranch(branchId).map((commit) => ({
        verdict_summary: commit.verdict_summary,
      }));
      const result = await this.ai.synthesizeCommit(
        items.map((item) => ({
          text: item.raw_text ?? '',
          url: item.url,
          entities: extractEntities(item.extracted_entities),
        })),
        { title: thread.title, previousCommits },
      );
      const commit = this.commitRepo.create({
        branch_id: branchId,
        verdict_summary: result.verdict,
        reasoning: result.reasoning,
        source_item_ids: items.map((item) => item.id),
      });
      this.feedEventRepo.create({
        type: 'commit_closed',
        thread_id: thread.id,
        payload: { threadId: thread.id, branchId, commitId: commit.id, verdict: result.verdict },
      });
      for (const item of items) synthesizedItemIds.add(item.id);
      synthesized = true;
    }

    if (!synthesized) return 'skipped';
    const hasPendingItems = allItems.some((item) => !item.processed)
      || uncommitted.some((item) => !synthesizedItemIds.has(item.id));
    if (!hasPendingItems) this.threadRepo.updateStatus(thread.id, 'closed');
    return 'synthesized';
  }
}

function extractEntities(value: Record<string, unknown> | null): string[] {
  if (!value) return [];
  return Object.values(value).flatMap((entry) => {
    if (typeof entry === 'string') return [entry];
    if (Array.isArray(entry)) return entry.filter((item): item is string => typeof item === 'string');
    return [];
  });
}

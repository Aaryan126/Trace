import type { Database } from 'better-sqlite3';
import type { BrainchAI } from '../ai/openai-client.js';
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
    private ai: BrainchAI,
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

    // Collect IDs of items already included in any commit on this thread's branches
    const committedIds = new Set<string>();
    const branches = this.branchRepo.listByThread(thread.id);
    for (const branch of branches) {
      const commits = this.commitRepo.listByBranch(branch.id);
      for (const c of commits) {
        for (const id of c.source_item_ids) committedIds.add(id);
      }
    }

    // Uncommitted items: processed and not already in a commit
    const uncommitted = allItems.filter((item) => item.processed && !committedIds.has(item.id));

    if (uncommitted.length < minItems) return 'skipped';

    // Check quiet window: most recent captured_at must be older than quietWindowHours
    const mostRecent = uncommitted.reduce<SourceItem>((latest, item) =>
      item.captured_at > latest.captured_at ? item : latest,
      uncommitted[0],
    );
    const hoursSinceLastItem = (Date.now() - new Date(mostRecent.captured_at).getTime()) / 3_600_000;
    if (hoursSinceLastItem < quietWindowHours) return 'skipped';

    // Trunk branch: parent_commit_id === null
    const trunk = branches.find((b) => b.parent_commit_id === null);
    if (!trunk) return 'skipped';

    // Previous commits on trunk for context
    const previousCommits = this.commitRepo.listByBranch(trunk.id).map((c) => ({
      verdict_summary: c.verdict_summary,
    }));

    const itemsForAI = uncommitted.map((item) => ({
      text: item.raw_text ?? '',
      url: item.url,
      entities: item.extracted_entities ? (Object.keys(item.extracted_entities) as string[]) : [],
    }));

    const result = await this.ai.synthesizeCommit(itemsForAI, {
      title: thread.title,
      previousCommits,
    });

    const commit = this.commitRepo.create({
      branch_id: trunk.id,
      verdict_summary: result.verdict,
      reasoning: result.reasoning,
      source_item_ids: uncommitted.map((i) => i.id),
    });

    this.threadRepo.updateStatus(thread.id, 'closed');

    this.feedEventRepo.create({
      type: 'commit_closed',
      thread_id: thread.id,
      payload: { threadId: thread.id, commitId: commit.id, verdict: result.verdict },
    });

    return 'synthesized';
  }
}

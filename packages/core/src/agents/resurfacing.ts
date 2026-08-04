import type { TraceAI } from '../ai/openai-client.js';
import type { ThreadRepository } from '../db/repositories/thread-repository.js';
import type { BranchRepository } from '../db/repositories/branch-repository.js';
import type { CommitRepository } from '../db/repositories/commit-repository.js';
import type { SourceItemRepository } from '../db/repositories/source-item-repository.js';
import type { FeedEventRepository } from '../db/repositories/feed-event-repository.js';

export interface ResurfacingConfig {
  digestWindowDays: number;
}

const DEFAULT_CONFIG: ResurfacingConfig = {
  digestWindowDays: 7,
};

export class ResurfacingAgent {
  constructor(
    private ai: TraceAI,
    private config: Partial<ResurfacingConfig> = {},
    private threadRepo: ThreadRepository,
    private branchRepo: BranchRepository,
    private commitRepo: CommitRepository,
    private sourceItemRepo: SourceItemRepository,
    private feedEventRepo: FeedEventRepository,
  ) {}

  private get cfg(): ResurfacingConfig {
    return { ...DEFAULT_CONFIG, ...this.config };
  }

  async generateReopenDiffs(): Promise<{ diffsGenerated: number }> {
    const reopenEvents = this.feedEventRepo.listByType('reopen');

    let diffsGenerated = 0;

    for (const event of reopenEvents) {
      try {
        const threadId = event.payload.threadId as string;
        if (!threadId) continue;

        const existingNudges = this.feedEventRepo.listByThreadAndType(threadId, 'nudge');
        if (existingNudges.some((nudge) =>
          nudge.payload.reopenEventId === event.id || nudge.payload.reopenEventId === undefined
        )) continue;

        // Get the thread
        const thread = this.threadRepo.getById(threadId);
        if (!thread) continue;

        // Get the most recent commit on the trunk branch
        const priorCommitId = event.payload.priorCommitId as string | undefined;
        const latestCommit = (priorCommitId ? this.commitRepo.getById(priorCommitId) : undefined)
          ?? this.commitRepo.getLatestByThread(threadId);
        if (!latestCommit) continue; // No prior verdict, can't generate diff

        // Get the source item that triggered the reopen
        const itemId = event.payload.itemId as string;
        if (!itemId) continue;
        const item = this.sourceItemRepo.getById(itemId);
        if (!item) continue;

        const diff = await this.ai.generateDiff(
          {
            text: item.raw_text ?? '',
            entities: extractEntities(item.extracted_entities),
            url: item.url,
          },
          {
            verdict_summary: latestCommit.verdict_summary,
            reasoning: latestCommit.reasoning,
            created_at: latestCommit.created_at,
          },
        );

        this.feedEventRepo.create({
          type: 'nudge',
          thread_id: threadId,
          payload: {
            threadId,
            reopenEventId: event.id,
            diff: { summary: diff.summary, changedFactors: diff.changedFactors },
            previousVerdict: latestCommit.verdict_summary,
            reopenReason: (event.payload.reason as string) ?? 'New activity detected',
          },
        });

        diffsGenerated++;
      } catch (err) {
        console.error(
          `ResurfacingAgent: error generating diff for reopen event ${event.id}:`,
          err,
        );
      }
    }

    return { diffsGenerated };
  }

  async generateDigest(): Promise<{ digestsGenerated: number }> {
    const { digestWindowDays } = this.cfg;
    const windowStart = new Date(Date.now() - digestWindowDays * 86_400_000).toISOString();
    const openThreads = this.threadRepo.list({ status: 'open' });

    let digestsGenerated = 0;

    for (const thread of openThreads) {
      try {
        const items = this.sourceItemRepo.listByThread(thread.id);
        const recentItems = items.filter((i) => i.captured_at >= windowStart);

        if (recentItems.length < 2) continue;

        // Check if a digest already exists for this thread in the current window
        const existingDigests = this.feedEventRepo.listByThreadAndType(
          thread.id,
          'digest',
          windowStart,
        );
        if (existingDigests.length > 0) continue;

        const latestItemDate = recentItems.reduce((latest, item) =>
          item.captured_at > latest ? item.captured_at : latest,
          recentItems[0].captured_at,
        );

        this.feedEventRepo.create({
          type: 'digest',
          thread_id: thread.id,
          payload: {
            threadId: thread.id,
            threadTitle: thread.title,
            itemCount: recentItems.length,
            timespan: 'this week',
            latestItemDate,
          },
        });

        digestsGenerated++;
      } catch (err) {
        console.error(
          `ResurfacingAgent: error generating digest for thread ${thread.id}:`,
          err,
        );
      }
    }

    return { digestsGenerated };
  }

  async run(): Promise<{ diffsGenerated: number; digestsGenerated: number }> {
    const { diffsGenerated } = await this.generateReopenDiffs();
    const { digestsGenerated } = await this.generateDigest();
    return { diffsGenerated, digestsGenerated };
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

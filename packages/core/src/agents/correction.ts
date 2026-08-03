import type { Database } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { ThreadRepository } from '../db/repositories/thread-repository.js';
import type { BranchRepository } from '../db/repositories/branch-repository.js';
import type { SourceItemRepository } from '../db/repositories/source-item-repository.js';
import type { FeedEventRepository } from '../db/repositories/feed-event-repository.js';

export class CorrectionAgent {
  constructor(
    private db: Database,
    private threadRepo: ThreadRepository,
    private branchRepo: BranchRepository,
    private sourceItemRepo: SourceItemRepository,
    private feedEventRepo: FeedEventRepository,
  ) {}

  /** Move a source item to a different thread and mark it processed. */
  reassign(itemId: string, targetThreadId: string): void {
    this.sourceItemRepo.assignToThread(itemId, targetThreadId);
    this.sourceItemRepo.markProcessed(itemId);
  }

  /** Merge two threads: move all items and branches from source into target, then delete source. */
  mergeThreads(sourceThreadId: string, targetThreadId: string): void {
    // Move all source items to target thread
    const items = this.sourceItemRepo.listByThread(sourceThreadId);
    for (const item of items) {
      this.sourceItemRepo.assignToThread(item.id, targetThreadId);
    }

    // Move all branches to target thread
    const branches = this.branchRepo.listByThread(sourceThreadId);
    for (const branch of branches) {
      this.branchRepo.reassignThread(branch.id, targetThreadId);
    }

    // Delete the source thread (no cascade issues since items/branches are moved)
    this.threadRepo.delete(sourceThreadId);
  }

  /** Split an item into a brand new thread with a trunk branch. */
  splitToNewThread(itemId: string, title: string): { threadId: string; branchId: string } {
    const thread = this.threadRepo.create({ title, tags: [], status: 'open' });
    const branch = this.branchRepo.create({
      thread_id: thread.id,
      parent_commit_id: null,
      context_label: null,
    });

    this.sourceItemRepo.assignToThread(itemId, thread.id);
    this.sourceItemRepo.markProcessed(itemId);

    return { threadId: thread.id, branchId: branch.id };
  }

  /** Confirm that the agent's clustering is correct (mark item as processed). */
  confirm(itemId: string): void {
    this.sourceItemRepo.markProcessed(itemId);
  }
}

import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { AutomationAction, BranchWorkingState, ComparisonCellStatus, ComparisonOverride } from '../../models/index.js';

export type WorkingStateInput = Omit<BranchWorkingState, 'id' | 'updated_at'> & { id?: string };

export class WorkingStateRepository {
  constructor(private db: Database.Database) {}

  upsert(data: WorkingStateInput): BranchWorkingState {
    const now = new Date().toISOString();
    const id = data.id ?? uuidv4();
    this.db.prepare(`
      INSERT INTO branch_working_states
        (id, branch_id, research_question, summary, options, constraints, open_questions,
         tentative_direction, evidence_ids, changed_factors, status, last_event_at, checkpoint_due_at, updated_at, comparison_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(branch_id) DO UPDATE SET
        research_question = excluded.research_question,
        summary = excluded.summary,
        options = excluded.options,
        constraints = excluded.constraints,
        open_questions = excluded.open_questions,
        tentative_direction = excluded.tentative_direction,
        evidence_ids = excluded.evidence_ids,
        changed_factors = excluded.changed_factors,
        status = excluded.status,
        last_event_at = excluded.last_event_at,
        checkpoint_due_at = excluded.checkpoint_due_at,
        updated_at = excluded.updated_at,
        comparison_json = excluded.comparison_json
    `).run(
      id, data.branch_id, data.research_question, data.summary, JSON.stringify(data.options),
      JSON.stringify(data.constraints), JSON.stringify(data.open_questions), data.tentative_direction,
      JSON.stringify(data.evidence_ids), JSON.stringify(data.changed_factors), data.status,
      data.last_event_at, data.checkpoint_due_at, now, JSON.stringify(data.comparison),
    );
    return this.getByBranch(data.branch_id)!;
  }

  getByBranch(branchId: string): BranchWorkingState | undefined {
    const row = this.db.prepare('SELECT * FROM branch_working_states WHERE branch_id = ?').get(branchId) as RawWorkingState | undefined;
    return row ? toWorkingState(row) : undefined;
  }

  listRecent(limit = 50): BranchWorkingState[] {
    return (this.db.prepare('SELECT * FROM branch_working_states ORDER BY last_event_at DESC, rowid DESC LIMIT ?').all(limit) as RawWorkingState[])
      .map(toWorkingState);
  }

  listDue(now = new Date().toISOString()): BranchWorkingState[] {
    return (this.db.prepare("SELECT * FROM branch_working_states WHERE checkpoint_due_at <= ? AND status = 'active' ORDER BY checkpoint_due_at ASC").all(now) as RawWorkingState[])
      .map(toWorkingState);
  }

  setStatus(branchId: string, status: BranchWorkingState['status']): void {
    this.db.prepare('UPDATE branch_working_states SET status = ?, updated_at = ? WHERE branch_id = ?')
      .run(status, new Date().toISOString(), branchId);
  }

  claimCheckpoint(branchId: string): boolean {
    const result = this.db.prepare(
      "UPDATE branch_working_states SET status = 'checkpointing', updated_at = ? WHERE branch_id = ? AND status = 'active'",
    ).run(new Date().toISOString(), branchId);
    return result.changes === 1;
  }
}

export class ComparisonOverrideRepository {
  constructor(private db: Database.Database) {}

  upsert(data: { branch_id: string; option_id: string; criterion_id: string; value: string; status: ComparisonCellStatus; pinned: boolean }): ComparisonOverride {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT id, created_at FROM comparison_overrides WHERE branch_id = ? AND option_id = ? AND criterion_id = ?')
      .get(data.branch_id, data.option_id, data.criterion_id) as { id: string; created_at: string } | undefined;
    const id = existing?.id ?? uuidv4();
    this.db.prepare(`
      INSERT INTO comparison_overrides (id, branch_id, option_id, criterion_id, value, status, pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(branch_id, option_id, criterion_id) DO UPDATE SET
        value = excluded.value, status = excluded.status, pinned = excluded.pinned, updated_at = excluded.updated_at
    `).run(id, data.branch_id, data.option_id, data.criterion_id, data.value, data.status, data.pinned ? 1 : 0, existing?.created_at ?? now, now);
    return this.get(data.branch_id, data.option_id, data.criterion_id)!;
  }

  get(branchId: string, optionId: string, criterionId: string): ComparisonOverride | undefined {
    const row = this.db.prepare('SELECT * FROM comparison_overrides WHERE branch_id = ? AND option_id = ? AND criterion_id = ?')
      .get(branchId, optionId, criterionId) as RawComparisonOverride | undefined;
    return row ? toComparisonOverride(row) : undefined;
  }

  listByBranch(branchId: string): ComparisonOverride[] {
    return (this.db.prepare('SELECT * FROM comparison_overrides WHERE branch_id = ? ORDER BY updated_at DESC').all(branchId) as RawComparisonOverride[])
      .map(toComparisonOverride);
  }

  delete(branchId: string, optionId: string, criterionId: string): boolean {
    return this.db.prepare('DELETE FROM comparison_overrides WHERE branch_id = ? AND option_id = ? AND criterion_id = ?')
      .run(branchId, optionId, criterionId).changes === 1;
  }
}

export class AutomationActionRepository {
  constructor(private db: Database.Database) {}

  create(data: Omit<AutomationAction, 'id' | 'created_at' | 'reverted_at'> & { id?: string }): AutomationAction {
    const action: AutomationAction = { ...data, id: data.id ?? uuidv4(), created_at: new Date().toISOString(), reverted_at: null };
    this.db.prepare(`
      INSERT INTO automation_actions
        (id, action, source_item_id, thread_id, branch_id, model, confidence, rationale,
         context_snapshot, before_snapshot, after_snapshot, latency_ms, status, undoable, created_at, reverted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      action.id, action.action, action.source_item_id, action.thread_id, action.branch_id,
      action.model, action.confidence, action.rationale, JSON.stringify(action.context_snapshot),
      JSON.stringify(action.before_snapshot), JSON.stringify(action.after_snapshot), action.latency_ms,
      action.status, action.undoable ? 1 : 0, action.created_at, null,
    );
    return action;
  }

  getById(id: string): AutomationAction | undefined {
    const row = this.db.prepare('SELECT * FROM automation_actions WHERE id = ?').get(id) as RawAction | undefined;
    return row ? toAction(row) : undefined;
  }

  list(limit = 100): AutomationAction[] {
    return (this.db.prepare('SELECT * FROM automation_actions ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as RawAction[]).map(toAction);
  }

  markReverted(id: string): void {
    this.db.prepare("UPDATE automation_actions SET status = 'reverted', reverted_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }
}

export class EmbeddingRepository {
  constructor(private db: Database.Database) {}

  upsert(entityType: 'source_item' | 'thread', entityId: string, model: string, vector: number[]): void {
    this.db.prepare(`
      INSERT INTO semantic_embeddings (id, entity_type, entity_id, model, vector, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, entity_id, model) DO UPDATE SET vector = excluded.vector, created_at = excluded.created_at
    `).run(uuidv4(), entityType, entityId, model, JSON.stringify(vector), new Date().toISOString());
  }

  nearestThreads(vector: number[], model: string, limit = 8): Array<{ threadId: string; similarity: number }> {
    const rows = this.db.prepare("SELECT entity_id, vector FROM semantic_embeddings WHERE entity_type = 'thread' AND model = ?").all(model) as Array<{ entity_id: string; vector: string }>;
    return rows.map((row) => ({ threadId: row.entity_id, similarity: cosine(vector, JSON.parse(row.vector) as number[]) }))
      .sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / (Math.sqrt(aa) * Math.sqrt(bb)) : 0;
}

interface RawWorkingState {
  id: string; branch_id: string; research_question: string; summary: string; options: string;
  constraints: string; open_questions: string; tentative_direction: string | null; evidence_ids: string;
  changed_factors: string; status: string; last_event_at: string; checkpoint_due_at: string; updated_at: string; comparison_json: string;
}
function toWorkingState(row: RawWorkingState): BranchWorkingState {
  return { ...row, options: JSON.parse(row.options), constraints: JSON.parse(row.constraints), open_questions: JSON.parse(row.open_questions), evidence_ids: JSON.parse(row.evidence_ids), changed_factors: JSON.parse(row.changed_factors), comparison: JSON.parse(row.comparison_json), status: row.status as BranchWorkingState['status'] };
}

interface RawComparisonOverride {
  id: string; branch_id: string; option_id: string; criterion_id: string; value: string;
  status: ComparisonCellStatus; pinned: number; created_at: string; updated_at: string;
}
function toComparisonOverride(row: RawComparisonOverride): ComparisonOverride {
  return { ...row, pinned: row.pinned === 1 };
}

interface RawAction {
  id: string; action: string; source_item_id: string | null; thread_id: string | null; branch_id: string | null;
  model: string | null; confidence: number | null; rationale: string; context_snapshot: string;
  before_snapshot: string; after_snapshot: string; latency_ms: number | null; status: string; undoable: number;
  created_at: string; reverted_at: string | null;
}
function toAction(row: RawAction): AutomationAction {
  return { ...row, context_snapshot: JSON.parse(row.context_snapshot), before_snapshot: JSON.parse(row.before_snapshot), after_snapshot: JSON.parse(row.after_snapshot), status: row.status as AutomationAction['status'], undoable: row.undoable === 1 };
}

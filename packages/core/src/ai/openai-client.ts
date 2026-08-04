import OpenAI from 'openai';

// ─── Configuration ────────────────────────────────────────────────────────────

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
  visionModel?: string;
  checkpointModel?: string;
}

// ─── Response types ───────────────────────────────────────────────────────────

export interface ScreenshotExtraction {
  text: string;
  entities: string[];
  url: string | null;
  appSource: string | null;
}

export interface ClusterDecision {
  decision: 'existing' | 'new' | 'ignore';
  threadId: string | null;
  confidence: number;
  suggestedTitle?: string;
  contextLabel?: string;
  reason?: string;
}

export interface CommitSynthesis {
  verdict: string;
  reasoning: string;
}

export interface DiffResult {
  summary: string;
  changedFactors: string[];
}

export interface AutonomousRouteDecision {
  action: 'ignore' | 'new_thread' | 'continue_branch' | 'new_branch';
  threadId: string | null;
  branchId: string | null;
  confidence: number;
  rationale: string;
  title: string | null;
  contextLabel: string | null;
  researchQuestion: string;
  summary: string;
  options: string[];
  constraints: string[];
  openQuestions: string[];
  tentativeDirection: string | null;
  changedFactors: string[];
  checkpointNow: boolean;
  comparisonUpdates?: Array<{
    option: string;
    criterion: string;
    value: string;
    status: 'supported' | 'unknown' | 'conflicting' | 'assumption';
  }>;
}

export interface CheckpointSynthesis extends CommitSynthesis {
  resolutionStatus: 'in_progress' | 'resolved';
}

export interface ReconciliationDecision {
  action: 'none' | 'merge';
  confidence: number;
  rationale: string;
  sourceBranchIds: string[];
  targetBranchId: string | null;
  durableRule: string | null;
}

// ─── System prompts ───────────────────────────────────────────────────────────

const PROMPTS = {
  extractFromScreenshot:
    'You are analyzing a screenshot. Extract: all readable text, named entities (technologies, products, people, companies), any visible URL, and the source application (inferred from UI chrome). Return JSON with keys: text, entities, url, appSource.',

  clusterItem:
    'You curate research for a decision-tracking system, not a browser-history archive. First decide whether the item contains evidence of an actual choice, comparison, evaluation, constraint, or revisited verdict. Generic homepages, feeds, inboxes, messages, entertainment, news consumed without a decision, account pages, and casual browsing must be ignored. If relevant, decide whether it belongs to an existing decision thread or starts a new decision. A new thread title must describe the decision being made, not merely repeat the page title. Consider semantic similarity, not just keywords. When selecting a closed thread, provide a short contextLabel describing why the decision is being revisited. Return JSON with keys: decision ("existing"|"new"|"ignore"), threadId (string|null), confidence (0-1 number), reason (short string), suggestedTitle (only when decision is "new"), contextLabel (only when reopening a closed thread).',

  synthesizeCommit:
    'You are synthesizing a decision. Given research items from a decision thread, write a clear verdict (what was decided) and reasoning (why). Be concise and actionable. The verdict should be a single sentence a developer can act on. Return JSON with keys: verdict, reasoning.',

  generateDiff:
    'You are comparing contexts. Given new research context and a prior decision commit, identify what has changed that might make the prior decision worth revisiting. Focus on changed constraints, new options, or invalidated assumptions. Return JSON with keys: summary, changedFactors (string array).',

  autonomousRoute:
    'You are the autonomous routing brain for Trace, a local Git-like research history. Ignore casual browsing and pages with no evidence of a choice, comparison, evaluation, constraint, or revisited conclusion. For relevant evidence: continue the current branch when it advances the same research context; create a new branch only when a material constraint, audience, timeframe, or goal creates a genuinely different decision context; create a new thread only for a genuinely different core research question. Different wording, broader comparison criteria, or another source about the same underlying choice belong to the existing thread. Update a concise live working state using only evidence supplied. Extract comparisonUpdates only for explicit option-by-criterion claims in the supplied evidence; use unknown rather than guessing, assumption only when the page itself frames a claim as an assumption, and conflicting only when the claims cannot both be true in the same stated context. Never invent IDs. Use null when no supplied ID applies.',

  checkpoint:
    'Create a durable research checkpoint from the live state and evidence. Mark it resolved when the evidence supports a clear actionable recommendation, default, or context-bounded rule, even if minor validation or refinement questions remain; do not require perfect certainty. Keep it in progress only when a key choice, blocking constraint, or essential evidence gap prevents action. Keep the verdict concise, state material caveats, and keep the reasoning traceable to supplied evidence.',

  reconcile:
    'Decide whether multiple research branches now support one durable rule without erasing meaningful context. Merge only when conclusions are compatible and the rule states the context boundary clearly. Otherwise return none. Never invent branch IDs.',
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = 'gpt-5.6-terra';
const DEFAULT_CHECKPOINT_MODEL = 'gpt-5.6-sol';

function resolveConfig(config?: Partial<OpenAIConfig>): Required<Pick<OpenAIConfig, 'apiKey'>> & { model: string; visionModel: string; checkpointModel: string } {
  const apiKey = config?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass apiKey in config.',
    );
  }
  return {
    apiKey,
    model: config?.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL,
    visionModel: config?.visionModel ?? process.env.OPENAI_VISION_MODEL ?? DEFAULT_MODEL,
    checkpointModel: config?.checkpointModel ?? process.env.OPENAI_CHECKPOINT_MODEL ?? DEFAULT_CHECKPOINT_MODEL,
  };
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRateLimit =
        err instanceof OpenAI.RateLimitError ||
        (err as { status?: number })?.status === 429;
      if (!isRateLimit || attempt === maxRetries) break;
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

function parseJSONResponse<T>(content: string | null | undefined, methodName: string): T {
  if (!content) {
    throw new Error(`${methodName}: Empty response from model`);
  }
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(
      `${methodName}: Failed to parse model response as JSON: ${content.slice(0, 200)}`,
    );
  }
}

// ─── Main class ───────────────────────────────────────────────────────────────

export class TraceAI {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly visionModel: string;
  private readonly checkpointModel: string;

  constructor(config?: Partial<OpenAIConfig>) {
    const resolved = resolveConfig(config);
    this.client = new OpenAI({ apiKey: resolved.apiKey, timeout: 15_000, maxRetries: 0 });
    this.model = resolved.model;
    this.visionModel = resolved.visionModel;
    this.checkpointModel = resolved.checkpointModel;
  }

  async extractFromScreenshot(imageBuffer: Buffer, mimeType = 'image/png'): Promise<ScreenshotExtraction> {
    const base64 = imageBuffer.toString('base64');
    return withRetry(async () => {
      const response = await this.client.chat.completions.create({
        model: this.visionModel,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PROMPTS.extractFromScreenshot },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze this screenshot and extract all relevant information.' },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ],
      });
      const content = response.choices[0]?.message?.content;
      return parseJSONResponse<ScreenshotExtraction>(content, 'extractFromScreenshot');
    });
  }

  async clusterItem(
    item: { text: string; entities: string[]; url: string | null },
    existingThreads: Array<{ id: string; title: string; summary: string; status: 'open' | 'closed' }>,
  ): Promise<ClusterDecision> {
    return withRetry(async () => {
      const response = await this.client.chat.completions.create({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PROMPTS.clusterItem },
          { role: 'user', content: JSON.stringify({ item, existingThreads }) },
        ],
      });
      const content = response.choices[0]?.message?.content;
      return parseJSONResponse<ClusterDecision>(content, 'clusterItem');
    });
  }

  async synthesizeCommit(
    sourceItems: Array<{ text: string; url: string | null; entities: string[] }>,
    threadContext: { title: string; previousCommits: Array<{ verdict_summary: string }> },
  ): Promise<CommitSynthesis> {
    return withRetry(async () => {
      const response = await this.client.chat.completions.create({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PROMPTS.synthesizeCommit },
          { role: 'user', content: JSON.stringify({ sourceItems, threadContext }) },
        ],
      });
      const content = response.choices[0]?.message?.content;
      return parseJSONResponse<CommitSynthesis>(content, 'synthesizeCommit');
    });
  }

  async generateDiff(
    currentContext: { text: string; entities: string[]; url: string | null },
    priorCommit: { verdict_summary: string; reasoning: string; created_at: string },
  ): Promise<DiffResult> {
    return withRetry(async () => {
      const response = await this.client.chat.completions.create({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PROMPTS.generateDiff },
          { role: 'user', content: JSON.stringify({ currentContext, priorCommit }) },
        ],
      });
      const content = response.choices[0]?.message?.content;
      return parseJSONResponse<DiffResult>(content, 'generateDiff');
    });
  }

  async routeResearch(
    item: { text: string; url: string | null; entities: string[] },
    candidates: Array<{
      id: string;
      title: string;
      status: 'open' | 'closed';
      branches: Array<{ id: string; contextLabel: string | null; workingSummary: string; latestVerdict: string; comparison?: unknown }>;
    }>,
    imageDataUrl?: string,
  ): Promise<AutonomousRouteDecision> {
    return withRetry(async () => {
      const response = await this.client.chat.completions.create({
        model: this.model,
        reasoning_effort: 'low',
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'trace_route', strict: true, schema: ROUTE_SCHEMA },
        },
        messages: [
          { role: 'system', content: PROMPTS.autonomousRoute },
          { role: 'user', content: imageDataUrl ? [
            { type: 'text', text: JSON.stringify({ item, candidates }) },
            { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
          ] : JSON.stringify({ item, candidates }) },
        ],
      });
      return parseJSONResponse<AutonomousRouteDecision>(response.choices[0]?.message?.content, 'routeResearch');
    }, 1);
  }

  async synthesizeCheckpoint(input: {
    threadTitle: string;
    workingState: Record<string, unknown>;
    evidence: Array<{ text: string; url: string | null }>;
    previousVerdicts: string[];
  }): Promise<CheckpointSynthesis> {
    return withRetry(async () => {
      const response = await this.client.chat.completions.create({
        model: this.checkpointModel,
        reasoning_effort: 'medium',
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'trace_checkpoint', strict: true, schema: CHECKPOINT_SCHEMA },
        },
        messages: [
          { role: 'system', content: PROMPTS.checkpoint },
          { role: 'user', content: JSON.stringify(input) },
        ],
      });
      return parseJSONResponse<CheckpointSynthesis>(response.choices[0]?.message?.content, 'synthesizeCheckpoint');
    }, 1);
  }

  async embed(text: string): Promise<number[]> {
    const response = await withRetry(() => this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.slice(0, 20_000),
      encoding_format: 'float',
    }), 1);
    return response.data[0]?.embedding ?? [];
  }

  async reconcileBranches(input: {
    threadTitle: string;
    branches: Array<{ id: string; contextLabel: string | null; workingSummary: string; latestVerdict: string }>;
  }): Promise<ReconciliationDecision> {
    return withRetry(async () => {
      const response = await this.client.chat.completions.create({
        model: this.checkpointModel,
        reasoning_effort: 'medium',
        response_format: { type: 'json_schema', json_schema: { name: 'trace_reconcile', strict: true, schema: RECONCILIATION_SCHEMA } },
        messages: [
          { role: 'system', content: PROMPTS.reconcile },
          { role: 'user', content: JSON.stringify(input) },
        ],
      });
      return parseJSONResponse<ReconciliationDecision>(response.choices[0]?.message?.content, 'reconcileBranches');
    }, 1);
  }
}

const ROUTE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['action', 'threadId', 'branchId', 'confidence', 'rationale', 'title', 'contextLabel', 'researchQuestion', 'summary', 'options', 'constraints', 'openQuestions', 'tentativeDirection', 'changedFactors', 'checkpointNow', 'comparisonUpdates'],
  properties: {
    action: { type: 'string', enum: ['ignore', 'new_thread', 'continue_branch', 'new_branch'] },
    threadId: { type: ['string', 'null'] }, branchId: { type: ['string', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 }, rationale: { type: 'string' },
    title: { type: ['string', 'null'] }, contextLabel: { type: ['string', 'null'] },
    researchQuestion: { type: 'string' }, summary: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } }, constraints: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } }, tentativeDirection: { type: ['string', 'null'] },
    changedFactors: { type: 'array', items: { type: 'string' } }, checkpointNow: { type: 'boolean' },
    comparisonUpdates: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['option', 'criterion', 'value', 'status'],
        properties: {
          option: { type: 'string' }, criterion: { type: 'string' }, value: { type: 'string' },
          status: { type: 'string', enum: ['supported', 'unknown', 'conflicting', 'assumption'] },
        },
      },
    },
  },
} as const;

const CHECKPOINT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'reasoning', 'resolutionStatus'],
  properties: {
    verdict: { type: 'string' }, reasoning: { type: 'string' },
    resolutionStatus: { type: 'string', enum: ['in_progress', 'resolved'] },
  },
} as const;

const RECONCILIATION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['action', 'confidence', 'rationale', 'sourceBranchIds', 'targetBranchId', 'durableRule'],
  properties: {
    action: { type: 'string', enum: ['none', 'merge'] }, confidence: { type: 'number', minimum: 0, maximum: 1 },
    rationale: { type: 'string' }, sourceBranchIds: { type: 'array', items: { type: 'string' } },
    targetBranchId: { type: ['string', 'null'] }, durableRule: { type: ['string', 'null'] },
  },
} as const;

// ─── Singleton factory ────────────────────────────────────────────────────────

let singleton: TraceAI | null = null;

export function createTraceAI(config?: Partial<OpenAIConfig>): TraceAI {
  if (!singleton) {
    singleton = new TraceAI(config);
  }
  return singleton;
}

/** @internal — exposed for testing only */
export function _resetSingleton(): void {
  singleton = null;
}

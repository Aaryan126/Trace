import OpenAI from 'openai';

// ─── Configuration ────────────────────────────────────────────────────────────

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
  visionModel?: string;
}

// ─── Response types ───────────────────────────────────────────────────────────

export interface ScreenshotExtraction {
  text: string;
  entities: string[];
  url: string | null;
  appSource: string | null;
}

export interface ClusterDecision {
  decision: 'existing' | 'new';
  threadId: string | null;
  confidence: number;
  suggestedTitle?: string;
}

export interface CommitSynthesis {
  verdict: string;
  reasoning: string;
}

export interface DiffResult {
  summary: string;
  changedFactors: string[];
}

// ─── System prompts ───────────────────────────────────────────────────────────

const PROMPTS = {
  extractFromScreenshot:
    'You are analyzing a screenshot. Extract: all readable text, named entities (technologies, products, people, companies), any visible URL, and the source application (inferred from UI chrome). Return JSON with keys: text, entities, url, appSource.',

  clusterItem:
    'You are a decision-tracking system. Given a research item and existing decision threads, determine if this item belongs to an existing thread or starts a new one. Consider semantic similarity, not just keyword matching. Return JSON with keys: decision ("existing"|"new"), threadId (string|null), confidence (0-1 number), suggestedTitle (string, only when decision is "new").',

  synthesizeCommit:
    'You are synthesizing a decision. Given research items from a decision thread, write a clear verdict (what was decided) and reasoning (why). Be concise and actionable. The verdict should be a single sentence a developer can act on. Return JSON with keys: verdict, reasoning.',

  generateDiff:
    'You are comparing contexts. Given new research context and a prior decision commit, identify what has changed that might make the prior decision worth revisiting. Focus on changed constraints, new options, or invalidated assumptions. Return JSON with keys: summary, changedFactors (string array).',
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = 'gpt-5.4';

function resolveConfig(config?: Partial<OpenAIConfig>): Required<Pick<OpenAIConfig, 'apiKey'>> & { model: string; visionModel: string } {
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

export class BrainchAI {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly visionModel: string;

  constructor(config?: Partial<OpenAIConfig>) {
    const resolved = resolveConfig(config);
    this.client = new OpenAI({ apiKey: resolved.apiKey });
    this.model = resolved.model;
    this.visionModel = resolved.visionModel;
  }

  async extractFromScreenshot(imageBuffer: Buffer): Promise<ScreenshotExtraction> {
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
              { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
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
}

// ─── Singleton factory ────────────────────────────────────────────────────────

let singleton: BrainchAI | null = null;

export function createBrainchAI(config?: Partial<OpenAIConfig>): BrainchAI {
  if (!singleton) {
    singleton = new BrainchAI(config);
  }
  return singleton;
}

/** @internal — exposed for testing only */
export function _resetSingleton(): void {
  singleton = null;
}

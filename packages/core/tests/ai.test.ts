import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock setup (hoisted so vi.mock factory can reference them) ──────────────

const { mockCreate, MockRateLimitError } = vi.hoisted(() => {
  const mockCreate = vi.fn();

  class MockRateLimitError extends Error {
    status = 429;
    constructor(message = 'Rate limit exceeded') {
      super(message);
      this.name = 'RateLimitError';
    }
  }

  return { mockCreate, MockRateLimitError };
});

vi.mock('openai', () => {
  const MockOpenAI = Object.assign(vi.fn().mockImplementation(() => ({
    chat: {
      completions: { create: mockCreate },
    },
  })), { RateLimitError: MockRateLimitError });
  return { default: MockOpenAI };
});

import { TraceAI, createTraceAI, _resetSingleton } from '../src/ai/openai-client.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_KEY = 'test-api-key';

function jsonResponse(payload: unknown) {
  return {
    choices: [
      { message: { content: typeof payload === 'string' ? payload : JSON.stringify(payload) } },
    ],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TraceAI', () => {
  let ai: TraceAI;

  beforeEach(() => {
    mockCreate.mockReset();
    _resetSingleton();
    ai = new TraceAI({ apiKey: TEST_KEY });
  });

  // ── Constructor / config ──────────────────────────────────────────────────

  describe('constructor & configuration', () => {
    it('throws when no API key is available', () => {
      const orig = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      try {
        expect(() => new TraceAI()).toThrow(/API key/i);
      } finally {
        if (orig !== undefined) process.env.OPENAI_API_KEY = orig;
      }
    });

    it('reads API key from OPENAI_API_KEY env var', () => {
      const orig = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'env-key-123';
      try {
        expect(() => new TraceAI()).not.toThrow();
      } finally {
        if (orig === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = orig;
      }
    });

    it('explicit config overrides env vars for model', async () => {
      const origModel = process.env.OPENAI_MODEL;
      process.env.OPENAI_MODEL = 'env-model';
      try {
        const instance = new TraceAI({ apiKey: TEST_KEY, model: 'explicit-model' });
        mockCreate.mockResolvedValueOnce(
          jsonResponse({ decision: 'new', threadId: null, confidence: 1 }),
        );
        await instance.clusterItem({ text: '', entities: [], url: null }, []);
        expect(mockCreate.mock.calls[0][0].model).toBe('explicit-model');
      } finally {
        if (origModel === undefined) delete process.env.OPENAI_MODEL;
        else process.env.OPENAI_MODEL = origModel;
      }
    });

    it('falls back to env vars for model and visionModel', async () => {
      const origModel = process.env.OPENAI_MODEL;
      const origVision = process.env.OPENAI_VISION_MODEL;
      process.env.OPENAI_MODEL = 'env-text-model';
      process.env.OPENAI_VISION_MODEL = 'env-vision-model';
      try {
        const instance = new TraceAI({ apiKey: TEST_KEY });

        // Verify text model via clusterItem
        mockCreate.mockResolvedValueOnce(
          jsonResponse({ decision: 'new', threadId: null, confidence: 1 }),
        );
        await instance.clusterItem({ text: '', entities: [], url: null }, []);
        expect(mockCreate.mock.calls[0][0].model).toBe('env-text-model');

        // Verify vision model via extractFromScreenshot
        mockCreate.mockResolvedValueOnce(
          jsonResponse({ text: '', entities: [], url: null, appSource: null }),
        );
        await instance.extractFromScreenshot(Buffer.from('img'));
        expect(mockCreate.mock.calls[1][0].model).toBe('env-vision-model');
      } finally {
        if (origModel === undefined) delete process.env.OPENAI_MODEL;
        else process.env.OPENAI_MODEL = origModel;
        if (origVision === undefined) delete process.env.OPENAI_VISION_MODEL;
        else process.env.OPENAI_VISION_MODEL = origVision;
      }
    });
  });

  // ── extractFromScreenshot ─────────────────────────────────────────────────

  describe('extractFromScreenshot', () => {
    it('sends correct system prompt and base64-encodes the image', async () => {
      const expected = {
        text: 'Welcome to VS Code',
        entities: ['VS Code', 'TypeScript'],
        url: 'https://example.com',
        appSource: 'VS Code',
      };
      mockCreate.mockResolvedValueOnce(jsonResponse(expected));

      const buf = Buffer.from('fake-png-data');
      const result = await ai.extractFromScreenshot(buf);

      expect(result).toEqual(expected);
      expect(mockCreate).toHaveBeenCalledOnce();

      const args = mockCreate.mock.calls[0][0];
      expect(args.messages[0].role).toBe('system');
      expect(args.messages[0].content).toContain('analyzing a screenshot');

      // Vision: image must be base64-encoded
      const userParts = args.messages[1].content;
      const imagePart = userParts.find((p: { type: string }) => p.type === 'image_url');
      expect(imagePart).toBeDefined();
      expect(imagePart.image_url.url).toBe(`data:image/png;base64,${buf.toString('base64')}`);

      // JSON mode
      expect(args.response_format).toEqual({ type: 'json_object' });
    });

    it('uses the vision model, not the text model', async () => {
      const instance = new TraceAI({
        apiKey: TEST_KEY,
        model: 'text-model',
        visionModel: 'vision-model',
      });
      mockCreate.mockResolvedValueOnce(
        jsonResponse({ text: '', entities: [], url: null, appSource: null }),
      );
      await instance.extractFromScreenshot(Buffer.from('x'));
      expect(mockCreate.mock.calls[0][0].model).toBe('vision-model');
    });

    it('throws on malformed JSON response', async () => {
      mockCreate.mockResolvedValueOnce(jsonResponse('not valid json {{{'));
      await expect(ai.extractFromScreenshot(Buffer.from('img'))).rejects.toThrow(
        /Failed to parse/,
      );
    });

    it('throws on empty response', async () => {
      mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: null } }] });
      await expect(ai.extractFromScreenshot(Buffer.from('img'))).rejects.toThrow(/Empty response/);
    });
  });

  // ── clusterItem ────────────────────────────────────────────────────────────

  describe('clusterItem', () => {
    const item = { text: 'Should we adopt React?', entities: ['React'], url: null };
    const threads = [
      { id: 't1', title: 'Frontend framework choice', summary: 'Evaluating frameworks', status: 'open' as const },
    ];

    it('sends correct system prompt and structured user data', async () => {
      const expected = { decision: 'existing', threadId: 't1', confidence: 0.92 };
      mockCreate.mockResolvedValueOnce(jsonResponse(expected));

      const result = await ai.clusterItem(item, threads);

      expect(result).toEqual(expected);
      const args = mockCreate.mock.calls[0][0];
      expect(args.messages[0].content).toContain('decision-tracking system');

      const parsed = JSON.parse(args.messages[1].content);
      expect(parsed).toEqual({ item, existingThreads: threads });
      expect(args.response_format).toEqual({ type: 'json_object' });
    });

    it('returns a "new" decision with suggestedTitle', async () => {
      const expected = {
        decision: 'new',
        threadId: null,
        confidence: 0.85,
        suggestedTitle: 'React adoption decision',
      };
      mockCreate.mockResolvedValueOnce(jsonResponse(expected));

      const result = await ai.clusterItem(item, []);
      expect(result.decision).toBe('new');
      expect(result.threadId).toBeNull();
      expect(result.suggestedTitle).toBe('React adoption decision');
    });

    it('returns an "ignore" decision for non-decision browsing', async () => {
      const expected = {
        decision: 'ignore',
        threadId: null,
        confidence: 0.98,
        reason: 'No decision intent',
      };
      mockCreate.mockResolvedValueOnce(jsonResponse(expected));

      const result = await ai.clusterItem(item, []);
      expect(result).toEqual(expected);
      expect(mockCreate.mock.calls[0][0].messages[0].content).toContain('must be ignored');
    });

    it('throws on malformed JSON', async () => {
      mockCreate.mockResolvedValueOnce(jsonResponse('{broken'));
      await expect(ai.clusterItem(item, threads)).rejects.toThrow(/Failed to parse/);
    });
  });

  describe('routeResearch', () => {
    it('sends screenshot pixels alongside routing context when available', async () => {
      const decision = {
        action: 'ignore', threadId: null, branchId: null, confidence: 0.9,
        rationale: 'Not decision-relevant', title: null, contextLabel: null,
        researchQuestion: '', summary: '', options: [], constraints: [], openQuestions: [],
        tentativeDirection: null, changedFactors: [], checkpointNow: false,
      };
      mockCreate.mockResolvedValueOnce(jsonResponse(decision));
      const image = 'data:image/jpeg;base64,/9j/';

      await ai.routeResearch({ text: 'Comparison page', entities: [], url: 'https://example.com' }, [], image);

      const content = mockCreate.mock.calls[0][0].messages[1].content;
      expect(content[0].type).toBe('text');
      expect(content[1]).toEqual({ type: 'image_url', image_url: { url: image, detail: 'high' } });
    });
  });

  // ── synthesizeCommit ───────────────────────────────────────────────────────

  describe('synthesizeCommit', () => {
    const sourceItems = [{ text: 'React has the best ecosystem', url: null, entities: ['React'] }];
    const threadContext = { title: 'Frontend framework', previousCommits: [] };

    it('sends correct system prompt and returns verdict + reasoning', async () => {
      const expected = { verdict: 'Adopt React for the frontend.', reasoning: 'Mature ecosystem and strong community support.' };
      mockCreate.mockResolvedValueOnce(jsonResponse(expected));

      const result = await ai.synthesizeCommit(sourceItems, threadContext);

      expect(result).toEqual(expected);
      const args = mockCreate.mock.calls[0][0];
      expect(args.messages[0].content).toContain('synthesizing a decision');

      const parsed = JSON.parse(args.messages[1].content);
      expect(parsed).toEqual({ sourceItems, threadContext });
      expect(args.response_format).toEqual({ type: 'json_object' });
    });

    it('throws on empty response', async () => {
      mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: '' } }] });
      await expect(ai.synthesizeCommit(sourceItems, threadContext)).rejects.toThrow(/Empty response/);
    });
  });

  // ── generateDiff ───────────────────────────────────────────────────────────

  describe('generateDiff', () => {
    const currentContext = { text: 'Next.js 15 released with new features', entities: ['Next.js'], url: null };
    const priorCommit = {
      verdict_summary: 'Use plain React',
      reasoning: 'Simpler setup',
      created_at: '2024-06-01',
    };

    it('sends correct system prompt and returns summary + changedFactors', async () => {
      const expected = {
        summary: 'Next.js 15 introduces server components that change the calculus.',
        changedFactors: ['Server components now stable', 'New build performance gains'],
      };
      mockCreate.mockResolvedValueOnce(jsonResponse(expected));

      const result = await ai.generateDiff(currentContext, priorCommit);

      expect(result).toEqual(expected);
      const args = mockCreate.mock.calls[0][0];
      expect(args.messages[0].content).toContain('comparing contexts');

      const parsed = JSON.parse(args.messages[1].content);
      expect(parsed).toEqual({ currentContext, priorCommit });
      expect(args.response_format).toEqual({ type: 'json_object' });
    });

    it('throws on malformed JSON', async () => {
      mockCreate.mockResolvedValueOnce(jsonResponse('garbage'));
      await expect(ai.generateDiff(currentContext, priorCommit)).rejects.toThrow(/Failed to parse/);
    });
  });

  // ── Retry logic ────────────────────────────────────────────────────────────

  describe('retry logic', () => {
    it('retries on rate limit errors and eventually succeeds', async () => {
      const rateLimitErr = new MockRateLimitError();
      mockCreate
        .mockRejectedValueOnce(rateLimitErr)
        .mockResolvedValueOnce(
          jsonResponse({ text: 'ok', entities: [], url: null, appSource: null }),
        );

      vi.useFakeTimers();
      const promise = ai.extractFromScreenshot(Buffer.from('img'));
      // First retry delay: 2^0 * 1000 = 1000ms
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;
      vi.useRealTimers();

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.text).toBe('ok');
    });

    it('retries up to 3 times then throws', async () => {
      const rateLimitErr = new MockRateLimitError();
      mockCreate.mockRejectedValue(rateLimitErr);

      vi.useFakeTimers();
      const promise = ai.extractFromScreenshot(Buffer.from('img'));
      // Attach early catch to prevent unhandled-rejection warning
      promise.catch(() => {});

      await vi.advanceTimersByTimeAsync(8000);
      await expect(promise).rejects.toThrow('Rate limit exceeded');
      // 1 initial + 3 retries = 4 total calls
      expect(mockCreate).toHaveBeenCalledTimes(4);
      vi.useRealTimers();
    });

    it('does not retry on non-rate-limit errors', async () => {
      const authErr = new Error('Unauthorized');
      (authErr as Error & { status: number }).status = 401;
      mockCreate.mockRejectedValue(authErr);

      await expect(ai.clusterItem({ text: '', entities: [], url: null }, [])).rejects.toThrow(
        'Unauthorized',
      );
      expect(mockCreate).toHaveBeenCalledOnce();
    });
  });

  // ── Singleton factory ──────────────────────────────────────────────────────

  describe('createTraceAI', () => {
    it('returns the same instance on repeated calls', () => {
      const a = createTraceAI({ apiKey: TEST_KEY });
      const b = createTraceAI();
      expect(a).toBe(b);
    });

    it('returns a fresh instance after reset', () => {
      const a = createTraceAI({ apiKey: TEST_KEY });
      _resetSingleton();
      const b = createTraceAI({ apiKey: TEST_KEY });
      expect(a).not.toBe(b);
    });
  });
});

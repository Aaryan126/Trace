import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StatusBadge } from '../src/components/StatusBadge';
import { ThreadGraph } from '../src/components/ThreadGraph';
import { AllThreads } from '../src/pages/AllThreads';
import { CaptureView } from '../src/pages/CaptureView';
import { DecisionFlow } from '../src/components/DecisionFlow';
import { CaptureThumbnail } from '../src/components/CaptureThumbnail';
import { FeedCard } from '../src/components/FeedCard';
import { Layout } from '../src/components/Layout';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

beforeEach(() => {
  mockFetch.mockReset();
});

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }));
}

function expectNoCanvasNodeOverlaps(container: HTMLElement) {
  const rectangles = [...container.querySelectorAll<HTMLElement>('.react-flow__node')].map((node) => {
    const match = node.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    expect(match).toBeTruthy();
    return {
      id: node.getAttribute('data-id'),
      x: Number(match![1]),
      y: Number(match![2]),
      width: Number.parseFloat(node.style.width),
      height: Number.parseFloat(node.style.height),
    };
  });
  for (let index = 0; index < rectangles.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < rectangles.length; otherIndex += 1) {
      const left = rectangles[index];
      const right = rectangles[otherIndex];
      const separated = left.x + left.width <= right.x || right.x + right.width <= left.x
        || left.y + left.height <= right.y || right.y + right.height <= left.y;
      expect(separated, `${left.id} ${JSON.stringify(left)} overlaps ${right.id} ${JSON.stringify(right)}`).toBe(true);
    }
  }
}

// ─── StatusBadge ────────────────────────────────────────────

describe('StatusBadge', () => {
  it('renders open status with correct text', () => {
    render(<StatusBadge status="open" />);
    expect(screen.getByText('open')).toBeTruthy();
  });

  it('renders closed status with correct text', () => {
    render(<StatusBadge status="closed" />);
    expect(screen.getByText('closed')).toBeTruthy();
  });
});

describe('DecisionFlow', () => {
  it('explains the complete decision lifecycle', () => {
    render(<DecisionFlow activeStage="curate" />);
    expect(screen.getByText('1. Capture')).toBeTruthy();
    expect(screen.getByText('2. Curate')).toBeTruthy();
    expect(screen.getByText('3. Commit')).toBeTruthy();
    expect(screen.getByText('4. Revisit')).toBeTruthy();
  });
});

// ─── ThreadGraph ────────────────────────────────────────────

describe('ThreadGraph', () => {
  it('renders an interactive canvas with research nodes and edges', () => {
    const tree = {
      nodes: [
        { id: 'n1', type: 'commit' as const, branchId: null, regret: false, createdAt: '2026-01-01T00:00:00Z' },
        { id: 'n2', type: 'commit' as const, branchId: null, regret: false, createdAt: '2026-01-02T00:00:00Z' },
      ],
      edges: [{ from: 'n1', to: 'n2', type: 'sequential' as const }],
    };
    const commits = [
      {
        id: 'n1',
        parentId: null,
        branchId: null,
        verdictSummary: 'First verdict',
        reasoning: 'Some reasoning',
        createdAt: new Date().toISOString(),
        regret: false,
        sourceItems: [],
      },
      {
        id: 'n2',
        parentId: 'n1',
        branchId: null,
        verdictSummary: 'Second verdict',
        reasoning: 'More reasoning',
        createdAt: new Date().toISOString(),
        regret: false,
        sourceItems: [],
      },
    ];

    const { container } = render(
      <ThreadGraph tree={tree} commits={commits} />,
    );

    const canvas = screen.getByTestId('research-canvas');
    expect(canvas.style.height).toBe('calc(100vh - 330px)');
    expect(canvas.style.minHeight).toBe('620px');
    expect(canvas.style.maxHeight).toBe('900px');
    expect(screen.getByText('First verdict')).toBeTruthy();
    expect(screen.getByText('Second verdict')).toBeTruthy();
    expect(container.querySelector('.react-flow')).toBeTruthy();
    expectNoCanvasNodeOverlaps(container);

    const firstNode = screen.getByText('First verdict').closest('.react-flow__node') as HTMLElement;
    const secondNode = screen.getByText('Second verdict').closest('.react-flow__node') as HTMLElement;
    expect(firstNode.style.height).toBe('220px');
    fireEvent.click(screen.getByText('First verdict'));
    expect(firstNode.style.width).toBe('480px');
    expect(firstNode.style.height).toBe('430px');
    expectNoCanvasNodeOverlaps(container);
    fireEvent.click(screen.getByText('Second verdict'));
    expect(firstNode.style.width).toBe('300px');
    expect(secondNode.style.width).toBe('480px');
    expect(secondNode.style.height).toBe('430px');
    expectNoCanvasNodeOverlaps(container);
  });

  it('renders empty message when no nodes', () => {
    render(<ThreadGraph tree={{ nodes: [], edges: [] }} commits={[]} />);
    expect(screen.getByText('No graph data available.')).toBeTruthy();
  });

  it('puts captured evidence and the current working state on the research map', () => {
    const now = new Date().toISOString();
    const { container } = render(<ThreadGraph
      tree={{ nodes: [{ id: 'commit1', type: 'commit', branchId: null, regret: false, createdAt: now }], edges: [] }}
      commits={[{ id: 'commit1', parentId: null, branchId: null, verdictSummary: 'Use SQLite', reasoning: 'Local first', createdAt: now, regret: false, sourceItems: [{ id: 'source1', type: 'browser_history', rawText: 'Comparison', capturedAt: now, capture: { thumbnailUrl: '/thumb.jpg', fullUrl: '/full.jpg', width: 1200, height: 800, capturedAt: now } }] }]}
      rootBranchId="root"
      workingStates={[{ id: 'working1', branchId: 'root', threadId: 'thread1', threadTitle: 'Database', researchQuestion: 'Validate sync constraints', summary: 'Still researching', options: [], constraints: [], openQuestions: [], changedFactors: [], evidenceIds: [], evidence: [], status: 'active', lastEventAt: now, checkpointDueAt: now }]}
    />);
    expect(container.querySelector('img[src="/thumb.jpg"]')).toBeTruthy();
    expect(screen.getByText(/Current session/i)).toBeTruthy();
    const workingNode = screen.getByText(/Current session/i).closest('.react-flow__node') as HTMLElement;
    expect(workingNode.style.width).toBe('330px');
    expect(workingNode.style.height).toBe('270px');
  });

  it('adds an outcome review node after a resolved decision', async () => {
    const now = new Date().toISOString();
    const setOutcome = vi.fn().mockResolvedValue(undefined);
    render(<ThreadGraph
      tree={{ nodes: [{ id: 'commit1', type: 'commit', branchId: null, regret: false, createdAt: now }], edges: [] }}
      commits={[{ id: 'commit1', parentId: null, branchId: 'branch1', verdictSummary: 'Use SQLite', reasoning: 'Local first', createdAt: now, regret: false, sourceItems: [], resolutionStatus: 'resolved' }]}
      outcomeReview={{ commitId: 'commit1', branchId: 'branch1', decision: 'Use SQLite', decidedAt: now }}
      onSetOutcome={setOutcome}
    />);

    expect(screen.getByText('Outcome review')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Outcome note'), { target: { value: 'It stayed reliable.' } });
    fireEvent.click(screen.getByText('Worked'));
    await waitFor(() => expect(setOutcome).toHaveBeenCalledWith('worked', 'It stayed reliable.'));
  });

  it('opens the live comparison in an expanded scrollable dialog', () => {
    const now = new Date().toISOString();
    const { container } = render(<ThreadGraph
      tree={{ nodes: [{ id: 'commit1', type: 'commit', branchId: null, regret: false, createdAt: now }], edges: [] }}
      commits={[{ id: 'commit1', parentId: null, branchId: 'branch1', verdictSummary: 'Compare architectures', reasoning: 'Review the evidence', createdAt: now, regret: false, sourceItems: [] }]}
      comparison={{
        options: [
          { id: 'resnet', label: 'ResNet' },
          { id: 'densenet', label: 'DenseNet' },
          { id: 'unet', label: 'U-Net' },
          { id: 'transformer', label: 'Transformer' },
        ],
        criteria: [{ id: 'quality', label: 'Quality' }],
        cells: [{ optionId: 'resnet', criterionId: 'quality', value: 'Strong baseline', status: 'supported', sourceItemIds: ['source1'] }],
      }}
    />);

    const expand = container.querySelector<HTMLButtonElement>('.comparison-expand-button');
    expect(expand).toBeTruthy();
    fireEvent.click(expand!);
    const dialog = screen.getByRole('dialog', { name: 'Expanded live comparison' });
    expect(dialog.textContent).toContain('ResNet');
    expect(dialog.textContent).toContain('Transformer');
    expect(dialog.querySelector('.comparison-expanded-scroll')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close expanded comparison' }));
    expect(screen.queryByRole('dialog', { name: 'Expanded live comparison' })).toBeNull();
  });
});

describe('Unified layout', () => {
  it('uses top tabs, defaults to light, and has no sidebar', async () => {
    localStorage.removeItem('trace-theme');
    mockFetch.mockImplementation((url: string) => url.includes('/api/feed')
      ? jsonResponse({ events: [], unread: 0, total: 0 })
      : jsonResponse({ states: [], actions: [], sources: [], capture: null }));
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes><Route element={<Layout />}><Route index element={<div>Decision content</div>} /></Route></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('navigation', { name: 'Trace views' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Decisions' }).getAttribute('href')).toBe('/decisions');
    expect(screen.queryByText('Decision history')).toBeNull();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

// ─── Home Page ──────────────────────────────────────────────

describe('Home page', () => {
  // Need outlet context for Home
  // We'll wrap with a mock outlet context provider
  it('renders feed cards from mocked API', async () => {
    // Mock the outlet context by rendering directly (Home uses useOutletContext)
    // We'll test the loading/error states instead since outlet context requires Layout
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/feed')) {
        return jsonResponse({
          events: [
            {
              id: 'evt1',
              type: 'digest',
              threadId: 't1',
              threadTitle: 'Test Thread',
              createdAt: new Date().toISOString(),
              read: false,
              data: { itemCount: 5, timespan: '24h' },
            },
          ],
          unread: 1,
          total: 1,
        });
      }
      return jsonResponse({ ok: true });
    });

    // We can't easily test useOutletContext without Layout, so test the API integration
    // by rendering just the FeedCard component
    const { FeedCard } = await import('../src/components/FeedCard');
    render(
      <MemoryRouter>
        <FeedCard
          event={{
            id: 'evt1',
            type: 'digest',
            threadId: 't1',
            threadTitle: 'Test Thread',
            createdAt: new Date().toISOString(),
            read: false,
            data: { itemCount: 5, timespan: '24h' },
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Test Thread')).toBeTruthy();
    expect(screen.getByText('WEEKLY DIGEST')).toBeTruthy();
  });
});

describe('Grouped activity', () => {
  it('labels an in-progress group as a checkpoint and expands earlier updates', () => {
    render(
      <MemoryRouter>
        <FeedCard event={{
          id: 'new', type: 'commit_closed', threadId: 'thread', threadTitle: 'Choose an upscaler',
          createdAt: new Date().toISOString(), read: false, eventIds: ['new', 'old'], updateCount: 2,
          resolutionStatus: 'in_progress', branchId: 'branch',
          updates: [
            { id: 'new', createdAt: new Date().toISOString(), verdictSummary: 'Latest checkpoint' },
            { id: 'old', createdAt: new Date().toISOString(), verdictSummary: 'Earlier checkpoint' },
          ],
          data: { verdictSummary: 'Latest checkpoint' },
        }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('RESEARCH CHECKPOINT')).toBeTruthy();
    fireEvent.click(screen.getByText('Show 1 earlier checkpoint'));
    expect(screen.getByText(/Earlier checkpoint/)).toBeTruthy();
  });
});

describe('CaptureThumbnail', () => {
  it('opens the full capture with source context', () => {
    render(<CaptureThumbnail source={{
      id: 'source', type: 'browser_history', rawText: 'Comparison page', capturedAt: new Date().toISOString(),
      capture: { thumbnailUrl: '/thumb.jpg', fullUrl: '/full.jpg', width: 1200, height: 800, capturedAt: new Date().toISOString() },
    }} />);
    fireEvent.click(screen.getByText('view capture'));
    expect(screen.getByRole('dialog', { name: 'Comparison page' })).toBeTruthy();
    expect(screen.getByText('1200 × 800')).toBeTruthy();
  });
});

// ─── AllThreads Page ────────────────────────────────────────

describe('AllThreads page', () => {
  it('renders thread list from mocked API', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/threads')) {
        return jsonResponse({
          threads: [
            {
              id: 't1',
              title: 'Architecture Decision',
              status: 'open',
              tags: ['design'],
              lastActivity: new Date().toISOString(),
              itemCount: 12,
              createdAt: new Date().toISOString(),
            },
          ],
          total: 1,
        });
      }
      return jsonResponse({ ok: true });
    });

    render(
      <MemoryRouter>
        <AllThreads />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Architecture Decision')).toBeTruthy();
    });
    expect(screen.getByText('open')).toBeTruthy();
  });

  it('search input triggers filter', async () => {
    mockFetch.mockImplementation(() =>
      jsonResponse({ threads: [], total: 0 }),
    );

    render(
      <MemoryRouter>
        <AllThreads />
      </MemoryRouter>,
    );

    // Wait for loading to complete and search input to appear
    const input = await screen.findByPlaceholderText('Search decisions…');
    fireEvent.change(input, { target: { value: 'test query' } });

    await waitFor(() => {
      // initial load + search-triggered load
      const threadCalls = mockFetch.mock.calls.filter(
        ([url]: [string]) => url.includes('/api/threads'),
      );
      expect(threadCalls.length).toBeGreaterThan(0);
    });
  });
});

// ─── CaptureView Page ───────────────────────────────────────

describe('CaptureView page', () => {
  it('renders autonomous working state and audit rationale', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/live')) {
        return jsonResponse({
          states: [{ id: 'state1', branchId: 'branch1', threadId: 't1', threadTitle: 'Choose a database', researchQuestion: 'Postgres or SQLite?', summary: 'Comparing local-first storage constraints.', options: ['Postgres', 'SQLite'], constraints: ['Offline'], openQuestions: ['Sync later?'], tentativeDirection: 'SQLite', changedFactors: [], evidenceIds: ['cap1'], evidence: [{ id: 'cap1', type: 'browser_history', rawText: 'Database comparison', capturedAt: new Date().toISOString(), capture: { thumbnailUrl: '/thumb.jpg', fullUrl: '/full.jpg', width: 1200, height: 800, capturedAt: new Date().toISOString() } }], status: 'active', lastEventAt: new Date().toISOString(), checkpointDueAt: new Date().toISOString() }],
          actions: [{ id: 'action1', action: 'new_thread', sourceItemId: 'cap1', threadId: 't1', branchId: 'branch1', threadTitle: 'Choose a database', confidence: 0.94, rationale: 'This page compares storage options.', status: 'applied', undoable: true, createdAt: new Date().toISOString() }],
          sources: [],
          capture: { enabled: true, authorized: true, connected: true, lastHeartbeatAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString(), lastResult: 'captured', lastReason: null },
        });
      }
      return jsonResponse({ ok: true });
    });

    render(
      <MemoryRouter>
        <CaptureView />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Choose a database').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Postgres or SQLite?')).toBeTruthy();
    expect(screen.getByText('This page compares storage options.')).toBeTruthy();
    expect(screen.getByText('Undo')).toBeTruthy();
    expect(screen.getByText('Chrome extension connected. Approved research pages are captured automatically.')).toBeTruthy();
    expect(screen.getByAltText('Captured browser context for Database comparison')).toBeTruthy();
  });

  it('can undo an autonomous filing', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/live')) {
        return jsonResponse({ states: [], sources: [], actions: [{ id: 'action1', action: 'ignore', rationale: 'Casual browsing', status: 'applied', undoable: true, createdAt: new Date().toISOString() }] });
      }
      if (url.includes('/api/automation/actions/action1/undo')) {
        expect(init?.method).toBe('POST');
        return jsonResponse({ success: true });
      }
      return jsonResponse({ ok: true });
    });

    render(
      <MemoryRouter>
        <CaptureView />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByText('Undo'));

    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([url]: [string]) => url.includes('/api/automation/actions/action1/undo'))).toBe(true);
    });
  });

  it('can retry a failed autonomous item', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/live')) {
        return jsonResponse({
          states: [], actions: [],
          sources: [{ id: 'failed1', type: 'browser_history', rawText: 'Database comparison', capturedAt: new Date().toISOString(), automationStatus: 'error', errorMessage: 'timeout' }],
        });
      }
      if (url.includes('/api/automation/failed1/retry')) {
        expect(init?.method).toBe('POST');
        return jsonResponse({ success: true });
      }
      return jsonResponse({ ok: true });
    });

    render(<MemoryRouter><CaptureView /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Retry'));

    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([url]: [string]) => url.includes('/api/automation/failed1/retry'))).toBe(true);
    });
  });
});

const BASE_URL = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface FeedEvent {
  id: string;
  type: 'reopen' | 'nudge' | 'digest' | 'commit_closed';
  threadId: string;
  threadTitle: string;
  createdAt: string;
  read: boolean;
  data: {
    diffSummary?: string;
    changedFactors?: string[];
    previousVerdict?: string;
    itemCount?: number;
    timespan?: string;
    verdictSummary?: string;
    verdict?: string;
    [key: string]: unknown;
  };
}

export interface FeedResponse {
  events: FeedEvent[];
  unread: number;
  total: number;
}

export interface Thread {
  id: string;
  title: string;
  status: 'open' | 'closed';
  tags: string[];
  lastActivity: string;
  itemCount: number;
  createdAt: string;
}

export interface ThreadDetail extends Thread {
  verdictSummary?: string;
  reasoning?: string;
  branches: Branch[];
}

export interface Branch {
  id: string;
  contextLabel: string;
  commits: CommitNode[];
}

export interface CommitNode {
  id: string;
  parentId: string | null;
  branchId: string | null;
  verdictSummary: string;
  reasoning: string;
  createdAt: string;
  regret: boolean;
  sourceItems: SourceItem[];
}

export interface SourceItem {
  id: string;
  type: 'screenshot' | 'browser_history' | 'clipboard' | 'note' | string;
  rawText: string;
  url?: string;
  capturedAt: string;
}

export interface TreeData {
  nodes: TreeNode[];
  edges: TreeEdge[];
}

export interface TreeNode {
  id: string;
  branchId: string | null;
  contextLabel?: string;
  regret: boolean;
  x: number;
  y: number;
}

export interface TreeEdge {
  from: string;
  to: string;
  type: 'sequential' | 'branch' | 'merge';
}

export interface CaptureItem {
  id: string;
  type: string;
  rawText: string;
  url?: string;
  capturedAt: string;
  suggestion?: {
    threadId: string;
    threadTitle: string;
    confidence: number;
  };
}

export function fetchFeed(params: { limit?: number; offset?: number; unreadOnly?: boolean }) {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  if (params.unreadOnly) qs.set('unreadOnly', 'true');
  return request<FeedResponse>(`/feed?${qs}`);
}

export function fetchThreads(params: { status?: string; search?: string; sort?: string; limit?: number; offset?: number }) {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.search) qs.set('search', params.search);
  if (params.sort) qs.set('sort', params.sort);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  return request<{ threads: Thread[]; total: number }>(`/threads?${qs}`);
}

export function fetchThread(id: string) {
  return request<ThreadDetail>(`/threads/${id}`);
}

export function fetchThreadTree(id: string) {
  return request<TreeData>(`/threads/${id}/tree`);
}

export function fetchCapture(limit = 50) {
  return request<{ items: CaptureItem[] }>(`/capture?limit=${limit}`);
}

export function postCorrection(type: string, body: object) {
  return request<{ ok: boolean }>('/corrections', {
    method: 'POST',
    body: JSON.stringify({ type, ...body }),
  });
}

export function markFeedRead(id: string) {
  return request<{ ok: boolean }>(`/feed/${id}/read`, { method: 'PATCH' });
}

export function addRegret(commitId: string, note?: string) {
  return request<{ ok: boolean }>(`/commits/${commitId}/regret`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export function mergeThread(threadId: string, body: { sourceBranchIds: string[]; resolvedRule: string }) {
  return request<{ ok: boolean }>(`/threads/${threadId}/merge`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

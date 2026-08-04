const BASE_URL = '/api';

import type {
  ApiBranch,
  ApiCaptureItem,
  ApiCommit,
  ApiFeedEvent,
  ApiSourceItem,
  ApiThread,
  ApiThreadDetail,
  ApiWorkingState,
  ApiAutomationAction,
  ApiBrowserCaptureHealth,
  ApiTreeEdge,
  ApiTreeNode,
  ApiSearchResult,
  ApiComparisonCellStatus,
} from '@trace/core';

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

export type FeedEvent = ApiFeedEvent;

export interface FeedResponse {
  events: FeedEvent[];
  unread: number;
  total: number;
}

export type Thread = ApiThread;
export type ThreadDetail = ApiThreadDetail;
export type Branch = ApiBranch;
export type CommitNode = ApiCommit;
export type SourceItem = ApiSourceItem;

export interface TreeData {
  nodes: TreeNode[];
  edges: TreeEdge[];
}

export type TreeNode = ApiTreeNode;
export type TreeEdge = ApiTreeEdge;

export type CaptureItem = ApiCaptureItem;
export type WorkingState = ApiWorkingState;
export type AutomationAction = ApiAutomationAction;
export type SearchResult = ApiSearchResult;

export interface LiveTraceResponse {
  states: WorkingState[];
  actions: AutomationAction[];
  sources: SourceItem[];
  capture: ApiBrowserCaptureHealth | null;
}

export function fetchLiveTrace() {
  return request<LiveTraceResponse>('/live');
}

export function subscribeToTrace(onEvent: () => void): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  const events = new EventSource(`${BASE_URL}/events`);
  events.addEventListener('trace', onEvent);
  return () => events.close();
}

export function retryAutomation(itemId: string) {
  return request<{ success: boolean }>(`/automation/${itemId}/retry`, { method: 'POST' });
}

export function undoAutomation(actionId: string) {
  return request<{ success: boolean }>(`/automation/actions/${actionId}/undo`, { method: 'POST' });
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

export function searchTrace(query: string) {
  return request<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(query)}`);
}

export function correctComparison(branchId: string, optionId: string, criterionId: string, body: { value: string; status: ApiComparisonCellStatus; pinned?: boolean }) {
  return request<{ success: boolean }>(`/branches/${encodeURIComponent(branchId)}/comparison-overrides/${encodeURIComponent(optionId)}/${encodeURIComponent(criterionId)}`, {
    method: 'PATCH', body: JSON.stringify(body),
  });
}

export function resetComparison(branchId: string, optionId: string, criterionId: string) {
  return request<{ success: boolean; deleted: boolean }>(`/branches/${encodeURIComponent(branchId)}/comparison-overrides/${encodeURIComponent(optionId)}/${encodeURIComponent(criterionId)}`, { method: 'DELETE' });
}

export async function exportThread(threadId: string, format: 'markdown' | 'adr') {
  const response = await fetch(`${BASE_URL}/threads/${encodeURIComponent(threadId)}/export?format=${format}`);
  if (!response.ok) throw new Error(`Export failed (${response.status})`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `trace-${threadId.slice(0, 8)}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}

const TRACE_EXTENSION_ID = 'maahnfbolbhanbmofehlmmgkbjcgilgn';

export async function openResumePages(urls: string[]): Promise<{ opened: number; viaExtension: boolean }> {
  const safe = urls.slice(0, 3).filter((value) => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
  });
  if (!safe.length) return { opened: 0, viaExtension: false };
  const chromeRuntime = (window as Window & { chrome?: { runtime?: { sendMessage?: (...args: unknown[]) => void } } }).chrome?.runtime;
  if (chromeRuntime?.sendMessage) {
    const result = await new Promise<{ ok?: boolean; opened?: number }>((resolve) => {
      chromeRuntime.sendMessage!(TRACE_EXTENSION_ID, { action: 'trace.openResumeTabs', urls: safe }, (response: unknown) => resolve((response ?? {}) as { ok?: boolean; opened?: number }));
    }).catch(() => ({} as { ok?: boolean; opened?: number }));
    if (result.ok) return { opened: result.opened ?? safe.length, viaExtension: true };
  }
  window.open(safe[0], '_blank', 'noopener,noreferrer');
  return { opened: 1, viaExtension: false };
}

export function fetchCapture(limit = 50) {
  return request<{ items: CaptureItem[] }>(`/capture?limit=${limit}`);
}

function postCorrection(path: string, body: object) {
  return request<{ success: boolean }>(`/corrections/${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export const confirmCapture = (itemId: string) => postCorrection('confirm', { itemId });
export const ignoreCapture = (itemId: string) => postCorrection('ignore', { itemId });
export const reassignCapture = (itemId: string, targetThreadId: string) =>
  postCorrection('reassign', { itemId, targetThreadId });
export const splitCapture = (itemId: string, title: string) =>
  request<{ threadId: string; branchId: string }>('/corrections/new-thread', {
    method: 'POST',
    body: JSON.stringify({ itemId, title }),
  });

export function markFeedRead(id: string) {
  return request<{ ok: boolean }>(`/feed/${id}/read`, { method: 'PATCH' });
}

export function markFeedGroupRead(eventIds: string[]) {
  return request<{ success: boolean; updated: number }>('/feed/read', {
    method: 'PATCH',
    body: JSON.stringify({ eventIds }),
  });
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

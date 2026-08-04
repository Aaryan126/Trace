import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SourceItem } from '@trace/core';
import { CaptureAssetRepository, SourceItemRepository } from '@trace/core';
import type Database from 'better-sqlite3';
import type { AutonomousCoordinator } from './automation.js';

export interface BrowserCaptureRequest {
  id: string;
  sourceItemId: string;
  title: string;
  url: string;
  availableAt: string;
}

export interface BrowserCapturePayload {
  fullImageBase64: string;
  thumbnailBase64: string;
  ocrText: string;
  width: number;
  height: number;
  visualHash: string;
}

export type BrowserCaptureFailureReason =
  | 'capture_disabled'
  | 'permission_required'
  | 'capture_agent_offline'
  | 'sensitive_url'
  | 'rate_limited'
  | 'url_cooldown'
  | 'low_relevance'
  | 'unsupported_system'
  | 'browser_not_frontmost'
  | 'private_window'
  | 'no_matching_window'
  | 'capture_failed'
  | 'encoding_failed'
  | 'upload_failed'
  | 'invalid_payload'
  | 'capture_timeout';

export interface BrowserCaptureHealth {
  enabled: boolean;
  authorized: boolean;
  connected: boolean;
  lastHeartbeatAt: string | null;
  lastAttemptAt: string | null;
  lastResult: 'queued' | 'capturing' | 'captured' | 'skipped' | 'failed' | null;
  lastReason: string | null;
  agents: Array<{
    id: 'chrome_extension' | 'mac_screen';
    connected: boolean;
    authorized: boolean;
    lastHeartbeatAt: string | null;
  }>;
}

export interface BrowserExtensionVisit {
  url: string;
  title: string;
  capturedAt: string;
  pageText?: string;
  manual?: boolean;
}

export interface BrowserExtensionVisitResult {
  status: 'capture' | 'ignored' | 'disabled' | 'rate_limited';
  request?: BrowserCaptureRequest;
}

interface PendingRequest extends BrowserCaptureRequest {
  state: 'pending' | 'leased';
  leaseUntil: number;
  timeout: ReturnType<typeof setTimeout>;
  owner: 'chrome_extension' | 'mac_screen';
}

export class BrowserCaptureCoordinator {
  private readonly items: SourceItemRepository;
  private readonly assets: CaptureAssetRepository;
  private readonly requests = new Map<string, PendingRequest>();
  private readonly urlCooldowns = new Map<string, number>();
  private captureTimes: number[] = [];
  private policyEnabled = false;
  private readonly agents = new Map<'chrome_extension' | 'mac_screen', { seenAt: number; authorized: boolean }>();
  private lastAttemptAt: string | null = null;
  private lastResult: BrowserCaptureHealth['lastResult'] = null;
  private lastReason: string | null = null;
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: Database.Database,
    private readonly automation: AutonomousCoordinator,
    private readonly assetRoot = join(homedir(), '.trace', 'assets', 'screenshots'),
  ) {
    this.items = new SourceItemRepository(db);
    this.assets = new CaptureAssetRepository(db);
    this.items.failInterruptedCaptures();
    this.policyEnabled = this.readPolicy();
    mkdirSync(this.assetRoot, { recursive: true, mode: 0o700 });
    chmodSync(this.assetRoot, 0o700);
    this.garbageCollect();
    this.gcTimer = setInterval(() => this.garbageCollect(), 6 * 60 * 60 * 1_000);
  }

  reportAgentStatus(enabled: boolean, authorized: boolean): void {
    this.setPolicyEnabled(enabled);
    this.reportAgent('mac_screen', authorized);
  }

  reportAgent(id: 'chrome_extension' | 'mac_screen', authorized: boolean): void {
    this.agents.set(id, { seenAt: Date.now(), authorized });
  }

  setPolicyEnabled(enabled: boolean): void {
    this.policyEnabled = enabled;
    this.db.prepare(`
      INSERT INTO metadata (key, value) VALUES ('browser_capture_enabled', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(enabled ? 'true' : 'false');
  }

  health(): BrowserCaptureHealth {
    const agents = (['chrome_extension', 'mac_screen'] as const).map((id) => {
      const agent = this.agents.get(id);
      return {
        id,
        connected: Boolean(agent && Date.now() - agent.seenAt <= (id === 'chrome_extension' ? 90_000 : 10_000)),
        authorized: agent?.authorized ?? false,
        lastHeartbeatAt: agent ? new Date(agent.seenAt).toISOString() : null,
      };
    });
    const connected = agents.some((agent) => agent.connected);
    const authorized = agents.some((agent) => agent.connected && agent.authorized);
    return {
      enabled: this.policyEnabled,
      authorized,
      connected,
      lastHeartbeatAt: agents.reduce<string | null>((latest, agent) => !agent.lastHeartbeatAt || (latest && latest >= agent.lastHeartbeatAt) ? latest : agent.lastHeartbeatAt, null),
      lastAttemptAt: this.lastAttemptAt,
      lastResult: this.lastResult,
      lastReason: this.lastReason,
      agents,
    };
  }

  consider(item: SourceItem): boolean {
    if (item.type !== 'browser_history' || !item.url || !item.raw_text) return false;
    if (!this.policyEnabled) return this.decline(item.id, 'capture_disabled');
    const mac = this.agents.get('mac_screen');
    if (!mac?.authorized) return this.decline(item.id, 'permission_required');
    if (Date.now() - mac.seenAt > 10_000) return this.decline(item.id, 'capture_agent_offline');
    return Boolean(this.queue(item, 'mac_screen', 1));
  }

  considerExtensionVisit(visit: BrowserExtensionVisit): BrowserExtensionVisitResult {
    this.reportAgent('chrome_extension', true);
    if (!this.policyEnabled) return { status: 'disabled' };
    if (!isSafeCaptureUrl(visit.url)) return { status: 'ignored' };

    const capturedAt = validDate(visit.capturedAt) ? visit.capturedAt : new Date().toISOString();
    const existing = this.items.findByUrl(visit.url).find((item) =>
      Math.abs(new Date(item.captured_at).getTime() - new Date(capturedAt).getTime()) < 60_000,
    );
    const item = existing ?? this.items.create({
      type: 'browser_history', raw_text: visit.title.slice(0, 1_000) || visit.url,
      extracted_entities: null, url: visit.url, captured_at: capturedAt, thread_id: null,
      content_text: visit.pageText?.slice(0, 20_000) || null,
      content_status: visit.pageText ? 'fetched' : 'metadata_only',
    });
    if (visit.pageText) this.items.updateVisualContext(item.id, visit.pageText.slice(0, 20_000));

    const priority = capturePriority(visit, existing);
    if (priority === 0) {
      this.decline(item.id, 'low_relevance');
      if (!existing) this.automation.enqueue(item.id);
      return { status: 'ignored' };
    }

    if (existing && !['not_requested', 'failed', 'skipped'].includes(existing.capture_status)) {
      return { status: 'ignored' };
    }
    const request = this.queue(item, 'chrome_extension', priority);
    if (!request) {
      const reason = this.items.getById(item.id)?.capture_reason;
      if (reason === 'rate_limited' || reason === 'url_cooldown') return { status: 'rate_limited' };
      if (!existing) this.automation.enqueue(item.id);
      return { status: 'ignored' };
    }
    return { status: 'capture', request };
  }

  private queue(item: SourceItem, owner: PendingRequest['owner'], priority: 1 | 2 | 3): BrowserCaptureRequest | undefined {
    if (!item.url || !item.raw_text) return undefined;
    if (!isSafeCaptureUrl(item.url)) { this.decline(item.id, 'sensitive_url'); return undefined; }
    const now = Date.now();
    this.captureTimes = this.captureTimes.filter((time) => now - time < 86_400_000);
    if (priority === 1 && this.captureTimes.some((time) => now - time < 10_000)) { this.decline(item.id, 'rate_limited'); return undefined; }
    if (this.captureTimes.filter((time) => now - time < 60_000).length >= 6) { this.decline(item.id, 'rate_limited'); return undefined; }
    if (this.captureTimes.filter((time) => now - time < 3_600_000).length >= 120) { this.decline(item.id, 'rate_limited'); return undefined; }
    if (this.captureTimes.length >= 500) { this.decline(item.id, 'rate_limited'); return undefined; }
    const normalizedUrl = normalizeUrl(item.url);
    if (priority < 3 && (this.urlCooldowns.get(normalizedUrl) ?? 0) > now - 600_000) { this.decline(item.id, 'url_cooldown'); return undefined; }

    const id = randomUUID();
    const timeout = setTimeout(() => this.finishWithoutCapture(id, 'failed', 'capture_timeout'), 60_000);
    this.requests.set(id, {
      id, sourceItemId: item.id, title: item.raw_text, url: item.url,
      availableAt: new Date(now + 2_000).toISOString(), state: 'pending', leaseUntil: 0, timeout,
      owner,
    });
    this.captureTimes.push(now);
    this.urlCooldowns.set(normalizedUrl, now);
    this.items.updateCaptureStatus(item.id, 'queued');
    this.recordResult('queued');
    return { id, sourceItemId: item.id, title: item.raw_text, url: item.url, availableAt: new Date(now + 2_000).toISOString() };
  }

  next(): BrowserCaptureRequest | undefined {
    const now = Date.now();
    for (const request of this.requests.values()) {
      if (request.owner !== 'mac_screen') continue;
      if (new Date(request.availableAt).getTime() > now) continue;
      if (request.state === 'leased' && request.leaseUntil > now) continue;
      request.state = 'leased';
      request.leaseUntil = now + 25_000;
      clearTimeout(request.timeout);
      request.timeout = setTimeout(() => this.finishWithoutCapture(request.id, 'failed', 'capture_timeout'), 25_000);
      this.items.updateCaptureStatus(request.sourceItemId, 'capturing');
      this.recordResult('capturing');
      return request;
    }
    return undefined;
  }

  stage(id: string, stage: string): boolean {
    const request = this.requests.get(id);
    if (!request) return false;
    this.items.updateCaptureStatus(request.sourceItemId, 'capturing', stage);
    this.recordResult('capturing', stage);
    return true;
  }

  complete(id: string, payload: BrowserCapturePayload): boolean {
    const request = this.requests.get(id);
    if (!request) return false;
    if (!validPayload(payload)) {
      this.finishWithoutCapture(id, 'failed', 'invalid_payload');
      return false;
    }
    const full = Buffer.from(payload.fullImageBase64, 'base64');
    const thumbnail = Buffer.from(payload.thumbnailBase64, 'base64');
    if (!isJpeg(full) || !isJpeg(thumbnail) || full.length > 5_000_000 || thumbnail.length > 750_000) {
      this.finishWithoutCapture(id, 'failed', 'invalid_payload');
      return false;
    }

    clearTimeout(request.timeout);
    this.requests.delete(id);
    this.items.updateVisualContext(request.sourceItemId, payload.ocrText.slice(0, 20_000));
    const duplicate = this.assets.listRecent(100).some((asset) => hashDistance(asset.visual_hash, payload.visualHash) <= 4);
    const day = new Date().toISOString().slice(0, 10);
    const directory = join(this.assetRoot, day);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const fullPath = duplicate ? null : join(directory, `${request.sourceItemId}.jpg`);
    const thumbnailPath = join(directory, `${request.sourceItemId}-thumb.jpg`);
    if (fullPath) {
      writeFileSync(fullPath, full, { mode: 0o600 });
    }
    writeFileSync(thumbnailPath, thumbnail, { mode: 0o600 });
    this.assets.create({
      source_item_id: request.sourceItemId, full_path: fullPath, thumbnail_path: thumbnailPath,
      mime_type: 'image/jpeg', byte_size: fullPath ? full.length : 0, width: payload.width, height: payload.height,
      visual_hash: payload.visualHash.toLowerCase(), captured_at: new Date().toISOString(),
      full_expires_at: '9999-12-31T23:59:59.999Z',
    });
    this.items.updateCaptureStatus(request.sourceItemId, 'captured', duplicate ? 'near_duplicate' : null);
    this.recordResult('captured', duplicate ? 'near_duplicate' : null);
    this.automation.enqueue(request.sourceItemId);
    return true;
  }

  skip(id: string, reason: BrowserCaptureFailureReason = 'capture_failed'): boolean {
    if (!this.requests.has(id)) return false;
    const status = ['capture_failed', 'encoding_failed', 'upload_failed'].includes(reason) ? 'failed' : 'skipped';
    this.finishWithoutCapture(id, status, reason);
    return true;
  }

  removeForSourceItem(sourceItemId: string): void {
    const asset = this.assets.getBySourceItem(sourceItemId);
    if (!asset) return;
    deleteFile(asset.full_path);
    deleteFile(asset.thumbnail_path);
    this.assets.deleteBySourceItem(sourceItemId);
  }

  garbageCollect(): void {
    let totalBytes = this.assets.totalFullBytes();
    for (const asset of this.assets.listFullAssetsOldestFirst()) {
      if (totalBytes > 1_000_000_000) {
        deleteFile(asset.full_path);
        this.assets.clearFullPath(asset.id);
        totalBytes -= asset.byte_size;
      }
    }
  }

  close(): void {
    if (this.gcTimer) clearInterval(this.gcTimer);
    this.gcTimer = null;
    for (const request of this.requests.values()) clearTimeout(request.timeout);
    this.requests.clear();
  }

  private finishWithoutCapture(
    id: string,
    status: 'skipped' | 'failed',
    reason: BrowserCaptureFailureReason,
  ): void {
    const request = this.requests.get(id);
    if (!request) return;
    clearTimeout(request.timeout);
    this.requests.delete(id);
    this.items.updateCaptureStatus(request.sourceItemId, status, reason);
    this.recordResult(status, reason);
    this.automation.enqueue(request.sourceItemId);
  }

  private decline(sourceItemId: string, reason: BrowserCaptureFailureReason): false {
    this.items.updateCaptureStatus(sourceItemId, 'skipped', reason);
    this.recordResult('skipped', reason);
    return false;
  }

  private recordResult(result: BrowserCaptureHealth['lastResult'], reason: string | null = null): void {
    this.lastAttemptAt = new Date().toISOString();
    this.lastResult = result;
    this.lastReason = reason;
  }

  private readPolicy(): boolean {
    const row = this.db.prepare("SELECT value FROM metadata WHERE key = 'browser_capture_enabled'").get() as { value: string } | undefined;
    return row?.value === 'true';
  }
}

function capturePriority(visit: BrowserExtensionVisit, existing?: SourceItem): 0 | 1 | 2 | 3 {
  if (!isSafeCaptureUrl(visit.url)) return 0;
  if (visit.manual) return 3;
  if (existing?.branch_id || existing?.thread_id) return 2;
  if (existing) return 1;
  let url: URL;
  try { url = new URL(visit.url); } catch { return 0; }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if ((host.includes('youtube.com') && (path === '/' || path.startsWith('/shorts'))) ||
      (host.includes('linkedin.com') && (path === '/feed' || path.startsWith('/notifications'))) ||
      ((host === 'reddit.com' || host === 'www.reddit.com') && path === '/')) return 0;
  const text = `${visit.title}\n${visit.url}\n${visit.pageText ?? ''}`.toLowerCase();
  if (/\b(compare|comparison|versus|\bvs\b|alternatives?|benchmark|pricing|trade-?offs?|pros? and cons?|evaluate|evaluation|choose|best (tool|model|service|option)|decision|migration)\b/.test(text)) return 2;
  return (visit.pageText?.trim().length ?? 0) >= 400 && path !== '/' ? 1 : 0;
}

function validPayload(payload: BrowserCapturePayload): boolean {
  return typeof payload.fullImageBase64 === 'string' && typeof payload.thumbnailBase64 === 'string' &&
    typeof payload.ocrText === 'string' && Number.isInteger(payload.width) && payload.width > 0 && payload.width <= 5_000 &&
    Number.isInteger(payload.height) && payload.height > 0 && payload.height <= 5_000 && /^[0-9a-f]{16}$/i.test(payload.visualHash);
}

function validDate(value: string): boolean {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
  return url.toString();
}

function isSafeCaptureUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())) return false;
  const text = `${url.hostname}${url.pathname}`.toLowerCase();
  return !/(^|\.)(accounts|login|mail|outlook|proton|1password|bitwarden)\.|\/((sign|log)[-_]?in|auth|checkout|payment|bank|health|medical)(\/|$)/.test(text);
}

function hashDistance(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/i.test(a) || !/^[0-9a-f]{16}$/i.test(b)) return 64;
  let distance = 0;
  for (let index = 0; index < 16; index++) {
    let value = Number.parseInt(a[index], 16) ^ Number.parseInt(b[index], 16);
    while (value) { distance += value & 1; value >>= 1; }
  }
  return distance;
}

function deleteFile(path: string | null): void {
  if (!path) return;
  try { unlinkSync(path); } catch { /* already gone */ }
}

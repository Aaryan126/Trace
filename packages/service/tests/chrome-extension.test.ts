import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { isCapturableUrl } from '../../../browser-extension/capture-policy.js';
import { encodeNativeMessage, readNativeMessage } from '../../../scripts/native-message.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Trace Chrome extension capture policy', () => {
  it('accepts ordinary research pages', () => {
    expect(isCapturableUrl('https://example.com/database-comparison')).toBe(true);
  });

  it('rejects internal, sign-in, payment, mail, and health pages', () => {
    expect(isCapturableUrl('chrome://settings')).toBe(false);
    expect(isCapturableUrl('http://localhost:3333/threads/example')).toBe(false);
    expect(isCapturableUrl('http://127.0.0.1:3333/activity')).toBe(false);
    expect(isCapturableUrl('https://accounts.google.com/signin')).toBe(false);
    expect(isCapturableUrl('https://shop.example.com/checkout')).toBe(false);
    expect(isCapturableUrl('https://mail.proton.me/u/0/inbox')).toBe(false);
    expect(isCapturableUrl('https://example.com/medical/results')).toBe(false);
  });

  it('uses the same fixed extension ID for native messaging and Resume Research', () => {
    const root = resolve(import.meta.dirname, '../../..');
    const start = readFileSync(resolve(root, 'scripts/start.sh'), 'utf8');
    const dashboard = readFileSync(resolve(root, 'packages/dashboard/src/lib/api.ts'), 'utf8');
    const nativeId = start.match(/chrome-extension:\/\/([a-p]{32})\//)?.[1];
    const resumeId = dashboard.match(/TRACE_EXTENSION_ID = '([a-p]{32})'/)?.[1];
    expect(nativeId).toBeTruthy();
    expect(resumeId).toBe(nativeId);
  });
});

describe('Chrome native messaging', () => {
  it('reads a complete message without waiting for Chrome to close stdin', async () => {
    const stream = new PassThrough();
    const message = readNativeMessage(stream);

    stream.write(encodeNativeMessage({ action: 'status', authorized: true }));

    await expect(message).resolves.toEqual({ action: 'status', authorized: true });
    expect(stream.writableEnded).toBe(false);
    stream.destroy();
  });
});

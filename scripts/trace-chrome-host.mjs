#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { encodeNativeMessage, readNativeMessage } from './native-message.mjs';

const runtimeDir = join(homedir(), '.trace');

function reply(value) {
  process.stdout.write(encodeNativeMessage(value));
}

async function call(path, body) {
  const [token, port] = await Promise.all([
    readFile(join(runtimeDir, 'capture-token'), 'utf8'),
    readFile(join(runtimeDir, 'capture-port'), 'utf8'),
  ]);
  const response = await fetch(`http://127.0.0.1:${port.trim()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-trace-capture-token': token.trim() },
    body: JSON.stringify(body ?? {}),
  });
  const result = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || `Trace returned ${response.status}`);
  return result;
}

try {
  const message = await readNativeMessage(process.stdin);
  let result;
  switch (message.action) {
    case 'status':
      result = await call('/api/browser-capture/status', { agent: 'chrome_extension', authorized: message.authorized === true });
      break;
    case 'visit':
      result = await call('/api/browser-extension/visit', message.visit);
      break;
    case 'complete':
      result = await call(`/api/browser-capture/${encodeURIComponent(message.id)}/complete`, message.payload);
      break;
    case 'skip':
      result = await call(`/api/browser-capture/${encodeURIComponent(message.id)}/skip`, { reason: message.reason });
      break;
    default:
      throw new Error('Unknown native message action');
  }
  reply({ ok: true, result });
} catch (error) {
  reply({ ok: false, error: error instanceof Error ? error.message : 'Native host failed' });
}

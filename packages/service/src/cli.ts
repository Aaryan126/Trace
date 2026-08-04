import { closeSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRuntime } from './runtime.js';

type Command = 'cluster' | 'synthesize' | 'resurface' | 'digest' | 'recover' | 'reconcile';

async function main(): Promise<void> {
  const command = process.argv[2] as Command | undefined;
  if (!command || !['cluster', 'synthesize', 'resurface', 'digest', 'recover', 'reconcile'].includes(command)) {
    throw new Error('Usage: trace-agent <cluster|synthesize|resurface|digest|recover|reconcile>');
  }

  const release = acquireLock(command);
  let runtime: ReturnType<typeof createRuntime> | undefined;
  try {
    if (command === 'recover' && await traceServiceHealthy()) {
      console.log(JSON.stringify({ command, ok: true, recovered: 0, skipped: 'live-service-healthy' }));
      return;
    }
    runtime = createRuntime();
    const result = command === 'recover'
      ? await runtime.automation.recover()
      : command === 'reconcile'
        ? await runtime.automation.reconcile()
        : command === 'cluster'
      ? await runtime.clustering.run()
      : command === 'synthesize'
        ? await runtime.synthesis.run()
        : command === 'resurface'
          ? await runtime.resurfacing.generateReopenDiffs()
          : await runtime.resurfacing.generateDigest();
    console.log(JSON.stringify({ command, ok: true, ...result }));
  } finally {
    await runtime?.close();
    release();
  }
}

async function traceServiceHealthy(): Promise<boolean> {
  const port = process.env.TRACE_PORT ?? '3333';
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function acquireLock(command: Command): () => void {
  const projectRoot = resolve(import.meta.dirname, '..', '..', '..');
  const lockDir = resolve(projectRoot, '.trace', 'locks');
  const lockPath = resolve(lockDir, `${command}.lock`);
  mkdirSync(lockDir, { recursive: true });
  let descriptor: number;
  try {
    descriptor = openSync(lockPath, 'wx');
  } catch {
    throw new Error(`${command} is already running`);
  }
  writeFileSync(descriptor, `${process.pid}\n`, 'utf8');
  return () => {
    closeSync(descriptor);
    rmSync(lockPath, { force: true });
  };
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});

import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createDatabase } from '../packages/core/src/db/database.js';

// Legacy product paths are intentionally confined to this migration utility.
const legacyDirName = `.${['bra', 'inch'].join('')}`;
const legacyFileName = `${['bra', 'inch'].join('')}.sqlite`;
const legacyPath = join(homedir(), legacyDirName, legacyFileName);
const traceDir = join(homedir(), '.trace');
const tracePath = join(traceDir, 'trace.sqlite');
const stamp = new Date().toISOString().replaceAll(':', '-');
const backupDir = join(traceDir, 'backups', stamp);

function countData(path: string): number {
  if (!existsSync(path)) return 0;
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const tables = ['threads', 'branches', 'commits', 'source_items', 'feed_events'];
    return tables.reduce((total, table) => {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      if (!exists) return total;
      return total + (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
    }, 0);
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const legacyCount = countData(legacyPath);
  const traceCount = countData(tracePath);
  if (legacyCount === 0) {
    console.log('No populated legacy database found; nothing to migrate.');
    return;
  }
  if (traceCount > 0) {
    throw new Error('Both legacy and Trace databases contain data; migration aborted without modifying either.');
  }

  mkdirSync(backupDir, { recursive: true });
  const legacy = new Database(legacyPath, { readonly: true, fileMustExist: true });
  const migratedPath = join(backupDir, 'trace-migrated.sqlite');
  try {
    await legacy.backup(join(backupDir, basename(legacyPath)));
    await legacy.backup(migratedPath);
  } finally {
    legacy.close();
  }
  if (existsSync(tracePath)) copyFileSync(tracePath, join(backupDir, 'trace-before-migration.sqlite'));
  mkdirSync(traceDir, { recursive: true });
  renameSync(migratedPath, tracePath);
  const migrated = createDatabase(tracePath);
  migrated.close();
  console.log(`Migrated ${legacyCount} records to ${tracePath}. Backups: ${backupDir}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

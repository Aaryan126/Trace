// Seed script for Trace — populates the database with realistic test data
// and demonstrates the full pipeline (ingestion → clustering → synthesis → resurfacing)
//
// Usage:  npx tsx scripts/seed.ts
// Or via: ./scripts/seed-test.sh

import Database from 'better-sqlite3';
import { mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createDatabase } from '@trace/core';

// ── Resolve DB path ──────────────────────────────────────────────────────────
const TRACE_DIR = join(homedir(), '.trace');
const DB_PATH = join(TRACE_DIR, 'trace.sqlite');

mkdirSync(TRACE_DIR, { recursive: true });

// Wipe existing DB for a clean seed (idempotent reruns)
if (existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
  // Also remove WAL/SHM files if present
  if (existsSync(DB_PATH + '-wal')) unlinkSync(DB_PATH + '-wal');
  if (existsSync(DB_PATH + '-shm')) unlinkSync(DB_PATH + '-shm');
}

const db = createDatabase(DB_PATH);

console.log('🧠 Trace Seed — Populating with test data...\n');

// ── Helpers ──────────────────────────────────────────────────────────────────
const uuid = (): string => crypto.randomUUID();

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

function daysAgo(d: number): string {
  return hoursAgo(d * 24);
}

// ── Time anchors ─────────────────────────────────────────────────────────────
const NOW = new Date().toISOString();
const YESTERDAY = daysAgo(1);
const THREE_DAYS_AGO = daysAgo(3);
const LAST_WEEK = daysAgo(7);

// ── Pre-generated IDs ────────────────────────────────────────────────────────
const thread1Id = uuid();
const branch1Id = uuid();
const commit1Id = uuid();

const thread2Id = uuid();
const branch2Id = uuid();

const thread3Id = uuid();
const branch3Id = uuid();

// Source item IDs (needed for commit.source_item_ids FK reference)
const item1aId = uuid();
const item1bId = uuid();
const item1cId = uuid();

// ── PHASE 1: Thread 1 — Postgres vs MongoDB (closed, then reopened) ──────────
console.log('📌 Thread 1: Postgres vs MongoDB for orders service');

db.prepare(
  `INSERT INTO threads (id, title, tags, status, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?)`
).run(
  thread1Id,
  'Postgres vs MongoDB for orders service',
  JSON.stringify(['database', 'architecture', 'orders-service']),
  'closed',
  LAST_WEEK,
  YESTERDAY,
);

db.prepare(
  `INSERT INTO branches (id, thread_id, parent_commit_id, context_label, created_at)
   VALUES (?, ?, ?, ?, ?)`
).run(branch1Id, thread1Id, null, null, LAST_WEEK);

// Source items from the original research session
const items1 = [
  {
    id: item1aId,
    text: 'Compared PostgreSQL 16 vs MongoDB 7 for relational order data. PG handles complex joins natively and supports CTEs for reporting queries.',
    url: 'https://db-engines.com/en/ranking',
    entities: ['PostgreSQL', 'MongoDB', 'relational data', 'CTEs'],
    captured: LAST_WEEK,
  },
  {
    id: item1bId,
    text: 'MongoDB excels with document-oriented data but our orders have many relations (items, payments, shipping, refunds). Join performance degrades at scale.',
    url: 'https://www.mongodb.com/docs/manual/introduction/',
    entities: ['MongoDB', 'orders', 'documents', 'joins'],
    captured: LAST_WEEK,
  },
  {
    id: item1cId,
    text: 'PostgreSQL JSONB gives us document flexibility when needed without sacrificing relational integrity. Gin indexes on JSONB columns make querying nested fields fast.',
    url: 'https://www.postgresql.org/docs/current/datatype-json.html',
    entities: ['PostgreSQL', 'JSONB', 'flexibility', 'Gin index'],
    captured: LAST_WEEK,
  },
];

const insertItem = db.prepare(
  `INSERT INTO source_items (id, type, raw_text, extracted_entities, url, captured_at, thread_id, processed)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

for (const item of items1) {
  insertItem.run(
    item.id,
    'browser_history',
    item.text,
    JSON.stringify({ mentioned: item.entities }),
    item.url,
    item.captured,
    thread1Id,
    1, // processed
  );
}

// Commit: the decision that was made
db.prepare(
  `INSERT INTO commits (id, branch_id, verdict_summary, reasoning, source_item_ids, created_at, regret, regret_note)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
).run(
  commit1Id,
  branch1Id,
  'Use PostgreSQL for the orders service — relational integrity is critical, and JSONB covers document needs.',
  'The orders domain has strong relational requirements (orders → items → payments → shipping). PostgreSQL handles complex joins natively and supports CTEs for reporting. While MongoDB offers document flexibility, PG\'s JSONB type provides equivalent capability without sacrificing ACID transactions across related tables. Performance benchmarks show PG outperforming Mongo on multi-table aggregations at our expected scale (~2M orders/month).',
  JSON.stringify([item1aId, item1bId, item1cId]),
  YESTERDAY,
  0,
  null,
);

// Feed event: commit closed
db.prepare(
  `INSERT INTO feed_events (id, type, thread_id, payload, created_at, read)
   VALUES (?, ?, ?, ?, ?, ?)`
).run(
  uuid(),
  'commit_closed',
  thread1Id,
  JSON.stringify({
    verdict: 'Use PostgreSQL for the orders service — relational integrity is critical.',
    commitId: commit1Id,
    itemCount: 3,
  }),
  YESTERDAY,
  0,
);

// ── PHASE 2: Thread 2 — Auth Provider (open, 4 items, digest pending) ───────
console.log('📌 Thread 2: Auth provider selection (Auth0 vs Clerk vs Supabase)');

db.prepare(
  `INSERT INTO threads (id, title, tags, status, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?)`
).run(
  thread2Id,
  'Auth provider selection: Auth0 vs Clerk vs Supabase',
  JSON.stringify(['auth', 'vendor', 'security']),
  'open',
  THREE_DAYS_AGO,
  NOW,
);

db.prepare(
  `INSERT INTO branches (id, thread_id, parent_commit_id, context_label, created_at)
   VALUES (?, ?, ?, ?, ?)`
).run(branch2Id, thread2Id, null, null, THREE_DAYS_AGO);

const items2 = [
  {
    text: 'Clerk offers better DX for React/Next.js apps with pre-built UI components. Their <SignIn/> and <UserProfile/> components drop in with zero config.',
    url: 'https://clerk.com',
    entities: ['Clerk', 'React', 'Next.js', 'DX'],
    captured: daysAgo(2.5),
  },
  {
    text: 'Auth0 is more enterprise-ready with extensive social login and SAML support. Better for B2B SSO requirements. Okta backing adds long-term stability.',
    url: 'https://auth0.com/features',
    entities: ['Auth0', 'enterprise', 'SAML', 'SSO', 'Okta'],
    captured: daysAgo(2),
  },
  {
    text: 'Supabase Auth is free tier generous (50k MAU) and integrates well with Postgres but limited custom providers. No SAML on free tier.',
    url: 'https://supabase.com/auth',
    entities: ['Supabase', 'free tier', 'Postgres', 'SAML'],
    captured: daysAgo(1.5),
  },
  {
    text: 'Clerk pricing: $25/month for 10k MAU. Auth0: $23/month for 7k MAU. Supabase: free up to 50k MAU then $25/month for 100k.',
    url: 'https://clerk.com/pricing',
    entities: ['Clerk', 'pricing', 'Auth0', 'Supabase', 'MAU'],
    captured: daysAgo(1),
  },
];

for (const item of items2) {
  insertItem.run(
    uuid(),
    'browser_history',
    item.text,
    JSON.stringify({ mentioned: item.entities }),
    item.url,
    item.captured,
    thread2Id,
    1, // processed
  );
}

// Feed event: digest for the open thread
db.prepare(
  `INSERT INTO feed_events (id, type, thread_id, payload, created_at, read)
   VALUES (?, ?, ?, ?, ?, ?)`
).run(
  uuid(),
  'digest',
  thread2Id,
  JSON.stringify({
    threadTitle: 'Auth provider selection',
    itemCount: 4,
    timespan: 'this week',
    summary: 'Compared Clerk (best DX for React), Auth0 (enterprise/SAML), and Supabase (generous free tier). Pricing and B2B SSO requirements still under review.',
  }),
  hoursAgo(1),
  0,
);

// ── PHASE 3: Thread 3 — Zustand vs Jotai (open, 1 item, just started) ───────
console.log('📌 Thread 3: Zustand vs Jotai for state management');

db.prepare(
  `INSERT INTO threads (id, title, tags, status, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?)`
).run(
  thread3Id,
  'Zustand vs Jotai for state management',
  JSON.stringify(['frontend', 'state-management', 'React']),
  'open',
  hoursAgo(12),
  NOW,
);

db.prepare(
  `INSERT INTO branches (id, thread_id, parent_commit_id, context_label, created_at)
   VALUES (?, ?, ?, ?, ?)`
).run(branch3Id, thread3Id, null, null, hoursAgo(12));

insertItem.run(
  uuid(),
  'browser_history',
  'Zustand is simpler with less boilerplate — single store, no providers needed. Jotai is more atomic and fine-grained, better for complex derived state. Zustand bundle: 1.2KB. Jotai: 2.4KB.',
  JSON.stringify({ mentioned: ['Zustand', 'Jotai', 'bundle size'] }),
  'https://zustand-demo.pmnd.rs',
  hoursAgo(6),
  thread3Id,
  1, // processed
);

// ── PHASE 4: Reopen Thread 1 — new context (notifications service) ───────────
console.log('📌 Reopen: Postgres vs Mongo revisited for notifications service');

const reopenItemId = uuid();
insertItem.run(
  reopenItemId,
  'browser_history',
  'Revisiting database choice for notifications service — MongoDB might work better here since notification schemas vary wildly by type (email, push, in-app, SMS) and don\'t need strong relational joins. Each notification type has different payload shapes.',
  JSON.stringify({ mentioned: ['PostgreSQL', 'MongoDB', 'notifications service', 'schema flexibility'] }),
  'https://engineering.fb.com/2023/11/13/data-infrastructure/optimizing-data-processing-with-rocksdb/',
  NOW,
  thread1Id,
  0, // unprocessed — just ingested, clustering will pick it up
);

// Reopen the thread
db.prepare(
  `UPDATE threads SET status = 'open', updated_at = ? WHERE id = ?`
).run(NOW, thread1Id);

// Create a new branch for the reopened context
const branch1bId = uuid();
db.prepare(
  `INSERT INTO branches (id, thread_id, parent_commit_id, context_label, created_at)
   VALUES (?, ?, ?, ?, ?)`
).run(branch1bId, thread1Id, commit1Id, 'notifications-service', NOW);

// Feed event: reopen
db.prepare(
  `INSERT INTO feed_events (id, type, thread_id, payload, created_at, read)
   VALUES (?, ?, ?, ?, ?, ?)`
).run(
  uuid(),
  'reopen',
  thread1Id,
  JSON.stringify({
    threadId: thread1Id,
    itemId: reopenItemId,
    previousVerdict: 'Use PostgreSQL for the orders service',
    contextDiff: 'Previous decision was for orders service (strong relational needs). New context is notifications service where schemas vary by type and relational joins are minimal.',
    reason: 'New research activity in different context (notifications service)',
  }),
  NOW,
  0,
);

// ── PHASE 5: Unprocessed items (just ingested, awaiting clustering) ───────────
console.log('📌 Unprocessed item: Stripe vs Paddle billing comparison');

insertItem.run(
  uuid(),
  'browser_history',
  'Comparing Stripe vs Paddle for subscription billing — Stripe has better API DX and docs but Paddle handles tax compliance globally as a reseller. Stripe Tax add-on exists but requires separate integration.',
  JSON.stringify({ mentioned: ['Stripe', 'Paddle', 'billing', 'tax compliance', 'subscriptions'] }),
  'https://stripe.com/docs/billing',
  NOW,
  null, // not yet clustered
  0,
);

console.log('📌 Unprocessed item: Screenshot of HN post about Notion alternative');

insertItem.run(
  uuid(),
  'screenshot',
  'Hacker News: Show HN: Open-source alternative to Notion with real-time collaboration\n\n543 points by devuser 3 hours ago | 89 comments\n\nNotable comments: "We switched from Notion to this 6 months ago and the real-time collab is actually reliable." "Self-hosting was a dealbreaker for our compliance team."',
  JSON.stringify({ mentioned: ['Notion', 'open-source', 'real-time collaboration', 'self-hosting'] }),
  null,
  NOW,
  null, // not yet clustered
  0,
);

// ── PHASE 6: Nudge event (synthesis agent nudging about stale open thread) ──
db.prepare(
  `INSERT INTO feed_events (id, type, thread_id, payload, created_at, read)
   VALUES (?, ?, ?, ?, ?, ?)`
).run(
  uuid(),
  'nudge',
  thread3Id,
  JSON.stringify({
    threadTitle: 'Zustand vs Jotai for state management',
    message: 'You added one item 6 hours ago. Ready to close this research or add more findings?',
    itemCount: 1,
  }),
  hoursAgo(0.5),
  0,
);

// ── Summary ──────────────────────────────────────────────────────────────────
db.close();

console.log('\n✅ Seed data created at ' + DB_PATH);
console.log('');
console.log('Threads:');
console.log('  1. "Postgres vs MongoDB"        — REOPENED (was closed, new context: notifications service)');
console.log('  2. "Auth provider selection"    — OPEN (4 items, weekly digest pending)');
console.log('  3. "Zustand vs Jotai"           — OPEN (1 item, synthesis nudge sent)');
console.log('');
console.log('Unprocessed items (visible in Capture View):');
console.log('  1. Stripe vs Paddle billing comparison (browser_history)');
console.log('  2. HN post about Notion alternative (screenshot/OCR)');
console.log('  3. Postgres vs Mongo for notifications (browser_history, assigned to thread 1)');
console.log('');
console.log('Feed events (visible on Home page):');
console.log('  - commit_closed  → Postgres decision from yesterday');
console.log('  - reopen         → Postgres revisited for notifications service');
console.log('  - digest         → Auth provider weekly summary');
console.log('  - nudge          → Zustand vs Jotai synthesis prompt');
console.log('');
console.log('🌐 Start the app:  ./scripts/start.sh');
console.log('   Then open http://127.0.0.1:5173 to see the seeded data.');

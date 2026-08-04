import dotenv from 'dotenv';
import type Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  BranchRepository,
  ClusteringAgent,
  CommitRepository,
  createDatabase,
  FeedEventRepository,
  loadConfig,
  ResurfacingAgent,
  SourceItemRepository,
  SynthesisAgent,
  ThreadRepository,
  TraceAI,
  type TraceConfig,
} from '@trace/core';
import { BrowserHistoryReader, ScreenshotWatcher } from './watchers/index.js';
import { AutonomousCoordinator } from './automation.js';
import { BrowserCaptureCoordinator } from './browser-capture.js';

export interface RuntimeOptions {
  configPath?: string;
  startWatchers?: boolean;
}

export interface TraceRuntime {
  config: TraceConfig;
  db: Database.Database;
  clustering: ClusteringAgent;
  synthesis: SynthesisAgent;
  resurfacing: ResurfacingAgent;
  automation: AutonomousCoordinator;
  captures: BrowserCaptureCoordinator;
  startIngestion(): void;
  close(): Promise<void>;
}

export function createRuntime(options: RuntimeOptions = {}): TraceRuntime {
  const projectRoot = resolve(import.meta.dirname, '..', '..', '..');
  dotenv.config({ path: resolve(projectRoot, '.env') });
  const config = loadConfig(options.configPath);
  mkdirSync(dirname(config.db.path), { recursive: true });
  const db = createDatabase(config.db.path);
  const ai = new TraceAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: config.openai.model,
    visionModel: config.openai.visionModel,
    checkpointModel: config.openai.checkpointModel,
  });
  const threadRepo = new ThreadRepository(db);
  const branchRepo = new BranchRepository(db);
  const commitRepo = new CommitRepository(db);
  const sourceItemRepo = new SourceItemRepository(db);
  const feedEventRepo = new FeedEventRepository(db);
  const clustering = new ClusteringAgent(
    db, ai, threadRepo, branchRepo, sourceItemRepo, feedEventRepo,
    config.clusteringConfidenceThreshold,
  );
  const synthesis = new SynthesisAgent(
    db,
    ai,
    { quietWindowHours: config.quietWindowHours, minItems: config.synthesisMinItems },
    threadRepo,
    branchRepo,
    commitRepo,
    sourceItemRepo,
    feedEventRepo,
  );
  const resurfacing = new ResurfacingAgent(
    ai,
    { digestWindowDays: config.resurfacingDigestWindowDays },
    threadRepo,
    branchRepo,
    commitRepo,
    sourceItemRepo,
    feedEventRepo,
  );
  const automation = new AutonomousCoordinator(db, ai, {
    checkpointQuietSeconds: config.checkpointQuietSeconds,
  });
  const captures = new BrowserCaptureCoordinator(db, automation);
  automation.events.on('event', (event: { type: string; sourceItemId?: string }) => {
    if (event.type === 'source.ignored' && event.sourceItemId) captures.removeForSourceItem(event.sourceItemId);
  });
  const onScreenshotCreated = (item: { id: string }) => automation.enqueue(item.id);
  const onHistoryCreated = (item: { id: string }) => automation.enqueue(item.id);
  const screenshots = new ScreenshotWatcher(
    { watchDir: config.screenshotDir, extensions: config.screenshotExtensions },
    ai,
    sourceItemRepo,
    onScreenshotCreated,
  );
  const history = new BrowserHistoryReader(
    {
      pollIntervalMs: config.browserHistoryPollIntervalMs,
      debounceMs: config.browserHistoryDebounceMs,
      initialLookbackHours: config.browserHistoryInitialLookbackHours,
    },
    sourceItemRepo,
    db,
    onHistoryCreated,
  );
  let watchersStarted = false;
  let closed = false;

  const startIngestion = () => {
    if (watchersStarted) return;
    automation.start();
    screenshots.start();
    history.start();
    watchersStarted = true;
  };

  if (options.startWatchers) startIngestion();

  return {
    config,
    db,
    clustering,
    synthesis,
    resurfacing,
    automation,
    captures,
    startIngestion,
    async close() {
      if (closed) return;
      closed = true;
      await history.stop();
      await screenshots.stop();
      captures.close();
      await automation.close();
      db.close();
    },
  };
}

export type { TraceConfig };

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface TraceConfig {
  screenshotDir: string;
  screenshotExtensions: string[];
  browserHistoryPollIntervalMs: number;
  browserHistoryDebounceMs: number;
  browserHistoryInitialLookbackHours: number;
  quietWindowHours: number;
  checkpointQuietSeconds: number;
  synthesisMinItems: number;
  clusteringConfidenceThreshold: number;
  resurfacingDigestWindowDays: number;
  dashboardPort: number;
  openai: {
    model: string;
    visionModel: string;
    checkpointModel: string;
  };
  db: {
    path: string;
  };
}

const DEFAULTS: TraceConfig = {
  screenshotDir: '~/Desktop',
  screenshotExtensions: ['.png', '.jpg', '.jpeg'],
  browserHistoryPollIntervalMs: 120_000,
  browserHistoryDebounceMs: 1_500,
  browserHistoryInitialLookbackHours: 0,
  quietWindowHours: 24,
  checkpointQuietSeconds: 25,
  synthesisMinItems: 2,
  clusteringConfidenceThreshold: 0.6,
  resurfacingDigestWindowDays: 7,
  dashboardPort: 3333,
  openai: {
    model: 'gpt-5.6-terra',
    visionModel: 'gpt-5.6-terra',
    checkpointModel: 'gpt-5.6-sol',
  },
  db: {
    path: '~/.trace/trace.sqlite',
  },
};

function expandTilde(value: string): string {
  if (value.startsWith('~/') || value === '~') {
    return join(homedir(), value.slice(2));
  }
  return value;
}

function expandPaths(config: TraceConfig): TraceConfig {
  return {
    ...config,
    screenshotDir: expandTilde(config.screenshotDir),
    db: {
      ...config.db,
      path: expandTilde(config.db.path),
    },
  };
}

function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const val = override[key];
    if (
      val !== undefined &&
      typeof val === 'object' &&
      val !== null &&
      !Array.isArray(val) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        val as Record<string, unknown>,
      ) as T[keyof T];
    } else if (val !== undefined) {
      result[key] = val as T[keyof T];
    }
  }
  return result;
}

function readJsonFile(filePath: string): Partial<TraceConfig> | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Partial<TraceConfig>;
  } catch {
    return null;
  }
}

export function loadConfig(configPath?: string): TraceConfig {
  const candidates: string[] = [];

  if (configPath) {
    candidates.push(resolve(configPath));
  }

  candidates.push(join(homedir(), '.trace', 'config.json'));

  // Project root fallback: walk up from this file's location
  // In compiled output: dist/config.js -> ../../trace.config.json
  // In source: src/config.ts -> ../../trace.config.json
  const projectRoot = resolve(import.meta.dirname, '..', '..', '..');
  candidates.push(join(projectRoot, 'trace.config.json'));

  let fileConfig: Partial<TraceConfig> | null = null;
  for (const candidate of candidates) {
    fileConfig = readJsonFile(candidate);
    if (fileConfig) break;
  }

  const merged = fileConfig
    ? deepMerge(DEFAULTS as unknown as Record<string, unknown>, fileConfig as unknown as Record<string, unknown>) as unknown as TraceConfig
    : { ...DEFAULTS };

  if (process.env.TRACE_DB_PATH) merged.db.path = process.env.TRACE_DB_PATH;
  if (process.env.TRACE_PORT) merged.dashboardPort = Number(process.env.TRACE_PORT);
  if (process.env.OPENAI_MODEL) merged.openai.model = process.env.OPENAI_MODEL;
  if (process.env.OPENAI_VISION_MODEL) merged.openai.visionModel = process.env.OPENAI_VISION_MODEL;
  if (process.env.OPENAI_CHECKPOINT_MODEL) merged.openai.checkpointModel = process.env.OPENAI_CHECKPOINT_MODEL;

  return expandPaths(merged);
}

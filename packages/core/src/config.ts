import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface BrainchConfig {
  screenshotDir: string;
  screenshotExtensions: string[];
  browserHistoryPollIntervalMs: number;
  quietWindowHours: number;
  synthesisMinItems: number;
  clusteringConfidenceThreshold: number;
  resurfacingDigestWindowDays: number;
  dashboardPort: number;
  openai: {
    model: string;
    visionModel: string;
  };
  db: {
    path: string;
  };
}

const DEFAULTS: BrainchConfig = {
  screenshotDir: '~/Desktop',
  screenshotExtensions: ['.png', '.jpg', '.jpeg'],
  browserHistoryPollIntervalMs: 300_000,
  quietWindowHours: 24,
  synthesisMinItems: 2,
  clusteringConfidenceThreshold: 0.6,
  resurfacingDigestWindowDays: 7,
  dashboardPort: 3333,
  openai: {
    model: 'gpt-5.4',
    visionModel: 'gpt-5.4',
  },
  db: {
    path: '~/.brainch/brainch.sqlite',
  },
};

function expandTilde(value: string): string {
  if (value.startsWith('~/') || value === '~') {
    return join(homedir(), value.slice(2));
  }
  return value;
}

function expandPaths(config: BrainchConfig): BrainchConfig {
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

function readJsonFile(filePath: string): Partial<BrainchConfig> | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Partial<BrainchConfig>;
  } catch {
    return null;
  }
}

export function loadConfig(configPath?: string): BrainchConfig {
  const candidates: string[] = [];

  if (configPath) {
    candidates.push(resolve(configPath));
  }

  candidates.push(join(homedir(), '.brainch', 'config.json'));

  // Project root fallback: walk up from this file's location
  // In compiled output: dist/config.js -> ../../brainch.config.json
  // In source: src/config.ts -> ../../brainch.config.json
  const projectRoot = resolve(import.meta.dirname, '..', '..');
  candidates.push(join(projectRoot, 'brainch.config.json'));

  let fileConfig: Partial<BrainchConfig> | null = null;
  for (const candidate of candidates) {
    fileConfig = readJsonFile(candidate);
    if (fileConfig) break;
  }

  const merged = fileConfig
    ? deepMerge(DEFAULTS as unknown as Record<string, unknown>, fileConfig as unknown as Record<string, unknown>) as unknown as BrainchConfig
    : { ...DEFAULTS };

  return expandPaths(merged);
}

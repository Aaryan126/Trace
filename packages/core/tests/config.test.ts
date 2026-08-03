import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, type BrainchConfig } from '../src/config.js';

describe('loadConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `brainch-config-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns defaults when no config file exists', () => {
    const config = loadConfig(join(tempDir, 'nonexistent.json'));
    expect(config.dashboardPort).toBe(3333);
    expect(config.clusteringConfidenceThreshold).toBe(0.6);
    expect(config.quietWindowHours).toBe(24);
    expect(config.synthesisMinItems).toBe(2);
    expect(config.screenshotExtensions).toEqual(['.png', '.jpg', '.jpeg']);
    expect(config.openai.model).toBe('gpt-5.4');
    expect(config.openai.visionModel).toBe('gpt-5.4');
  });

  it('reads and merges a partial config file', () => {
    const partialConfig: Partial<BrainchConfig> = {
      dashboardPort: 4000,
      openai: {
        model: 'gpt-6',
        visionModel: 'gpt-6-vision',
      },
    };

    const configPath = join(tempDir, 'config.json');
    writeFileSync(configPath, JSON.stringify(partialConfig));

    const config = loadConfig(configPath);
    expect(config.dashboardPort).toBe(4000);
    expect(config.openai.model).toBe('gpt-6');
    expect(config.openai.visionModel).toBe('gpt-6-vision');
    // Defaults still present
    expect(config.quietWindowHours).toBe(24);
    expect(config.clusteringConfidenceThreshold).toBe(0.6);
  });

  it('expands tilde in screenshotDir and db.path', () => {
    const configPath = join(tempDir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({ screenshotDir: '~/Pictures', db: { path: '~/data/brainch.sqlite' } }),
    );

    const config = loadConfig(configPath);
    expect(config.screenshotDir).not.toContain('~');
    expect(config.db.path).not.toContain('~');
    expect(config.screenshotDir).toMatch(/Pictures$/);
    expect(config.db.path).toMatch(/data\/brainch\.sqlite$/);
  });

  it('uses explicit configPath over fallback locations', () => {
    const configPath = join(tempDir, 'explicit.json');
    writeFileSync(configPath, JSON.stringify({ dashboardPort: 9999 }));

    const config = loadConfig(configPath);
    expect(config.dashboardPort).toBe(9999);
  });
});

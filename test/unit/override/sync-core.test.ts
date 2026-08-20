import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashOf, payloadFileName, stagePayload, stageDist } from '../../../scripts/override/sync-core.mjs';

describe('override sync-core', () => {
  let dir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'blok-override-payload-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('hashes content deterministically to 12 hex chars', () => {
    expect(hashOf('abc')).toBe(hashOf('abc'));
    expect(hashOf('abc')).toMatch(/^[0-9a-f]{12}$/);
    expect(hashOf('abc')).not.toBe(hashOf('abd'));
  });

  it('stages the payload under a hashed name and writes current.json', () => {
    const meta = { version: '1.11.0-dev.abc1234' };
    const { file } = stagePayload(dir, 'globalThis.x=1;', meta);
    expect(file).toBe(payloadFileName(hashOf('globalThis.x=1;')));
    expect(readFileSync(join(dir, file), 'utf8')).toBe('globalThis.x=1;');
    expect(JSON.parse(readFileSync(join(dir, 'current.json'), 'utf8'))).toEqual({
      file,
      hash: hashOf('globalThis.x=1;'),
      builtAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      ...meta,
    });
  });

  // Watch mode restages on every rebuild with metadata captured when the
  // watcher STARTED — the staging moment is the only truthful build time.
  it('stamps builtAt at staging time, overriding any caller-passed value', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T15:00:00Z'));
    stagePayload(dir, 'globalThis.x=1;', { version: 'v', builtAt: '2026-08-20T00:00:00Z' });
    const current = JSON.parse(readFileSync(join(dir, 'current.json'), 'utf8'));
    expect(current.builtAt).toBe('2026-08-20T15:00:00.000Z');
    vi.useRealTimers();
  });

  it('prunes stale payloads, keeping only the current one', () => {
    const meta = { version: 'v' };
    stagePayload(dir, 'old build', meta);
    stagePayload(dir, 'new build', meta);
    const payloads = readdirSync(dir).filter((f) => f.startsWith('blok-override.'));
    expect(payloads).toEqual([payloadFileName(hashOf('new build'))]);
  });

  it('escapes Unicode noncharacters Chrome refuses in content-script files', () => {
    const meta = { version: 'v' };
    const code = 'const eof=`￿`;const probe="﷐￾";const astral="\u{1FFFE}";const keep="\u{1F3FE}é";';
    const { file } = stagePayload(dir, code, meta);
    const staged = readFileSync(join(dir, file), 'utf8');

    expect(staged).not.toMatch(/[﷐-﷯￾￿]/);
    expect(staged).toContain('\\uFFFF');
    expect(staged).toContain('\\uFDD0');
    expect(staged).toContain('\\uFFFE');
    expect(staged).toContain('\\uD83F\\uDFFE');
    expect(staged).toContain('"\u{1F3FE}é"');
    expect(file).toBe(payloadFileName(hashOf(staged)));
  });

  it('a rebuild with identical content keeps the same filename (no churn)', () => {
    const meta = { version: 'v' };
    const first = stagePayload(dir, 'same', meta);
    const second = stagePayload(dir, 'same', meta);
    expect(second.file).toBe(first.file);
  });
});

describe('override dist staging', () => {
  let payloadDir: string;
  let distDir: string;

  beforeEach(() => {
    payloadDir = mkdtempSync(join(tmpdir(), 'blok-override-payload-'));
    distDir = mkdtempSync(join(tmpdir(), 'blok-dist-'));
  });

  afterEach(() => {
    rmSync(payloadDir, { recursive: true, force: true });
    rmSync(distDir, { recursive: true, force: true });
  });

  it('copies the dist tree into payload/dist and counts the files', () => {
    writeFileSync(join(distDir, 'blok.mjs'), 'export default 1;');
    mkdirSync(join(distDir, 'chunks'));
    writeFileSync(join(distDir, 'chunks', 'en.mjs'), 'export const en = 1;');

    const result = stageDist(payloadDir, distDir);

    expect(result).toEqual({ files: 2 });
    expect(readFileSync(join(payloadDir, 'dist', 'blok.mjs'), 'utf8')).toBe('export default 1;');
    expect(readFileSync(join(payloadDir, 'dist', 'chunks', 'en.mjs'), 'utf8')).toBe('export const en = 1;');
  });

  it('replaces a previously staged dist instead of merging stale files in', () => {
    writeFileSync(join(distDir, 'old.mjs'), 'old');
    stageDist(payloadDir, distDir);
    rmSync(join(distDir, 'old.mjs'));
    writeFileSync(join(distDir, 'new.mjs'), 'new');

    stageDist(payloadDir, distDir);

    expect(existsSync(join(payloadDir, 'dist', 'old.mjs'))).toBe(false);
    expect(existsSync(join(payloadDir, 'dist', 'new.mjs'))).toBe(true);
  });

  it('returns null when the repo has no dist build to stage', () => {
    expect(stageDist(payloadDir, join(distDir, 'missing'))).toBeNull();
    expect(existsSync(join(payloadDir, 'dist'))).toBe(false);
  });
});

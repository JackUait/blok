import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashOf, payloadFileName, stagePayload } from '../../../scripts/override/sync-core.mjs';

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
    const meta = { version: '1.11.0-dev.abc1234', builtAt: '2026-08-20T00:00:00Z' };
    const { file } = stagePayload(dir, 'globalThis.x=1;', meta);
    expect(file).toBe(payloadFileName(hashOf('globalThis.x=1;')));
    expect(readFileSync(join(dir, file), 'utf8')).toBe('globalThis.x=1;');
    expect(JSON.parse(readFileSync(join(dir, 'current.json'), 'utf8'))).toEqual({ file, hash: hashOf('globalThis.x=1;'), ...meta });
  });

  it('prunes stale payloads, keeping only the current one', () => {
    const meta = { version: 'v', builtAt: 't' };
    stagePayload(dir, 'old build', meta);
    stagePayload(dir, 'new build', meta);
    const payloads = readdirSync(dir).filter((f) => f.startsWith('blok-override.'));
    expect(payloads).toEqual([payloadFileName(hashOf('new build'))]);
  });

  it('escapes Unicode noncharacters Chrome refuses in content-script files', () => {
    const meta = { version: 'v', builtAt: 't' };
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
    const meta = { version: 'v', builtAt: 't' };
    const first = stagePayload(dir, 'same', meta);
    const second = stagePayload(dir, 'same', meta);
    expect(second.file).toBe(first.file);
  });
});

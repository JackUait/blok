// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENT_SKILLS } from '../../../src/shared/skills';

const ROOT = resolve(__dirname, '../../..');

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A plain substring check would let `--authorize` stand in for `--auth`.
const mentions = (text: string, name: string): boolean => new RegExp(`(?<![\\w-])${escape(name)}(?![\\w-])`).test(text);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('@bloklabs/mcp README', () => {
  // The names come from the parser, so a flag added later fails here until it is documented.
  const config = readFileSync(resolve(ROOT, 'src/mcp/config.ts'), 'utf-8');
  const readme = readFileSync(resolve(ROOT, 'packages/mcp/README.md'), 'utf-8');
  const flags = [...new Set([...config.matchAll(/'(--[a-z][a-z-]*)'/g)].map((match) => match[1]))];
  const envs = [...new Set([...config.matchAll(/env(?:\.|\[')([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]))];

  it('finds the parser names (non-vacuity)', () => {
    expect(flags.length).toBeGreaterThan(15);
    expect(flags).toContain('--auth');
    expect(envs).toContain('BLOK_SECRET');
  });

  it('matches whole names only', () => {
    expect(mentions('use --authorize here', '--auth')).toBe(false);
    expect(mentions('use `--auth oauth`', '--auth')).toBe(true);
  });

  it.each(flags)('documents %s', (flag) => {
    expect(mentions(readme, flag)).toBe(true);
  });

  it.each(envs)('documents %s', (env) => {
    expect(mentions(readme, env)).toBe(true);
  });

  it('states how an OAuth token names its principal', () => {
    expect(readme).toMatch(/principal is the token's `sub`/);
    expect(readme).toContain('`client:<client_id>`');
  });

  it('states how to declare custom inline tools in the custom tools file', () => {
    expect(readme).toContain('`inlineTools`');
    expect(readme).toMatch(/Function rules cannot go in a JSON file/);
  });

  it('states that flag values are separate arguments and unknown flags are refused', () => {
    expect(readme).toContain('`--auth=oauth`');
    expect(readme).toMatch(/unknown flag.*refuse/i);
  });

  it.each(AGENT_SKILLS.map((skill) => skill.id))('documents the %s prompt', (id) => {
    expect(readme).toContain(`| \`${id}\` |`);
  });

  it('states the version lockstep and the Markdown rule', () => {
    expect(readme).toMatch(/@bloklabs\/core[\s\S]*@bloklabs\/server|@bloklabs\/server[\s\S]*@bloklabs\/core/);
    expect(readme).toMatch(/never.*Markdown/i);
  });
});

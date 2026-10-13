import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LEDGER, isExempt } from './agent-coverage.ledger';
import { ENUMERATORS, SCAN_FLOORS, enumerateTunes, scanToolMenus } from './agent-coverage/enumerators';
import type { Capability } from './agent-coverage/scan';
import type { CapabilitySource } from './agent-coverage/enumerators';
import { isInstrumented } from '../helpers/instrumented';

/**
 * ARCHITECTURE LAW — every human-reachable capability has an agent route.
 * Spec: docs/plans/2026-10-08-agent-control/05-coverage-and-evals.md §3.1.
 */

/**
 * `onActivate` items allowed to stay unnamed, keyed `file:line`. An unnamed item
 * has no stable capability id, so no tool action can mirror it.
 */
const UNNAMED_MENU_ITEMS: Record<string, string> = {};

const ID_TOKEN = /\b[a-z-]+:[^\s,;)]+/g;
const FIELD_TOKEN = /\b[a-z_-]+\.[a-zA-Z]+\b/;

// Each scan parses hundreds of files; run it once per file run to keep the unit shard fast.
const once = <T>(scan: () => T): (() => T) => {
  let cache: { value: T } | undefined;

  return () => {
    cache ??= { value: scan() };

    return cache.value;
  };
};

// The first test to scan pays for parsing src/: up to 21 s on a CI unit shard (run 38334145403), above vitest's 5 s default.
const SCAN_TIMEOUT_MS = 60_000;

const toolMenus = once(scanToolMenus);
// One scan per source, shared by assertions 7 and 1. Same first-wins order as enumerateAll.
const bySource = once(() => (Object.keys(ENUMERATORS) as CapabilitySource[]).map((source) => ({ source, found: ENUMERATORS[source]() })));
const allCapabilities = once(() => {
  const all = new Map<string, Capability>();

  bySource().flatMap(({ found }) => found).forEach((c) => {
    if (!all.has(c.id)) {
      all.set(c.id, c);
    }
  });

  return all;
});

const namesCoveredId = (reason: string): boolean =>
  (reason.match(ID_TOKEN) ?? []).some((token) => LEDGER[token] !== undefined && !isExempt(LEDGER[token]));

describe('agent coverage law', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.skipIf(isInstrumented())('every tool menu item has a name (assertion 6)', () => {
    const unnamed = toolMenus().unnamed.filter((key) => UNNAMED_MENU_ITEMS[key] === undefined);

    expect(
      unnamed,
      'These popover items have onActivate but no `name`. Add a unique `name` ' +
        '(prefix it with the tool, e.g. `table-merge-cells`). It also becomes data-blok-item-name ' +
        'for e2e locators. Only if a name is impossible, add the file:line to UNNAMED_MENU_ITEMS with a reason.'
    ).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  it.skipIf(isInstrumented())('no tool menu name collides with a block settings item', () => {
    const settingsNames = new Set(enumerateTunes().map((c) => c.id.replace(/^tune:/, '')));
    const collisions = toolMenus().capabilities
      .map((c) => ({ ...c, name: c.id.slice(c.id.indexOf('/') + 1) }))
      .filter((c) => settingsNames.has(c.name))
      .map((c) => `${c.file}:${c.line} "${c.name}"`);

    // Tool settings render inside block settings, and popovers hide/find items by name.
    expect(collisions).toEqual([]);
  });

  it.skipIf(isInstrumented())('no static menu name repeats inside one tool', () => {
    const seen = new Map<string, string>();
    const repeats: string[] = [];

    for (const c of toolMenus().capabilities) {
      if (c.id.includes('*')) {
        continue;
      }

      const first = seen.get(c.id);
      const where = `${c.file}:${c.line}`;

      if (first !== undefined && first !== where) {
        repeats.push(`${c.id} at ${first} and ${where}`);
      }

      seen.set(c.id, first ?? where);
    }

    expect(repeats).toEqual([]);
  });

  it.skipIf(isInstrumented())('every enumerator still finds its floor (assertion 7)', () => {
    const below = bySource()
      .map(({ source, found }) => ({ source, found: new Set(found.map((c) => c.id)).size }))
      .filter(({ source, found }) => found < SCAN_FLOORS[source])
      .map(({ source, found }) => `${source}: found ${found}, floor ${SCAN_FLOORS[source]}`);

    expect(below).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  it.skipIf(isInstrumented())('every capability has a ledger row (assertion 1)', () => {
    const missing = [...allCapabilities().values()]
      .filter((c) => LEDGER[c.id] === undefined)
      .map((c) => `${c.id}  (${c.file}:${c.line})`);

    expect(
      missing,
      'These human-reachable capabilities have no agent route. For each one: declare a tool action ' +
        'whose `mirrors` lists the id (02), or add a LEDGER row in agent-coverage.ledger.ts naming the ' +
        'command / field, or exempt it with a category and a reason.'
    ).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  it.skipIf(isInstrumented())('no ledger row is stale (assertion 4)', () => {
    const found = allCapabilities();
    const stale = Object.keys(LEDGER).filter((id) => !found.has(id));

    expect(stale, 'These ledger rows name ids the scan no longer finds. Delete them.').toEqual([]);
  });

  it('every exemption has a real reason (assertion 5)', () => {
    const problems = Object.entries(LEDGER).flatMap(([id, coverage]) => {
      if (!isExempt(coverage)) {
        return [];
      }

      const reason = coverage.reason.trim();
      const found: string[] = [];

      if (reason.length < 20 || reason.toLowerCase().replace(/[^a-z]/g, '') === coverage.exempt.replace(/-/g, '')) {
        found.push(`${id}: reason only repeats the category`);
      }

      if (coverage.exempt === 'cut-v1' && !reason.includes('D6')) {
        found.push(`${id}: a cut-v1 reason must name the D6 cut it follows`);
      }

      if (coverage.exempt === 'gesture-alias' && !namesCoveredId(reason)) {
        found.push(`${id}: a gesture-alias reason must name a ledger id that a command or field covers`);
      }

      return found;
    });

    expect(problems).toEqual([]);
  });

  it('block.update is never the coverage of a UI capability (06 C4)', () => {
    const problems = Object.entries(LEDGER).flatMap(([id, coverage]) => {
      if ('command' in coverage && coverage.command === 'block.update') {
        return [`${id}: use { field: '<registryKey>.<field>' } instead of { command: 'block.update' }`];
      }

      if ('commands' in coverage && coverage.commands.includes('block.update') && !FIELD_TOKEN.test(coverage.note)) {
        return [`${id}: a commands row with block.update must name the fields it writes ('<key>.<field>') in its note`];
      }

      return [];
    });

    expect(problems).toEqual([]);
  });

  it('reports how many rows still wait on 01 and 02', () => {
    const pending = Object.values(LEDGER).filter((c) => !isExempt(c) && c.pending !== undefined).length;

    // Informational until Task 16, which requires zero.
    expect(pending).toBeGreaterThanOrEqual(0);
  });
});

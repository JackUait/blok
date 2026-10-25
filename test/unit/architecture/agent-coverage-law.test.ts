import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentContract } from '../../../types/tool-manifest';
import { nodeContract } from '../agent/harness';
import { loadParityCases } from '../agent/parity/corpus';
import { LEDGER, isExempt } from './agent-coverage.ledger';
import type { Coverage } from './agent-coverage.ledger';
import { ENUMERATORS, HAND_FEATURES, SCAN_FLOORS, enumerateTunes, featureAnchorProblems, scanToolMenus } from './agent-coverage/enumerators';
import { KNOWN_GAPS } from './agent-coverage/probes';
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

/** Commands that are not a single-document parity case, each with the spec line that says so. */
const UNCORPUSED_COMMANDS: Record<string, string> = {
  'page.rename': 'Headless form writes another document; one document per case cannot hold it (05 §3.2.1). 01 and 04 test it.',
  'page.setIcon': 'Headless form writes another document; one document per case cannot hold it (05 §3.2.1). 01 and 04 test it.',
  // A case needs a versionHistory fixture in every runner (json, store, editor, Jint, room), and a golden only the user reviews.
  'history.versions': 'No corpus runner has a versionHistory fixture yet. The version-history tests cover node, editor, MCP live and C#.',
  'history.read': 'No corpus runner has a versionHistory fixture yet. The version-history tests cover node, editor, MCP live and C#.',
  'history.changes': 'No corpus runner has a versionHistory fixture yet. The version-history tests cover node, editor, MCP live and C#.',
  // A golden counts only once the user reviews it; until then these sessions test them on every runtime.
  'database.updateView': 'Corpus case proposed, awaiting user review. test/unit/shared/agent/database-view-settings.test.ts runs it on the json and store sessions.',
  'database.setLayout': 'Corpus case proposed, awaiting user review. test/unit/shared/agent/database-view-settings.test.ts runs it on the json and store sessions.',
  'database.setLock': 'Corpus case proposed, awaiting user review. test/unit/shared/agent/database-view-settings.test.ts runs it on the json and store sessions.',
};

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

const contract = nodeContract('node');

/** Capability id → the action command whose `mirrors` lists it (06 05-Q7). */
const mirroredIds = (c: AgentContract): Map<string, string> =>
  new Map(c.manifest.blocks.flatMap((b) => b.actions.flatMap((a) => (a.mirrors ?? []).map((id): [string, string] => [id, a.command]))));

const mirrored = mirroredIds(contract);

const routeNames = (coverage: Coverage): string[] => {
  if ('command' in coverage) {
    return [coverage.command];
  }

  return 'commands' in coverage ? coverage.commands : [];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const fieldProblem = (field: string): string | null => {
  const [key, name] = field.split('.');
  const entry = contract.manifest.blocks.find((b) => b.name === key);

  if (entry === undefined) {
    return `no manifest entry "${key}"`;
  }

  const properties = isRecord(entry.data.properties) ? entry.data.properties : {};

  if (!(name in properties)) {
    return `"${name}" is not a property of ${key}'s data schema`;
  }

  if (entry.viewState.includes(name)) {
    return `"${name}" is view-state on ${key}`;
  }

  return name in entry.guardedFields ? `"${name}" is guarded on ${key}; use ${entry.guardedFields[name]}` : null;
};

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
      .filter((c) => LEDGER[c.id] === undefined && !mirrored.has(c.id))
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
    const stale = Object.keys(LEDGER).filter((id) => !found.has(id) || mirrored.has(id));

    expect(stale, 'These ledger rows name ids the scan no longer finds, or an action already mirrors. Delete them.').toEqual([]);
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

  it('no ledger row waits on 01 or 02 any more', () => {
    const pending = Object.entries(LEDGER).flatMap(([id, c]) =>
      !isExempt(c) && c.pending !== undefined ? [`${id} (${c.pending})`] : []);

    expect(pending).toEqual([]);
  });

  it('every contract command is reached by at least one parity case', () => {
    const used = new Set(loadParityCases().flatMap((c) => c.batches.flatMap((b) => b.commands.map((x) => x.name))));
    const unreached = contract.commands
      .map((c) => c.name)
      .filter((name) => !used.has(name) && UNCORPUSED_COMMANDS[name] === undefined);

    expect(
      unreached,
      'Add a case under test/fixtures/agent-commands/cases/ for each command, and its golden.'
    ).toEqual([]);
  });

  it.skipIf(isInstrumented())('every named command exists, and pending markers are dropped once it does (assertion 2)', () => {
    const known = new Set<string>(contract.commands.map((c) => c.name));
    const problems = Object.entries(LEDGER).flatMap(([id, coverage]) => {
      if (isExempt(coverage)) {
        return [];
      }

      const missing = routeNames(coverage).filter((name) => !known.has(name));

      if (coverage.pending === undefined && missing.length > 0) {
        return [`${id}: unknown command(s) ${missing.join(', ')}`];
      }

      return coverage.pending !== undefined && missing.length === 0 && !('field' in coverage)
        ? [`${id}: every command now exists; drop pending: '${coverage.pending}'`]
        : [];
    });
    const staleMirrors = [...mirrored]
      .filter(([id]) => !allCapabilities().has(id))
      .map(([id, command]) => `${command} mirrors "${id}", which the scan no longer finds`);

    expect([...problems, ...staleMirrors]).toEqual([]);
  });

  it('field rows are real field writes (assertion 3)', () => {
    const problems = Object.entries(LEDGER).flatMap(([id, coverage]) => {
      if (!('field' in coverage)) {
        return [];
      }

      const problem = fieldProblem(coverage.field);

      if (KNOWN_GAPS[id] !== undefined) {
        return problem === null ? [`${id}: ${coverage.field} is now a valid field write; drop it from KNOWN_GAPS`] : [];
      }

      if (coverage.pending === undefined && problem !== null) {
        return [`${id}: ${coverage.field}: ${problem}`];
      }

      return coverage.pending !== undefined && problem === null
        ? [`${id}: ${coverage.field} is now a valid field write; drop pending`]
        : [];
    });

    expect(problems).toEqual([]);
  });

  it('every hand feature anchor still names an export of its file', () => {
    expect(featureAnchorProblems(HAND_FEATURES)).toEqual([]);
  });
});

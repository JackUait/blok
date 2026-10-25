// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildBuiltInSnapshot } from '../../../src/shared/built-in-snapshot';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../src/shared/tool-actions';
import { buildToolManifest } from '../../../src/shared/tool-manifest';
import { openJsonSession } from '../agent/harness';

/**
 * `requires` makes a command unavailable without the service, so it must be true:
 * run each such action with the service declared but absent, and it must fail.
 * One that still works (falls back) declares `uses` instead.
 */

const ARGS: Record<string, Record<string, unknown>> = {
  'page.rename': { title: 'Renamed' },
  'page.setIcon': { icon: null },
  'bookmark.create': { url: 'https://example.com/' },
};

/** Data for the block a `target: 'block'` action acts on. */
const TARGET_DATA: Record<string, Record<string, unknown>> = {
  page: { pageId: 'page-1' },
};

const manifest = buildToolManifest(buildBuiltInSnapshot({ blokVersion: 'test' }));
const requiring = manifest.blocks.flatMap(block => block.actions
  .filter(action => (action.requires?.length ?? 0) > 0 && Object.hasOwn(BUILT_IN_TOOL_RUNTIMES.get(block.name)?.actions ?? {}, action.name))
  .map(action => ({ tool: block.name, command: action.command, target: action.target, requires: action.requires ?? [] })));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('an action that requires a service fails without it', () => {
  it('finds actions to check', () => {
    expect(requiring.length).toBeGreaterThan(0);
  });

  it.each(requiring)('$command (requires $requires)', async ({ tool, command, target, requires }) => {
    const args = ARGS[command];

    expect(args, `add ${command} to ARGS`).toBeDefined();
    const seed = target === 'block'
      ? { blocks: [{ id: 'target', type: tool, data: TARGET_DATA[tool] ?? {} }] }
      : { blocks: [] };
    const session = openJsonSession(seed, undefined, { names: requires, impl: {} });

    try {
      const result = await session.execute({ commands: [{
        name: command,
        args: { ...args, ...(target === 'block' ? { id: 'target' } : { position: 'end' }) },
      }] });

      expect(result.ok, `${command} works without ${requires.join(', ')}: declare it as uses, not requires`).toBe(false);
    } finally {
      await session.close();
    }
  });
});

describe('bookmark.create in a headless session', () => {
  const create = { name: 'bookmark.create', args: { url: 'https://example.com/', position: 'end' } };

  it('is available without linkMetadata and stores just the url', async () => {
    const session = openJsonSession({ blocks: [] });

    try {
      const result = await session.execute({ commands: [create] });

      expect(result.ok && result.blocks?.map(block => block.data)).toEqual([{ url: 'https://example.com/' }]);
    } finally {
      await session.close();
    }
  });

  it('fills the preview when the service is present', async () => {
    const fetch = vi.fn(async (url: string) => ({ url, title: 'Example' }));
    const session = openJsonSession({ blocks: [] }, undefined, { names: ['linkMetadata'], impl: { linkMetadata: { fetch } } });

    try {
      const result = await session.execute({ commands: [create] });

      expect(result.ok && result.blocks?.map(block => block.data)).toEqual([{ url: 'https://example.com/', title: 'Example' }]);
      expect(fetch).toHaveBeenCalledWith('https://example.com/');
    } finally {
      await session.close();
    }
  });
});

/**
 * Reactive inline-toolbar contract (core phase):
 *
 * 1. `assignInlineToolsToBlockTool` must be idempotent — re-running it after a
 *    config change must leave a correct (possibly empty) collection. The old
 *    implementation early-returned on `inlineToolbar === false` and skipped
 *    opt-out tools, which was only safe against a fresh, empty collection.
 * 2. `tools.setInlineToolbar(config)` re-runs assignment for every block tool
 *    AND invalidates the adapters' memoized sanitize configs, so the paste
 *    path (which reads `adapter.baseSanitizeConfig`) never composes against a
 *    stale inline-tool set.
 * 3. `tools.isInstalled(name)` — public introspection over Tools.available.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { BoldInlineTool } from '../../../../src/components/inline-tools/inline-tool-bold';
import { ItalicInlineTool } from '../../../../src/components/inline-tools/inline-tool-italic';
import { LinkInlineTool } from '../../../../src/components/inline-tools/inline-tool-link';
import { Header } from '../../../../src/tools/header';
import { Paragraph } from '../../../../src/tools/paragraph';

import type { BlokConfig } from '../../../../types';

/**
 * Minimal replica of Blok.destroy()'s module teardown so a Core booted
 * directly (to reach moduleInstances) does not leak listeners between tests.
 * @param core - booted core instance
 */
const destroyCore = (core: Core): void => {
  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    if (moduleInstance === undefined || moduleInstance === null) {
      return;
    }

    const instance = moduleInstance as { markDestroyed?: () => void };

    if (typeof instance.markDestroyed === 'function') {
      instance.markDestroyed();
    }
  });

  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    if (moduleInstance === undefined || moduleInstance === null) {
      return;
    }

    const instance = moduleInstance as {
      destroy?: () => void;
      listeners?: { removeAll?: () => void };
    };

    if (typeof instance.destroy === 'function') {
      instance.destroy();
    }

    if (instance.listeners && typeof instance.listeners.removeAll === 'function') {
      instance.listeners.removeAll();
    }
  });
};

const TOOLS: BlokConfig['tools'] = {
  paragraph: {
    class: Paragraph,
    inlineToolbar: true,
  },
  header: {
    class: Header,
    inlineToolbar: [ 'bold' ],
  },
  plain: {
    class: Header,
    inlineToolbar: false,
  },
  bold: { class: BoldInlineTool },
  italic: { class: ItalicInlineTool },
  link: { class: LinkInlineTool },
};

describe('Tools inline-toolbar reactivity', () => {
  let holder: HTMLDivElement | undefined;
  let core: Core | undefined;

  const boot = async (configOverrides: Partial<BlokConfig> = {}): Promise<Core> => {
    core = new Core({
      holder,
      tools: TOOLS,
      ...configOverrides,
    });
    await core.isReady;

    return core;
  };

  const inlineToolKeys = (booted: Core, toolName: string): string[] => {
    const adapter = booted.moduleInstances.Tools.blockTools.get(toolName);

    if (adapter === undefined) {
      throw new Error(`Block tool "${toolName}" is not available`);
    }

    return Array.from(adapter.inlineTools.keys());
  };

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    if (core) {
      destroyCore(core);
    }
    core = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  describe('first-run equivalence (construction behavior unchanged)', () => {
    it('assigns the default inline set to a tool with inlineToolbar: true', async () => {
      const booted = await boot();

      expect(inlineToolKeys(booted, 'paragraph')).toEqual(['convertTo', 'bold', 'italic', 'link']);
    });

    it('assigns the tool-scoped subset to a tool with an inlineToolbar array', async () => {
      const booted = await boot();

      expect(inlineToolKeys(booted, 'header')).toEqual(['convertTo', 'bold']);
    });

    it('leaves the collection empty for an opt-out tool', async () => {
      const booted = await boot();

      expect(inlineToolKeys(booted, 'plain')).toEqual([]);
    });

    it('leaves every collection empty when the global inlineToolbar is false', async () => {
      const booted = await boot({ inlineToolbar: false });

      expect(inlineToolKeys(booted, 'paragraph')).toEqual([]);
      expect(inlineToolKeys(booted, 'header')).toEqual([]);
    });
  });

  describe('setInlineToolbar', () => {
    it('clears previously-assigned inline tools when set to false (idempotency regression)', async () => {
      const booted = await boot();

      expect(inlineToolKeys(booted, 'paragraph')).not.toEqual([]);

      booted.moduleInstances.Tools.setInlineToolbar(false);

      expect(inlineToolKeys(booted, 'paragraph')).toEqual([]);
      expect(inlineToolKeys(booted, 'header')).toEqual([]);
    });

    it('drops stale entries when reduced to a subset (idempotency regression)', async () => {
      const booted = await boot();

      booted.moduleInstances.Tools.setInlineToolbar([ 'bold' ]);

      /** Same shape a construction-time global array produces: exactly the named tools */
      expect(inlineToolKeys(booted, 'paragraph')).toEqual([ 'bold' ]);
    });

    it('restores the full default set when re-enabled with true', async () => {
      const booted = await boot();

      booted.moduleInstances.Tools.setInlineToolbar(false);
      booted.moduleInstances.Tools.setInlineToolbar(true);

      expect(inlineToolKeys(booted, 'paragraph')).toEqual(['convertTo', 'bold', 'italic', 'link']);
    });

    it('keeps opt-out tools empty regardless of the new global config', async () => {
      const booted = await boot();

      booted.moduleInstances.Tools.setInlineToolbar([ 'bold', 'italic' ]);

      expect(inlineToolKeys(booted, 'plain')).toEqual([]);
    });

    it('keeps tool-scoped arrays authoritative over the new global config', async () => {
      const booted = await boot();

      booted.moduleInstances.Tools.setInlineToolbar([ 'bold', 'italic', 'link' ]);

      expect(inlineToolKeys(booted, 'header')).toEqual(['convertTo', 'bold']);
    });

    it('writes the new value into config.inlineToolbar', async () => {
      const booted = await boot();

      booted.moduleInstances.Tools.setInlineToolbar([ 'bold' ]);

      expect(booted.configuration.inlineToolbar).toEqual([ 'bold' ]);
    });

    it('invalidates the memoized baseSanitizeConfig the paste path reads', async () => {
      const booted = await boot();
      const paragraphAdapter = booted.moduleInstances.Tools.blockTools.get('paragraph');

      expect(paragraphAdapter).toBeDefined();

      /** Prime the memoized caches, as a real paste would */
      expect(paragraphAdapter?.baseSanitizeConfig).toHaveProperty('a');
      expect(paragraphAdapter?.sanitizeConfig).toBeDefined();

      booted.moduleInstances.Tools.setInlineToolbar([ 'bold' ]);

      expect(paragraphAdapter?.baseSanitizeConfig).not.toHaveProperty('a');
      expect(paragraphAdapter?.baseSanitizeConfig).toHaveProperty('b');
    });

    it('drops the memoized sanitizeConfig so it is recomposed on next access', async () => {
      const booted = await boot();
      const paragraphAdapter = booted.moduleInstances.Tools.blockTools.get('paragraph');

      /** Prime the cache — repeated access returns the same memoized object */
      const before = paragraphAdapter?.sanitizeConfig;

      expect(paragraphAdapter?.sanitizeConfig).toBe(before);

      booted.moduleInstances.Tools.setInlineToolbar([ 'bold' ]);

      const after = paragraphAdapter?.sanitizeConfig;

      /** A fresh composition proves the cache was invalidated */
      expect(after).not.toBe(before);
      /** ...and it is composed against the reduced inline set */
      expect(paragraphAdapter?.baseSanitizeConfig).toHaveProperty('b');
      expect(paragraphAdapter?.baseSanitizeConfig).not.toHaveProperty('a');
    });

    it('is exposed on the public tools API', async () => {
      const booted = await boot();
      const toolsApi = booted.moduleInstances.API.methods.tools;

      toolsApi.setInlineToolbar([ 'bold' ]);

      expect(inlineToolKeys(booted, 'paragraph')).toEqual([ 'bold' ]);
    });
  });

  describe('isInstalled', () => {
    it('returns true for an installed tool and false otherwise', async () => {
      const booted = await boot();
      const toolsApi = booted.moduleInstances.API.methods.tools;

      expect(toolsApi.isInstalled('paragraph')).toBe(true);
      expect(toolsApi.isInstalled('bold')).toBe(true);
      expect(toolsApi.isInstalled('nonexistent')).toBe(false);
    });
  });
});

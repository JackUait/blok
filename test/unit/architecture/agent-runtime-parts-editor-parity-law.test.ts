import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../src/components/core';
import { runtimesFromTools } from '../../../src/components/tools/registry-snapshot';
import { destroy as destroyTooltip } from '../../../src/components/utils/tooltip';
import { BUILT_IN_RUNTIME_PARTS, BUILT_IN_TOOL_RUNTIMES } from '../../../src/shared/tool-actions';
import { builtInEditorTools } from '../shared/tool-descriptions/built-in-tools';

/**
 * ARCHITECTURE LAW — the in-editor agent runs the same tool checks as the headless one.
 *
 * Headless runtimes come from BUILT_IN_TOOL_RUNTIMES by name. The editor builds its own in
 * runtimesFromTools (src/components/tools/registry-snapshot.ts), by the RUNTIME_PARTS_OWNER brand on
 * the tool class (src/components/tools/runtime-parts-owner.ts). A missing brand or a part missing
 * there passes every headless test while Ask AI in the editor skips it: that is how the embed
 * write check first shipped headless-only. Every part of every built-in tool must reach the
 * editor as the same object.
 */

const PART_KEYS = ['normalize', 'cleared', 'rejectWrite', 'defaultChildren', 'conversion', 'childCommand'] as const;

const destroyCore = (core: Core): void => {
  const modules: unknown[] = Object.values(core.moduleInstances);

  for (const module of modules) {
    if (typeof module === 'object' && module !== null && 'markDestroyed' in module && typeof module.markDestroyed === 'function') {
      module.markDestroyed();
    }
  }
  for (const module of modules) {
    if (typeof module === 'object' && module !== null && 'destroy' in module && typeof module.destroy === 'function') {
      module.destroy();
    }
  }
  destroyTooltip();
};

describe('agent runtime parts editor parity law', () => {
  let holder: HTMLDivElement;
  let core: Core | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    try {
      if (core !== undefined) {
        await core.isReady.catch(() => undefined);
        destroyCore(core);
      }
    } finally {
      holder.remove();
      core = undefined;
      vi.restoreAllMocks();
    }
  });

  it('gives every built-in tool its runtime parts in the editor, as the same objects', async () => {
    core = new Core({ holder, tools: builtInEditorTools() });
    await core.isReady;

    const editor = runtimesFromTools(core.moduleInstances.Tools);
    const missing = Object.entries(BUILT_IN_RUNTIME_PARTS).flatMap(([name, parts]) => PART_KEYS
      .filter(key => parts[key] !== undefined)
      .filter(key => BUILT_IN_TOOL_RUNTIMES.get(name)?.[key] !== parts[key] || editor.get(name)?.[key] !== parts[key])
      .map(key => `${name}.${key}`));

    expect(missing, 'Wire these parts in runtimesFromTools (registry-snapshot.ts).').toEqual([]);
  }, 60_000);
});

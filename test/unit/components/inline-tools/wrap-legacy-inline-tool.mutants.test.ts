import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { wrapLegacyInlineTool } from '../../../../src/components/inline-tools/wrap-legacy-inline-tool';
import type { API, ToolConfig } from '../../../../types';
import type { PopoverItemChildren, PopoverItemDefaultBaseParams } from '../../../../types/utils/popover';

/**
 * Mutant sweep for src/components/inline-tools/wrap-legacy-inline-tool.ts.
 *
 * Every mutant on the live list is killed here; no survivor remains, so there is
 * no equivalence proof to record.
 *
 * What made the survivors observable:
 * - Fakes that OMIT an optional legacy method. Each surviving guard is a
 *   "typeof x === function" check, and it is only observable when the method is
 *   genuinely absent, so the mutated guard dereferences undefined.
 * - Calling the produced callbacks directly rather than through a DOM event, so
 *   a mutant throw reaches the test instead of jsdom window error handling.
 * - A stubbed window.getSelection returning a selection whose rangeCount is 0
 *   but whose getRangeAt still yields a Range. That turns the empty-selection
 *   guard into a positive, counted observation: the mutants reach surround and
 *   bump a counter instead of merely throwing.
 * - Parameters of wrapLegacyInlineTool as the constructor type, so a fake that
 *   lacks render can be passed without loosening the published contract.
 */

type LegacyToolConstructable = Parameters<typeof wrapLegacyInlineTool>[0];

const fakeApi = {} as API;
const fakeConfig = { placeholder: 'x' } as ToolConfig;

/** Legacy tool exposing render only — no surround, no checkState, no clear. */
class RenderOnlyTool {
  public render(): HTMLElement {
    return document.createElement('button');
  }
}

/** Legacy tool that records how many times surround was reached. */
class CountingSurroundTool {
  public surroundCount = 0;
  public lastRange: Range | null = null;

  public render(): HTMLElement {
    return document.createElement('button');
  }

  public surround(range: Range): void {
    this.surroundCount += 1;
    this.lastRange = range;
  }
}

/** Legacy tool with a secondary actions UI but no clear() reset hook. */
class ActionsWithoutClearTool {
  public render(): HTMLElement {
    return document.createElement('button');
  }

  public renderActions(): HTMLElement {
    return document.createElement('div');
  }
}

/**
 * A legacy tool whose render is missing at runtime. Real Editor.js tools always
 * ship one, so the guard is only reachable through a fake like this.
 */
class NoRenderAtAllTool {
  public label = 'no-render';
}

const NoRenderTool = NoRenderAtAllTool as unknown as LegacyToolConstructable;

const hasChildren = (
  config: PopoverItemDefaultBaseParams | { children: PopoverItemChildren }
): config is { children: PopoverItemChildren } => 'children' in config;

const activate = (config: PopoverItemDefaultBaseParams): void => {
  const { onActivate } = config;

  if (typeof onActivate !== 'function') {
    throw new Error('the rendered config carries no onActivate');
  }

  onActivate(config);
};

const legacyOf = <T>(instance: unknown): T => (instance as { legacyInstance: T }).legacyInstance;

/**
 * A selection that reports no ranges yet still answers getRangeAt.
 * Removing the guard then reaches surround instead of throwing, which makes the
 * mutants countable rather than merely noisy.
 */
const stubEmptySelection = (): Range => {
  const range = document.createRange();
  const selection = {
    rangeCount: 0,
    getRangeAt: (): Range => range,
  } as unknown as Selection;

  vi.spyOn(window, 'getSelection').mockReturnValue(selection);

  return range;
};

describe('wrapLegacyInlineTool mutants', () => {
  let editable: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    editable = document.createElement('div');
    editable.contentEditable = 'true';
    editable.textContent = 'hello world';
    document.body.appendChild(editable);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  const selectEditableText = (): void => {
    const range = document.createRange();

    range.selectNodeContents(editable);

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  it('does not call render on a legacy tool that has none', () => {
    const Wrapped = wrapLegacyInlineTool(NoRenderTool);
    const instance = new Wrapped({ api: fakeApi,
      config: fakeConfig });

    const config = instance.render() as PopoverItemDefaultBaseParams;

    expect(config.icon).toBe('');
    expect(config.name).toBe('norenderatalltool');
  });

  it('does not call surround on a legacy tool that has none, even with a live selection', () => {
    const Wrapped = wrapLegacyInlineTool(RenderOnlyTool);
    const instance = new Wrapped({ api: fakeApi,
      config: fakeConfig });
    const config = instance.render() as PopoverItemDefaultBaseParams;

    selectEditableText();

    const selection = window.getSelection();

    expect(selection?.rangeCount).toBe(1);
    expect(() => activate(config)).not.toThrow();
  });

  it('leaves surround untouched when the selection reports no ranges', () => {
    const Wrapped = wrapLegacyInlineTool(CountingSurroundTool);
    const instance = new Wrapped({ api: fakeApi,
      config: fakeConfig });
    const config = instance.render() as PopoverItemDefaultBaseParams;

    stubEmptySelection();

    activate(config);

    const legacy = legacyOf<CountingSurroundTool>(instance);

    expect(legacy.surroundCount).toBe(0);
    expect(legacy.lastRange).toBeNull();
  });

  it('calls surround exactly once with the first range when the selection has one', () => {
    const Wrapped = wrapLegacyInlineTool(CountingSurroundTool);
    const instance = new Wrapped({ api: fakeApi,
      config: fakeConfig });
    const config = instance.render() as PopoverItemDefaultBaseParams;

    selectEditableText();

    activate(config);

    const legacy = legacyOf<CountingSurroundTool>(instance);

    expect(legacy.surroundCount).toBe(1);
    expect(legacy.lastRange?.toString()).toBe('hello world');
  });

  it('does not call clear on a legacy tool that has renderActions but no clear', () => {
    const Wrapped = wrapLegacyInlineTool(ActionsWithoutClearTool);
    const instance = new Wrapped({ api: fakeApi,
      config: fakeConfig });
    const config = instance.render() as PopoverItemDefaultBaseParams | { children: PopoverItemChildren };

    expect(hasChildren(config)).toBe(true);

    if (!hasChildren(config)) {
      return;
    }

    const { onClose } = config.children;

    expect(typeof onClose).toBe('function');
    expect(() => onClose?.()).not.toThrow();
  });
});

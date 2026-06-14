import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { wrapLegacyInlineTool } from '../../../../src/components/inline-tools/wrap-legacy-inline-tool';
import type { API, SanitizerConfig, ToolConfig } from '../../../../types';
import type { PopoverItemDefaultBaseParams, PopoverItemChildren, PopoverItemHtmlParams } from '../../../../types/utils/popover';
import { PopoverItemType } from '../../../../src/components/utils/popover';

/**
 * Minimal fake Editor.js-style inline tool.
 * Mirrors the legacy contract: render() -> HTMLElement, surround(range), checkState(selection).
 */
const ICON_MARKUP = '<svg data-icon="fake"></svg>';

interface FakeConstructorArgs {
  api: API;
  config?: ToolConfig;
}

class FakeLegacyTool {
  public static isInline = true;
  public static title = 'My Fake';
  public static shortcut = 'CMD+M';
  public static get sanitize(): SanitizerConfig {
    return { mark: {} } as SanitizerConfig;
  }

  public receivedArgs: FakeConstructorArgs;
  public surroundedRange: Range | null = null;
  public checkStateFlag = false;
  public renderCallCount = 0;

  constructor(args: FakeConstructorArgs) {
    this.receivedArgs = args;
  }

  public render(): HTMLElement {
    this.renderCallCount += 1;
    const button = document.createElement('button');

    button.innerHTML = ICON_MARKUP;

    return button;
  }

  public surround(range: Range): void {
    this.surroundedRange = range;
  }

  public checkState(): boolean {
    return this.checkStateFlag;
  }
}

/**
 * Legacy tool without checkState, surround, or static metadata.
 */
class MinimalLegacyTool {
  public render(): HTMLElement {
    return document.createElement('button');
  }
}

/**
 * Legacy tool exposing a secondary actions UI via renderActions() and a clear() reset hook.
 * Mirrors the Editor.js link-tool contract.
 */
const ACTIONS_TESTID = 'fake-legacy-actions';

class ActionsLegacyTool {
  public static title = 'With Actions';

  public clearCallCount = 0;
  private readonly actionsElement: HTMLElement;

  constructor() {
    this.actionsElement = document.createElement('div');
    this.actionsElement.setAttribute('data-testid', ACTIONS_TESTID);
    const input = document.createElement('input');

    this.actionsElement.appendChild(input);
  }

  public render(): HTMLElement {
    return document.createElement('button');
  }

  public renderActions(): HTMLElement {
    return this.actionsElement;
  }

  public clear(): void {
    this.clearCallCount += 1;
  }
}

/**
 * Type guard narrowing a MenuConfig item to one that carries a `children` block.
 */
const hasChildren = (
  config: PopoverItemDefaultBaseParams | { children: PopoverItemChildren }
): config is { children: PopoverItemChildren } => 'children' in config;

const fakeApi = {} as API;
const fakeConfig = { placeholder: 'x' } as ToolConfig;

describe('wrapLegacyInlineTool', () => {
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
    document.body.innerHTML = '';
  });

  /**
   * Set a real selection over the editable's text content.
   */
  const selectEditableText = (): Range => {
    const range = document.createRange();

    range.selectNodeContents(editable);

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);

    return range;
  };

  it('returns a constructable class that accepts {api, config}', () => {
    const Wrapped = wrapLegacyInlineTool(FakeLegacyTool);

    expect(typeof Wrapped).toBe('function');

    const instance = new Wrapped({ api: fakeApi, config: fakeConfig });

    expect(instance).toBeDefined();
  });

  it('render() returns a plain MenuConfig object (not an HTMLElement) with the legacy icon and callbacks', () => {
    const Wrapped = wrapLegacyInlineTool(FakeLegacyTool);
    const instance = new Wrapped({ api: fakeApi, config: fakeConfig });

    const config = instance.render() as PopoverItemDefaultBaseParams;

    expect(config).not.toBeInstanceOf(HTMLElement);
    expect(typeof config).toBe('object');
    expect(config.icon).toBe(ICON_MARKUP);
    expect(config.name).toBe('my fake');
    expect(config.onActivate).toBeInstanceOf(Function);
    expect(config.isActive).toBeInstanceOf(Function);
    expect(config.title).toBe('My Fake');
  });

  it('onActivate() calls the legacy surround with the current selection range', () => {
    const Wrapped = wrapLegacyInlineTool(FakeLegacyTool);
    const instance = new Wrapped({ api: fakeApi, config: fakeConfig });
    const config = instance.render() as PopoverItemDefaultBaseParams;

    const range = selectEditableText();

    if (typeof config.onActivate === 'function') {
      config.onActivate(config);
    }

    const legacy = (instance as unknown as { legacyInstance: FakeLegacyTool }).legacyInstance;

    expect(legacy.surroundedRange).not.toBeNull();
    expect(legacy.surroundedRange?.toString()).toBe(range.toString());
  });

  it('isActive() reflects the legacy checkState return value', () => {
    const Wrapped = wrapLegacyInlineTool(FakeLegacyTool);
    const instance = new Wrapped({ api: fakeApi, config: fakeConfig });
    const config = instance.render() as PopoverItemDefaultBaseParams;

    selectEditableText();

    const legacy = (instance as unknown as { legacyInstance: FakeLegacyTool }).legacyInstance;

    legacy.checkStateFlag = true;
    expect(typeof config.isActive === 'function' && config.isActive()).toBe(true);

    legacy.checkStateFlag = false;
    expect(typeof config.isActive === 'function' && config.isActive()).toBe(false);
  });

  it('isActive() returns false and does not throw when the legacy tool has no checkState', () => {
    const Wrapped = wrapLegacyInlineTool(MinimalLegacyTool);
    const instance = new Wrapped({ api: fakeApi, config: fakeConfig });
    const config = instance.render() as PopoverItemDefaultBaseParams;

    selectEditableText();

    expect(() => (typeof config.isActive === 'function' ? config.isActive() : false)).not.toThrow();
    expect(typeof config.isActive === 'function' && config.isActive()).toBe(false);
  });

  it('onActivate() does not throw when the legacy tool has no surround or there is no selection', () => {
    const Wrapped = wrapLegacyInlineTool(MinimalLegacyTool);
    const instance = new Wrapped({ api: fakeApi, config: fakeConfig });
    const config = instance.render() as PopoverItemDefaultBaseParams;

    window.getSelection()?.removeAllRanges();

    expect(() => {
      if (typeof config.onActivate === 'function') {
        config.onActivate(config);
      }
    }).not.toThrow();
  });

  it('falls back to the lowercased class name when no static title is present', () => {
    const Wrapped = wrapLegacyInlineTool(MinimalLegacyTool);
    const instance = new Wrapped({ api: fakeApi, config: fakeConfig });
    const config = instance.render() as PopoverItemDefaultBaseParams;

    expect(config.name).toBe('minimallegacytool');
  });

  it('forwards static shortcut, title, sanitize, and isInline onto the wrapped class', () => {
    const Wrapped = wrapLegacyInlineTool(FakeLegacyTool);

    expect(Wrapped.isInline).toBe(true);
    expect(Wrapped.shortcut).toBe('CMD+M');
    expect(Wrapped.title).toBe('My Fake');
    expect(Wrapped.sanitize).toStrictEqual({ mark: {} });
  });

  it('falls back to an empty icon when legacy render() does not return an element', () => {
    class NoElementTool {
      public render(): null {
        return null;
      }
    }

    const Wrapped = wrapLegacyInlineTool(NoElementTool);
    const instance = new Wrapped({ api: fakeApi, config: fakeConfig });
    const config = instance.render() as PopoverItemDefaultBaseParams;

    expect(config.icon).toBe('');
  });

  it('surfaces the legacy renderActions() element through children as an Html popover item', () => {
    const Wrapped = wrapLegacyInlineTool(ActionsLegacyTool);
    const instance = new Wrapped({ api: fakeApi, config: fakeConfig });
    const config = instance.render() as PopoverItemDefaultBaseParams | { children: PopoverItemChildren };

    expect(hasChildren(config)).toBe(true);

    if (!hasChildren(config)) {
      return;
    }

    const { children } = config;

    expect(children.hideChevron).toBe(true);
    expect(Array.isArray(children.items)).toBe(true);

    const [htmlItem] = children.items ?? [];

    expect(htmlItem).toBeDefined();
    expect((htmlItem as PopoverItemHtmlParams).type).toBe(PopoverItemType.Html);

    const element = (htmlItem as PopoverItemHtmlParams).element;

    expect(element).toBeInstanceOf(HTMLElement);
    expect(element.getAttribute('data-testid')).toBe(ACTIONS_TESTID);
  });

  it('invokes the legacy clear() through the children onClose hook', () => {
    const Wrapped = wrapLegacyInlineTool(ActionsLegacyTool);
    const instance = new Wrapped({ api: fakeApi, config: fakeConfig });
    const config = instance.render() as PopoverItemDefaultBaseParams | { children: PopoverItemChildren };

    expect(hasChildren(config)).toBe(true);

    if (!hasChildren(config)) {
      return;
    }

    const legacy = (instance as unknown as { legacyInstance: ActionsLegacyTool }).legacyInstance;

    expect(legacy.clearCallCount).toBe(0);

    config.children.onClose?.();

    expect(legacy.clearCallCount).toBe(1);
  });

  it('does not add a children block when the legacy tool has no renderActions', () => {
    const Wrapped = wrapLegacyInlineTool(FakeLegacyTool);
    const instance = new Wrapped({ api: fakeApi, config: fakeConfig });
    const config = instance.render() as PopoverItemDefaultBaseParams | { children: PopoverItemChildren };

    expect('children' in config).toBe(false);
  });

  it('does not throw when only clear is implemented without renderActions (no children, no regression)', () => {
    class ClearOnlyTool {
      public render(): HTMLElement {
        return document.createElement('button');
      }

      public clear(): void {
        // no-op
      }
    }

    const Wrapped = wrapLegacyInlineTool(ClearOnlyTool);
    const instance = new Wrapped({ api: fakeApi, config: fakeConfig });
    const config = instance.render() as PopoverItemDefaultBaseParams | { children: PopoverItemChildren };

    // Without an actions element there is nothing to host children, so clear cannot be wired.
    expect('children' in config).toBe(false);
  });
});

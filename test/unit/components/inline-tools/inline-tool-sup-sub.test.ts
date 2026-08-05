import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IconSuperscript, IconSubscript } from '../../../../src/components/icons';
import { SupSubInlineTool } from '../../../../src/components/inline-tools/inline-tool-sup-sub';
import { InlineToolEventManager } from '../../../../src/components/inline-tools/services/inline-tool-event-manager';
import type { PopoverItemDefaultBaseParams, WithChildren } from '../../../../types/utils/popover';

const createMockApi = () => ({
  toolbar: {},
  inlineToolbar: { close: vi.fn() },
  notifier: {},
  i18n: { t: (key: string) => key, has: () => false },
  blocks: {},
  selection: {},
  caret: {},
  tools: {},
});

/**
 * Shape of the two nested toggle items the tool renders
 */
interface ModeItemShape {
  name: string;
  icon: string;
  title: string;
  closeOnActivate: boolean;
  isActive: () => boolean;
  onActivate: () => void;
}

/**
 * Select all contents of an element so mark-engine calls operate on it
 */
const selectContents = (element: HTMLElement): Range => {
  const range = document.createRange();

  range.selectNodeContents(element);
  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);

  return range;
};

describe('SupSubInlineTool', () => {
  let tool: SupSubInlineTool;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new SupSubInlineTool({ api: createMockApi() as never, config: undefined });
    container = document.createElement('div');
    container.contentEditable = 'true';
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
    InlineToolEventManager.reset();
  });

  it('exposes inline metadata and sanitizer config', () => {
    expect(SupSubInlineTool.isInline).toBe(true);
    expect(SupSubInlineTool.title).toBe('Superscript & subscript');
    expect(SupSubInlineTool.titleKey).toBe('supSub');
    expect(SupSubInlineTool.sanitize).toStrictEqual({ sup: {}, sub: {} });
  });

  it('renders a chevronless two-item nested popover', () => {
    const config = tool.render() as WithChildren<PopoverItemDefaultBaseParams>;

    expect(config.icon).toBe(IconSuperscript);
    expect(config.name).toBe('sup-sub');
    expect(config.children.hideChevron).toBe(true);
    expect(config.children.items).toHaveLength(2);

    const [supItem, subItem] = config.children.items as unknown as [ModeItemShape, ModeItemShape];

    expect(supItem.name).toBe('superscript');
    expect(supItem.icon).toBe(IconSuperscript);
    expect(supItem.title).toBe('tools.supSub.superscript');
    expect(supItem.closeOnActivate).toBe(true);
    expect(subItem.name).toBe('subscript');
    expect(subItem.icon).toBe(IconSubscript);
    expect(subItem.title).toBe('tools.supSub.subscript');
    expect(subItem.closeOnActivate).toBe(true);
  });

  it('wraps a selection in <sup> and unwraps it on re-toggle', () => {
    container.textContent = 'E = mc2';
    selectContents(container);

    tool.toggle('superscript');
    expect(container.querySelector('sup')).not.toBeNull();

    selectContents(container);
    tool.toggle('superscript');
    expect(container.querySelector('sup')).toBeNull();
  });

  it('wraps a selection in <sub> and unwraps it on re-toggle', () => {
    container.textContent = 'H2O';
    selectContents(container);

    tool.toggle('subscript');
    expect(container.querySelector('sub')).not.toBeNull();

    selectContents(container);
    tool.toggle('subscript');
    expect(container.querySelector('sub')).toBeNull();
  });

  it('applying subscript over superscripted text swaps the mark (mutual exclusion)', () => {
    container.textContent = 'x2';
    selectContents(container);
    tool.toggle('superscript');

    selectContents(container);
    tool.toggle('subscript');

    expect(container.querySelector('sup')).toBeNull();
    expect(container.querySelector('sub')).not.toBeNull();
  });

  it('applying superscript over subscripted text swaps the mark (mutual exclusion)', () => {
    container.textContent = 'x2';
    selectContents(container);
    tool.toggle('subscript');

    selectContents(container);
    tool.toggle('superscript');

    expect(container.querySelector('sub')).toBeNull();
    expect(container.querySelector('sup')).not.toBeNull();
  });

  it('registers both shortcut handlers on the event manager', () => {
    const manager = InlineToolEventManager.getInstance();

    expect(manager.hasHandler('sup-sub:superscript')).toBe(true);
    expect(manager.hasHandler('sup-sub:subscript')).toBe(true);
  });

  it('isActive reports true when the selection carries either mark', () => {
    container.innerHTML = '<sup>2</sup>';
    selectContents(container.querySelector('sup') as HTMLElement);

    const config = tool.render() as PopoverItemDefaultBaseParams;
    const isActive = typeof config.isActive === 'function' ? config.isActive() : false;

    expect(isActive).toBe(true);
  });

  it('isActive reports false on a plain selection', () => {
    container.textContent = 'plain';
    selectContents(container);

    const config = tool.render() as PopoverItemDefaultBaseParams;
    const isActive = typeof config.isActive === 'function' ? config.isActive() : false;

    expect(isActive).toBe(false);
  });
});

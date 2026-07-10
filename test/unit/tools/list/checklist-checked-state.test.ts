/**
 * Regression: every path that changes a checklist item's checked state MUST
 * keep three things in sync on the DOM:
 *
 *   1. the checkbox control's `checked` + `data-state` (checked|unchecked)
 *   2. the content element's `data-checked` attribute — dark-mode CSS keys
 *      `opacity: 0.45` muting off `[data-checked="true"]` (src/styles/checklist.css)
 *   3. the content element's strike-through classes (`line-through opacity-60`)
 *
 * Before the fix, `data-checked` was stamped ONCE at build time and never
 * updated by (a) the pointer/change-event toggle, (b) the Cmd/Ctrl+Enter
 * keyboard toggle, or (c) the programmatic in-place `setData({ checked })`
 * path — and (c) also skipped the text-styling classes entirely.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ListItem } from '../../../../src/tools/list';
import { toggleChecklistChecked } from '../../../../src/tools/list/list-keyboard';
import type { KeyboardContext } from '../../../../src/tools/list/list-keyboard';
import type { ListItemData } from '../../../../src/tools/list/types';

const buildChecklistTool = (checked: boolean): { tool: ListItem } => {
  const blocksAPI = {
    getById: (): null => null,
    getBlockIndex: (): number | undefined => 0,
    getCurrentBlockIndex: (): number => 0,
    getBlockByIndex: (): undefined => undefined,
    getBlocksCount: (): number => 1,
    update: vi.fn().mockResolvedValue(undefined),
  };

  const api = {
    blocks: blocksAPI,
    i18n: { t: (key: string): string => key },
    events: { on: vi.fn(), off: vi.fn() },
  } as never;

  const data: ListItemData = { text: 'task', style: 'checklist', checked };

  const tool = new ListItem({
    data,
    config: {},
    api,
    readOnly: false,
    block: { id: 'todo' } as never,
  });

  return { tool };
};

const getParts = (element: HTMLElement): { checkbox: HTMLInputElement; content: HTMLElement } => {
  const checkbox = element.querySelector('input[type="checkbox"]');
  const content = element.querySelector('[data-blok-testid="list-checklist-content"]');

  if (!(checkbox instanceof HTMLInputElement) || !(content instanceof HTMLElement)) {
    throw new Error('checklist parts not found');
  }

  return { checkbox, content };
};

const expectCheckedDom = (checkbox: HTMLInputElement, content: HTMLElement): void => {
  expect(checkbox.checked).toBe(true);
  expect(checkbox.getAttribute('data-state')).toBe('checked');
  expect(content.getAttribute('data-checked')).toBe('true');
  expect(content.classList.contains('line-through')).toBe(true);
  expect(content.classList.contains('opacity-60')).toBe(true);
};

const expectUncheckedDom = (checkbox: HTMLInputElement, content: HTMLElement): void => {
  expect(checkbox.checked).toBe(false);
  expect(checkbox.getAttribute('data-state')).toBe('unchecked');
  expect(content.getAttribute('data-checked')).toBe('false');
  expect(content.classList.contains('line-through')).toBe(false);
  expect(content.classList.contains('opacity-60')).toBe(false);
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checklist checked-state DOM sync', () => {
  describe('pointer toggle (checkbox change event)', () => {
    it('checking an unchecked item flips data-checked to true and strikes the text', () => {
      const { tool } = buildChecklistTool(false);
      const element = tool.render();
      document.body.appendChild(element);
      const { checkbox, content } = getParts(element);

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expectCheckedDom(checkbox, content);
    });

    it('unchecking a loaded-checked item flips data-checked to false and unstrikes the text', () => {
      const { tool } = buildChecklistTool(true);
      const element = tool.render();
      document.body.appendChild(element);
      const { checkbox, content } = getParts(element);

      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));

      expectUncheckedDom(checkbox, content);
    });
  });

  describe('keyboard toggle (Cmd/Ctrl+Enter — toggleChecklistChecked)', () => {
    const buildContext = (checked: boolean): { context: KeyboardContext; checkbox: HTMLInputElement; content: HTMLElement } => {
      const { tool } = buildChecklistTool(checked);
      const element = tool.render();
      document.body.appendChild(element);
      const { checkbox, content } = getParts(element);

      const api = {
        blocks: { update: vi.fn().mockResolvedValue(undefined) },
        caret: { setToBlock: vi.fn(), updateLastCaretAfterPosition: vi.fn() },
      } as unknown as KeyboardContext['api'];

      const context: KeyboardContext = {
        api,
        blockId: 'todo',
        data: { text: 'task', style: 'checklist', checked },
        element,
        getContentElement: () => content,
        syncContentFromDOM: vi.fn(),
        getDepth: () => 0,
      };

      return { context, checkbox, content };
    };

    it('checking updates data-checked alongside data-state', async () => {
      const { context, checkbox, content } = buildContext(false);

      await toggleChecklistChecked(context);

      expectCheckedDom(checkbox, content);
    });

    it('unchecking updates data-checked alongside data-state', async () => {
      const { context, checkbox, content } = buildContext(true);

      await toggleChecklistChecked(context);

      expectUncheckedDom(checkbox, content);
    });
  });

  describe('programmatic in-place setData({ checked }) — undo/redo path', () => {
    it('setData checked:true strikes the text and sets data-checked', () => {
      const { tool } = buildChecklistTool(false);
      const element = tool.render();
      document.body.appendChild(element);
      const { checkbox, content } = getParts(element);

      const inPlace = tool.setData({ text: 'task', style: 'checklist', checked: true });

      expect(inPlace).toBe(true);
      expectCheckedDom(checkbox, content);
    });

    it('setData checked:false unstrikes the text and clears data-checked', () => {
      const { tool } = buildChecklistTool(true);
      const element = tool.render();
      document.body.appendChild(element);
      const { checkbox, content } = getParts(element);

      const inPlace = tool.setData({ text: 'task', style: 'checklist', checked: false });

      expect(inPlace).toBe(true);
      expectUncheckedDom(checkbox, content);
    });
  });
});

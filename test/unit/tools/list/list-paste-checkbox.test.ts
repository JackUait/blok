/**
 * Regression: pasting generic HTML checklists (e.g. GitHub task lists like
 * `<ul><li><input type="checkbox" checked>Buy milk</li></ul>`) lost both the
 * checked state and the checkbox-based checklist detection, because the paste
 * pipeline's sanitizer whitelist (built from the tool's pasteConfig.tags) did
 * not include `input` — html-janitor stripped the `<input>` before
 * List.onPaste ever ran, so `querySelector('input[type="checkbox"]')` found
 * nothing.
 *
 * Mirrors the table sanitizer regression suite
 * (test/unit/tools/table/table-onpaste-merges.test.ts, "Table pasteConfig
 * sanitizer keeps span attributes").
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ListItem } from '../../../../src/tools/list';
import { SanitizerConfigBuilder } from '../../../../src/components/modules/paste/sanitizer-config';
import { clean } from '../../../../src/components/utils/sanitizer';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
import type { ToolsCollection } from '../../../../src/components/tools/collection';
import type { BlokConfig } from '../../../../types/configs/blok-config';
import type { ListItemData } from '../../../../src/tools/list/types';

const buildListTool = (): ListItem => {
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

  const data: ListItemData = { text: '', style: 'unordered', checked: false };

  return new ListItem({
    data,
    config: {},
    api,
    readOnly: false,
    block: { id: 'pasted-list' } as never,
  });
};

const composeTagPasteEvent = (element: HTMLElement): CustomEvent => {
  return new CustomEvent('tag', {
    detail: { data: element },
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('List pasteConfig sanitizer keeps checkbox inputs', () => {
  it('clean() with the List paste config preserves <input type="checkbox" checked> inside li innerHTML', () => {
    const builder = new SanitizerConfigBuilder(
      {} as unknown as ToolsCollection<BlockToolAdapter>,
      {} as BlokConfig
    );
    const toolConfig = builder.buildToolConfig({
      pasteConfig: ListItem.pasteConfig,
    } as unknown as BlockToolAdapter);

    const cleaned = clean('<input type="checkbox" checked> Buy milk', toolConfig);

    const probe = document.createElement('div');

    probe.innerHTML = cleaned;

    const checkbox = probe.querySelector('input[type="checkbox"]');

    expect(checkbox).not.toBeNull();
    expect(checkbox instanceof HTMLInputElement && checkbox.checked).toBe(true);
    expect(probe.textContent).toContain('Buy milk');
  });
});

describe('List onPaste with checkbox inputs', () => {
  it('a pasted li with a checked checkbox yields checklist style, checked=true and no <input> markup in text', () => {
    const tool = buildListTool();

    tool.render();

    const li = document.createElement('li');

    li.innerHTML = '<input type="checkbox" checked> Buy milk';

    tool.onPaste(composeTagPasteEvent(li) as never);

    const saved = tool.save();

    expect(saved.style).toBe('checklist');
    expect(saved.checked).toBe(true);
    expect(saved.text).not.toContain('<input');
    expect(saved.text).toContain('Buy milk');
  });

  it('a pasted li with an unchecked checkbox yields checklist style with checked=false', () => {
    const tool = buildListTool();

    tool.render();

    const li = document.createElement('li');

    li.innerHTML = '<input type="checkbox"> Open task';

    tool.onPaste(composeTagPasteEvent(li) as never);

    const saved = tool.save();

    expect(saved.style).toBe('checklist');
    expect(saved.checked).toBe(false);
    expect(saved.text).toContain('Open task');
  });

  it('a bare pasted <input type="checkbox" checked> (tag-substitution case) does not crash and yields a checked checklist item with empty text', () => {
    const tool = buildListTool();

    tool.render();

    const input = document.createElement('input');

    input.type = 'checkbox';
    input.setAttribute('checked', '');

    expect(() => tool.onPaste(composeTagPasteEvent(input) as never)).not.toThrow();

    const saved = tool.save();

    expect(saved.style).toBe('checklist');
    expect(saved.checked).toBe(true);
    expect(saved.text).not.toContain('<input');
  });
});

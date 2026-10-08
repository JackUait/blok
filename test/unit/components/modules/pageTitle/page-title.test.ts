import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import { findRanges } from '../../../../../src/components/modules/find/text-index';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { BlokConfig } from '../../../../../types';

describe('PageTitle module', () => {
  let holder: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder.remove();
    vi.restoreAllMocks();
  });

  const boot = async (config: Partial<BlokConfig>): Promise<Core> => {
    const core = new Core({ holder, tools: { paragraph: { class: Paragraph } }, data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }] }, ...config });

    await core.isReady;

    return core;
  };
  const titleIn = (root: ParentNode): HTMLElement | null => root.querySelector(`[${DATA_ATTR.pageTitle}]`);

  it('draws nothing without the title config', async () => {
    await boot({});
    expect(titleIn(holder)).toBeNull();
  });

  it('draws the header inside the editor, before the blocks', async () => {
    await boot({ pageTitle: true });
    const header = holder.querySelector(`[${DATA_ATTR.pageHeader}]`);
    const redactor = holder.querySelector(`[${DATA_ATTR.redactor}]`);

    expect(header?.nextElementSibling).toBe(redactor);
  });

  it('draws into an outside holder given by selector', async () => {
    const outside = document.createElement('section');

    outside.id = 'page-title';
    document.body.appendChild(outside);
    await boot({ pageTitle: { holder: '#page-title' } });

    expect(titleIn(outside)).not.toBeNull();
    expect(titleIn(holder)).toBeNull();
    outside.remove();
  });

  it('falls back to inside the editor when the holder selector matches nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await boot({ pageTitle: { holder: '#missing' } });

    expect(titleIn(holder)).not.toBeNull();
    expect(error).toHaveBeenCalled();
  });

  it('shows the loaded title and the i18n placeholder', async () => {
    await boot({ pageTitle: true, data: { title: 'Plans', blocks: [] } });
    const title = titleIn(holder);

    expect(title?.textContent).toBe('Plans');
    expect(title?.getAttribute('data-placeholder')).toBe('New page');
    expect(title?.getAttribute('role')).toBe('textbox');
    expect(title?.getAttribute('aria-label')).toBe('Page title');
  });

  it('shows the title of a persisted load', async () => {
    // Given data skips the persisted load.
    await boot({
      pageTitle: true,
      data: undefined,
      persistence: { load: async () => ({ title: 'Saved', blocks: [] }), save: async () => {} },
    });

    expect(titleIn(holder)?.textContent).toBe('Saved');
  });

  it('typing writes the document and fires onChange with source user', async () => {
    const onChange = vi.fn();
    const core = await boot({ pageTitle: { onChange } });
    const title = titleIn(holder);

    if (title === null) {
      throw new Error('no title');
    }
    title.textContent = 'Plans';
    title.dispatchEvent(new InputEvent('input', { bubbles: true }));

    expect(core.moduleInstances.YjsManager.getPageFields().title).toBe('Plans');
    expect(onChange).toHaveBeenCalledWith('Plans', { source: 'user' });
  });

  it('turns newlines into spaces and leaves no stray br when emptied', async () => {
    await boot({ pageTitle: true });
    const title = titleIn(holder);

    if (title === null) {
      throw new Error('no title');
    }
    title.textContent = 'a\nb';
    title.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(title.textContent).toBe('a b');

    title.innerHTML = '<br>';
    title.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(title.childNodes.length).toBe(0);
  });

  it('undo restores the text and fires onChange with source undo', async () => {
    const onChange = vi.fn();
    const core = await boot({ pageTitle: { onChange } });

    core.moduleInstances.PageTitle.setText('Plans', 'api');
    core.moduleInstances.YjsManager.stopCapturing();
    core.moduleInstances.YjsManager.undo();

    expect(titleIn(holder)?.textContent).toBe('');
    expect(onChange).toHaveBeenLastCalledWith('', { source: 'undo' });
  });

  it('read-only makes the title not editable, and back', async () => {
    const core = await boot({ pageTitle: true, readOnly: true });

    expect(titleIn(holder)?.getAttribute('contenteditable')).toBe('false');
    await core.moduleInstances.ReadOnly.toggle(false);
    expect(titleIn(holder)?.getAttribute('contenteditable')).toBe('true');
  });

  it('carries its own interface value and the editor instance id', async () => {
    await boot({ pageTitle: true });
    const header = holder.querySelector(`[${DATA_ATTR.pageHeader}]`);
    const wrapper = holder.querySelector(`[${DATA_ATTR.editor}]`);

    expect(header?.getAttribute(DATA_ATTR.interface)).toBe('page-title');
    expect(header?.getAttribute(DATA_ATTR.instance)).toBe(wrapper?.getAttribute(DATA_ATTR.instance));
  });

  it('font config reaches the header through the instance-scoped font tag', async () => {
    await boot({ pageTitle: true, style: { fontFamily: 'Georgia' } });
    const instance = holder.querySelector(`[${DATA_ATTR.editor}]`)?.getAttribute(DATA_ATTR.instance) ?? 'none';
    const tag = Array.from(document.head.querySelectorAll('style')).find((candidate) => candidate.id.startsWith('blok-font-'));

    expect(tag?.textContent).toContain(`[data-blok-interface=page-title]:where([data-blok-instance="${instance}"])`);
    tag?.remove();
  });

  it('find matches the title in an outside holder', async () => {
    const outside = document.createElement('div');

    document.body.appendChild(outside);
    await boot({ pageTitle: { holder: outside }, data: { title: 'Plans', blocks: [] } });

    const ranges = findRanges(document.body, 'Plans');

    expect(ranges.some((range) => titleIn(outside)?.contains(range.startContainer) === true)).toBe(true);
    outside.remove();
  });

  it('destroy empties an outside holder', async () => {
    const outside = document.createElement('div');

    document.body.appendChild(outside);
    const core = await boot({ pageTitle: { holder: outside } });

    core.moduleInstances.PageTitle.destroy();

    expect(outside.childElementCount).toBe(0);
    outside.remove();
  });

  it('render() with a new title redraws the header', async () => {
    const blocks = [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }];
    const core = await boot({ pageTitle: true, data: { title: 'Old', blocks } });

    await core.moduleInstances.API.methods.blocks.render({ title: 'New', blocks });

    expect(titleIn(holder)?.textContent).toBe('New');
  });

  it('mount() moves the same element', async () => {
    const core = await boot({ pageTitle: true });
    const before = titleIn(holder);
    const target = document.createElement('div');

    document.body.appendChild(target);
    core.moduleInstances.PageTitle.mount(target);

    expect(titleIn(target)).toBe(before);
    target.remove();
  });
  it('input rewrites browser formatting back to plain text', async () => {
    const core = await boot({ pageTitle: true });
    const title = titleIn(holder);

    if (title === null) {
      throw new Error('no title');
    }
    title.innerHTML = 'a<b>b</b>';
    title.dispatchEvent(new InputEvent('input', { bubbles: true }));

    expect(title.childNodes.length).toBe(1);
    expect(title.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(title.textContent).toBe('ab');
    expect(core.moduleInstances.PageTitle.getText()).toBe('ab');
  });

  it('Enter in the title moves the text after the caret into a new first block', async () => {
    const core = await boot({ pageTitle: true, data: { title: 'Hello world', blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }] } });
    const title = titleIn(holder);

    if (title === null) {
      throw new Error('no title');
    }
    title.focus();
    window.getSelection()?.setPosition(title.firstChild, 5);
    title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    const { BlockManager } = core.moduleInstances;

    expect(core.moduleInstances.PageTitle.getText()).toBe('Hello');
    expect(BlockManager.blocks.length).toBe(2);
    expect(BlockManager.getBlockByIndex(0)?.holder.textContent).toBe(' world');
  });

  it('one undo reverts an Enter split in the title', async () => {
    const core = await boot({ pageTitle: true, data: { title: 'Hello world', blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }] } });
    const title = titleIn(holder);

    if (title === null) {
      throw new Error('no title');
    }
    title.focus();
    window.getSelection()?.setPosition(title.firstChild, 5);
    title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    core.moduleInstances.YjsManager.stopCapturing();
    core.moduleInstances.YjsManager.undo();

    expect(core.moduleInstances.PageTitle.getText()).toBe('Hello world');
    expect(core.moduleInstances.BlockManager.blocks.length).toBe(1);
  });

  it('appendAndFocus joins text onto the title with the caret at the seam', async () => {
    const core = await boot({ pageTitle: true, data: { title: 'Plans', blocks: [] } });
    const title = titleIn(holder);

    core.moduleInstances.PageTitle.appendAndFocus(' ahead');

    const selection = window.getSelection();

    expect(title?.textContent).toBe('Plans ahead');
    expect(core.moduleInstances.PageTitle.getText()).toBe('Plans ahead');
    expect(selection?.anchorNode).toBe(title?.firstChild);
    expect(selection?.anchorOffset).toBe(5);
  });

  it('focusAtX(null) puts the caret at the end of the title', async () => {
    const core = await boot({ pageTitle: true, data: { title: 'Plans', blocks: [] } });
    const title = titleIn(holder);

    core.moduleInstances.PageTitle.focusAtX(null);

    expect(title).toHaveFocus();
    expect(window.getSelection()?.anchorNode).toBe(title);
    expect(window.getSelection()?.anchorOffset).toBe(title?.childNodes.length);
  });
  it('focusing the title clears block selection, so Backspace there keeps the block', async () => {
    const core = await boot({ pageTitle: true, data: { title: 'Plans', blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }] } });
    const { BlockManager, BlockSelection } = core.moduleInstances;
    const title = titleIn(holder);
    const first = BlockManager.getBlockByIndex(0);

    if (title === null || first === undefined) {
      throw new Error('no title or block');
    }
    BlockManager.currentBlock = first;
    BlockSelection.selectBlock(first);
    title.focus();
    window.getSelection()?.setPosition(title.firstChild, 5);
    title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true, cancelable: true }));

    expect(BlockManager.blocks.map((block) => block.id)).toEqual(['p1']);
    expect(BlockSelection.anyBlockSelected).toBe(false);
    expect(BlockManager.currentBlockIndex).toBe(-1);
  });

  it('Cmd+B on selected title text runs no inline tool', async () => {
    const core = await boot({ pageTitle: true, data: { title: 'Plans', blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }] } });
    const { BlockManager } = core.moduleInstances;
    const title = titleIn(holder);
    const first = BlockManager.getBlockByIndex(0);

    if (title === null || first === undefined || title.firstChild === null) {
      throw new Error('no title or block');
    }
    BlockManager.currentBlock = first;
    title.focus();
    window.getSelection()?.setBaseAndExtent(title.firstChild, 0, title.firstChild, 5);
    const event = new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', metaKey: true, bubbles: true, cancelable: true });
    const documentKeydown = vi.fn();

    document.addEventListener('keydown', documentKeydown);
    title.dispatchEvent(event);
    document.removeEventListener('keydown', documentKeydown);

    expect(title.childNodes.length).toBe(1);
    expect(title.firstChild).toBeInstanceOf(Text);
    expect(event.defaultPrevented).toBe(true);
    expect(documentKeydown).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { IconLink } from '@codexteam/icons';

import LinkInlineTool from '../../../../src/components/inline-tools/inline-tool-link';
import type SelectionUtils from '../../../../src/components/selection';
import type { API } from '../../../../types';

type SelectionMock = Pick<SelectionUtils,
  'setFakeBackground' |
  'save' |
  'restore' |
  'removeFakeBackground' |
  'expandToTag' |
  'clearSaved' |
  'collapseToEnd'> & {
  isFakeBackgroundEnabled: boolean;
  findParentTag: Mock<[tagName: string, className?: string, searchDepth?: number], HTMLElement | null>;
};

const setDocumentCommand = (implementation: Document['execCommand']): void => {
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    writable: true,
    value: implementation,
  });
};

const createSelectionMock = (): SelectionMock => {
  return {
    setFakeBackground: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    removeFakeBackground: vi.fn(),
    findParentTag: vi.fn<[string, string?, number?], HTMLElement | null>(() => null),
    expandToTag: vi.fn(),
    clearSaved: vi.fn(),
    collapseToEnd: vi.fn(),
    isFakeBackgroundEnabled: false,
  };
};

type ToolSetup = {
  tool: InstanceType<typeof LinkInlineTool>;
  toolbar: { close: ReturnType<typeof vi.fn> };
  inlineToolbar: { close: ReturnType<typeof vi.fn> };
  notifier: { show: ReturnType<typeof vi.fn> };
  selection: SelectionMock;
};

type LinkToolRenderResult = {
  icon: string;
  title: string;
  isActive: () => boolean;
  children: {
    items: {
      element: HTMLElement;
    }[];
    onOpen: () => void;
    onClose: () => void;
  };
};

const createTool = (): ToolSetup => {
  const toolbar = { close: vi.fn() };
  const inlineToolbar = { close: vi.fn() };
  const notifier = { show: vi.fn() };
  const i18n = { t: vi.fn((phrase: string) => phrase) };

  const api = {
    toolbar,
    inlineToolbar,
    notifier,
    i18n,
  } as unknown as API;

  const tool = new LinkInlineTool({ api });
  const selection = createSelectionMock();

  (tool as unknown as { selection: SelectionMock }).selection = selection;

  return {
    tool,
    toolbar,
    inlineToolbar,
    notifier,
    selection,
  };
};

const createKeyboardEventWithKeyCode = (keyCode: number): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: 'Enter' });

  Object.defineProperty(event, 'keyCode', {
    configurable: true,
    value: keyCode,
  });

  return event;
};

type KeyboardEventStub = Pick<KeyboardEvent,
  'preventDefault' |
  'stopPropagation' |
  'stopImmediatePropagation'> & {
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
  stopImmediatePropagation: ReturnType<typeof vi.fn>;
};

const createEnterEventStubs = (): KeyboardEventStub => {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };
};

describe('LinkInlineTool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    setDocumentCommand(vi.fn());
  });

  it('exposes inline metadata and shortcut', () => {
    expect(LinkInlineTool.isInline).toBe(true);
    expect(LinkInlineTool.title).toBe('Link');
    expect(LinkInlineTool.sanitize).toEqual({
      a: {
        href: true,
        target: '_blank',
        rel: 'nofollow',
      },
    });

    const { tool } = createTool();

    expect(tool.shortcut).toBe('CMD+K');
  });

  it('renders menu config with correct properties', () => {
    const { tool } = createTool();

    const renderResult = tool.render() as unknown as LinkToolRenderResult;

    expect(renderResult).toHaveProperty('icon', IconLink);
    expect(renderResult).toHaveProperty('isActive');
    expect(typeof renderResult.isActive).toBe('function');
    expect(renderResult).toHaveProperty('children');
  });

  it('renders actions input and invokes enter handler when Enter key is pressed', () => {
    const { tool } = createTool();
    const enterSpy = vi.spyOn(tool as unknown as { enterPressed(event: KeyboardEvent): void }, 'enterPressed');

    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const input = renderResult.children.items[0].element as HTMLInputElement;

    expect(input.placeholder).toBe('Add a link');
    expect(input.classList.contains('ce-inline-tool-input')).toBe(true);
    expect(input.getAttribute('data-blok-link-tool-input-opened')).toBe('false');

    const event = createKeyboardEventWithKeyCode(13);

    input.dispatchEvent(event);

    expect(enterSpy).toHaveBeenCalledWith(event);
  });

  it('returns true from isActive when selection contains anchor', () => {
    const { tool, selection } = createTool();
    const anchor = document.createElement('a');

    anchor.setAttribute('href', 'https://codex.so');
    selection.findParentTag.mockReturnValue(anchor);

    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const isActive = renderResult.isActive();

    expect(isActive).toBe(true);
  });

  it('returns false from isActive when selection does not contain anchor', () => {
    const { tool, selection } = createTool();

    selection.findParentTag.mockReturnValue(null);

    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const isActive = renderResult.isActive();

    expect(isActive).toBe(false);
  });

  it('populates input when opened on an existing link', () => {
    const { tool, selection } = createTool();
    const anchor = document.createElement('a');

    anchor.setAttribute('href', 'https://codex.so');

    selection.findParentTag.mockReturnValue(anchor);

    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const input = renderResult.children.items[0].element as HTMLInputElement;

    // Simulate onOpen
    renderResult.children.onOpen();

    expect(input.value).toBe('https://codex.so');
    expect(selection.save).toHaveBeenCalled();
  });

  it('removes link when input is submitted empty', () => {
    const { tool, selection } = createTool();
    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const input = renderResult.children.items[0].element as HTMLInputElement;

    const unlinkSpy = vi.spyOn(tool as unknown as { unlink(): void }, 'unlink');
    const closeActionsSpy = vi.spyOn(tool as unknown as { closeActions(clearSavedSelection?: boolean): void }, 'closeActions');

    input.value = '   ';

    const event = createEnterEventStubs();

    (tool as unknown as { enterPressed(event: KeyboardEvent): void }).enterPressed(event as unknown as KeyboardEvent);

    expect(selection.restore).toHaveBeenCalled();
    expect(unlinkSpy).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(closeActionsSpy).toHaveBeenCalled();
  });

  it('shows notifier when URL validation fails', () => {
    const { tool, notifier } = createTool();
    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const input = renderResult.children.items[0].element as HTMLInputElement;
    const insertLinkSpy = vi.spyOn(tool as unknown as { insertLink(link: string): void }, 'insertLink');

    input.value = 'https://codex .so';

    (tool as unknown as { enterPressed(event: KeyboardEvent): void }).enterPressed(createEnterEventStubs() as unknown as KeyboardEvent);

    expect(notifier.show).toHaveBeenCalledWith({
      message: 'Pasted link is not valid.',
      style: 'error',
    });
    expect(insertLinkSpy).not.toHaveBeenCalled();
  });

  it('inserts prepared link and collapses selection when URL is valid', () => {
    const { tool, selection, inlineToolbar } = createTool();
    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const input = renderResult.children.items[0].element as HTMLInputElement;
    const insertLinkSpy = vi.spyOn(tool as unknown as { insertLink(link: string): void }, 'insertLink');
    const removeFakeBackgroundSpy = selection.removeFakeBackground as unknown as ReturnType<typeof vi.fn>;

    input.value = 'example.com';

    (tool as unknown as { enterPressed(event: KeyboardEvent): void }).enterPressed(createEnterEventStubs() as unknown as KeyboardEvent);

    expect(selection.restore).toHaveBeenCalled();
    expect(removeFakeBackgroundSpy).toHaveBeenCalled();
    expect(insertLinkSpy).toHaveBeenCalledWith('http://example.com');
    expect(selection.collapseToEnd).toHaveBeenCalled();
    expect(inlineToolbar.close).toHaveBeenCalled();
  });

  it('adds missing protocol only when needed', () => {
    const { tool } = createTool();
    const addProtocol = tool as unknown as { addProtocol(link: string): string };

    expect(addProtocol.addProtocol('https://codex.so')).toBe('https://codex.so');
    expect(addProtocol.addProtocol('codex.so')).toBe('http://codex.so');
    expect(addProtocol.addProtocol('/internal')).toBe('/internal');
    expect(addProtocol.addProtocol('#hash')).toBe('#hash');
    expect(addProtocol.addProtocol('//cdn.codex.so')).toBe('//cdn.codex.so');
  });

  it('inserts anchor tag with correct attributes when inserting link', () => {
    const { tool } = createTool();

    const range = document.createRange();
    const textNode = document.createTextNode('selected text');

    document.body.appendChild(textNode);
    range.selectNodeContents(textNode);

    const selectionMock = {
      getRangeAt: vi.fn().mockReturnValue(range),
      rangeCount: 1,
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    };

    vi.spyOn(window, 'getSelection').mockReturnValue(selectionMock as unknown as Selection);

    (tool as unknown as { insertLink(link: string): void }).insertLink('https://codex.so');

    const anchor = document.querySelector('a');

    expect(anchor).not.toBeNull();
    expect(anchor?.href).toBe('https://codex.so/');
    expect(anchor?.target).toBe('_blank');
    expect(anchor?.rel).toBe('nofollow');
    expect(anchor?.textContent).toBe('selected text');
  });

  it('unwraps anchor tag when unlinking', () => {
    const { tool, selection } = createTool();

    const anchor = document.createElement('a');

    anchor.href = 'https://codex.so';
    anchor.textContent = 'link text';
    document.body.appendChild(anchor);

    selection.findParentTag.mockReturnValue(anchor);

    (tool as unknown as { unlink(): void }).unlink();

    const anchorCheck = document.querySelector('a');

    expect(anchorCheck).toBeNull();
    expect(document.body.textContent).toBe('link text');
  });
});

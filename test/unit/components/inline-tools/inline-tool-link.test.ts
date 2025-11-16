import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { IconLink, IconUnlink } from '@codexteam/icons';

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
  tool: LinkInlineTool;
  toolbar: { close: ReturnType<typeof vi.fn> };
  inlineToolbar: { close: ReturnType<typeof vi.fn> };
  notifier: { show: ReturnType<typeof vi.fn> };
  selection: SelectionMock;
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

/**
 * Normalizes HTML string by parsing and re-serializing it.
 * This ensures consistent comparison when browsers serialize SVG differently.
 *
 * @param html - The HTML string to normalize
 * @returns The normalized HTML string
 */
const normalizeHTML = (html: string): string => {
  const temp = document.createElement('div');

  temp.innerHTML = html;

  return temp.innerHTML;
};

const expectButtonIcon = (button: HTMLElement, iconHTML: string): void => {
  expect(normalizeHTML(button.innerHTML)).toBe(normalizeHTML(iconHTML));
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

  it('renders toolbar button with initial state persisted in data attributes', () => {
    const { tool } = createTool();

    const button = tool.render() as HTMLButtonElement;

    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(button.type).toBe('button');
    expect(button.classList.contains('ce-inline-tool')).toBe(true);
    expect(button.classList.contains('ce-inline-tool--link')).toBe(true);
    expect(button.getAttribute('data-link-tool-active')).toBe('false');
    expect(button.getAttribute('data-link-tool-unlink')).toBe('false');
    expectButtonIcon(button, IconLink);
  });

  it('renders actions input and invokes enter handler when Enter key is pressed', () => {
    const { tool } = createTool();
    const enterSpy = vi.spyOn(tool as unknown as { enterPressed(event: KeyboardEvent): void }, 'enterPressed');

    const input = tool.renderActions() as HTMLInputElement;

    expect(input.placeholder).toBe('Add a link');
    expect(input.classList.contains('ce-inline-tool-input')).toBe(true);
    expect(input.getAttribute('data-link-tool-input-opened')).toBe('false');

    const event = createKeyboardEventWithKeyCode(13);

    input.dispatchEvent(event);

    expect(enterSpy).toHaveBeenCalledWith(event);
  });

  it('activates unlink state when selection already contains anchor', () => {
    const { tool, selection } = createTool();
    const button = tool.render() as HTMLButtonElement;
    const input = tool.renderActions() as HTMLInputElement;
    const openActionsSpy = vi.spyOn(tool as unknown as { openActions(needFocus?: boolean): void }, 'openActions');
    const anchor = document.createElement('a');

    anchor.setAttribute('href', 'https://codex.so');
    selection.findParentTag.mockReturnValue(anchor);

    const result = tool.checkState();

    expect(result).toBe(true);
    expectButtonIcon(button, IconUnlink);
    expect(button.classList.contains('ce-inline-tool--active')).toBe(true);
    expect(button.getAttribute('data-link-tool-unlink')).toBe('true');
    expect(input.value).toBe('https://codex.so');
    expect(openActionsSpy).toHaveBeenCalled();
    expect(selection.save).toHaveBeenCalled();
  });

  it('deactivates button when selection leaves anchor', () => {
    const { tool, selection } = createTool();
    const button = tool.render() as HTMLButtonElement;

    button.classList.add('ce-inline-tool--active');
    tool.renderActions();
    selection.findParentTag.mockReturnValue(null);

    const result = tool.checkState();

    expect(result).toBe(false);
    expectButtonIcon(button, IconLink);
    expect(button.classList.contains('ce-inline-tool--active')).toBe(false);
    expect(button.getAttribute('data-link-tool-unlink')).toBe('false');
  });

  it('removes link when input is submitted empty', () => {
    const { tool, selection } = createTool();
    const input = tool.renderActions() as HTMLInputElement;
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
    const input = tool.renderActions() as HTMLInputElement;
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
    const input = tool.renderActions() as HTMLInputElement;
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

  it('delegates to document.execCommand when inserting and removing links', () => {
    const execSpy = vi.fn();

    setDocumentCommand(execSpy as Document['execCommand']);

    const { tool } = createTool();

    (tool as unknown as { insertLink(link: string): void }).insertLink('https://codex.so');
    expect(execSpy).toHaveBeenCalledWith('createLink', false, 'https://codex.so');

    execSpy.mockClear();

    (tool as unknown as { unlink(): void }).unlink();
    expect(execSpy).toHaveBeenCalledWith('unlink');
  });
});

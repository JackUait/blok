import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { IconLink } from '../../../../src/components/icons';

import { LinkInlineTool } from '../../../../src/components/inline-tools/inline-tool-link';
import type { SelectionUtils } from '../../../../src/components/selection';
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
  findParentTag: Mock<(tagName: string, className?: string, searchDepth?: number) => HTMLElement | null>;
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
    findParentTag: vi.fn((_tagName: string, _className?: string, _searchDepth?: number): HTMLElement | null => null),
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

const getInputFromWrapper = (wrapper: HTMLElement): HTMLInputElement => {
  const input = wrapper.querySelector<HTMLInputElement>('input');

  if (!input) {
    throw new Error('Input not found in wrapper');
  }

  return input;
};

const getSuggestionChip = (itemWrapper: HTMLElement): HTMLElement | null => {
  return itemWrapper.querySelector<HTMLElement>('[data-link-suggestion]');
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

type KeyboardEventStub = {
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
    expect(LinkInlineTool.shortcut).toBe('CMD+K');
  });

  it('renders menu config with correct properties', () => {
    const { tool } = createTool();

    const renderResult = tool.render() as unknown as LinkToolRenderResult;

    expect(renderResult).toHaveProperty('icon', IconLink);
    expect(renderResult).toHaveProperty('isActive');
    expect(typeof renderResult.isActive).toBe('function');
    expect(renderResult).toHaveProperty('children');
  });

  it('does not hardcode children width so the link popover fits any language text', () => {
    const { tool } = createTool();
    const config = tool.render() as unknown as { children: { width?: string } };

    expect(config.children.width).toBeUndefined();
  });

  it('renders actions input and invokes enter handler when Enter key is pressed', () => {
    const { tool } = createTool();
    const enterSpy = vi.spyOn(tool as unknown as { enterPressed(event: KeyboardEvent): void }, 'enterPressed');

    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const wrapper = renderResult.children.items[0].element;
    const input = getInputFromWrapper(wrapper);

    expect(input.placeholder).toBe('tools.link.addLink');
    expect(input).toHaveAttribute('data-blok-testid', 'inline-tool-input');
    expect(input).toHaveAttribute('data-blok-link-tool-input-opened', 'false');

    const event = createKeyboardEventWithKeyCode(13);

    input.dispatchEvent(event);

    expect(enterSpy).toHaveBeenCalledWith(event);
  });

  it('returns true from isActive when selection contains anchor', () => {
    const { tool, selection } = createTool();
    const anchor = document.createElement('a');

    anchor.setAttribute('href', 'https://google.com');
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

    anchor.setAttribute('href', 'https://google.com');

    selection.findParentTag.mockReturnValue(anchor);

    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const input = getInputFromWrapper(renderResult.children.items[0].element);

    // Simulate onOpen
    renderResult.children.onOpen();

    expect(input.value).toBe('https://google.com');
    expect(selection.save).toHaveBeenCalled();
  });

  it('removes link when input is submitted empty', () => {
    const { tool, inlineToolbar } = createTool();
    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const input = getInputFromWrapper(renderResult.children.items[0].element);

    input.value = '   ';

    const event = createEnterEventStubs();

    (tool as unknown as { enterPressed(event: KeyboardEvent): void }).enterPressed(event as unknown as KeyboardEvent);

    // Verify observable behavior: input is cleared and actions are closed
    expect(input.value).toBe('');
    expect(input).toHaveAttribute('data-blok-link-tool-input-opened', 'false');
    expect(inlineToolbar.close).toHaveBeenCalled();
  });

  it('shows notifier when URL validation fails', () => {
    const { tool, notifier } = createTool();
    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const input = getInputFromWrapper(renderResult.children.items[0].element);
    const insertLinkSpy = vi.spyOn(tool as unknown as { insertLink(link: string): void }, 'insertLink');

    input.value = 'https://google .com';

    (tool as unknown as { enterPressed(event: KeyboardEvent): void }).enterPressed(createEnterEventStubs() as unknown as KeyboardEvent);

    expect(notifier.show).toHaveBeenCalledWith({
      message: 'tools.link.invalidLink',
      style: 'error',
    });
    expect(insertLinkSpy).not.toHaveBeenCalled();
  });

  it('inserts prepared link and collapses selection when URL is valid', () => {
    const { tool, selection, inlineToolbar } = createTool();
    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const input = getInputFromWrapper(renderResult.children.items[0].element);
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

    expect(addProtocol.addProtocol('https://google.com')).toBe('https://google.com');
    expect(addProtocol.addProtocol('google.com')).toBe('http://google.com');
    expect(addProtocol.addProtocol('/internal')).toBe('/internal');
    expect(addProtocol.addProtocol('#hash')).toBe('#hash');
    expect(addProtocol.addProtocol('//cdn.google.com')).toBe('//cdn.google.com');
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

    (tool as unknown as { insertLink(link: string): void }).insertLink('https://google.com');

    const anchor = document.querySelector('a');

    expect(anchor).not.toBeNull();
    expect(anchor?.href).toBe('https://google.com/');
    expect(anchor?.target).toBe('_blank');
    expect(anchor?.rel).toBe('nofollow');
    expect(anchor?.textContent).toBe('selected text');
  });

  it('unwraps anchor tag when unlinking', () => {
    const { tool, selection } = createTool();

    const anchor = document.createElement('a');

    anchor.href = 'https://google.com';
    anchor.textContent = 'link text';
    document.body.appendChild(anchor);

    selection.findParentTag.mockReturnValue(anchor);

    (tool as unknown as { unlink(): void }).unlink();

    const anchorCheck = document.querySelector('a');

    expect(anchorCheck).toBeNull();
    expect(document.body).toHaveTextContent('link text');
  });

  describe('suggestion chip', () => {
    it('is hidden initially', () => {
      const { tool } = createTool();
      const itemWrapper = (tool.render() as unknown as LinkToolRenderResult).children.items[0].element;
      const chip = getSuggestionChip(itemWrapper);

      expect(chip?.classList.contains('hidden')).toBe(true);
    });

    it('shows and populates chip when input has a URL', () => {
      const { tool } = createTool();
      const itemWrapper = (tool.render() as unknown as LinkToolRenderResult).children.items[0].element;

      (tool as unknown as { updateSuggestion(v: string): void }).updateSuggestion('https://example.com');

      const chip = getSuggestionChip(itemWrapper);
      const urlEl = itemWrapper.querySelector('[data-link-suggestion-url]');
      const typeEl = itemWrapper.querySelector('[data-link-suggestion-type]');

      expect(chip?.classList.contains('hidden')).toBe(false);
      expect(urlEl?.textContent).toBe('https://example.com');
      expect(typeEl?.textContent).toBe('Link to web page');
    });

    it('hides chip when input is cleared', () => {
      const { tool } = createTool();
      const itemWrapper = (tool.render() as unknown as LinkToolRenderResult).children.items[0].element;

      (tool as unknown as { updateSuggestion(v: string): void }).updateSuggestion('https://example.com');
      (tool as unknown as { updateSuggestion(v: string): void }).updateSuggestion('');

      const chip = getSuggestionChip(itemWrapper);

      expect(chip?.classList.contains('hidden')).toBe(true);
    });

    it('labels mailto: links as Email address', () => {
      const { tool } = createTool();
      const wrapper = tool.render() as unknown as LinkToolRenderResult;
      const itemWrapper = wrapper.children.items[0].element;

      (tool as unknown as { updateSuggestion(v: string): void }).updateSuggestion('mailto:hello@example.com');

      const typeEl = itemWrapper.querySelector('[data-link-suggestion-type]');

      expect(typeEl?.textContent).toBe('Email address');
    });

    it('shows invalid label and disables row for incomplete URLs', () => {
      const { tool } = createTool();
      const itemWrapper = (tool.render() as unknown as LinkToolRenderResult).children.items[0].element;

      (tool as unknown as { updateSuggestion(v: string): void }).updateSuggestion('asd');

      const typeEl = itemWrapper.querySelector('[data-link-suggestion-type]');
      const row = itemWrapper.querySelector('[data-link-suggestion-row]');

      expect(typeEl?.textContent).toBe('Keep typing to add a link');
      expect(row?.className).toContain('pointer-events-none');
    });

    it('shows valid label and enables row for complete URLs', () => {
      const { tool } = createTool();
      const itemWrapper = (tool.render() as unknown as LinkToolRenderResult).children.items[0].element;

      (tool as unknown as { updateSuggestion(v: string): void }).updateSuggestion('google.com');

      const typeEl = itemWrapper.querySelector('[data-link-suggestion-type]');
      const row = itemWrapper.querySelector('[data-link-suggestion-row]');

      expect(typeEl?.textContent).toBe('Link to web page');
      expect(row?.className).toContain('cursor-pointer');
    });

    it('labels anchor links as Jump to section', () => {
      const { tool } = createTool();
      const wrapper = tool.render() as unknown as LinkToolRenderResult;
      const itemWrapper = wrapper.children.items[0].element;

      (tool as unknown as { updateSuggestion(v: string): void }).updateSuggestion('#results');

      const typeEl = itemWrapper.querySelector('[data-link-suggestion-type]');

      expect(typeEl?.textContent).toBe('Jump to section');
    });

    it('shows suggestion for existing link when popover opens', () => {
      const { tool, selection } = createTool();
      const anchor = document.createElement('a');

      anchor.setAttribute('href', 'https://notion.so');
      selection.findParentTag.mockReturnValue(anchor);

      const renderResult = tool.render() as unknown as LinkToolRenderResult;

      renderResult.children.onOpen();

      const itemWrapper = renderResult.children.items[0].element;
      const urlEl = itemWrapper.querySelector('[data-link-suggestion-url]');

      expect(urlEl?.textContent).toBe('https://notion.so');
    });

    it('hides suggestion when popover closes', () => {
      const { tool } = createTool();
      const renderResult = tool.render() as unknown as LinkToolRenderResult;
      const itemWrapper = renderResult.children.items[0].element;

      (tool as unknown as { updateSuggestion(v: string): void }).updateSuggestion('https://example.com');
      renderResult.children.onClose();

      const chip = getSuggestionChip(itemWrapper);

      expect(chip?.classList.contains('hidden')).toBe(true);
    });

    it('confirmLink inserts link and closes toolbar', () => {
      const { tool, selection, inlineToolbar } = createTool();
      const renderResult = tool.render() as unknown as LinkToolRenderResult;
      const input = getInputFromWrapper(renderResult.children.items[0].element);
      const insertLinkSpy = vi.spyOn(tool as unknown as { insertLink(link: string): void }, 'insertLink');

      input.value = 'example.com';

      (tool as unknown as { confirmLink(): void }).confirmLink();

      expect(insertLinkSpy).toHaveBeenCalledWith('http://example.com');
      expect(selection.collapseToEnd).toHaveBeenCalled();
      expect(inlineToolbar.close).toHaveBeenCalled();
    });

    it('confirmLink shows notifier for complete-looking URL with spaces and does not insert', () => {
      const { tool, notifier } = createTool();
      const renderResult = tool.render() as unknown as LinkToolRenderResult;
      const input = getInputFromWrapper(renderResult.children.items[0].element);
      const insertLinkSpy = vi.spyOn(tool as unknown as { insertLink(link: string): void }, 'insertLink');

      // Has a protocol so isLinkComplete passes, but space makes validateURL fail
      input.value = 'https://google .com';

      (tool as unknown as { confirmLink(): void }).confirmLink();

      expect(notifier.show).toHaveBeenCalledWith({ message: 'tools.link.invalidLink', style: 'error' });
      expect(insertLinkSpy).not.toHaveBeenCalled();
    });

    it('confirmLink does nothing silently for incomplete URLs', () => {
      const { tool, notifier, inlineToolbar } = createTool();
      const renderResult = tool.render() as unknown as LinkToolRenderResult;
      const input = getInputFromWrapper(renderResult.children.items[0].element);
      const insertLinkSpy = vi.spyOn(tool as unknown as { insertLink(link: string): void }, 'insertLink');

      input.value = 'asd';

      (tool as unknown as { confirmLink(): void }).confirmLink();

      expect(insertLinkSpy).not.toHaveBeenCalled();
      expect(notifier.show).not.toHaveBeenCalled();
      expect(inlineToolbar.close).not.toHaveBeenCalled();
    });

    it('confirmLink does nothing when input is empty', () => {
      const { tool, inlineToolbar } = createTool();
      const renderResult = tool.render() as unknown as LinkToolRenderResult;
      const input = getInputFromWrapper(renderResult.children.items[0].element);
      const insertLinkSpy = vi.spyOn(tool as unknown as { insertLink(link: string): void }, 'insertLink');

      input.value = '';

      (tool as unknown as { confirmLink(): void }).confirmLink();

      expect(insertLinkSpy).not.toHaveBeenCalled();
      expect(inlineToolbar.close).not.toHaveBeenCalled();
    });
  });

  describe('isLinkComplete', () => {
    const check = (tool: InstanceType<typeof LinkInlineTool>, url: string) =>
      (tool as unknown as { isLinkComplete(u: string): boolean }).isLinkComplete(url);

    it('accepts https:// with a host', () => {
      const { tool } = createTool();

      expect(check(tool, 'https://g')).toBe(true);
      expect(check(tool, 'https://google.com')).toBe(true);
    });

    it('rejects bare https:// with no host', () => {
      const { tool } = createTool();

      expect(check(tool, 'https://')).toBe(false);
      expect(check(tool, 'http://')).toBe(false);
    });

    it('accepts other ://  protocols with a host', () => {
      const { tool } = createTool();

      expect(check(tool, 'ftp://server')).toBe(true);
      expect(check(tool, 'ftp://')).toBe(false);
    });

    it('accepts mailto: with an address', () => {
      const { tool } = createTool();

      expect(check(tool, 'mailto:a')).toBe(true);
      expect(check(tool, 'mailto:user@example.com')).toBe(true);
    });

    it('rejects bare mailto:', () => {
      const { tool } = createTool();

      expect(check(tool, 'mailto:')).toBe(false);
    });

    it('accepts other single-colon schemes with content', () => {
      const { tool } = createTool();

      expect(check(tool, 'tel:+1234567890')).toBe(true);
      expect(check(tool, 'sms:+1')).toBe(true);
    });

    it('accepts protocol-relative URLs with a host', () => {
      const { tool } = createTool();

      expect(check(tool, '//cdn.example.com')).toBe(true);
      expect(check(tool, '//')).toBe(false);
    });

    it('accepts anchors with content after #', () => {
      const { tool } = createTool();

      expect(check(tool, '#section')).toBe(true);
      expect(check(tool, '#')).toBe(false);
    });

    it('accepts any absolute internal path', () => {
      const { tool } = createTool();

      expect(check(tool, '/')).toBe(true);
      expect(check(tool, '/dashboard')).toBe(true);
    });

    it('accepts plain text with a recognisable TLD', () => {
      const { tool } = createTool();

      expect(check(tool, 'google.com')).toBe(true);
      expect(check(tool, 'sub.example.co.uk')).toBe(true);
    });

    it('accepts IP addresses', () => {
      const { tool } = createTool();

      expect(check(tool, '192.168.1.1')).toBe(true);
      expect(check(tool, '10.0.0.1')).toBe(true);
    });

    it('rejects plain words with no domain structure', () => {
      const { tool } = createTool();

      expect(check(tool, 'asd')).toBe(false);
      expect(check(tool, 'localhost')).toBe(false);
      expect(check(tool, 'google')).toBe(false);
    });
  });
});

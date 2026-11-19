import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { IconGlobe, IconLink, IconPage, IconPhone, IconTable } from '../../../../src/components/icons';

import defaultDictionary from '../../../../src/components/i18n/locales/en.json';
import { LinkInlineTool } from '../../../../src/components/inline-tools/inline-tool-link';
import { clean } from '../../../../src/components/utils/sanitizer';
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
  const input = wrapper.querySelector<HTMLInputElement>('[data-blok-testid="inline-tool-input"]');

  if (!input) {
    throw new Error('Input not found in wrapper');
  }

  return input;
};

const getSuggestionChip = (itemWrapper: HTMLElement): HTMLElement | null => {
  return itemWrapper.querySelector<HTMLElement>('[data-link-suggestion]');
};

const getTitleInput = (itemWrapper: HTMLElement): HTMLInputElement => {
  const input = itemWrapper.querySelector<HTMLInputElement>('[data-blok-testid="inline-tool-title-input"]');

  if (!input) {
    throw new Error('Title input not found in wrapper');
  }

  return input;
};

const getRemoveButton = (itemWrapper: HTMLElement): HTMLButtonElement => {
  const button = itemWrapper.querySelector<HTMLButtonElement>('[data-blok-testid="inline-tool-remove-link"]');

  if (!button) {
    throw new Error('Remove-link button not found in wrapper');
  }

  return button;
};

type LinkConfig = {
  unfurl?: { endpoint: string };
  target?: string;
  rel?: string;
  transformHref?: (href: string) => string;
  transform?: (context: { href: string; text: string; element: HTMLAnchorElement }) => {
    href?: string;
    target?: string;
    rel?: string;
    attributes?: Record<string, string>;
  } | void;
};

const ENGLISH_LINK_TRANSLATIONS: Record<string, string> = {
  'tools.link.keepTyping': defaultDictionary['tools.link.keepTyping'],
  'tools.link.emailAddress': defaultDictionary['tools.link.emailAddress'],
  'tools.link.jumpToSection': defaultDictionary['tools.link.jumpToSection'],
  'tools.link.webLink': defaultDictionary['tools.link.webLink'],
  'tools.link.webPage': defaultDictionary['tools.link.webPage'],
  'tools.link.phoneNumber': defaultDictionary['tools.link.phoneNumber'],
  'tools.link.recent': defaultDictionary['tools.link.recent'],
  'tools.link.onThisPage': defaultDictionary['tools.link.onThisPage'],
  'tools.database.moveToPages': defaultDictionary['tools.database.moveToPages'],
  'tools.page.unresolved': defaultDictionary['tools.page.unresolved'],
  'tools.page.draft': defaultDictionary['tools.page.draft'],
};

type PageHit = { pageId: string; title?: string; icon?: { type: 'emoji'; value: string }; access?: 'none'; kind?: 'database'; path?: string[]; status?: 'draft' | 'published' };

type PageHost = {
  search?: (query: string) => Promise<readonly PageHit[]>;
  href?: (pageId: string) => string;
};

/**
 * The page tool's config the tool sees through `api.tools`. Reset before every test.
 */
const pageHost: { config: PageHost | null } = { config: null };

type DocumentBlock = { id: string; name: string; holder: HTMLElement };

/**
 * Blocks the tool sees through `api.blocks`. Reset before every test.
 */
const documentBlocks: DocumentBlock[] = [];

const addBlock = (id: string, content: HTMLElement, name = 'header'): HTMLElement => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');
  holder.append(content);
  documentBlocks.push({ id, name, holder });

  return holder;
};

const addHeading = (level: number, text: string, id = `heading-${documentBlocks.length}`): HTMLElement => {
  const heading = document.createElement(`h${level}`);

  heading.textContent = text;

  return addBlock(id, heading);
};

const createTool = (
  linkConfig?: LinkConfig,
  translations: Record<string, string> = ENGLISH_LINK_TRANSLATIONS
): ToolSetup => {
  const toolbar = { close: vi.fn() };
  const inlineToolbar = { close: vi.fn() };
  const notifier = { show: vi.fn() };
  const i18n = {
    t: vi.fn((phrase: string) => translations[phrase] ?? phrase),
    has: vi.fn((phrase: string) => phrase in translations),
  };

  const api = {
    toolbar,
    inlineToolbar,
    notifier,
    i18n,
    blocks: {
      getBlocksCount: () => documentBlocks.length,
      getBlockByIndex: (index: number) => documentBlocks[index],
    },
    tools: {
      getBlockTools: () => pageHost.config === null ? [] : [{ name: 'page', settings: pageHost.config }],
    },
    config: {
      link: linkConfig,
    },
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
    vi.clearAllMocks();
    document.body.innerHTML = '';
    setDocumentCommand(vi.fn());
    localStorage.removeItem('blok-recent-links');
    documentBlocks.length = 0;
    pageHost.config = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes inline metadata and shortcut', () => {
    expect(LinkInlineTool.isInline).toBe(true);
    expect(LinkInlineTool.title).toBe('Link');
    expect(LinkInlineTool.shortcut).toBe('CMD+K');
  });

  it('keeps ordinary link attributes but strips stale page-reference metadata', () => {
    const ordinary = '<a href="#section" target="_self" rel="noopener">Jump</a>';
    const staleReference = '<a data-blok-page-id="p1" href="/old" title="Old">Old</a>';

    expect(clean(staleReference, LinkInlineTool.sanitize)).toBe('<a data-blok-page-id="p1">Page</a>');
    expect(clean(ordinary, LinkInlineTool.sanitize)).toBe(ordinary);
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

  it('leaves the link field placement to the inline toolbar, which drops it over the card', () => {
    const { tool } = createTool();
    const config = tool.render() as unknown as { children: { placement?: string } };

    expect(config.children.placement).toBeUndefined();
  });

  it('stretches the input to fill the popover width instead of a fixed pixel width', () => {
    const { tool } = createTool();
    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const wrapper = renderResult.children.items[0].element;
    const input = getInputFromWrapper(wrapper);

    expect(input.className).toContain('w-full');
    // No standalone fixed pixel width (a `min-w-[200px]` floor is fine).
    expect(input.className).not.toMatch(/(^|\s)w-\[200px\]/);
  });

  it('keeps one card width while the typed link and the lists change, and goes fluid on mobile', () => {
    const { tool } = createTool();
    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const wrapper = renderResult.children.items[0].element;
    const input = getInputFromWrapper(wrapper);

    renderResult.children.onOpen();
    input.value = 'https://a-very-long-link.example.com/with/a/deep/path?and=query';
    input.dispatchEvent(new Event('input'));

    expect(wrapper.className).toMatch(/(^|\s)w-80(\s|$)/);
    expect(wrapper.className).toMatch(/(^|\s)mobile:w-auto(\s|$)/);
    expect(input.style.width).toBe('');
  });

  it('tells the user the field takes a link and searches headings', () => {
    const { tool } = createTool(undefined, { 'tools.link.addLink': defaultDictionary['tools.link.addLink'] });
    const renderResult = tool.render() as unknown as LinkToolRenderResult;

    expect(getInputFromWrapper(renderResult.children.items[0].element).placeholder).toBe('Paste link or search pages');
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

  it('surfaces the inline validation error (not a toast) when URL validation fails', () => {
    const { tool, notifier } = createTool();
    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const input = getInputFromWrapper(renderResult.children.items[0].element);
    const insertLinkSpy = vi.spyOn(tool as unknown as { insertLink(link: string): void }, 'insertLink');

    input.value = 'https://google .com';

    (tool as unknown as { enterPressed(event: KeyboardEvent): void }).enterPressed(createEnterEventStubs() as unknown as KeyboardEvent);

    // The failure is surfaced once, via the accessible inline field error —
    // a duplicate toast would render the same "Invalid link" text twice.
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(notifier.show).not.toHaveBeenCalled();
    expect(insertLinkSpy).not.toHaveBeenCalled();
  });

  it('marks the input aria-invalid and shows an inline error when validation fails', () => {
    const { tool } = createTool();
    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const wrapper = renderResult.children.items[0].element;
    const input = getInputFromWrapper(wrapper);

    input.value = 'https://google .com';

    (tool as unknown as { enterPressed(event: KeyboardEvent): void }).enterPressed(createEnterEventStubs() as unknown as KeyboardEvent);

    const error = wrapper.querySelector<HTMLElement>('[data-blok-link-tool-error]');

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(error).not.toBeNull();
    expect(error?.hidden).toBe(false);
    // trim(): the decorative warning icon's SVG markup contributes formatting
    // whitespace to textContent; the announced message is what matters.
    expect(error?.textContent?.trim()).toBe('tools.link.invalidLink');
    expect(error?.id).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toContain(error?.id ?? '');
  });

  it('clears the aria-invalid error once the user edits the input', () => {
    const { tool } = createTool();
    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const wrapper = renderResult.children.items[0].element;
    const input = getInputFromWrapper(wrapper);

    input.value = 'https://google .com';
    (tool as unknown as { enterPressed(event: KeyboardEvent): void }).enterPressed(createEnterEventStubs() as unknown as KeyboardEvent);
    expect(input.getAttribute('aria-invalid')).toBe('true');

    input.value = 'https://google.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const error = wrapper.querySelector<HTMLElement>('[data-blok-link-tool-error]');

    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(error?.hidden).toBe(true);
  });

  it('hides the suggestion row while the validation error is shown', () => {
    const { tool } = createTool();
    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const wrapper = renderResult.children.items[0].element;
    const input = getInputFromWrapper(wrapper);

    input.value = 'https://google .com';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Typing a complete-looking URL surfaces the suggestion row.
    expect(getSuggestionChip(wrapper)?.classList.contains('hidden')).toBe(false);

    (tool as unknown as { enterPressed(event: KeyboardEvent): void }).enterPressed(createEnterEventStubs() as unknown as KeyboardEvent);

    // The error and the confirmable suggestion row contradict each other —
    // while "Invalid link" is shown the row must not offer the same URL.
    expect(getSuggestionChip(wrapper)?.classList.contains('hidden')).toBe(true);
  });

  it('restores the suggestion row when the user edits the input after an error', () => {
    const { tool } = createTool();
    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const wrapper = renderResult.children.items[0].element;
    const input = getInputFromWrapper(wrapper);

    input.value = 'https://google .com';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    (tool as unknown as { enterPressed(event: KeyboardEvent): void }).enterPressed(createEnterEventStubs() as unknown as KeyboardEvent);

    input.value = 'https://google.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const error = wrapper.querySelector<HTMLElement>('[data-blok-link-tool-error]');

    expect(error?.hidden).toBe(true);
    expect(getSuggestionChip(wrapper)?.classList.contains('hidden')).toBe(false);
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+',
    'vbscript:msgbox(1)',
  ])('rejects unsafe URL scheme %s', (unsafeUrl) => {
    const { tool, notifier } = createTool();
    const renderResult = tool.render() as unknown as LinkToolRenderResult;
    const input = getInputFromWrapper(renderResult.children.items[0].element);
    const insertLinkSpy = vi.spyOn(tool as unknown as { insertLink(link: string): void }, 'insertLink');

    input.value = unsafeUrl;

    (tool as unknown as { enterPressed(event: KeyboardEvent): void }).enterPressed(createEnterEventStubs() as unknown as KeyboardEvent);

    // Rejected via the accessible inline field error, not a duplicate toast.
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(notifier.show).not.toHaveBeenCalled();
    expect(insertLinkSpy).not.toHaveBeenCalled();
  });

  it('inserts prepared link and keeps the linked text selected when URL is valid', () => {
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
    expect(selection.collapseToEnd).not.toHaveBeenCalled();
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

  describe('global link config', () => {
    const insertNewAnchor = (tool: InstanceType<typeof LinkInlineTool>, href: string): HTMLAnchorElement => {
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

      (tool as unknown as { insertLink(link: string): void }).insertLink(href);

      const anchor = document.querySelector('a');

      if (!anchor) {
        throw new Error('Anchor not inserted');
      }

      return anchor;
    };

    it('defaults to target="_blank" and rel="nofollow" when no link config is provided', () => {
      const { tool } = createTool();
      const anchor = insertNewAnchor(tool, 'https://google.com');

      expect(anchor.target).toBe('_blank');
      expect(anchor.rel).toBe('nofollow');
    });

    it('applies configured target and rel to created anchors', () => {
      const { tool } = createTool({ target: '_self', rel: 'noopener noreferrer' });
      const anchor = insertNewAnchor(tool, 'https://google.com');

      expect(anchor.target).toBe('_self');
      expect(anchor.rel).toBe('noopener noreferrer');
    });

    it('applies configured target and rel when editing an existing anchor', () => {
      const { tool, selection } = createTool({ target: '_top', rel: 'sponsored' });

      const existing = document.createElement('a');

      existing.href = 'https://old.com';
      existing.textContent = 'link';
      document.body.appendChild(existing);
      selection.findParentTag.mockReturnValue(existing);

      (tool as unknown as { insertLink(link: string): void }).insertLink('https://new.com');

      expect(existing.target).toBe('_top');
      expect(existing.rel).toBe('sponsored');
    });

    it('forces target="_self" for anchor links even when config sets _blank', () => {
      const { tool } = createTool({ target: '_blank' });
      const anchor = insertNewAnchor(tool, '#results');

      expect(anchor.target).toBe('_self');
    });

    it('forces target="_self" for same-page links even when config sets _blank', () => {
      const { tool } = createTool({ target: '_blank' });
      const samePage = `${window.location.origin}${window.location.pathname}#section`;
      const anchor = insertNewAnchor(tool, samePage);

      expect(anchor.target).toBe('_self');
    });

    it('forces target="_self" for same-page links when editing an existing anchor', () => {
      const { tool, selection } = createTool({ target: '_blank' });

      const existing = document.createElement('a');

      existing.href = 'https://old.com';
      existing.textContent = 'link';
      document.body.appendChild(existing);
      selection.findParentTag.mockReturnValue(existing);

      (tool as unknown as { insertLink(link: string): void }).insertLink('#anchor');

      expect(existing.target).toBe('_self');
    });

    it('keeps the configured target for cross-page links', () => {
      const { tool } = createTool({ target: '_blank' });
      const anchor = insertNewAnchor(tool, 'https://google.com');

      expect(anchor.target).toBe('_blank');
    });

    it('transforms the href via transformHref before assigning it to the anchor', () => {
      const transformHref = vi.fn((href: string) => `https://proxy.example/?u=${encodeURIComponent(href)}`);
      const { tool } = createTool({ transformHref });
      const anchor = insertNewAnchor(tool, 'https://google.com/');

      expect(transformHref).toHaveBeenCalledWith('https://google.com/');
      expect(anchor.getAttribute('href')).toBe('https://proxy.example/?u=https%3A%2F%2Fgoogle.com%2F');
    });

    it('applies the richer transform (href/rel/attributes + anchor text) to created anchors', () => {
      const transform = vi.fn(() => ({
        href: 'https://public.example/page',
        rel: 'noopener',
        attributes: { class: 'kb-link', 'data-internal': 'true' },
      }));
      const { tool } = createTool({ transform });
      const anchor = insertNewAnchor(tool, 'https://kb.internal/page');

      expect(transform).toHaveBeenCalledWith({
        href: 'https://kb.internal/page',
        text: 'selected text',
        element: anchor,
      });
      expect(anchor.getAttribute('href')).toBe('https://public.example/page');
      expect(anchor.getAttribute('rel')).toBe('noopener');
      // target omitted by the transform → cross-page default.
      expect(anchor.getAttribute('target')).toBe('_blank');
      expect(anchor.getAttribute('class')).toBe('kb-link');
      expect(anchor.getAttribute('data-internal')).toBe('true');
    });

    it('applies the richer transform when editing an existing anchor', () => {
      const { tool, selection } = createTool({ transform: () => ({ href: 'https://rewritten.example/', rel: 'sponsored' }) });

      const existing = document.createElement('a');

      existing.href = 'https://old.com';
      existing.textContent = 'old text';
      document.body.appendChild(existing);
      selection.findParentTag.mockReturnValue(existing);

      (tool as unknown as { insertLink(link: string): void }).insertLink('https://new.com');

      expect(existing.getAttribute('href')).toBe('https://rewritten.example/');
      expect(existing.getAttribute('rel')).toBe('sponsored');
    });
  });

  describe('suggestion chip', () => {
    it.each([
      {
        value: 'incomplet',
        key: 'tools.link.keepTyping',
        translation: 'Continuez à saisir pour ajouter un lien',
      },
      {
        value: 'mailto:hello@example.com',
        key: 'tools.link.emailAddress',
        translation: 'Adresse e-mail',
      },
      {
        value: '#results',
        key: 'tools.link.jumpToSection',
        translation: 'Aller à une section',
      },
      {
        value: 'https://example.com',
        key: 'tools.link.webPage',
        translation: 'Lien vers une page web',
      },
      {
        value: 'sms:+15551234567',
        key: 'tools.link.webLink',
        translation: 'Lien',
      },
    ])('localizes the $key suggestion label', ({ value, key, translation }) => {
      const { tool } = createTool(undefined, { [key]: translation });
      const itemWrapper = (tool.render() as unknown as LinkToolRenderResult).children.items[0].element;

      (tool as unknown as { updateSuggestion(v: string): void }).updateSuggestion(value);

      const typeEl = itemWrapper.querySelector('[data-link-suggestion-type]');

      expect(typeEl?.textContent).toBe(translation);
    });

    it.each([
      'https://example.com',
      'HTTP://example.com',
      '//cdn.example.com/file.js',
      '/docs/getting-started',
      'example.com',
      'localhost:3000/docs',
    ])('says a web address leads to a web page: %s', value => {
      const { tool } = createTool();
      const itemWrapper = (tool.render() as unknown as LinkToolRenderResult).children.items[0].element;

      (tool as unknown as { updateSuggestion(v: string): void }).updateSuggestion(value);

      const typeEl = itemWrapper.querySelector('[data-link-suggestion-type]');

      expect(typeEl?.textContent).toBe('Link to web page');
    });

    it.each(['tel:+15551234567', 'TEL:911'])('says %s is a link to a phone number', value => {
      const { tool } = createTool();
      const itemWrapper = (tool.render() as unknown as LinkToolRenderResult).children.items[0].element;

      (tool as unknown as { updateSuggestion(v: string): void }).updateSuggestion(value);

      expect(itemWrapper.querySelector('[data-link-suggestion-type]')?.textContent).toBe('Link to phone number');
    });

    it.each([
      'ftp://files.example.com',
      'sms:+15551234567',
    ])('keeps the plain link label for %s, which is no web page', value => {
      const { tool } = createTool();
      const itemWrapper = (tool.render() as unknown as LinkToolRenderResult).children.items[0].element;

      (tool as unknown as { updateSuggestion(v: string): void }).updateSuggestion(value);

      const typeEl = itemWrapper.querySelector('[data-link-suggestion-type]');

      expect(typeEl?.textContent).toBe('Link');
    });

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

    it('labels mailto: links as a link to an email address', () => {
      const { tool } = createTool();
      const wrapper = tool.render() as unknown as LinkToolRenderResult;
      const itemWrapper = wrapper.children.items[0].element;

      (tool as unknown as { updateSuggestion(v: string): void }).updateSuggestion('mailto:hello@example.com');

      const typeEl = itemWrapper.querySelector('[data-link-suggestion-type]');

      expect(typeEl?.textContent).toBe('Link to email address');
    });

    it('shows invalid label and disables row for incomplete URLs', () => {
      const { tool } = createTool();
      const itemWrapper = (tool.render() as unknown as LinkToolRenderResult).children.items[0].element;

      (tool as unknown as { updateSuggestion(v: string): void }).updateSuggestion('asd');

      const typeEl = itemWrapper.querySelector('[data-link-suggestion-type]');
      const row = itemWrapper.querySelector('[data-link-suggestion-row]');

      expect(typeEl?.textContent).toBe('Keep typing to add link');
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

    it('shows the enter-key hint only when the URL is confirmable', () => {
      const { tool } = createTool();
      const itemWrapper = (tool.render() as unknown as LinkToolRenderResult).children.items[0].element;
      const update = tool as unknown as { updateSuggestion(v: string): void };

      update.updateSuggestion('asd');

      const hint = itemWrapper.querySelector<HTMLElement>('[data-link-suggestion-enter-hint]');

      expect(hint).not.toBeNull();
      // Incomplete URL: pressing Enter would fail, so the hint must not promise it.
      expect(hint?.classList.contains('hidden')).toBe(true);

      update.updateSuggestion('https://example.com');

      expect(hint?.classList.contains('hidden')).toBe(false);
    });

    it.each([
      ['tel:+15551234567', IconPhone],
      ['TEL:911', IconPhone],
      ['sms:+15551234567', IconGlobe],
      ['telegram.org', IconGlobe],
    ])('draws the sign for %s: a telephone for a phone number only', (value, svg) => {
      const { tool } = createTool();
      const itemWrapper = (tool.render() as unknown as LinkToolRenderResult).children.items[0].element;
      const expected = document.createElement('span');

      expected.innerHTML = svg;
      (tool as unknown as { updateSuggestion(v: string): void }).updateSuggestion(value);

      expect(itemWrapper.querySelector('[data-link-suggestion-icon]')?.innerHTML).toBe(expected.innerHTML);
    });

    it('shows the suggestion icon and the enter-key hint as bare glyphs, with no chip behind them', () => {
      const { tool } = createTool();
      const itemWrapper = (tool.render() as unknown as LinkToolRenderResult).children.items[0].element;

      (tool as unknown as { updateSuggestion(v: string): void }).updateSuggestion('https://example.com');

      const icon = itemWrapper.querySelector<HTMLElement>('[data-link-suggestion-icon]');
      const hint = itemWrapper.querySelector<HTMLElement>('[data-link-suggestion-enter-hint]');

      expect(icon?.className).toContain('size-6');
      expect(icon?.className).not.toContain('bg-popover-icon-bg');
      expect(icon?.className).not.toContain('rounded-md');
      expect(hint?.className).toContain('size-5');
      expect(hint?.className).not.toContain('bg-popover-icon-bg');
      expect(hint?.className).not.toContain('rounded-md');
    });

    it('prefills the URL field and suppresses the suggestion chip when editing an existing link', () => {
      const { tool, selection } = createTool();
      const anchor = document.createElement('a');

      anchor.setAttribute('href', 'https://notion.so');
      selection.findParentTag.mockReturnValue(anchor);

      const renderResult = tool.render() as unknown as LinkToolRenderResult;

      renderResult.children.onOpen();

      const itemWrapper = renderResult.children.items[0].element;

      // Edit mode uses the labeled fields, not the create-mode suggestion chip.
      expect(getInputFromWrapper(itemWrapper).value).toBe('https://notion.so');
      expect(getSuggestionChip(itemWrapper)?.classList.contains('hidden')).toBe(true);
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

    it('confirmLink inserts link, keeps the linked text selected and closes toolbar', () => {
      const { tool, selection, inlineToolbar } = createTool();
      const renderResult = tool.render() as unknown as LinkToolRenderResult;
      const input = getInputFromWrapper(renderResult.children.items[0].element);
      const insertLinkSpy = vi.spyOn(tool as unknown as { insertLink(link: string): void }, 'insertLink');

      input.value = 'example.com';

      (tool as unknown as { confirmLink(): void }).confirmLink();

      expect(insertLinkSpy).toHaveBeenCalledWith('http://example.com');
      expect(selection.collapseToEnd).not.toHaveBeenCalled();
      expect(inlineToolbar.close).toHaveBeenCalled();
    });

    it('confirmLink surfaces the inline validation error for a complete-looking URL with spaces and does not insert', () => {
      const { tool, notifier } = createTool();
      const renderResult = tool.render() as unknown as LinkToolRenderResult;
      const input = getInputFromWrapper(renderResult.children.items[0].element);
      const insertLinkSpy = vi.spyOn(tool as unknown as { insertLink(link: string): void }, 'insertLink');

      // Has a protocol so isLinkComplete passes, but space makes validateURL fail
      input.value = 'https://google .com';

      (tool as unknown as { confirmLink(): void }).confirmLink();

      // The failure is surfaced once, via the accessible inline field error
      // (aria-invalid), NOT a duplicate toast notification.
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(notifier.show).not.toHaveBeenCalled();
      expect(insertLinkSpy).not.toHaveBeenCalled();
    });

    it.each([
      ['Enter', (tool: unknown): void => (tool as { enterPressed(event: KeyboardEvent): void }).enterPressed(createEnterEventStubs() as unknown as KeyboardEvent)],
      ['a click on the row', (tool: unknown): void => (tool as { confirmLink(): void }).confirmLink()],
    ])('drops the spaces around a pasted address instead of refusing it, on %s', (_name, confirm) => {
      const { tool } = createTool();
      const renderResult = tool.render() as unknown as LinkToolRenderResult;
      const input = getInputFromWrapper(renderResult.children.items[0].element);
      const insertLinkSpy = vi.spyOn(tool as unknown as { insertLink(link: string): void }, 'insertLink');

      input.value = ' \thttps://google.com/page \n';

      confirm(tool);

      expect(insertLinkSpy).toHaveBeenCalledWith('https://google.com/page');
      expect(input.hasAttribute('aria-invalid')).toBe(false);
    });

    it.each([
      ['localhost:3000/docs', 'http://localhost:3000/docs'],
      ['example.com:8080', 'http://example.com:8080'],
      ['192.168.0.1:8080?x=1', 'http://192.168.0.1:8080?x=1'],
    ])('reads %s as a site with a port and adds the protocol, instead of refusing it', (typed, href) => {
      const { tool } = createTool();
      const renderResult = tool.render() as unknown as LinkToolRenderResult;
      const input = getInputFromWrapper(renderResult.children.items[0].element);
      const insertLinkSpy = vi.spyOn(tool as unknown as { insertLink(link: string): void }, 'insertLink');

      input.value = typed;
      (tool as unknown as { enterPressed(event: KeyboardEvent): void }).enterPressed(createEnterEventStubs() as unknown as KeyboardEvent);

      expect(insertLinkSpy).toHaveBeenCalledWith(href);
      expect(input.hasAttribute('aria-invalid')).toBe(false);
    });

    it.each(['tel:911', 'sms:12345', 'mailto:1'])('leaves %s alone: a short number after a known kind is no port', (typed) => {
      const { tool } = createTool();
      const renderResult = tool.render() as unknown as LinkToolRenderResult;
      const input = getInputFromWrapper(renderResult.children.items[0].element);
      const insertLinkSpy = vi.spyOn(tool as unknown as { insertLink(link: string): void }, 'insertLink');

      input.value = typed;
      (tool as unknown as { enterPressed(event: KeyboardEvent): void }).enterPressed(createEnterEventStubs() as unknown as KeyboardEvent);

      expect(insertLinkSpy).toHaveBeenCalledWith(typed);
    });

    it('still refuses an address that can run code, port-like or not', () => {
      const { tool } = createTool();
      const renderResult = tool.render() as unknown as LinkToolRenderResult;
      const input = getInputFromWrapper(renderResult.children.items[0].element);
      const insertLinkSpy = vi.spyOn(tool as unknown as { insertLink(link: string): void }, 'insertLink');

      input.value = 'javascript:alert(1)';
      (tool as unknown as { enterPressed(event: KeyboardEvent): void }).enterPressed(createEnterEventStubs() as unknown as KeyboardEvent);

      expect(insertLinkSpy).not.toHaveBeenCalled();
      expect(input.getAttribute('aria-invalid')).toBe('true');
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

  describe('edit mode (title field + remove button)', () => {
    const openEditing = (
      href = 'https://example.com',
      text = 'existing text'
    ): { tool: InstanceType<typeof LinkInlineTool>; selection: SelectionMock; inlineToolbar: { close: ReturnType<typeof vi.fn> }; anchor: HTMLAnchorElement; itemWrapper: HTMLElement } => {
      const setup = createTool();
      const anchor = document.createElement('a');

      anchor.setAttribute('href', href);
      anchor.textContent = text;
      document.body.appendChild(anchor);
      setup.selection.findParentTag.mockReturnValue(anchor);

      const renderResult = setup.tool.render() as unknown as LinkToolRenderResult;

      renderResult.children.onOpen();

      return {
        tool: setup.tool,
        selection: setup.selection,
        inlineToolbar: setup.inlineToolbar,
        anchor,
        itemWrapper: renderResult.children.items[0].element,
      };
    };

    it('shows the "Page or URL" and "Link title" field labels when editing', () => {
      const { itemWrapper } = openEditing();
      const urlLabel = itemWrapper.querySelector<HTMLElement>('[data-blok-testid="inline-tool-url-label"]');
      const titleLabel = itemWrapper.querySelector<HTMLElement>('[data-blok-testid="inline-tool-title-label"]');

      expect(urlLabel?.textContent).toBe('tools.link.pageOrUrl');
      expect(titleLabel?.textContent).toBe('tools.link.linkTitle');
      expect(urlLabel?.classList.contains('hidden')).toBe(false);
      expect(titleLabel?.classList.contains('hidden')).toBe(false);
    });

    it('hides the field labels when creating a new link', () => {
      const { tool, selection } = createTool();

      selection.findParentTag.mockReturnValue(null);

      const renderResult = tool.render() as unknown as LinkToolRenderResult;

      renderResult.children.onOpen();

      const itemWrapper = renderResult.children.items[0].element;
      const urlLabel = itemWrapper.querySelector<HTMLElement>('[data-blok-testid="inline-tool-url-label"]');
      const titleLabel = itemWrapper.querySelector<HTMLElement>('[data-blok-testid="inline-tool-title-label"]');

      expect(urlLabel?.classList.contains('hidden')).toBe(true);
      expect(titleLabel?.classList.contains('hidden')).toBe(true);
    });

    it('orders the URL field above the title field', () => {
      const { itemWrapper } = openEditing();
      const url = getInputFromWrapper(itemWrapper);
      const title = getTitleInput(itemWrapper);

      // Node.DOCUMENT_POSITION_FOLLOWING (4): title comes after url in the DOM.
      expect(url.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('reveals the title field prefilled with the link text and the remove button when editing', () => {
      const { itemWrapper } = openEditing('https://example.com', 'Blok repo');
      const titleInput = getTitleInput(itemWrapper);
      const removeButton = getRemoveButton(itemWrapper);

      expect(titleInput.value).toBe('Blok repo');
      expect(titleInput.classList.contains('hidden')).toBe(false);
      expect(removeButton.classList.contains('hidden')).toBe(false);
    });

    it('keeps the title field and remove button hidden when creating a new link', () => {
      const { tool, selection } = createTool();

      selection.findParentTag.mockReturnValue(null);

      const renderResult = tool.render() as unknown as LinkToolRenderResult;

      renderResult.children.onOpen();

      const itemWrapper = renderResult.children.items[0].element;

      expect(getTitleInput(itemWrapper).classList.contains('hidden!')).toBe(true);
      expect(getRemoveButton(itemWrapper).classList.contains('hidden')).toBe(true);
    });

    it('removes the link and closes the toolbar when the remove button is clicked', () => {
      const { itemWrapper, inlineToolbar } = openEditing('https://example.com', 'link text');
      const removeButton = getRemoveButton(itemWrapper);

      removeButton.click();

      expect(document.querySelector('a')).toBeNull();
      expect(document.body).toHaveTextContent('link text');
      expect(inlineToolbar.close).toHaveBeenCalled();
    });

    it('rewrites the anchor text when the title field changes before confirming', () => {
      const { tool, itemWrapper, anchor } = openEditing('https://old.com', 'old text');
      const titleInput = getTitleInput(itemWrapper);
      const urlInput = getInputFromWrapper(itemWrapper);

      titleInput.value = 'new title';
      urlInput.value = 'https://new.com';

      (tool as unknown as { confirmLink(): void }).confirmLink();

      expect(anchor.getAttribute('href')).toBe('https://new.com');
      expect(anchor.textContent).toBe('new title');
    });

    it('leaves the anchor content untouched when the title field is unchanged', () => {
      const { tool, itemWrapper, anchor } = openEditing('https://old.com', 'keep me');

      anchor.innerHTML = '<strong>keep me</strong>';

      const urlInput = getInputFromWrapper(itemWrapper);

      urlInput.value = 'https://new.com';

      (tool as unknown as { confirmLink(): void }).confirmLink();

      // Title unchanged → formatting preserved (not flattened to plain text).
      expect(anchor.querySelector('strong')).not.toBeNull();
    });

    it('clears and hides the title field and remove button when the popover closes', () => {
      const { tool, itemWrapper } = openEditing('https://example.com', 'text');
      const renderResult = tool.render() as unknown as LinkToolRenderResult;

      renderResult.children.onClose();

      const titleInput = getTitleInput(itemWrapper);
      const removeButton = getRemoveButton(itemWrapper);

      expect(titleInput.value).toBe('');
      expect(titleInput.classList.contains('hidden!')).toBe(true);
      expect(removeButton.classList.contains('hidden')).toBe(true);
    });
  });

  describe('recent links', () => {
    type RecentTool = {
      insertLink(link: string): void;
      enterPressed(event: KeyboardEvent): void;
    };

    const openCreating = (
      linkConfig?: LinkConfig
    ): ToolSetup & { itemWrapper: HTMLElement; input: HTMLInputElement } => {
      const setup = createTool(linkConfig);

      vi.spyOn(setup.tool as unknown as RecentTool, 'insertLink').mockImplementation(() => undefined);

      const renderResult = setup.tool.render() as unknown as LinkToolRenderResult;
      const itemWrapper = renderResult.children.items[0].element;

      document.body.appendChild(itemWrapper);
      renderResult.children.onOpen();

      return { ...setup, itemWrapper, input: getInputFromWrapper(itemWrapper) };
    };

    const seed = (entries: { url: string; title?: string; image?: string; checked?: boolean }[]): void => {
      localStorage.setItem('blok-recent-links', JSON.stringify(entries));
    };

    const recentSection = (itemWrapper: HTMLElement): HTMLElement | null =>
      itemWrapper.querySelector<HTMLElement>('[data-link-recent]');

    const recentRows = (itemWrapper: HTMLElement): HTMLElement[] =>
      Array.from(itemWrapper.querySelectorAll<HTMLElement>('[data-link-recent-row]'));

    const rowText = (row: HTMLElement, part: 'title' | 'meta'): string =>
      row.querySelector(`[data-link-recent-${part}]`)?.textContent ?? '';

    const readStored = (): { url: string; title?: string }[] =>
      JSON.parse(localStorage.getItem('blok-recent-links') ?? '[]') as { url: string; title?: string }[];

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('lists recent links by page title, newest first', () => {
      seed([
        { url: 'https://github.com/jackuait/blok', title: 'Blok editor' },
        { url: 'https://www.figma.com/file/1', title: 'Design tokens' },
      ]);

      const { itemWrapper } = openCreating();
      const rows = recentRows(itemWrapper);

      expect(recentSection(itemWrapper)?.hidden).toBe(false);
      expect(rows.map((row) => rowText(row, 'title'))).toEqual(['Blok editor', 'Design tokens']);
      expect(rows.map((row) => rowText(row, 'meta'))).toEqual(['github.com', 'figma.com']);
    });

    it('a reopen shows links another tab added while it was closed', () => {
      const { tool, itemWrapper } = openCreating();
      const renderResult = tool.render() as unknown as LinkToolRenderResult;

      renderResult.children.onClose();
      seed([{ url: 'https://a.com', title: 'From another tab' }]);
      window.dispatchEvent(new StorageEvent('storage', { key: 'blok-recent-links', storageArea: localStorage }));
      renderResult.children.onOpen();

      expect(recentRows(itemWrapper).map((row) => rowText(row, 'title'))).toEqual(['From another tab']);
    });

    it('labels the list "Recents"', () => {
      seed([{ url: 'https://a.com', title: 'A' }]);

      const { itemWrapper } = openCreating();

      expect(itemWrapper.querySelector('[data-link-recent-label]')?.textContent).toBe('Recents');
    });

    it('lays each recent link out as a row: the link sign, then the title with the site under it', () => {
      seed([
        { url: 'https://github.com/jackuait/blok', title: 'Blok editor' },
        { url: 'https://www.figma.com/file/1', title: 'Design tokens' },
      ]);

      const { itemWrapper } = openCreating();
      const [row] = recentRows(itemWrapper);
      const title = row.querySelector('[data-link-recent-title]');
      const meta = row.querySelector('[data-link-recent-meta]');

      expect(row.parentElement?.hasAttribute('data-link-recent-list')).toBe(true);
      expect(row.firstElementChild?.hasAttribute('data-link-recent-icon')).toBe(true);
      expect(row.firstElementChild?.querySelector('svg')).not.toBeNull();
      expect(row.firstElementChild).toHaveAttribute('aria-hidden', 'true');
      expect(title?.parentElement).toBe(meta?.parentElement);
      expect(title?.compareDocumentPosition(meta as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(row.querySelector('[data-link-option-enter-hint]')).not.toBeNull();
      expect(row.title).toBe('https://github.com/jackuait/blok');
    });

    it('draws every recent link with the same sign: no cover, no letter, no color of its own', () => {
      seed([
        { url: 'https://alpha.dev/one', title: 'One' },
        { url: 'https://zeta.io', title: 'Zeta' },
      ]);

      const { itemWrapper } = openCreating();
      const rows = recentRows(itemWrapper);
      const signs = rows.map((row) => row.querySelector('[data-link-recent-icon]')?.innerHTML);

      expect(signs[0]).toBe(signs[1]);
      expect(itemWrapper.querySelector('[data-link-recent-cover], [data-link-recent-letter], [data-link-recent-caption], [data-link-recent-open], [data-link-recent-plain]')).toBeNull();
      expect(rows.every((row) => row.style.getPropertyValue('--_blok-link-cover-bg') === '')).toBe(true);
    });

    it('shows the three newest links, even when storage still holds more', () => {
      seed([
        { url: 'https://a.com', title: 'A' },
        { url: 'https://b.com', title: 'B' },
        { url: 'https://c.com', title: 'C' },
        { url: 'https://d.com', title: 'D' },
      ]);

      const { itemWrapper } = openCreating();

      expect(recentRows(itemWrapper).map((row) => rowText(row, 'title'))).toEqual(['A', 'B', 'C']);
    });

    it('leaves a link with no title and no path on one line', () => {
      seed([{ url: 'https://youtube.com' }]);

      const { itemWrapper } = openCreating();
      const [row] = recentRows(itemWrapper);

      expect(rowText(row, 'title')).toBe('youtube.com');
      expect(row.querySelector('[data-link-recent-meta]')).toBeNull();
    });

    it('names a page by its path when its title only repeats the site name', () => {
      seed([
        { url: 'https://www.youtube.com/watch?v=abc', title: 'YouTube' },
        { url: 'https://youtube.com', title: 'YouTube' },
      ]);

      const { itemWrapper } = openCreating();
      const [video, home] = recentRows(itemWrapper);

      expect(rowText(video, 'title')).toBe('/watch?v=abc');
      expect(rowText(video, 'meta')).toBe('youtube.com');
      expect(rowText(home, 'title')).toBe('YouTube');
      expect(rowText(home, 'meta')).toBe('youtube.com');
    });

    it('falls back to the site name and path when the title is unknown', () => {
      seed([{ url: 'https://www.example.com/docs/intro' }]);

      const { itemWrapper } = openCreating();
      const [row] = recentRows(itemWrapper);

      expect(rowText(row, 'title')).toBe('example.com');
      expect(rowText(row, 'meta')).toBe('/docs/intro');
    });

    it('stays hidden when there is no history', () => {
      const { itemWrapper } = openCreating();

      expect(recentSection(itemWrapper)?.hidden).toBe(true);
    });

    it('gives way to the suggestion row while typing and comes back when cleared', () => {
      seed([{ url: 'https://a.com', title: 'A' }]);

      const { itemWrapper, input } = openCreating();

      input.value = 'https://b.com';
      input.dispatchEvent(new Event('input'));

      expect(recentSection(itemWrapper)?.hidden).toBe(true);
      expect(getSuggestionChip(itemWrapper)?.classList.contains('hidden')).toBe(false);

      input.value = '';
      input.dispatchEvent(new Event('input'));

      expect(recentSection(itemWrapper)?.hidden).toBe(false);
    });

    it('stays hidden while editing an existing link', () => {
      seed([{ url: 'https://a.com', title: 'A' }]);

      const setup = createTool();
      const anchor = document.createElement('a');

      anchor.setAttribute('href', 'https://b.com');
      setup.selection.findParentTag.mockReturnValue(anchor);

      const renderResult = setup.tool.render() as unknown as LinkToolRenderResult;

      renderResult.children.onOpen();

      expect(recentSection(renderResult.children.items[0].element)?.hidden).toBe(true);
    });

    it('applies a recent link when its row is clicked', () => {
      seed([{ url: 'https://a.com/page', title: 'A' }]);

      const { tool, itemWrapper, inlineToolbar } = openCreating();

      recentRows(itemWrapper)[0].click();

      expect((tool as unknown as RecentTool).insertLink).toHaveBeenCalledWith('https://a.com/page');
      expect(inlineToolbar.close).toHaveBeenCalled();
    });

    it('records a confirmed web link at the top of the history', () => {
      seed([{ url: 'https://a.com', title: 'A' }]);

      const { tool, input } = openCreating();

      input.value = 'example.com';
      (tool as unknown as RecentTool).enterPressed(createEnterEventStubs() as unknown as KeyboardEvent);

      expect(readStored().map((entry) => entry.url)).toEqual(['http://example.com', 'https://a.com']);
    });

    it.each(['#results', 'mailto:hi@example.com', '/docs/intro'])('does not record %s, which has no page title', (value) => {
      const { tool, input } = openCreating();

      input.value = value;
      (tool as unknown as RecentTool).enterPressed(createEnterEventStubs() as unknown as KeyboardEvent);

      expect(readStored()).toEqual([]);
    });

    it('looks up the page title through the unfurl endpoint and stores it', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: 1, meta: { title: 'Example Domain', image: { url: 'https://example.com/cover.png' }, favicon: 'https://example.com/favicon.ico' } }),
      });

      vi.stubGlobal('fetch', fetchMock);

      const { tool, input } = openCreating({ unfurl: { endpoint: '/unfurl' } });

      input.value = 'https://example.com';
      (tool as unknown as RecentTool).enterPressed(createEnterEventStubs() as unknown as KeyboardEvent);

      await vi.waitFor(() => {
        expect(readStored()[0]).toEqual({
          url: 'https://example.com',
          title: 'Example Domain',
          checked: true,
        });
      });
      expect(fetchMock).toHaveBeenCalledWith('/unfurl?url=https%3A%2F%2Fexample.com', { headers: undefined });
    });

    it('looks up a link that was never looked up when the field opens, and shows its title', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: 1, meta: { title: 'Escaping the Underworld', image: { url: 'https://i.example.com/cover.jpg' } } }),
      });

      vi.stubGlobal('fetch', fetchMock);
      seed([
        { url: 'https://www.youtube.com/watch?v=abc', title: 'YouTube' },
        { url: 'https://b.com', title: 'B', checked: true },
      ]);

      const { itemWrapper } = openCreating({ unfurl: { endpoint: '/unfurl' } });

      await vi.waitFor(() => {
        expect(rowText(recentRows(itemWrapper)[0], 'title')).toBe('Escaping the Underworld');
      });
      expect(recentRows(itemWrapper)[0].querySelector('img')).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith('/unfurl?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc', { headers: undefined });
    });

    it('keeps the row the user was on when a late title arrives', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: 1, meta: { title: 'Alpha' } }),
      }));
      seed([
        { url: 'https://a.com', title: 'A' },
        { url: 'https://b.com', title: 'B', checked: true },
      ]);

      const { itemWrapper, input } = openCreating({ unfurl: { endpoint: '/unfurl' } });

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));

      await vi.waitFor(() => {
        expect(rowText(recentRows(itemWrapper)[0], 'title')).toBe('Alpha');
      });

      const rows = recentRows(itemWrapper);

      expect(rows[1]).toHaveAttribute('aria-selected', 'true');
      expect(input.getAttribute('aria-activedescendant')).toBe(rows[1].id);
    });

    it('does not look a link up without a lookup endpoint', () => {
      const fetchMock = vi.fn();

      vi.stubGlobal('fetch', fetchMock);
      seed([{ url: 'https://example.com', title: 'Example Domain' }]);
      openCreating();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not look up again a link that was already looked up', () => {
      const fetchMock = vi.fn();

      vi.stubGlobal('fetch', fetchMock);
      seed([{ url: 'https://example.com', title: 'Example Domain', checked: true }]);

      const { itemWrapper } = openCreating({ unfurl: { endpoint: '/unfurl' } });

      recentRows(itemWrapper)[0].click();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps the site-name fallback when the lookup fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

      const { tool, input } = openCreating({ unfurl: { endpoint: '/unfurl' } });

      input.value = 'https://example.com';
      (tool as unknown as RecentTool).enterPressed(createEnterEventStubs() as unknown as KeyboardEvent);
      await Promise.resolve();

      expect(readStored()).toEqual([{ url: 'https://example.com' }]);
    });

    it('does not call fetch when no unfurl endpoint is configured', () => {
      const fetchMock = vi.fn();

      vi.stubGlobal('fetch', fetchMock);

      const { tool, input } = openCreating();

      input.value = 'https://example.com';
      (tool as unknown as RecentTool).enterPressed(createEnterEventStubs() as unknown as KeyboardEvent);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never draws a page picture, even for a link stored with one', () => {
      seed([{ url: 'https://a.com', title: 'Alpha', image: 'https://a.com/cover.png' }]);

      const { itemWrapper } = openCreating();

      expect(recentRows(itemWrapper)[0].querySelector('img')).toBeNull();
    });

    it('never draws a site icon, even for a link stored with one', () => {
      localStorage.setItem('blok-recent-links', JSON.stringify([
        { url: 'https://a.com', title: 'Alpha', favicon: 'https://a.com/icon.png' },
      ]));

      const { itemWrapper } = openCreating();

      expect(recentRows(itemWrapper)[0].querySelector('img')).toBeNull();
    });

    describe('the scrolling list', () => {
      const THREE = [
        { url: 'https://a.com', title: 'A' },
        { url: 'https://b.com', title: 'B' },
        { url: 'https://c.com', title: 'C' },
      ];

      /** jsdom lays nothing out, so the list and its rows get their sizes by hand. */
      const sized = (itemWrapper: HTMLElement, box: { clientHeight: number; scrollHeight: number }): HTMLElement => {
        const listbox = itemWrapper.querySelector<HTMLElement>('[role="listbox"]');

        if (!listbox) {
          throw new Error('no listbox');
        }

        Object.defineProperty(listbox, 'clientHeight', { configurable: true, value: box.clientHeight });
        Object.defineProperty(listbox, 'scrollHeight', { configurable: true, value: box.scrollHeight });

        return listbox;
      };

      const placed = (row: HTMLElement, offsetTop: number, offsetHeight: number): void => {
        Object.defineProperty(row, 'offsetTop', { configurable: true, value: offsetTop });
        Object.defineProperty(row, 'offsetHeight', { configurable: true, value: offsetHeight });
      };

      it('marks the edges that have more rows behind them', () => {
        seed(THREE);

        const { itemWrapper } = openCreating();
        const listbox = sized(itemWrapper, { clientHeight: 300, scrollHeight: 600 });
        const edges = (): string[] => ['up', 'down'].filter((edge) => listbox.hasAttribute(`data-link-more-${edge}`));

        listbox.dispatchEvent(new Event('scroll'));
        expect(edges()).toEqual(['down']);

        listbox.scrollTop = 120;
        listbox.dispatchEvent(new Event('scroll'));
        expect(edges()).toEqual(['up', 'down']);

        listbox.scrollTop = 300;
        listbox.dispatchEvent(new Event('scroll'));
        expect(edges()).toEqual(['up']);
      });

      it('marks no edge when every row fits', () => {
        seed(THREE);

        const { itemWrapper } = openCreating();
        const listbox = sized(itemWrapper, { clientHeight: 300, scrollHeight: 300 });

        listbox.dispatchEvent(new Event('scroll'));

        expect(listbox.hasAttribute('data-link-more-up')).toBe(false);
        expect(listbox.hasAttribute('data-link-more-down')).toBe(false);
      });

      it('scrolls a row picked with the arrows clear of the bottom fade', () => {
        seed(THREE);

        const { itemWrapper, input } = openCreating();
        const listbox = sized(itemWrapper, { clientHeight: 100, scrollHeight: 400 });
        const rows = recentRows(itemWrapper);

        placed(rows[0], 38, 46);
        placed(rows[1], 84, 46);

        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        expect(listbox.scrollTop).toBe(12);

        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        // The row ends at 130; the last 28px of the 100px list are fade.
        expect(listbox.scrollTop).toBe(58);
        expect(listbox.hasAttribute('data-link-more-up')).toBe(true);
      });

      it('scrolls a row picked with the arrows clear of the top fade', () => {
        seed(THREE);

        const { itemWrapper, input } = openCreating();
        const listbox = sized(itemWrapper, { clientHeight: 100, scrollHeight: 400 });
        const rows = recentRows(itemWrapper);

        placed(rows[0], 150, 46);
        placed(rows[1], 196, 46);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        listbox.scrollTop = 200;

        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));

        // The row starts at 150 and stays 24px under the list's top edge.
        expect(listbox.scrollTop).toBe(126);
      });

      it('ends a list that overflows on a whole row, with a sliver of the next', () => {
        seed(THREE);

        const { itemWrapper, input } = openCreating();
        const listbox = sized(itemWrapper, { clientHeight: 300, scrollHeight: 600 });
        const rows = recentRows(itemWrapper);

        placed(rows[0], 10, 90);
        placed(rows[1], 110, 90);
        placed(rows[2], 210, 90);
        input.dispatchEvent(new Event('input'));

        // Row 2 ends at 200 and row 3 at 300, past the 300px list less its 22px tail.
        expect(listbox.style.maxHeight).toBe('222px');
      });

      it('leaves a list that fits at its own height', () => {
        seed(THREE);

        const { itemWrapper, input } = openCreating();
        const listbox = sized(itemWrapper, { clientHeight: 300, scrollHeight: 300 });

        listbox.style.maxHeight = '120px';
        input.dispatchEvent(new Event('input'));

        expect(listbox.style.maxHeight).toBe('');
      });

      it('does not resize a list the user has scrolled', () => {
        seed(THREE);

        const { itemWrapper, input } = openCreating();
        const listbox = sized(itemWrapper, { clientHeight: 300, scrollHeight: 600 });

        listbox.style.maxHeight = '222px';
        listbox.scrollTop = 40;
        input.dispatchEvent(new Event('input'));

        expect(listbox.style.maxHeight).toBe('222px');
      });
    });

    it('walks the rows with the arrow keys while focus stays in the field', () => {
      seed([
        { url: 'https://a.com', title: 'A' },
        { url: 'https://b.com', title: 'B' },
      ]);

      const { itemWrapper, input } = openCreating();
      const rows = recentRows(itemWrapper);
      const press = (key: string): KeyboardEvent => {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

        input.dispatchEvent(event);

        return event;
      };
      const active = (): string | null => input.getAttribute('aria-activedescendant');

      input.focus();
      expect(press('ArrowDown').defaultPrevented).toBe(true);
      expect(active()).toBe(rows[0].id);
      expect(rows[0]).toHaveAttribute('aria-selected', 'true');
      expect(input).toHaveFocus();

      press('ArrowDown');
      expect(active()).toBe(rows[1].id);
      expect(rows[0]).toHaveAttribute('aria-selected', 'false');

      press('ArrowDown');
      expect(active()).toBe(rows[1].id);

      press('ArrowUp');
      press('ArrowUp');
      expect(active()).toBeNull();
    });

    it('applies the highlighted row on Enter', () => {
      seed([
        { url: 'https://a.com', title: 'A' },
        { url: 'https://b.com', title: 'B' },
      ]);

      const { tool, input } = openCreating();

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

      expect((tool as unknown as RecentTool).insertLink).toHaveBeenCalledWith('https://b.com');
    });

    it('exposes the list as the field\'s listbox and keeps rows out of the popover focus stops', () => {
      seed([{ url: 'https://a.com', title: 'A' }]);

      const { itemWrapper, input } = openCreating();
      const listbox = itemWrapper.querySelector('[role="listbox"]');

      expect(input).toHaveAttribute('role', 'combobox');
      expect(input).toHaveAttribute('aria-controls', listbox?.id);
      // The lists scroll under the field, and the popover draws their scrollbar.
      expect(listbox?.hasAttribute('data-blok-popover-scroller')).toBe(true);
      expect(input).toHaveAttribute('aria-expanded', 'true');
      expect(recentRows(itemWrapper)[0]).toHaveAttribute('role', 'option');
      expect(itemWrapper.querySelectorAll('[data-link-recent] button')).toHaveLength(0);

      input.value = 'x';
      input.dispatchEvent(new Event('input'));

      expect(input).toHaveAttribute('aria-expanded', 'false');
    });

    it('forgets the highlighted row once the user types', () => {
      seed([{ url: 'https://a.com', title: 'A' }]);

      const { input } = openCreating();

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      input.value = 'x';
      input.dispatchEvent(new Event('input'));

      expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    });
  });

  describe('pages', () => {
    type PagesTool = { insertLink(link: string): void };

    const PAGES: PageHit[] = [
      { pageId: 'p1', title: 'Roadmap', path: ['Home', 'Plans'] },
      { pageId: 'p2', title: 'Release notes', icon: { type: 'emoji', value: '📝' } },
    ];

    const hostWith = (search: PageHost['search']): PageHost => ({
      search,
      href: (pageId) => `https://app.test/p/${pageId}`,
    });

    const openCreating = (): ToolSetup & { itemWrapper: HTMLElement; input: HTMLInputElement; close: () => void; open: () => void } => {
      const setup = createTool();

      vi.spyOn(setup.tool as unknown as PagesTool, 'insertLink').mockImplementation(() => undefined);

      const renderResult = setup.tool.render() as unknown as LinkToolRenderResult;
      const itemWrapper = renderResult.children.items[0].element;

      document.body.appendChild(itemWrapper);
      renderResult.children.onOpen();

      return {
        ...setup,
        itemWrapper,
        input: getInputFromWrapper(itemWrapper),
        close: () => renderResult.children.onClose(),
        open: () => renderResult.children.onOpen(),
      };
    };

    const pageSection = (itemWrapper: HTMLElement): HTMLElement | null =>
      itemWrapper.querySelector<HTMLElement>('[data-link-pages]');

    const pageRows = (itemWrapper: HTMLElement): HTMLElement[] =>
      Array.from(itemWrapper.querySelectorAll<HTMLElement>('[data-link-page-row]'));

    const pageTitles = (itemWrapper: HTMLElement): string[] =>
      pageRows(itemWrapper).map((row) => row.querySelector('[data-link-page-title]')?.textContent ?? '');

    const type = (field: HTMLInputElement, value: string): void => {
      const input = field;

      input.value = value;
      input.dispatchEvent(new Event('input'));
    };

    const press = (input: HTMLInputElement, key: string): void => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it('asks the host for pages when the field opens and lists them under "Pages"', async () => {
      const search = vi.fn().mockResolvedValue(PAGES);

      pageHost.config = hostWith(search);
      localStorage.setItem('blok-recent-links', JSON.stringify([{ url: 'https://a.com', title: 'A', checked: true }]));
      addHeading(2, 'Intro');

      const { itemWrapper } = openCreating();

      expect(pageSection(itemWrapper)?.hidden).toBe(true);
      await vi.waitFor(() => expect(pageTitles(itemWrapper)).toEqual(['Roadmap', 'Release notes']));

      expect(search).toHaveBeenCalledWith('');
      expect(pageSection(itemWrapper)?.hidden).toBe(false);
      expect(itemWrapper.querySelector('[data-link-pages-label]')?.textContent).toBe('Pages');
      expect(pageRows(itemWrapper)[0].querySelector('[data-link-page-meta]')?.textContent).toBe('Home / Plans');
      expect(Array.from(itemWrapper.querySelectorAll('[data-link-group]')).map((group) =>
        ['data-link-recent', 'data-link-pages', 'data-link-headings', 'data-link-kinds'].find((name) => group.hasAttribute(name))))
        .toEqual(['data-link-recent', 'data-link-pages', 'data-link-headings', 'data-link-kinds']);
    });

    it('shows a page\'s own icon, and the page glyph for a page without one', async () => {
      pageHost.config = hostWith(vi.fn().mockResolvedValue(PAGES));

      const { itemWrapper } = openCreating();

      await vi.waitFor(() => expect(pageRows(itemWrapper)).toHaveLength(2));

      const [plain, withIcon] = pageRows(itemWrapper);
      const glyph = document.createElement('span');

      glyph.innerHTML = IconPage;

      expect(plain.querySelector('[data-link-page-icon]')?.innerHTML).toBe(glyph.innerHTML);
      expect(withIcon.querySelector('[data-link-page-icon]')?.textContent).toBe('📝');
    });

    it('shows the table glyph for a full-page database without an icon', async () => {
      pageHost.config = hostWith(vi.fn().mockResolvedValue([{ pageId: 'd1', title: 'Tasks', kind: 'database' }]));

      const { itemWrapper } = openCreating();

      await vi.waitFor(() => expect(pageRows(itemWrapper)).toHaveLength(1));

      const glyph = document.createElement('span');

      glyph.innerHTML = IconTable;

      expect(pageRows(itemWrapper)[0].querySelector('[data-link-page-icon]')?.innerHTML).toBe(glyph.innerHTML);
    });

    it('names an untitled page "Page" and marks a draft', async () => {
      pageHost.config = hostWith(vi.fn().mockResolvedValue([{ pageId: 'p9', status: 'draft', path: ['Home'] }]));

      const { itemWrapper } = openCreating();

      await vi.waitFor(() => expect(pageTitles(itemWrapper)).toEqual(['Page']));
      expect(pageRows(itemWrapper)[0].querySelector('[data-link-page-meta]')?.textContent).toBe('Draft · Home');
    });

    it('links the selected words to the page address and keeps the page out of Recent', async () => {
      pageHost.config = hostWith(vi.fn().mockResolvedValue(PAGES));

      const { tool, itemWrapper, inlineToolbar } = openCreating();

      await vi.waitFor(() => expect(pageRows(itemWrapper)).toHaveLength(2));
      pageRows(itemWrapper)[1].click();

      expect((tool as unknown as PagesTool).insertLink).toHaveBeenCalledWith('https://app.test/p/p2');
      expect(inlineToolbar.close).toHaveBeenCalled();
      expect(localStorage.getItem('blok-recent-links')).toBeNull();
    });

    it('links to an address the typed-link rules would refuse, as the host gave it', async () => {
      pageHost.config = { search: vi.fn().mockResolvedValue(PAGES), href: (pageId) => `page?id=${pageId}` };

      const { tool, itemWrapper } = openCreating();

      await vi.waitFor(() => expect(pageRows(itemWrapper)).toHaveLength(2));
      pageRows(itemWrapper)[0].click();

      expect((tool as unknown as PagesTool).insertLink).toHaveBeenCalledWith('page?id=p1');
    });

    it('leaves out a page with no address or an unsafe one', async () => {
      pageHost.config = {
        search: vi.fn().mockResolvedValue([...PAGES, { pageId: 'p3', title: 'Empty' }]),
        href: (pageId) => ({ p1: 'javascript:alert(1)', p2: 'https://app.test/p/p2' } as Record<string, string>)[pageId] ?? '',
      };

      const { itemWrapper } = openCreating();

      await vi.waitFor(() => expect(pageTitles(itemWrapper)).toEqual(['Release notes']));
    });

    it('leaves out a page the user may not see', async () => {
      pageHost.config = hostWith(vi.fn().mockResolvedValue([{ pageId: 'p0', title: 'Secret', access: 'none' }, ...PAGES]));

      const { itemWrapper } = openCreating();

      await vi.waitFor(() => expect(pageTitles(itemWrapper)).toEqual(['Roadmap', 'Release notes']));
    });

    it.each([
      ['no page tool', null],
      ['no search', { href: (pageId: string) => `/p/${pageId}` }],
      ['no address', { search: vi.fn().mockResolvedValue(PAGES) }],
    ] as [string, PageHost | null][])('shows no Pages section with %s', async (_name, config) => {
      pageHost.config = config;

      const { itemWrapper } = openCreating();

      await Promise.resolve();
      await Promise.resolve();

      expect(pageSection(itemWrapper)?.hidden).toBe(true);
      expect(config?.search ?? vi.fn()).not.toHaveBeenCalled();
    });

    it('searches as the user types, after a short pause, with the latest text only', async () => {
      vi.useFakeTimers();

      const search = vi.fn().mockResolvedValue([]);

      pageHost.config = hostWith(search);

      const { input } = openCreating();

      search.mockClear();
      type(input, 'r');
      type(input, 'ro');
      type(input, 'roa');

      expect(search).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(150);

      expect(search).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith('roa');
    });

    it('drops an answer that arrives after a newer one', async () => {
      vi.useFakeTimers();

      const answers: Record<string, (hits: PageHit[]) => void> = {};
      const search = vi.fn((query: string) => new Promise<readonly PageHit[]>((resolve) => {
        answers[query] = resolve;
      }));

      pageHost.config = hostWith(search);

      const { itemWrapper, input } = openCreating();

      type(input, 'ro');
      await vi.advanceTimersByTimeAsync(150);
      type(input, 'rel');
      await vi.advanceTimersByTimeAsync(150);

      answers.rel([PAGES[1]]);
      await vi.advanceTimersByTimeAsync(0);
      answers.ro([PAGES[0]]);
      await vi.advanceTimersByTimeAsync(0);

      expect(pageTitles(itemWrapper)).toEqual(['Release notes']);
    });

    it('keeps showing the pages that still match while a new search is on its way', async () => {
      vi.useFakeTimers();

      const search = vi.fn().mockResolvedValueOnce(PAGES).mockReturnValue(new Promise(() => undefined));

      pageHost.config = hostWith(search);

      const { itemWrapper, input } = openCreating();

      await vi.advanceTimersByTimeAsync(0);
      expect(pageTitles(itemWrapper)).toEqual(['Roadmap', 'Release notes']);

      type(input, 'road');

      expect(pageTitles(itemWrapper)).toEqual(['Roadmap']);
    });

    it('marks the part of a page title the search matched', async () => {
      vi.useFakeTimers();
      pageHost.config = hostWith(vi.fn().mockResolvedValue(PAGES));

      const { itemWrapper, input } = openCreating();

      await vi.advanceTimersByTimeAsync(0);
      type(input, 'road');

      const title = pageRows(itemWrapper)[0].querySelector('[data-link-page-title]');

      expect(title?.querySelector('[data-link-page-match]')?.textContent).toBe('Road');
      expect(title?.textContent).toBe('Roadmap');
    });

    it('picks the first page on Enter when the search finds pages and no heading', async () => {
      vi.useFakeTimers();
      pageHost.config = hostWith(vi.fn().mockResolvedValue([PAGES[0]]));

      const { tool, itemWrapper, input } = openCreating();

      type(input, 'road');
      await vi.advanceTimersByTimeAsync(150);

      expect(pageRows(itemWrapper)[0]).toHaveAttribute('aria-selected', 'true');
      expect(input.getAttribute('aria-activedescendant')).toBe(pageRows(itemWrapper)[0].id);

      press(input, 'Enter');

      expect((tool as unknown as PagesTool).insertLink).toHaveBeenCalledWith('https://app.test/p/p1');
    });

    it('keeps Enter on the heading already picked when pages arrive late', async () => {
      vi.useFakeTimers();
      pageHost.config = hostWith(vi.fn().mockResolvedValue([{ pageId: 'p5', title: 'Setup notes' }]));
      addHeading(2, 'Setup guide', 'h-setup');

      const { tool, itemWrapper, input } = openCreating();

      type(input, 'setup');

      const heading = itemWrapper.querySelector<HTMLElement>('[data-link-heading-row]');

      expect(heading).toHaveAttribute('aria-selected', 'true');

      await vi.advanceTimersByTimeAsync(150);

      expect(pageTitles(itemWrapper)).toEqual(['Setup notes']);
      expect(heading).toHaveAttribute('aria-selected', 'true');
      expect(input.getAttribute('aria-activedescendant')).toBe(heading?.id);

      press(input, 'Enter');

      expect((tool as unknown as PagesTool).insertLink).toHaveBeenCalledWith('#h-setup');
    });

    it('leaves Enter to a typed web link, and does not search pages for it', async () => {
      vi.useFakeTimers();

      const search = vi.fn().mockResolvedValue(PAGES);

      pageHost.config = hostWith(search);

      const { tool, itemWrapper, input } = openCreating();

      await vi.advanceTimersByTimeAsync(0);
      search.mockClear();
      type(input, 'https://example.com');
      await vi.advanceTimersByTimeAsync(150);

      expect(search).not.toHaveBeenCalled();
      expect(pageSection(itemWrapper)?.hidden).toBe(true);

      press(input, 'Enter');

      expect((tool as unknown as PagesTool).insertLink).toHaveBeenCalledWith('https://example.com');
    });

    it('does not search pages for a "#" heading search', async () => {
      vi.useFakeTimers();

      const search = vi.fn().mockResolvedValue(PAGES);

      pageHost.config = hostWith(search);

      const { itemWrapper, input } = openCreating();

      await vi.advanceTimersByTimeAsync(0);
      search.mockClear();
      type(input, '#road');
      await vi.advanceTimersByTimeAsync(150);

      expect(search).not.toHaveBeenCalled();
      expect(pageSection(itemWrapper)?.hidden).toBe(true);
    });

    it('walks from the recent links through the pages to the headings with the arrows', async () => {
      pageHost.config = hostWith(vi.fn().mockResolvedValue([PAGES[0]]));
      localStorage.setItem('blok-recent-links', JSON.stringify([{ url: 'https://a.com', title: 'A', checked: true }]));
      addHeading(2, 'Intro');

      const { itemWrapper, input } = openCreating();

      await vi.waitFor(() => expect(pageRows(itemWrapper)).toHaveLength(1));

      const picked = (): string | undefined => itemWrapper.querySelector('[aria-selected="true"]')?.id;

      press(input, 'ArrowDown');
      expect(picked()).toBe(itemWrapper.querySelector('[data-link-recent-row]')?.id);
      press(input, 'ArrowDown');
      expect(picked()).toBe(pageRows(itemWrapper)[0].id);
      press(input, 'ArrowDown');
      expect(picked()).toBe(itemWrapper.querySelector('[data-link-heading-row]')?.id);
    });

    it('drops an answer that arrives after the field closed, and a pending search with it', async () => {
      vi.useFakeTimers();

      const answers: ((hits: PageHit[]) => void)[] = [];
      const search = vi.fn(() => new Promise<readonly PageHit[]>((resolve) => {
        answers.push(resolve);
      }));

      pageHost.config = hostWith(search);

      const { itemWrapper, input, close } = openCreating();

      type(input, 'ro');
      close();
      await vi.advanceTimersByTimeAsync(150);

      expect(search).toHaveBeenCalledTimes(1);

      answers[0](PAGES);
      await vi.advanceTimersByTimeAsync(0);

      expect(pageRows(itemWrapper)).toHaveLength(0);
      expect(pageSection(itemWrapper)?.hidden).toBe(true);
    });

    it('shows no pages when the host search fails', async () => {
      pageHost.config = hostWith(vi.fn().mockRejectedValue(new Error('offline')));

      const { itemWrapper } = openCreating();

      await Promise.resolve();
      await Promise.resolve();

      expect(pageSection(itemWrapper)?.hidden).toBe(true);
    });

    it('offers the link kinds only when there are no pages either', async () => {
      pageHost.config = hostWith(vi.fn().mockResolvedValue(PAGES));

      const { itemWrapper } = openCreating();
      const kinds = itemWrapper.querySelector<HTMLElement>('[data-link-kinds]');

      expect(kinds?.hidden).toBe(false);
      await vi.waitFor(() => expect(pageRows(itemWrapper)).toHaveLength(2));
      expect(kinds?.hidden).toBe(true);
    });
  });

  describe('headings on this page', () => {
    type HeadingTool = {
      insertLink(link: string): void;
    };

    const openCreating = (): ToolSetup & { itemWrapper: HTMLElement; input: HTMLInputElement } => {
      const setup = createTool();

      vi.spyOn(setup.tool as unknown as HeadingTool, 'insertLink').mockImplementation(() => undefined);

      const renderResult = setup.tool.render() as unknown as LinkToolRenderResult;
      const itemWrapper = renderResult.children.items[0].element;

      document.body.appendChild(itemWrapper);
      renderResult.children.onOpen();

      return { ...setup, itemWrapper, input: getInputFromWrapper(itemWrapper) };
    };

    const headingSection = (itemWrapper: HTMLElement): HTMLElement | null =>
      itemWrapper.querySelector<HTMLElement>('[data-link-headings]');

    const headingRows = (itemWrapper: HTMLElement): HTMLElement[] =>
      Array.from(itemWrapper.querySelectorAll<HTMLElement>('[data-link-heading-row]'));

    const headingTitles = (itemWrapper: HTMLElement): string[] =>
      headingRows(itemWrapper).map((row) => row.querySelector('[data-link-heading-title]')?.textContent ?? '');

    const type = (field: HTMLInputElement, value: string): void => {
      const input = field;

      input.value = value;
      input.dispatchEvent(new Event('input'));
    };

    const press = (input: HTMLInputElement, key: string): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

      input.dispatchEvent(event);

      return event;
    };

    it('lists the document headings in order under "On this page"', () => {
      addHeading(1, 'Intro', 'h-intro');
      addBlock('p-1', document.createElement('p'), 'paragraph');
      addHeading(2, 'Setup', 'h-setup');
      addHeading(3, 'Install', 'h-install');

      const { itemWrapper } = openCreating();

      expect(headingSection(itemWrapper)?.hidden).toBe(false);
      expect(itemWrapper.querySelector('[data-link-headings-label]')?.textContent).toBe('On this page');
      expect(headingTitles(itemWrapper)).toEqual(['Intro', 'Setup', 'Install']);
      expect(headingRows(itemWrapper).map((row) => row.getAttribute('data-link-heading-level'))).toEqual(['1', '2', '3']);
    });

    it('sets the headings as an outline: no icons, stepped in by depth, the level at the edge', () => {
      addHeading(2, 'Pages');
      addHeading(6, 'Smallest');
      addHeading(3, 'Ordered');
      addHeading(3, 'Checklist');
      addHeading(5, 'Toggles');
      addHeading(1, 'Top');

      const { itemWrapper } = openCreating();
      const rows = headingRows(itemWrapper);

      expect(rows.map((row) => row.getAttribute('data-link-heading-depth'))).toEqual(['0', '1', '1', '1', '2', '0']);
      expect(rows.map((row) => row.querySelector('[data-link-heading-tag]')?.getAttribute('data-link-heading-tag'))).toEqual(['H2', 'H6', 'H3', 'H3', 'H5', 'H1']);
      expect(rows.map((row) => row.textContent?.trim())).toEqual(['Pages', 'Smallest', 'Ordered', 'Checklist', 'Toggles', 'Top']);
      expect(rows[0].firstElementChild?.querySelector('[data-link-heading-title]')).not.toBeNull();
      expect(rows[0].querySelectorAll('svg')).toHaveLength(1);
      expect(rows[0].querySelector('[data-link-option-enter-hint] svg')).not.toBeNull();
    });

    it('never steps a heading in more than two levels', () => {
      [1, 2, 3, 4, 5].forEach((level) => addHeading(level, `Level ${level}`));

      const { itemWrapper } = openCreating();

      expect(headingRows(itemWrapper).map((row) => row.getAttribute('data-link-heading-depth'))).toEqual(['0', '1', '2', '2', '2']);
    });

    it('marks the part of a heading the search matched, and clears it with the search', () => {
      addHeading(2, 'Inline Formatting');

      const { itemWrapper, input } = openCreating();
      const title = (): Element | null => headingRows(itemWrapper)[0].querySelector('[data-link-heading-title]');

      input.value = 'form';
      input.dispatchEvent(new Event('input'));

      expect(title()?.querySelector('[data-link-heading-match]')?.textContent).toBe('Form');
      expect(title()?.textContent).toBe('Inline Formatting');

      input.value = '';
      input.dispatchEvent(new Event('input'));

      expect(title()?.querySelector('[data-link-heading-match]')).toBeNull();
      expect(title()?.textContent).toBe('Inline Formatting');
    });

    it('skips empty headings and reads a nested child\'s heading only once, from the child', () => {
      addHeading(2, '   ', 'h-empty');

      const child = addHeading(3, 'Inside toggle', 'h-child');
      const toggleContent = document.createElement('div');

      toggleContent.append(child);
      addBlock('toggle', toggleContent, 'toggle');

      const { itemWrapper } = openCreating();

      expect(headingTitles(itemWrapper)).toEqual(['Inside toggle']);
    });

    it('stays hidden when the document has no headings', () => {
      addBlock('p-1', document.createElement('p'), 'paragraph');

      const { itemWrapper } = openCreating();

      expect(headingSection(itemWrapper)?.hidden).toBe(true);
    });

    it('links the heading by its block id and keeps it out of the recent history', () => {
      addHeading(2, 'Setup', 'h-setup');

      const { tool, itemWrapper, inlineToolbar } = openCreating();

      headingRows(itemWrapper)[0].click();

      expect((tool as unknown as HeadingTool).insertLink).toHaveBeenCalledWith('#h-setup');
      expect(inlineToolbar.close).toHaveBeenCalled();
      expect(localStorage.getItem('blok-recent-links')).toBeNull();
    });

    it('filters the headings by the typed text and picks the first match on Enter', () => {
      addHeading(2, 'Header Levels', 'h-levels');
      addHeading(2, 'Inline Formatting', 'h-inline');
      addHeading(3, 'Nested inline code', 'h-code');

      const { tool, itemWrapper, input } = openCreating();

      type(input, 'INLINE');

      expect(headingTitles(itemWrapper)).toEqual(['Inline Formatting', 'Nested inline code']);
      // The inert "keep typing" row would contradict the matches below it.
      expect(getSuggestionChip(itemWrapper)?.classList.contains('hidden')).toBe(true);
      expect(input.getAttribute('aria-activedescendant')).toBe(headingRows(itemWrapper)[0].id);

      press(input, 'Enter');

      expect((tool as unknown as HeadingTool).insertLink).toHaveBeenCalledWith('#h-inline');
    });

    it('leaves the rows that still match in place while typing, so they do not replay their entrance', () => {
      addHeading(2, 'Header Levels', 'h-levels');
      addHeading(2, 'Heading one', 'h-one');
      addHeading(2, 'Setup', 'h-setup');

      const { itemWrapper, input } = openCreating();

      type(input, 'h');

      const [levels, one] = headingRows(itemWrapper);
      const detached: Node[] = [];
      const observer = new MutationObserver((records) => {
        records.forEach((record) => detached.push(...Array.from(record.removedNodes)));
      });

      observer.observe(itemWrapper, { childList: true, subtree: true });

      type(input, 'he');
      type(input, 'hea');
      type(input, 'head');
      type(input, 'heade');
      observer.takeRecords().forEach((record) => detached.push(...Array.from(record.removedNodes)));
      observer.disconnect();

      expect(detached).not.toContain(levels);
      expect(detached).toContain(one);
      expect(headingRows(itemWrapper)).toEqual([levels]);
      expect(levels.id).toBe(input.getAttribute('aria-activedescendant'));
    });

    it('adds a row that starts matching again without disturbing its neighbours', () => {
      addHeading(2, 'Alpha', 'h-alpha');
      addHeading(2, 'Beta', 'h-beta');
      addHeading(2, 'Alpine', 'h-alpine');

      const { itemWrapper, input } = openCreating();

      type(input, 'alp');

      const [alpha, alpine] = headingRows(itemWrapper);

      type(input, 'a');

      expect(headingTitles(itemWrapper)).toEqual(['Alpha', 'Beta', 'Alpine']);
      expect(headingRows(itemWrapper)[0]).toBe(alpha);
      expect(headingRows(itemWrapper)[2]).toBe(alpine);
      expect(new Set(headingRows(itemWrapper).map((row) => row.id)).size).toBe(3);
    });

    it('brings the "keep typing" row back when no heading matches', () => {
      addHeading(2, 'Setup', 'h-setup');

      const { itemWrapper, input } = openCreating();

      type(input, 'zzz');

      expect(headingSection(itemWrapper)?.hidden).toBe(true);
      expect(getSuggestionChip(itemWrapper)?.classList.contains('hidden')).toBe(false);
      expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    });

    it('lists every heading for a bare "#" and filters by the text after it', () => {
      addHeading(2, 'Setup', 'h-setup');
      addHeading(2, 'Usage', 'h-usage');

      const { itemWrapper, input } = openCreating();

      type(input, '#');
      expect(headingTitles(itemWrapper)).toEqual(['Setup', 'Usage']);

      type(input, '#us');
      expect(headingTitles(itemWrapper)).toEqual(['Usage']);
      // Enter picks the heading, so no row may offer to insert "#us" itself.
      expect(getSuggestionChip(itemWrapper)?.classList.contains('hidden')).toBe(true);
      expect(input.getAttribute('aria-activedescendant')).toBe(headingRows(itemWrapper)[0].id);

      type(input, '#nothing-matches');
      expect(getSuggestionChip(itemWrapper)?.classList.contains('hidden')).toBe(false);
    });

    it('does not steal Enter from a typed web link that happens to match a heading', () => {
      addHeading(2, 'Notes on example.com', 'h-notes');

      const { tool, input } = openCreating();

      type(input, 'example.com');
      press(input, 'Enter');

      expect((tool as unknown as HeadingTool).insertLink).toHaveBeenCalledWith('http://example.com');
    });

    it('shows at most six headings at a time', () => {
      for (let index = 0; index < 9; index++) {
        addHeading(2, `Section ${index}`);
      }

      const { itemWrapper } = openCreating();

      expect(headingRows(itemWrapper)).toHaveLength(6);
    });

    it('walks from the recent links into the headings with the arrow keys', () => {
      localStorage.setItem('blok-recent-links', JSON.stringify([{ url: 'https://a.com', title: 'A' }]));
      addHeading(2, 'Setup', 'h-setup');

      const { itemWrapper, input } = openCreating();

      press(input, 'ArrowDown');
      press(input, 'ArrowDown');

      expect(input.getAttribute('aria-activedescendant')).toBe(headingRows(itemWrapper)[0].id);
      expect(headingRows(itemWrapper)[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('keeps every section inside the one listbox the field controls', () => {
      localStorage.setItem('blok-recent-links', JSON.stringify([{ url: 'https://a.com', title: 'A' }]));
      addHeading(2, 'Setup', 'h-setup');

      const { itemWrapper, input } = openCreating();
      const listboxes = itemWrapper.querySelectorAll('[role="listbox"]');

      expect(listboxes).toHaveLength(1);
      expect(input).toHaveAttribute('aria-controls', listboxes[0].id);
      expect(listboxes[0].contains(headingRows(itemWrapper)[0])).toBe(true);
      expect(listboxes[0].contains(itemWrapper.querySelector('[data-link-recent-row]'))).toBe(true);
    });

    it('lists every heading flat, whatever its level', () => {
      addHeading(1, 'Top', 'h-1');
      addHeading(2, 'Second', 'h-2');
      addHeading(4, 'Deep', 'h-4');

      const { itemWrapper } = openCreating();
      const rows = headingRows(itemWrapper);

      expect(rows.map((row) => row.style.paddingInlineStart)).toEqual(['', '', '']);
      expect(rows.map((row) => row.querySelector<HTMLElement>('[data-link-heading-title]')?.style.marginInlineStart))
        .toEqual(['', '', '']);
    });

    it('marks only the highlighted row with an Enter hint', () => {
      addHeading(2, 'Setup', 'h-setup');
      addHeading(2, 'Usage', 'h-usage');

      const { itemWrapper, input } = openCreating();
      const hints = headingRows(itemWrapper).map((row) => row.querySelector<HTMLElement>('[data-link-option-enter-hint]'));

      press(input, 'ArrowDown');

      // The hint shows through the row's aria-selected state, so it is
      // present on every row and only styled visible on the selected one.
      expect(hints.every((hint) => hint?.getAttribute('aria-hidden') === 'true')).toBe(true);
      expect(hints[0]?.className).toContain('group-aria-selected:flex');
      expect(hints[0]?.className.split(' ')).toContain('hidden');
      expect(headingRows(itemWrapper)[0]).toHaveAttribute('aria-selected', 'true');
      expect(headingRows(itemWrapper)[0].className.split(' ')).toContain('group');
    });

    it('stays hidden while editing an existing link', () => {
      addHeading(2, 'Setup', 'h-setup');

      const setup = createTool();
      const anchor = document.createElement('a');

      anchor.setAttribute('href', 'https://b.com');
      setup.selection.findParentTag.mockReturnValue(anchor);

      const renderResult = setup.tool.render() as unknown as LinkToolRenderResult;

      renderResult.children.onOpen();

      expect(headingSection(renderResult.children.items[0].element)?.hidden).toBe(true);
    });

    it('reads the headings again on every open', () => {
      addHeading(2, 'Setup', 'h-setup');

      const setup = createTool();
      const renderResult = setup.tool.render() as unknown as LinkToolRenderResult;
      const itemWrapper = renderResult.children.items[0].element;

      renderResult.children.onOpen();
      renderResult.children.onClose();
      addHeading(2, 'Usage', 'h-usage');
      renderResult.children.onOpen();

      expect(headingTitles(itemWrapper)).toEqual(['Setup', 'Usage']);
    });
  });

  describe('empty state', () => {
    const openCreating = (): { itemWrapper: HTMLElement; input: HTMLInputElement } => {
      const setup = createTool();
      const renderResult = setup.tool.render() as unknown as LinkToolRenderResult;
      const itemWrapper = renderResult.children.items[0].element;

      document.body.appendChild(itemWrapper);
      renderResult.children.onOpen();

      return { itemWrapper, input: getInputFromWrapper(itemWrapper) };
    };

    const kindSection = (itemWrapper: HTMLElement): HTMLElement | null =>
      itemWrapper.querySelector<HTMLElement>('[data-link-kinds]');

    const kindRows = (itemWrapper: HTMLElement): HTMLElement[] =>
      Array.from(itemWrapper.querySelectorAll<HTMLElement>('[data-link-kind-row]'));

    it('offers the kinds of link it can add when there is nothing else to show', () => {
      const { itemWrapper, input } = openCreating();

      expect(kindSection(itemWrapper)?.hidden).toBe(false);
      expect(kindRows(itemWrapper).map((row) => row.querySelector('[data-link-kind-title]')?.textContent)).toEqual([
        defaultDictionary['tools.link.webPage'],
        defaultDictionary['tools.link.emailAddress'],
      ]);
      expect(kindRows(itemWrapper).map((row) => row.getAttribute('data-link-kind-prefix'))).toEqual(['https://', 'mailto:']);
      expect(input).toHaveAttribute('aria-expanded', 'true');
    });

    it('starts the link with the picked kind and keeps typing in the field', () => {
      const { itemWrapper, input } = openCreating();

      input.focus();
      kindRows(itemWrapper)[1].click();

      expect(input.value).toBe('mailto:');
      expect(input).toHaveFocus();
      expect(kindSection(itemWrapper)?.hidden).toBe(true);
      expect(getSuggestionChip(itemWrapper)?.classList.contains('hidden')).toBe(false);
    });

    it('picks the highlighted kind on Enter', () => {
      const { input } = openCreating();

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

      expect(input.value).toBe('https://');
    });

    it('gives way to recent links', () => {
      localStorage.setItem('blok-recent-links', JSON.stringify([{ url: 'https://a.com', title: 'A' }]));

      const { itemWrapper } = openCreating();

      expect(kindSection(itemWrapper)?.hidden).toBe(true);
    });

    it('gives way to headings', () => {
      addHeading(2, 'Setup');

      const { itemWrapper } = openCreating();

      expect(kindSection(itemWrapper)?.hidden).toBe(true);
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

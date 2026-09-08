import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { LinkInlineTool } from '../../../../src/components/inline-tools/inline-tool-link';
import type { API } from '../../../../types';
import type { BlokConfig } from '../../../../types/configs/blok-config';

type LinkConfig = NonNullable<BlokConfig['link']>;

/**
 * The narrowed shape of what the link tool returns from render(). MenuConfig is
 * a union; the tool always returns the "children" variant.
 */
type LinkMenu = {
  icon: string;
  name: string;
  isActive: () => boolean;
  children: {
    hideChevron: boolean;
    placement: string;
    items: { element: HTMLElement }[];
    onOpen: () => void;
    onClose: () => void;
  };
};

type Harness = {
  menu: LinkMenu;
  wrapper: HTMLElement;
  input: HTMLInputElement;
  titleInput: HTMLInputElement;
  urlLabel: HTMLElement;
  titleLabel: HTMLElement;
  suggestion: HTMLElement;
  suggestionRow: HTMLButtonElement;
  suggestionIcon: HTMLElement;
  suggestionUrl: HTMLElement;
  suggestionType: HTMLElement;
  suggestionEnterHint: HTMLElement;
  error: HTMLElement;
  divider: HTMLElement;
  removeButton: HTMLButtonElement;
  inlineToolbarClose: Mock;
};

/**
 * "Paste a link" is 12 characters and "Link text" is 9 — the width assertions
 * below depend on those lengths through the stubbed text measurer.
 */
const TRANSLATIONS: Record<string, string> = {
  'tools.link.addLink': 'Paste a link',
  'tools.link.linkText': 'Link text',
  'tools.link.pageOrUrl': 'Page or URL',
  'tools.link.linkTitle': 'Link title',
  'tools.link.removeLink': 'Remove link',
  'tools.link.invalidLink': 'Invalid link',
  'tools.link.keepTyping': 'Keep typing',
  'tools.link.emailAddress': 'Email address',
  'tools.link.jumpToSection': 'Jump to section',
  'tools.link.webLink': 'Web link',
};

const EXISTING_HREF = 'https://old.example.com/page';

const EDITOR_HTML = `
  <div data-blok-redactor>
    <p data-blok-testid="para-one" contenteditable="true">Hello world</p>
    <p data-blok-testid="para-two" contenteditable="true">Second para</p>
    <p data-blok-testid="para-rich" contenteditable="true">start <em>mid</em> end</p>
    <p data-blok-testid="para-link" contenteditable="true">go <a href="${EXISTING_HREF}">here <b>bold</b></a> end</p>
    <p data-blok-testid="para-bare-link" contenteditable="true">go <a>bare</a> end</p>
  </div>
  <div data-blok-interface="inline-toolbar">
    <button type="button" data-blok-item-name="link"><span data-blok-testid="toolbar-icon">icon</span></button>
  </div>
  <p data-blok-testid="outside" contenteditable="true">Outside text</p>
`;

const must = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);

  if (found === null) {
    throw new Error(`fixture is missing ${selector}`);
  }

  return found;
};

const paragraph = (testid: string): HTMLElement => must<HTMLElement>(document.body, `[data-blok-testid="${testid}"]`);

const firstText = (element: Element): Text => {
  const node = element.firstChild;

  if (node === null || node.nodeType !== Node.TEXT_NODE) {
    throw new Error('expected a leading text node');
  }

  return node as Text;
};

const liveSelection = (): Selection => {
  const selection = window.getSelection();

  if (selection === null) {
    throw new Error('jsdom returned no selection');
  }

  return selection;
};

const selectRange = (startNode: Node, startOffset: number, endNode: Node, endOffset: number): void => {
  const range = document.createRange();

  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);

  const selection = liveSelection();

  selection.removeAllRanges();
  selection.addRange(range);
};

const selectWithin = (node: Node, start: number, end: number): void => selectRange(node, start, node, end);

const placeCaret = (node: Node, offset: number): void => selectRange(node, offset, node, offset);

const createHarness = (options: { link?: LinkConfig; translations?: Record<string, string> } = {}): Harness => {
  const inlineToolbarClose = vi.fn();
  const dictionary = { ...TRANSLATIONS, ...(options.translations ?? {}) };

  const api = {
    toolbar: {
      close: vi.fn(),
      open: vi.fn(),
    },
    inlineToolbar: {
      close: inlineToolbarClose,
      open: vi.fn(),
    },
    notifier: { show: vi.fn() },
    i18n: { t: (phrase: string): string => dictionary[phrase] ?? phrase },
    config: { link: options.link },
  } as unknown as API;

  const tool = new LinkInlineTool({ api });
  const menu = tool.render() as unknown as LinkMenu;
  const wrapper = menu.children.items[0].element;

  // The popover mounts the wrapper; focus() is a no-op on a detached element.
  document.body.append(wrapper);

  const suggestion = must<HTMLElement>(wrapper, '[data-link-suggestion]');

  return {
    menu,
    wrapper,
    input: must<HTMLInputElement>(wrapper, '[data-blok-testid="inline-tool-input"]'),
    titleInput: must<HTMLInputElement>(wrapper, '[data-blok-testid="inline-tool-title-input"]'),
    urlLabel: must<HTMLElement>(wrapper, '[data-blok-testid="inline-tool-url-label"]'),
    titleLabel: must<HTMLElement>(wrapper, '[data-blok-testid="inline-tool-title-label"]'),
    suggestion,
    suggestionRow: must<HTMLButtonElement>(suggestion, '[data-link-suggestion-row]'),
    suggestionIcon: must<HTMLElement>(suggestion, '[data-link-suggestion-icon]'),
    suggestionUrl: must<HTMLElement>(suggestion, '[data-link-suggestion-url]'),
    suggestionType: must<HTMLElement>(suggestion, '[data-link-suggestion-type]'),
    suggestionEnterHint: must<HTMLElement>(suggestion, '[data-link-suggestion-enter-hint]'),
    error: must<HTMLElement>(wrapper, '[data-blok-link-tool-error]'),
    divider: must<HTMLElement>(wrapper, '[data-blok-testid="inline-tool-link-divider"]'),
    removeButton: must<HTMLButtonElement>(wrapper, '[data-blok-testid="inline-tool-remove-link"]'),
    inlineToolbarClose,
  };
};

const toolbarButton = (): HTMLButtonElement =>
  must<HTMLButtonElement>(document.body, '[data-blok-interface="inline-toolbar"] [data-blok-item-name="link"]');

const typeUrl = (harness: Harness, value: string): void => {
  const { input } = harness;

  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const pressKey = (target: HTMLElement, key: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });

  target.dispatchEvent(event);

  return event;
};

const click = (target: HTMLElement): MouseEvent => {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
  });

  target.dispatchEvent(event);

  return event;
};

const anchorsIn = (testid: string): HTMLAnchorElement[] =>
  Array.from(paragraph(testid).querySelectorAll<HTMLAnchorElement>('a'));

const onlyAnchorIn = (testid: string): HTMLAnchorElement => {
  const anchors = anchorsIn(testid);

  if (anchors.length !== 1) {
    throw new Error(`expected exactly one anchor in ${testid}, found ${anchors.length}`);
  }

  return anchors[0];
};

/** The error region is a row span holding an icon span and the message span. */
const errorMessage = (harness: Harness): Element => harness.error.children[0].children[1];

const fakeBackgroundSpans = (): NodeListOf<HTMLElement> =>
  document.querySelectorAll<HTMLElement>('[data-blok-fake-background="true"]');

/** Opens the tool over a fresh word in the first paragraph (create mode). */
const openOnPlainText = (options?: { link?: LinkConfig; translations?: Record<string, string> }): Harness => {
  selectWithin(firstText(paragraph('para-one')), 0, 5);

  const harness = createHarness(options);

  harness.menu.children.onOpen();

  return harness;
};

/** Opens the tool with the caret inside the existing anchor (edit mode). */
const openOnExistingLink = (options?: { link?: LinkConfig }): Harness => {
  const anchor = must<HTMLAnchorElement>(paragraph('para-link'), 'a');

  selectWithin(firstText(anchor), 0, 4);

  const harness = createHarness(options);

  harness.menu.children.onOpen();

  return harness;
};

/**
 * Text measurement is unavailable in jsdom (no canvas 2d context), which makes
 * every content-driven width test a no-op unless the context is stubbed. Width
 * grows at 20px per character so each candidate string maps to a distinct
 * clamped width.
 */
const stubTextMeasurement = (): { font: string } => {
  const context = {
    font: 'UNSET',
    measureText: (text: string) => ({ width: text.length * 20 }),
  };

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    ((contextId: string) => (contextId === '2d' ? context : null)) as HTMLCanvasElement['getContext']
  );

  return context;
};

const stubComputedFont = (
  target: Element,
  font: Pick<CSSStyleDeclaration, 'fontWeight' | 'fontSize' | 'fontFamily'>
): void => {
  const real = window.getComputedStyle.bind(window);

  vi.spyOn(window, 'getComputedStyle').mockImplementation(((element: Element, pseudo?: string | null) =>
    element === target
      ? font
      : real(element, pseudo)) as typeof window.getComputedStyle);
};

/**
 * A listener that throws inside dispatchEvent never reaches the call site —
 * jsdom reports it as window's error event instead. Capturing and cancelling it
 * keeps such a failure assertable here and out of the runner's unhandled channel.
 */
const listenerErrors = (run: () => void): string[] => {
  const messages: string[] = [];
  const handler = (event: ErrorEvent): void => {
    messages.push(event.message);
    event.preventDefault();
  };

  window.addEventListener('error', handler);

  try {
    run();
  } finally {
    window.removeEventListener('error', handler);
  }

  return messages;
};

describe('LinkInlineTool — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = EDITOR_HTML;
    window.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  describe('URL completeness gate', () => {
    const offersConfirm = (harness: Harness, value: string): boolean => {
      typeUrl(harness, value);

      return harness.suggestionRow.tabIndex === 0;
    };

    it.each([
      // A scheme anywhere in the string must not satisfy the anchored scheme checks.
      ['?http://'],
      ['?ftp://'],
      // "//" only counts as a protocol-relative prefix, never as a suffix.
      ['a//'],
      // A TLD needs two or more letters, and an IP needs all four octets at the start.
      ['a.b'],
      ['1.2'],
      ['v1.2.3.4'],
    ])('refuses to confirm the incomplete URL %s', (value) => {
      const harness = openOnPlainText();

      expect(offersConfirm(harness, value)).toBe(false);
      expect(harness.suggestionType.textContent).toBe('Keep typing');
    });

    it.each([
      ['https://example.com'],
      ['ftp://example.com'],
      ['mailto:person@example.com'],
      ['#section'],
      ['/internal'],
      ['//cdn.example.com'],
      ['1.2.3.4'],
      // A host with an empty port is still a domain, not a single-colon scheme.
      ['example.com:'],
    ])('confirms the complete URL %s', (value) => {
      const harness = openOnPlainText();

      expect(offersConfirm(harness, value)).toBe(true);
      expect(harness.suggestionType.textContent).not.toBe('Keep typing');
    });
  });

  describe('protocol normalization', () => {
    const insertedHref = (value: string): string => {
      const harness = openOnPlainText();

      typeUrl(harness, value);
      pressKey(harness.input, 'Enter');

      return onlyAnchorIn('para-one').getAttribute('href') ?? '';
    };

    it.each([
      // Only a scheme at the START of the value counts as "already has a protocol".
      ['example.com/a:b', 'http://example.com/a:b'],
      // Only a LEADING slash marks an internal path.
      ['example.com/path', 'http://example.com/path'],
      // Only a LEADING double slash marks a protocol-relative URL.
      ['example.com//path', 'http://example.com//path'],
      ['example.com', 'http://example.com'],
    ])('prefixes %s with http://', (value, expected) => {
      expect(insertedHref(value)).toBe(expected);
    });

    it.each([
      // A single-colon scheme has no "//" and must survive untouched.
      ['mailto:person@example.com'],
      ['tel:+15550100'],
      ['https://example.com/x'],
      ['//cdn.example.com/x'],
      ['/internal/path'],
      ['#section'],
    ])('leaves %s untouched', (value) => {
      expect(insertedHref(value)).toBe(value);
    });
  });

  describe('script-bearing hrefs', () => {
    it.each([
      ['javascript:alert(1)'],
      ['data:text/html,<script>alert(1)</script>'],
      ['vbscript:msgbox(1)'],
    ])('refuses to insert %s', (value) => {
      const harness = openOnPlainText();

      typeUrl(harness, value);
      pressKey(harness.input, 'Enter');

      expect(anchorsIn('para-one')).toHaveLength(0);
      expect(harness.error.hidden).toBe(false);
      expect(harness.input.getAttribute('aria-invalid')).toBe('true');
    });
  });

  describe('inserting a new link', () => {
    it('writes href, target and rel on the anchor wrapping the selected text', () => {
      const harness = openOnPlainText();

      typeUrl(harness, 'https://example.com/x');
      pressKey(harness.input, 'Enter');

      const anchor = onlyAnchorIn('para-one');

      expect(anchor.getAttribute('href')).toBe('https://example.com/x');
      expect(anchor.getAttribute('target')).toBe('_blank');
      expect(anchor.getAttribute('rel')).toBe('nofollow');
      expect(anchor.textContent).toBe('Hello');
      expect(paragraph('para-one').textContent).toBe('Hello world');
    });

    it('keeps a same-page anchor link in the current tab', () => {
      const harness = openOnPlainText();

      typeUrl(harness, '#section');
      pressKey(harness.input, 'Enter');

      expect(onlyAnchorIn('para-one').getAttribute('target')).toBe('_self');
    });

    it('applies the configured target and rel', () => {
      const harness = openOnPlainText({ link: {
        target: '_top',
        rel: 'noopener',
      } });

      typeUrl(harness, 'https://example.com/x');
      pressKey(harness.input, 'Enter');

      const anchor = onlyAnchorIn('para-one');

      expect(anchor.getAttribute('target')).toBe('_top');
      expect(anchor.getAttribute('rel')).toBe('noopener');
    });

    it('selects the new anchor contents so the caret lands inside it', () => {
      const harness = openOnPlainText();

      typeUrl(harness, 'https://example.com/x');
      pressKey(harness.input, 'Enter');

      const anchor = onlyAnchorIn('para-one');

      expect(anchor.contains(liveSelection().anchorNode)).toBe(true);
    });

    it('drops the fake selection background before inserting', () => {
      const harness = openOnPlainText();

      expect(fakeBackgroundSpans().length).toBeGreaterThan(0);

      typeUrl(harness, 'https://example.com/x');
      click(harness.suggestionRow);

      expect(fakeBackgroundSpans()).toHaveLength(0);
    });

    it('restores the saved selection instead of linking wherever the caret drifted', () => {
      const harness = openOnPlainText();

      typeUrl(harness, 'https://example.com/x');
      selectWithin(firstText(paragraph('para-two')), 0, 6);
      click(harness.suggestionRow);

      expect(paragraph('para-two').querySelector('a')).toBeNull();
      expect(must<HTMLAnchorElement>(paragraph('para-one'), 'a').textContent).toBe('Hello');
    });
  });

  describe('editing an existing link', () => {
    it('rewrites the same anchor rather than nesting a new one', () => {
      const harness = openOnExistingLink();
      const anchor = must<HTMLAnchorElement>(paragraph('para-link'), 'a');

      typeUrl(harness, 'https://new.example.com/x');
      pressKey(harness.input, 'Enter');

      expect(onlyAnchorIn('para-link')).toBe(anchor);
      expect(anchor.getAttribute('href')).toBe('https://new.example.com/x');
    });

    it('prefills the URL field with the anchor href', () => {
      const harness = openOnExistingLink();

      expect(harness.input.value).toBe(EXISTING_HREF);
    });

    it('leaves the URL field empty for an anchor with no href', () => {
      const anchor = must<HTMLAnchorElement>(paragraph('para-bare-link'), 'a');

      selectWithin(firstText(anchor), 0, 4);

      const harness = createHarness();

      harness.menu.children.onOpen();

      expect(harness.input.value).toBe('');
    });

    it('clears a stale href when the next open is over plain text', () => {
      const harness = openOnExistingLink();

      expect(harness.input.value).toBe(EXISTING_HREF);

      selectWithin(firstText(paragraph('para-one')), 0, 5);
      harness.menu.children.onOpen();

      expect(harness.input.value).toBe('');
    });

    it('keeps the anchor inner markup when the title field is untouched', () => {
      const harness = openOnExistingLink();

      expect(harness.titleInput.value).toBe('here bold');

      typeUrl(harness, 'https://new.example.com/x');
      pressKey(harness.input, 'Enter');

      expect(onlyAnchorIn('para-link').querySelector('b')).not.toBeNull();
    });

    it('ignores a whitespace-only title', () => {
      const harness = openOnExistingLink();

      harness.titleInput.value = '   ';
      typeUrl(harness, 'https://new.example.com/x');
      pressKey(harness.input, 'Enter');

      expect(onlyAnchorIn('para-link').textContent).toBe('here bold');
    });

    it('keeps the link text when the title field is emptied', () => {
      const harness = openOnExistingLink();

      harness.titleInput.value = '';
      typeUrl(harness, 'https://new.example.com/x');
      pressKey(harness.input, 'Enter');

      expect(onlyAnchorIn('para-link').textContent).toBe('here bold');
    });

    it('applies a changed title to the anchor text', () => {
      const harness = openOnExistingLink();

      harness.titleInput.value = 'renamed';
      typeUrl(harness, 'https://new.example.com/x');
      pressKey(harness.input, 'Enter');

      expect(onlyAnchorIn('para-link').textContent).toBe('renamed');
    });

    it('submits from the title field too', () => {
      const harness = openOnExistingLink();

      harness.titleInput.value = 'renamed';
      typeUrl(harness, 'https://new.example.com/x');
      pressKey(harness.titleInput, 'Enter');

      expect(onlyAnchorIn('para-link').getAttribute('href')).toBe('https://new.example.com/x');
      expect(onlyAnchorIn('para-link').textContent).toBe('renamed');
      expect(harness.inlineToolbarClose).toHaveBeenCalled();
    });

    it('ignores non-Enter keys in the title field', () => {
      const harness = openOnExistingLink();

      typeUrl(harness, 'https://new.example.com/x');
      pressKey(harness.titleInput, 'a');

      expect(onlyAnchorIn('para-link').getAttribute('href')).toBe(EXISTING_HREF);
      expect(harness.inlineToolbarClose).not.toHaveBeenCalled();
    });

    it('ignores non-Enter keys in the URL field', () => {
      const harness = openOnPlainText();

      typeUrl(harness, 'https://example.com/x');
      pressKey(harness.input, 'a');

      expect(anchorsIn('para-one')).toHaveLength(0);
      expect(harness.inlineToolbarClose).not.toHaveBeenCalled();
    });

    it('swallows the confirming Enter so the block never sees it', () => {
      const harness = openOnExistingLink();
      const alsoOnInput: string[] = [];
      const onAncestor: string[] = [];

      // Registered after the tool's own listener, so only
      // stopImmediatePropagation keeps it quiet.
      harness.input.addEventListener('keydown', () => alsoOnInput.push('input'));
      harness.wrapper.addEventListener('keydown', () => onAncestor.push('wrapper'));

      typeUrl(harness, 'https://new.example.com/x');

      const event = pressKey(harness.input, 'Enter');

      expect(alsoOnInput).toStrictEqual([]);
      expect(onAncestor).toStrictEqual([]);
      // Otherwise the browser also runs its own Enter behaviour on the field.
      expect(event.defaultPrevented).toBe(true);
    });

    it('clears a standing error when Enter finally carries a valid URL', () => {
      const harness = openOnPlainText();

      typeUrl(harness, 'javascript:alert(1)');
      pressKey(harness.input, 'Enter');
      expect(harness.error.hidden).toBe(false);

      // Assigned without an input event: only the Enter path may clear it here.
      harness.input.value = 'https://example.com/x';
      pressKey(harness.input, 'Enter');

      expect(harness.error.hidden).toBe(true);
      expect(harness.input.getAttribute('aria-invalid')).toBeNull();
    });

    it('leaves the caret past the whole link, not inside its text', () => {
      const harness = openOnExistingLink();

      typeUrl(harness, 'https://new.example.com/x');
      pressKey(harness.input, 'Enter');

      const anchor = onlyAnchorIn('para-link');

      // Without the re-selection the caret collapses inside the clicked text
      // node instead; the offset is the same either way, so only the node tells
      // the two apart.
      expect(liveSelection().anchorNode).toBe(anchor);
      expect(anchor.contains(liveSelection().anchorNode)).toBe(true);
    });

    it('shows the edit-only affordances and hides the create-mode suggestion', () => {
      const harness = openOnExistingLink();

      expect(harness.divider.classList.contains('hidden')).toBe(false);
      expect(harness.removeButton.classList.contains('hidden')).toBe(false);
      expect(harness.urlLabel.classList.contains('hidden')).toBe(false);
      expect(harness.titleLabel.classList.contains('hidden')).toBe(false);
      expect(harness.titleInput.classList.contains('block')).toBe(true);
      expect(harness.suggestion.classList.contains('hidden')).toBe(true);
    });

    it('hides the edit-only affordances when creating a link', () => {
      const harness = openOnPlainText();

      expect(harness.divider.classList.contains('hidden')).toBe(true);
      expect(harness.removeButton.classList.contains('hidden')).toBe(true);
      expect(harness.urlLabel.classList.contains('hidden')).toBe(true);
      expect(harness.titleLabel.classList.contains('hidden')).toBe(true);
      expect(harness.titleInput.value).toBe('');
    });

    it('hides a leftover suggestion when the popover reopens', () => {
      const harness = openOnPlainText();

      typeUrl(harness, 'https://example.com/x');
      expect(harness.suggestion.classList.contains('hidden')).toBe(false);

      selectWithin(firstText(paragraph('para-two')), 0, 6);
      harness.menu.children.onOpen();

      expect(harness.suggestion.classList.contains('hidden')).toBe(true);
    });

    it('applies the transformHref shorthand to the stored href', () => {
      const harness = openOnPlainText({ link: { transformHref: (href) => `${href}?ref=blok` } });

      typeUrl(harness, 'https://example.com/x');
      pressKey(harness.input, 'Enter');

      expect(onlyAnchorIn('para-one').getAttribute('href')).toBe('https://example.com/x?ref=blok');
    });
  });

  describe('opening and closing the field', () => {
    it('reveals and focuses the URL field', () => {
      const harness = openOnPlainText();

      expect(harness.input.classList.contains('block')).toBe(true);
      expect(harness.input.classList.contains('hidden')).toBe(false);
      expect(harness.input.getAttribute('data-blok-link-tool-input-opened')).toBe('true');
      expect(harness.input).toHaveFocus();
    });

    it('paints the fake selection background while focus sits in the field', () => {
      openOnPlainText();

      expect(fakeBackgroundSpans().length).toBeGreaterThan(0);
    });

    it('takes focus back when another listener steals it', () => {
      vi.useFakeTimers();

      const harness = openOnPlainText();

      paragraph('para-two').focus();
      expect(paragraph('para-two')).toHaveFocus();

      vi.runAllTimers();

      expect(harness.input).toHaveFocus();
    });

    it('leaves focus alone when it was never stolen', () => {
      vi.useFakeTimers();

      const harness = openOnPlainText();

      vi.runAllTimers();

      expect(harness.input).toHaveFocus();
    });

    it('clears the field state on close', () => {
      const harness = openOnPlainText();

      typeUrl(harness, 'https://example.com/x');
      harness.menu.children.onClose();

      expect(harness.input.value).toBe('');
      expect(harness.input.getAttribute('data-blok-link-tool-input-opened')).toBe('false');
      expect(harness.suggestion.classList.contains('hidden')).toBe(true);
      expect(fakeBackgroundSpans()).toHaveLength(0);
    });
  });

  describe('selection restoration', () => {
    it('returns focus to the block the caret came from', () => {
      placeCaret(firstText(paragraph('para-one')), 3);

      const harness = createHarness();

      harness.menu.children.onOpen();
      expect(harness.input).toHaveFocus();

      harness.menu.children.onClose();

      expect(paragraph('para-one')).toHaveFocus();
    });

    it('returns focus to the block when the selection spanned several nodes', () => {
      const rich = paragraph('para-rich');

      selectRange(firstText(rich), 0, firstText(must<HTMLElement>(rich, 'em')), 3);

      const harness = createHarness();

      harness.menu.children.onOpen();
      harness.menu.children.onClose();

      expect(rich).toHaveFocus();
    });

    it('keeps a selection that moved to another block inside the editor', () => {
      const harness = openOnPlainText();

      // Focusing the field moves the document selection into it, so putting a
      // caret back in the editor is what takes the in-editor restore branch.
      selectWithin(firstText(paragraph('para-two')), 0, 6);
      harness.menu.children.onClose();

      expect(paragraph('para-two').contains(liveSelection().anchorNode)).toBe(true);
      expect(paragraph('para-two')).toHaveFocus();
    });

    it('leaves the caret where the user moved it, not where the field was opened', () => {
      // A collapsed caret skips the fake background, so the range saved at open
      // stays intact and would win if the moved selection were not put back.
      placeCaret(firstText(paragraph('para-one')), 3);

      const harness = createHarness();

      harness.menu.children.onOpen();
      selectWithin(firstText(paragraph('para-two')), 0, 6);
      harness.menu.children.onClose();

      expect(paragraph('para-two').contains(liveSelection().anchorNode)).toBe(true);
      expect(paragraph('para-two')).toHaveFocus();
    });

    it('focuses the block itself when the in-editor selection spans several nodes', () => {
      const rich = paragraph('para-rich');
      const harness = openOnPlainText();

      // An element-anchored range: the block, not its parent, owns the caret.
      selectRange(rich, 0, rich, 2);
      harness.menu.children.onClose();

      expect(rich).toHaveFocus();
    });

    it('pulls the selection back into the editor when it drifted outside', () => {
      const harness = openOnPlainText();

      selectWithin(firstText(paragraph('outside')), 0, 7);
      harness.menu.children.onClose();

      expect(paragraph('para-one').contains(liveSelection().anchorNode)).toBe(true);
      expect(paragraph('para-one')).toHaveFocus();
    });

    it('focuses the saved block when the caret sat between child nodes', () => {
      const rich = paragraph('para-rich');

      placeCaret(rich, 0);

      const harness = createHarness();

      harness.menu.children.onOpen();
      selectWithin(firstText(paragraph('outside')), 0, 7);
      harness.menu.children.onClose();

      expect(rich).toHaveFocus();
    });

    it('forgets the saved range once the field is closed', () => {
      placeCaret(firstText(paragraph('para-one')), 3);

      const harness = createHarness();

      harness.menu.children.onOpen();
      harness.menu.children.onClose();

      harness.input.focus();
      harness.menu.children.onClose();

      expect(harness.input).toHaveFocus();
    });
  });

  describe('unlinking', () => {
    it('unwraps the anchor when Enter is pressed on an emptied field', () => {
      const harness = openOnExistingLink();

      typeUrl(harness, '');

      const event = pressKey(harness.input, 'Enter');

      expect(anchorsIn('para-link')).toHaveLength(0);
      expect(paragraph('para-link').textContent).toBe('go here bold end');
      expect(event.defaultPrevented).toBe(true);
      expect(harness.inlineToolbarClose).toHaveBeenCalled();
    });

    it('restores the saved selection before unwrapping', () => {
      const harness = openOnExistingLink();

      typeUrl(harness, '');
      selectWithin(firstText(paragraph('outside')), 0, 7);
      pressKey(harness.input, 'Enter');

      expect(anchorsIn('para-link')).toHaveLength(0);
    });

    it('unwraps the anchor from the Remove link action', () => {
      const harness = openOnExistingLink();

      click(harness.removeButton);

      expect(anchorsIn('para-link')).toHaveLength(0);
      expect(harness.inlineToolbarClose).toHaveBeenCalled();
    });

    it('removes the link even after the selection drifted outside the editor', () => {
      const harness = openOnExistingLink();

      selectWithin(firstText(paragraph('outside')), 0, 7);
      click(harness.removeButton);

      expect(anchorsIn('para-link')).toHaveLength(0);
    });

    it('clears the toolbar button state after unlinking', () => {
      const harness = openOnExistingLink();

      expect(toolbarButton().getAttribute('data-blok-link-tool-active')).toBe('true');

      click(harness.removeButton);

      expect(toolbarButton().getAttribute('data-blok-link-tool-active')).toBe('false');
      expect(toolbarButton().getAttribute('data-blok-link-tool-unlink')).toBe('false');
    });

    it('keeps the selection intact when the Remove action takes focus', () => {
      const harness = openOnExistingLink();
      const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      });

      harness.removeButton.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('the inline toolbar button', () => {
    it('marks the button active while the caret is inside a link', () => {
      openOnExistingLink();

      expect(toolbarButton().getAttribute('data-blok-link-tool-active')).toBe('true');
      expect(toolbarButton().getAttribute('data-blok-link-tool-unlink')).toBe('true');
    });

    it('marks the button inactive while creating a link', () => {
      openOnPlainText();

      expect(toolbarButton().getAttribute('data-blok-link-tool-active')).toBe('false');
      expect(toolbarButton().getAttribute('data-blok-link-tool-unlink')).toBe('false');
    });

    it('clears the button state on close even though the caret is still in the link', () => {
      const harness = openOnExistingLink();

      harness.menu.children.onClose();

      expect(toolbarButton().getAttribute('data-blok-link-tool-active')).toBe('false');
      expect(toolbarButton().getAttribute('data-blok-link-tool-unlink')).toBe('false');
    });

    it('unlinks when the open button is clicked again', () => {
      const harness = openOnExistingLink();

      click(must<HTMLElement>(toolbarButton(), '[data-blok-testid="toolbar-icon"]'));

      expect(anchorsIn('para-link')).toHaveLength(0);
      expect(harness.inlineToolbarClose).toHaveBeenCalledTimes(1);
    });

    it('unlinks only once however often the button is clicked', () => {
      const harness = openOnExistingLink();
      const icon = must<HTMLElement>(toolbarButton(), '[data-blok-testid="toolbar-icon"]');

      click(icon);
      click(icon);

      expect(harness.inlineToolbarClose).toHaveBeenCalledTimes(1);
    });

    it('swallows the toggle click so nothing else reacts to it', () => {
      openOnExistingLink();

      const icon = must<HTMLElement>(toolbarButton(), '[data-blok-testid="toolbar-icon"]');
      const seen: string[] = [];

      icon.addEventListener('click', () => seen.push('icon'));
      toolbarButton().addEventListener('click', () => seen.push('button'), true);
      must<HTMLElement>(document.body, '[data-blok-interface="inline-toolbar"]')
        .addEventListener('click', () => seen.push('toolbar'));

      const event = click(icon);

      expect(seen).toStrictEqual([]);
      expect(event.defaultPrevented).toBe(true);
    });

    it('does nothing when the button is clicked with the field closed', () => {
      const harness = openOnExistingLink();

      harness.menu.children.onClose();
      harness.inlineToolbarClose.mockClear();

      click(toolbarButton());

      expect(anchorsIn('para-link')).toHaveLength(1);
      expect(harness.inlineToolbarClose).not.toHaveBeenCalled();
    });

    it('does nothing when the button is clicked while creating a link', () => {
      const harness = openOnPlainText();

      click(toolbarButton());

      expect(harness.inlineToolbarClose).not.toHaveBeenCalled();
    });

    it('restores the drifted selection before unlinking from the button', () => {
      const harness = openOnExistingLink();

      selectWithin(firstText(paragraph('outside')), 0, 7);
      click(toolbarButton());

      expect(anchorsIn('para-link')).toHaveLength(0);
      expect(harness.inlineToolbarClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('validation feedback', () => {
    it('describes the field by the inline error when the URL is rejected', () => {
      const harness = openOnPlainText();

      typeUrl(harness, 'javascript:alert(1)');
      pressKey(harness.input, 'Enter');

      expect(harness.error.hidden).toBe(false);
      expect(errorMessage(harness).textContent).toBe('Invalid link');
      expect(harness.input.getAttribute('aria-invalid')).toBe('true');
      expect(harness.input.getAttribute('aria-describedby')).toBe(harness.error.id);
      expect(harness.suggestion.classList.contains('hidden')).toBe(true);
    });

    it('logs the rejected value as a warning', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const harness = openOnPlainText();

      typeUrl(harness, 'javascript:alert(1)');
      pressKey(harness.input, 'Enter');

      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls[0][0])).toContain('Incorrect Link pasted');
    });

    it('clears the error as soon as the value changes', () => {
      const harness = openOnPlainText();

      typeUrl(harness, 'javascript:alert(1)');
      pressKey(harness.input, 'Enter');

      typeUrl(harness, 'https://example.com/x');

      expect(harness.error.hidden).toBe(true);
      expect(errorMessage(harness).textContent).toBe('');
      expect(harness.input.getAttribute('aria-invalid')).toBeNull();
      expect(harness.input.getAttribute('aria-describedby')).toBeNull();
    });

    it('clears the error after a successful confirm from the suggestion row', () => {
      const harness = openOnPlainText();

      typeUrl(harness, 'javascript:alert(1)');
      pressKey(harness.input, 'Enter');

      harness.input.value = 'https://example.com/x';
      click(harness.suggestionRow);

      expect(harness.error.hidden).toBe(true);
      expect(harness.input.getAttribute('aria-invalid')).toBeNull();
    });

    it('clears the error on close', () => {
      const harness = openOnPlainText();

      typeUrl(harness, 'javascript:alert(1)');
      pressKey(harness.input, 'Enter');

      harness.menu.children.onClose();

      expect(harness.error.hidden).toBe(true);
      expect(harness.input.getAttribute('aria-invalid')).toBeNull();
    });

    it('rejects a padded value on confirm instead of silently doing nothing', () => {
      const harness = openOnPlainText();

      harness.input.value = ' #section';
      click(harness.suggestionRow);

      expect(anchorsIn('para-one')).toHaveLength(0);
      expect(harness.error.hidden).toBe(false);
    });

    it('refreshes the error, the suggestion and the field width after a paste', () => {
      vi.useFakeTimers();
      stubTextMeasurement();

      const harness = openOnPlainText();

      typeUrl(harness, 'javascript:alert(1)');
      pressKey(harness.input, 'Enter');
      expect(harness.error.hidden).toBe(false);
      expect(harness.input.style.width).toBe('320px');

      harness.input.value = 'a.co';
      harness.input.dispatchEvent(new Event('paste', { bubbles: true }));
      vi.advanceTimersToNextFrame();

      expect(harness.error.hidden).toBe(true);
      expect(harness.suggestion.classList.contains('hidden')).toBe(false);
      expect(harness.suggestionUrl.textContent).toBe('a.co');
      expect(harness.input.style.width).toBe('220px');
    });
  });

  describe('the suggestion row', () => {
    it('shows the trimmed URL and its type', () => {
      const harness = openOnPlainText();

      typeUrl(harness, '   https://example.com   ');

      expect(harness.suggestionUrl.textContent).toBe('https://example.com');
      expect(harness.suggestionType.textContent).toBe('Web link');
    });

    it('labels a mail address and an in-page anchor', () => {
      const harness = openOnPlainText();

      typeUrl(harness, 'mailto:person@example.com');
      expect(harness.suggestionType.textContent).toBe('Email address');

      typeUrl(harness, '#section');
      expect(harness.suggestionType.textContent).toBe('Jump to section');
    });

    it('dims the row and drops it out of the tab order while incomplete', () => {
      const harness = openOnPlainText();
      const restingIconClass = harness.suggestionIcon.className;

      typeUrl(harness, 'exa');

      expect(harness.suggestionIcon.className).toBe(`${restingIconClass} opacity-50`);
      expect(harness.suggestionUrl.className).toMatch(/text-gray-text$/);
      expect(harness.suggestionRow.tabIndex).toBe(-1);
      expect(harness.suggestionEnterHint.className).toMatch(/^hidden /);
    });

    it('brightens the row and offers the Enter hint once complete', () => {
      const harness = openOnPlainText();
      const restingIconClass = harness.suggestionIcon.className;

      typeUrl(harness, 'https://example.com');

      expect(harness.suggestionIcon.className).toBe(restingIconClass);
      expect(harness.suggestionUrl.className).toMatch(/text-text-primary$/);
      expect(harness.suggestionRow.tabIndex).toBe(0);
      expect(harness.suggestionEnterHint.className).toMatch(/^flex /);
      expect(harness.suggestionEnterHint.className).toContain('size-5');
    });

    it('hides the row when the field is emptied', () => {
      const harness = openOnPlainText();

      typeUrl(harness, 'https://example.com');
      expect(harness.suggestion.classList.contains('hidden')).toBe(false);

      typeUrl(harness, '   ');
      expect(harness.suggestion.classList.contains('hidden')).toBe(true);
    });

    it('inserts the link when the row is clicked', () => {
      const harness = openOnPlainText();

      typeUrl(harness, 'https://example.com/x');
      click(harness.suggestionRow);

      expect(onlyAnchorIn('para-one').getAttribute('href')).toBe('https://example.com/x');
      expect(harness.inlineToolbarClose).toHaveBeenCalled();
    });

    it('does not insert an incomplete URL when the row is clicked', () => {
      const harness = openOnPlainText();

      typeUrl(harness, 'exa');
      click(harness.suggestionRow);

      expect(anchorsIn('para-one')).toHaveLength(0);
    });

    it('keeps the selection intact when the row takes focus', () => {
      const harness = openOnPlainText();
      const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      });

      harness.suggestionRow.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('content-driven field width', () => {
    const openWithFont = (font: { fontWeight: string; fontSize: string; fontFamily: string }): Harness => {
      selectWithin(firstText(paragraph('para-one')), 0, 5);

      const harness = createHarness();

      stubComputedFont(harness.input, font);
      harness.menu.children.onOpen();

      return harness;
    };

    it('measures the typed value in the field own font', () => {
      const context = stubTextMeasurement();
      const harness = openWithFont({
        fontWeight: '600',
        fontSize: '14px',
        fontFamily: 'Inter',
      });

      typeUrl(harness, 'abcdefghijklm');

      expect(context.font).toBe('600 14px Inter');
      // 13 characters at 20px plus 28px of input chrome.
      expect(harness.input.style.width).toBe('288px');
    });

    it('leaves the canvas font alone when the computed font resolves to nothing', () => {
      const context = stubTextMeasurement();
      const harness = openWithFont({
        fontWeight: '',
        fontSize: '',
        fontFamily: '',
      });

      typeUrl(harness, 'abcdefghijklm');

      expect(context.font).toBe('UNSET');
      expect(harness.input.style.width).toBe('288px');
    });

    it('falls back to the placeholder while the field is empty', () => {
      stubTextMeasurement();

      const harness = openOnPlainText();

      // "Paste a link" is 12 characters: 240px of text plus 28px of chrome.
      expect(harness.input.style.width).toBe('268px');
    });

    it('rests at the minimum width when there is nothing to measure', () => {
      stubTextMeasurement();

      const harness = openOnPlainText({ translations: { 'tools.link.addLink': '' } });

      expect(harness.input.style.width).toBe('220px');
    });

    it('caps the width at the maximum', () => {
      stubTextMeasurement();

      const harness = openOnPlainText();

      typeUrl(harness, 'abcdefghijklmnopqrst');

      expect(harness.input.style.width).toBe('320px');
    });

    it('leaves the width to CSS when no 2d context is available', () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
        (() => null) as HTMLCanvasElement['getContext']
      );

      const harness = openOnPlainText();

      expect(harness.input.style.width).toBe('');
    });

    it('hands the width back to CSS on a mobile screen', () => {
      stubTextMeasurement();

      const harness = openOnPlainText();

      expect(harness.input.style.width).toBe('268px');

      vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
      typeUrl(harness, 'abcdefghijklm');

      expect(harness.input.style.width).toBe('');
    });
  });

  describe('the popover chrome', () => {
    it('exposes the tool under the link name with no chevron', () => {
      const harness = createHarness();

      expect(harness.menu.name).toBe('link');
      expect(harness.menu.children.hideChevron).toBe(true);
      expect(harness.menu.children.placement).toBe('below');
    });

    it('reports itself active only inside an anchor', () => {
      const harness = createHarness();

      selectWithin(firstText(must<HTMLAnchorElement>(paragraph('para-link'), 'a')), 0, 4);
      expect(harness.menu.isActive()).toBe(true);

      selectWithin(firstText(paragraph('para-one')), 0, 5);
      expect(harness.menu.isActive()).toBe(false);
    });

    it('pads the wrapper so the field focus ring is not clipped', () => {
      const harness = createHarness();

      expect(harness.wrapper.className).toBe('px-1');
    });

    it('gives the error region a collision-free id', () => {
      const harness = createHarness();

      expect(harness.error.id).toMatch(/^blok-link-tool-error-[0-9a-z]{1,7}$/);
    });

    it('separates the two field captions by the stacked top gap alone', () => {
      const harness = createHarness();
      const urlClasses = harness.urlLabel.className.split(' ');
      const titleClasses = harness.titleLabel.className.split(' ');

      expect(urlClasses).toContain('px-2.5');
      expect(titleClasses.filter((token) => !urlClasses.includes(token))).toStrictEqual(['mt-3.5']);
      expect(urlClasses.filter((token) => !titleClasses.includes(token))).toStrictEqual([]);
    });

    it('captions both fields from the dictionary', () => {
      const harness = createHarness();

      expect(harness.urlLabel.textContent).toBe('Page or URL');
      expect(harness.titleLabel.textContent).toBe('Link title');
      expect(harness.input.placeholder).toBe('Paste a link');
      expect(harness.titleInput.placeholder).toBe('Link text');
      // Both fields ask the soft keyboard for a Done key, not a newline.
      expect(harness.input.enterKeyHint).toBe('done');
      expect(harness.titleInput.enterKeyHint).toBe('done');
    });

    it('renders the hairline divider above the destructive action', () => {
      const harness = createHarness();

      expect(harness.divider.className).toContain('h-px');
      expect(harness.divider.className).toContain('hidden');
    });

    it('renders the Remove link action as a real button with an icon and a label', () => {
      const harness = createHarness();

      expect(harness.removeButton.type).toBe('button');
      expect(harness.removeButton.className).toContain('hidden');
      expect(harness.removeButton.children).toHaveLength(2);
      expect(harness.removeButton.children[1].textContent).toBe('Remove link');
      expect(harness.removeButton.children[0].className).toContain('shrink-0');
      expect(harness.removeButton.children[0].innerHTML).toContain('<svg');
    });

    it('announces the error region and keeps it hidden until something fails', () => {
      const harness = createHarness();

      expect(harness.error.hidden).toBe(true);
      expect(harness.error.getAttribute('role')).toBe('alert');
      expect(harness.error.getAttribute('data-blok-link-tool-error')).toBe('');
      expect(harness.error.className).toContain('min-w-full');

      const row = harness.error.children[0];

      expect(row.className).toContain('text-[var(--blok-color-danger)]');
      expect(row.children[0].className).toContain('shrink-0');
      expect(row.children[0].getAttribute('aria-hidden')).toBe('true');
    });

    it('renders the suggestion row markup the update pass keys off', () => {
      const harness = createHarness();

      expect(harness.suggestion.getAttribute('data-link-suggestion')).toBe('');
      expect(harness.suggestion.children[0].className).toContain('h-px');
      expect(harness.suggestionRow.type).toBe('button');
      expect(harness.suggestionRow.getAttribute('data-link-suggestion-row')).toBe('');
      expect(harness.suggestionIcon.getAttribute('data-link-suggestion-icon')).toBe('');
      expect(harness.suggestionUrl.getAttribute('data-link-suggestion-url')).toBe('');
      expect(harness.suggestionUrl.className).toContain('truncate');
      expect(harness.suggestionType.getAttribute('data-link-suggestion-type')).toBe('');
      expect(harness.suggestionEnterHint.getAttribute('data-link-suggestion-enter-hint')).toBe('');
      expect(harness.suggestionEnterHint.getAttribute('aria-hidden')).toBe('true');
      expect(harness.suggestionEnterHint.className).toContain('hidden');
      expect(harness.suggestionUrl.parentElement?.className).toBe('flex-1 min-w-0');
    });
  });
  describe('degraded hosts and stale state', () => {
    it('finishes the suggestion pass when its inner markup has been torn out', () => {
      const harness = openOnPlainText();

      // Every part the pass writes to lives inside the row.
      harness.suggestionRow.remove();

      const errors = listenerErrors(() => typeUrl(harness, 'example.com'));

      expect(errors).toEqual([]);
      expect(harness.suggestion.classList.contains('hidden')).toBe(false);
    });

    it('does not schedule the focus retry when there is no document to poll', () => {
      vi.useFakeTimers();
      selectWithin(firstText(paragraph('para-one')), 0, 5);

      const harness = createHarness();

      // The retry guard is read right after the first focus() call, which is
      // the only point where the globals it names can be taken away.
      const focusSpy = vi.spyOn(harness.input, 'focus').mockImplementation(() => {
        vi.stubGlobal('document', undefined);
      });

      let thrown: unknown = null;

      try {
        harness.menu.children.onOpen();
      } catch (error) {
        thrown = error;
      } finally {
        vi.unstubAllGlobals();
      }

      // A scheduled retry would find the stubbed focus never took and call it again.
      vi.runAllTimers();

      expect(thrown).toBeNull();
      expect(focusSpy).toHaveBeenCalledTimes(1);
    });

    it('does not reach for a timer host that is gone', () => {
      vi.useFakeTimers();
      selectWithin(firstText(paragraph('para-one')), 0, 5);

      const harness = createHarness();

      const focusSpy = vi.spyOn(harness.input, 'focus').mockImplementation(() => {
        vi.stubGlobal('window', undefined);
      });

      let thrown: unknown = null;

      try {
        harness.menu.children.onOpen();
      } catch (error) {
        thrown = error;
      } finally {
        vi.unstubAllGlobals();
      }

      vi.runAllTimers();

      expect(thrown).toBeNull();
      expect(focusSpy).toHaveBeenCalledTimes(1);
    });

    it('focuses the field once when nothing steals it back', () => {
      vi.useFakeTimers();
      selectWithin(firstText(paragraph('para-one')), 0, 5);

      const harness = createHarness();
      const focusSpy = vi.spyOn(harness.input, 'focus');

      harness.menu.children.onOpen();
      vi.runAllTimers();

      expect(harness.input).toHaveFocus();
      expect(focusSpy).toHaveBeenCalledTimes(1);
    });

    it('closes cleanly after the toolbar button left the DOM', () => {
      const harness = openOnPlainText();

      toolbarButton().remove();

      expect(() => harness.menu.children.onClose()).not.toThrow();
      expect(harness.input.getAttribute('data-blok-link-tool-input-opened')).toBe('false');
    });

    it('keeps a second close inert once the field state is already cleared', () => {
      const harness = openOnPlainText();

      harness.menu.children.onClose();

      const resting = document.activeElement;

      if (!(resting instanceof HTMLElement)) {
        throw new Error('expected the first close to leave focus on an element');
      }

      expect(resting).not.toBe(paragraph('para-two'));

      selectWithin(firstText(paragraph('para-two')), 0, 6);
      harness.menu.children.onClose();

      expect(resting).toHaveFocus();
    });
  });

  describe('selection restore around unfocusable containers', () => {
    it('puts the saved caret back when the selection never left the field', () => {
      const em = must<HTMLElement>(paragraph('para-rich'), 'em');

      placeCaret(firstText(em), 1);

      const harness = createHarness();

      harness.menu.children.onOpen();

      // <em> cannot take focus, so the focus() that ends the restore cannot
      // stand in for putting the range back.
      expect(em.contains(liveSelection().anchorNode)).toBe(false);

      harness.menu.children.onClose();

      expect(em.contains(liveSelection().anchorNode)).toBe(true);
    });

    it('re-applies the selection the user moved to before closing', () => {
      const em = must<HTMLElement>(paragraph('para-rich'), 'em');

      placeCaret(firstText(paragraph('para-one')), 3);

      const harness = createHarness();

      harness.menu.children.onOpen();
      selectWithin(firstText(em), 0, 3);
      harness.menu.children.onClose();

      expect(em.contains(liveSelection().anchorNode)).toBe(true);
      expect(paragraph('para-one').contains(liveSelection().anchorNode)).toBe(false);
    });

    it('survives a saved caret parked on the document itself', () => {
      const range = document.createRange();

      // A caret on the document: its container is not an element and has no
      // parent element either, so there is nothing to hand focus to.
      range.setStart(document, document.childNodes.length);
      range.collapse(true);

      const selection = liveSelection();

      selection.removeAllRanges();
      selection.addRange(range);

      const harness = createHarness();

      harness.menu.children.onOpen();

      expect(() => harness.menu.children.onClose()).not.toThrow();
    });

    it('survives a closing selection that reaches up to the document', () => {
      placeCaret(firstText(paragraph('para-one')), 3);

      const harness = createHarness();

      harness.menu.children.onOpen();

      const range = document.createRange();

      // Starts in a block, so the editor still owns the selection, but ends on
      // the document, which leaves the common ancestor without a parent element.
      range.setStart(firstText(paragraph('para-two')), 0);
      range.setEnd(document, document.childNodes.length);

      const selection = liveSelection();

      selection.removeAllRanges();
      selection.addRange(range);

      expect(() => harness.menu.children.onClose()).not.toThrow();
    });
  });
});

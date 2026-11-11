import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions } from '../../../../src/tools/database/database-card-drawer';
import type { DatabaseRow } from '../../../../src/tools/database/types';
import type { I18n } from '../../../../types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IconChevronDoubleRight, IconChevronLeft, IconExpandDiagonal, IconPeekCenter, IconPeekFull, IconPeekSide } from '../../../../src/components/icons';
import { HINT_DELAY, destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { hover, shownHint } from './hint-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: vi.fn(function stubBlok() {
    return {
      isReady: Promise.resolve(),
      save: vi.fn().mockResolvedValue({ blocks: [] }),
      destroy: vi.fn(),
    };
  }),
}));

const ROW: DatabaseRow = { id: 'row-1', position: 'a0', properties: { 'prop-title': 'Card' } };

const createOptions = (overrides: Partial<CardDrawerOptions> = {}): CardDrawerOptions => {
  const wrapper = document.createElement('div');

  document.body.appendChild(wrapper);

  return {
    wrapper,
    readOnly: false,
    titlePropertyId: 'prop-title',
    schema: [],
    onTitleChange: vi.fn(),
    onDescriptionChange: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
};

const i18n = (): I18n => ({
  t: vi.fn((key: string) => key),
  has: vi.fn(() => true),
  getEnglishTranslation: vi.fn(() => ''),
  getLocale: vi.fn(() => 'en'),
});

const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);

const POPOVER_PROPS = ['popover', 'showPopover', 'hidePopover'] as const;

/** jsdom has no Popover API. Records which elements entered the top layer, in order. */
const installPopover = (): { shown: Element[]; restore: () => void } => {
  const saved = new Map(POPOVER_PROPS.map((prop) => [prop, Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)]));
  const shown: Element[] = [];

  Object.defineProperty(HTMLElement.prototype, 'popover', {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute('popover');
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'showPopover', {
    configurable: true,
    writable: true,
    value(this: HTMLElement) {
      if (shown.includes(this)) throw new DOMException('already open', 'InvalidStateError');
      shown.push(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'hidePopover', {
    configurable: true,
    writable: true,
    value(this: HTMLElement) {
      if (shown.includes(this)) shown.splice(shown.indexOf(this), 1);
    },
  });

  return {
    shown,
    restore: () => saved.forEach((descriptor, prop) => {
      if (descriptor === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, prop);
      } else {
        Object.defineProperty(HTMLElement.prototype, prop, descriptor);
      }
    }),
  };
};

describe('DatabaseCardDrawer shell', () => {
  let popover: ReturnType<typeof installPopover>;

  beforeEach(() => {
    vi.clearAllMocks();
    popover = installPopover();
  });

  afterEach(() => {
    popover.restore();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  // A host header or a transformed ancestor must not cover or trap a peek.
  describe('peeks sit in the top layer', () => {
    it('puts the side peek in the top layer', () => {
      const drawer = new DatabaseCardDrawer(createOptions());

      drawer.open(ROW, 'side');

      expect(popover.shown).toEqual([q('[data-blok-database-drawer]')]);
      drawer.destroy();
    });

    it('shows the center peek backdrop before the peek, so the peek paints above it', () => {
      const drawer = new DatabaseCardDrawer(createOptions());

      drawer.open(ROW, 'center');

      expect(popover.shown).toEqual([q('[data-blok-database-peek-backdrop]'), q('[data-blok-database-drawer]')]);
      drawer.destroy();
    });

    it('keeps the peek above the backdrop when a side peek turns into a center peek', () => {
      const drawer = new DatabaseCardDrawer(createOptions());

      drawer.open(ROW, 'side');
      drawer.open(ROW, 'center');

      expect(popover.shown).toEqual([q('[data-blok-database-peek-backdrop]'), q('[data-blok-database-drawer]')]);
      drawer.destroy();
    });

    it('leaves a full page in the editor flow', () => {
      const drawer = new DatabaseCardDrawer(createOptions());

      drawer.open(ROW, 'side');
      drawer.open(ROW, 'full');

      expect(popover.shown).toEqual([]);
      expect(q('[data-blok-database-drawer]')?.hasAttribute('popover')).toBe(false);
      drawer.destroy();
    });

    it('opens the page icon picker inside the peek, where body overlays would paint under it', () => {
      vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
      const drawer = new DatabaseCardDrawer(createOptions({ i18n: i18n(), onIconChange: vi.fn() }));

      drawer.open(ROW, 'side');
      drawer.editIcon();

      expect(q('[data-blok-emoji-picker]')?.closest('[data-blok-database-drawer]')).toBe(q('[data-blok-database-drawer]'));
      drawer.destroy();
    });

    it('stays in the top layer while the side peek slides out', () => {
      const drawer = new DatabaseCardDrawer(createOptions());

      drawer.open(ROW, 'side');
      const el = q('[data-blok-database-drawer]');

      drawer.close();

      expect(el?.isConnected).toBe(true);
      expect(popover.shown).toEqual([el]);
      drawer.destroy();
    });
  });

  // R31: the page beside a side peek stays usable; only the center peek's backdrop closes on a click.
  describe('clicks outside the peek', () => {
    // notion-motion.md Round 4 re-checks: a click inside the database view keeps the side peek.
    it('inside the database leave a side peek open', () => {
      const options = createOptions();
      const cell = document.createElement('div');

      options.wrapper.appendChild(cell);
      const drawer = new DatabaseCardDrawer(options);

      drawer.open(ROW, 'side');
      cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(drawer.isOpen).toBe(true);
      drawer.destroy();
    });

    // notion-motion.md "Peek: click outside" and Round 4: a click on the page outside the database closes the side peek.
    it('on the page outside the database close a side peek', () => {
      const onClose = vi.fn();
      const page = document.createElement('p');

      document.body.appendChild(page);
      const drawer = new DatabaseCardDrawer(createOptions({ onClose }));

      drawer.open(ROW, 'side');
      page.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(drawer.isOpen).toBe(false);
      expect(onClose).toHaveBeenCalledOnce();
    });

    // A confirm dialog or menu over the page is not the page: its backdrop carries data-blok-popover.
    it('in a dialog or menu over the page leave a side peek open', () => {
      const backdrop = document.createElement('div');
      const button = document.createElement('button');

      backdrop.setAttribute('data-blok-popover', '');
      backdrop.appendChild(button);
      document.body.appendChild(backdrop);
      const drawer = new DatabaseCardDrawer(createOptions());

      drawer.open(ROW, 'side');
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(drawer.isOpen).toBe(true);
      drawer.destroy();
    });

    it('on the backdrop close a center peek', () => {
      const onClose = vi.fn();
      const drawer = new DatabaseCardDrawer(createOptions({ onClose }));

      drawer.open(ROW, 'center');
      q('[data-blok-database-peek-backdrop]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(drawer.isOpen).toBe(false);
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  // notion-motion.md "Peek: click outside, and Open in full page": ⤡ first runs the peek's close slide, then the full page shows.
  describe('open in full page from a side peek', () => {
    const openSide = (): { drawer: DatabaseCardDrawer; panel: () => HTMLElement | null } => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        cb(0);

        return 0;
      });
      const drawer = new DatabaseCardDrawer(createOptions());

      drawer.open(ROW, 'side');

      return { drawer, panel: () => document.querySelector<HTMLElement>('[data-blok-database-drawer]') };
    };

    it('slides the peek out first, then shows the full page', () => {
      const { drawer, panel } = openSide();

      q('[data-blok-database-peek-expand]')?.click();

      expect(panel()?.getAttribute('data-peek-mode')).toBe('side');
      expect(panel()?.hasAttribute('data-open')).toBe(false);

      panel()?.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'transform' }));

      expect(panel()?.getAttribute('data-peek-mode')).toBe('full');
      expect(panel()?.hasAttribute('data-open')).toBe(true);
      drawer.destroy();
    });

    it('waits for the panel\'s own slide, not a fade inside it', () => {
      const { drawer, panel } = openSide();

      q('[data-blok-database-peek-expand]')?.click();
      q('[data-blok-database-peek-next]')?.dispatchEvent(new Event('transitionend', { bubbles: true }));

      expect(panel()?.getAttribute('data-peek-mode')).toBe('side');
      drawer.destroy();
    });

    it('shows the full page at once under reduced motion', () => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }));
      const { drawer, panel } = openSide();

      q('[data-blok-database-peek-expand]')?.click();

      expect(panel()?.getAttribute('data-peek-mode')).toBe('full');
      drawer.destroy();
      vi.unstubAllGlobals();
    });

    it('stays closed when Escape closes it during the slide', () => {
      const { drawer, panel } = openSide();

      q('[data-blok-database-peek-expand]')?.click();
      drawer.close();
      panel()?.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'transform' }));

      expect(drawer.isOpen).toBe(false);
      expect(document.querySelector('[data-blok-database-drawer][data-peek-mode="full"]')).toBeNull();
      drawer.destroy();
    });

    it('slides back in as a side peek when another row opens during the slide', () => {
      const { drawer, panel } = openSide();

      q('[data-blok-database-peek-expand]')?.click();
      drawer.open({ ...ROW, id: 'other' });
      panel()?.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'transform' }));

      expect(panel()?.getAttribute('data-peek-mode')).toBe('side');
      expect(panel()?.hasAttribute('data-open')).toBe(true);
      drawer.destroy();
    });
  });

  // Clicks beside a side peek reach other databases, so one page holds one peek, as in Notion.
  describe('one peek per page', () => {
    const shareHost = (): { host: HTMLElement; options: () => CardDrawerOptions } => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        cb(0);

        return 0;
      });
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1512);
      const host = document.createElement('div');

      vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, 1312, 800));
      document.body.appendChild(host);

      return {
        host,
        options: () => {
          const options = createOptions({ peekHost: () => host });

          host.appendChild(options.wrapper);

          return options;
        },
      };
    };

    it('closes the peek another database has open', () => {
      const { options } = shareHost();
      const onClose = vi.fn();
      const first = new DatabaseCardDrawer({ ...options(), onClose });
      const second = new DatabaseCardDrawer(options());

      first.open(ROW, 'side');
      second.open({ ...ROW, id: 'row-2' }, 'side');

      expect(first.isOpen).toBe(false);
      expect(onClose).toHaveBeenCalledOnce();
      expect(second.isOpen).toBe(true);
      second.destroy();
      first.destroy();
    });

    it('keeps the page narrowed for the new peek when the old one finishes sliding out', () => {
      const { host, options } = shareHost();
      const firstOptions = options();
      const first = new DatabaseCardDrawer(firstOptions);
      const second = new DatabaseCardDrawer(options());

      first.open(ROW, 'side');
      second.open({ ...ROW, id: 'row-2' }, 'side');
      firstOptions.wrapper.querySelector('[data-blok-database-drawer]')?.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'transform' }));

      expect(host.hasAttribute('data-blok-database-peek')).toBe(true);
      expect(host.style.getPropertyValue('--_blok-peek-inset')).toBe('656px');
      second.destroy();
      first.destroy();
    });
  });

  // feel/findings-rowpage R03, R04, R05, R18: Notion's top bar.
  describe('top bar', () => {
    const bar = (): string[] => [...(q('[data-blok-database-drawer-toolbar]')?.children ?? [])]
      .map((el) => [...el.attributes].map((a) => a.name).find((n) => n.startsWith('data-blok-database-')) ?? el.tagName);
    const actions = { onOpenIn: vi.fn(), onCopyLink: vi.fn(), properties: [] };
    const drawn = (selector: string): string => q(selector)?.innerHTML ?? '';
    const parsed = (icon: string): string => {
      const box = document.createElement('div');

      box.innerHTML = icon;

      return box.innerHTML;
    };

    it('groups close and expand, the mode, and the row steps, with Copy link before the star and "•••"', () => {
      const drawer = new DatabaseCardDrawer(createOptions({ rowActions: () => actions }));

      drawer.open(ROW, 'side');

      expect(bar()).toStrictEqual([
        'data-blok-database-drawer-close',
        'data-blok-database-peek-expand',
        'data-blok-database-peek-separator',
        'data-blok-database-peek-mode',
        'data-blok-database-peek-separator',
        'data-blok-database-peek-prev',
        'data-blok-database-peek-next',
        'data-blok-database-peek-crumbs',
        'data-blok-database-peek-copy-link',
        'data-blok-database-peek-page-info',
        'data-blok-database-peek-favorite',
        'data-blok-database-peek-actions',
      ]);
      drawer.destroy();
    });

    it('draws Notion\'s » close and diagonal expand, and the open mode\'s glyph on the mode button', () => {
      const drawer = new DatabaseCardDrawer(createOptions());

      drawer.open(ROW, 'side');

      expect(drawn('[data-blok-database-drawer-close]')).toBe(parsed(IconChevronDoubleRight));
      expect(drawn('[data-blok-database-peek-expand]')).toBe(parsed(IconExpandDiagonal));
      expect(drawn('[data-blok-database-peek-mode]')).toBe(parsed(IconPeekSide));
      drawer.open(ROW, 'center');
      expect(drawn('[data-blok-database-peek-mode]')).toBe(parsed(IconPeekCenter));
      drawer.open(ROW, 'full');
      expect(drawn('[data-blok-database-peek-mode]')).toBe(parsed(IconPeekFull));
      expect(drawn('[data-blok-database-drawer-close]')).toBe(parsed(IconChevronLeft));
      drawer.destroy();
    });

    it('has no close button in the center peek: Escape and the backdrop close it', () => {
      const drawer = new DatabaseCardDrawer(createOptions());

      drawer.open(ROW, 'center');

      expect(q('[data-blok-database-drawer-close]')?.hidden).toBe(true);
      drawer.open(ROW, 'side');
      expect(q('[data-blok-database-drawer-close]')?.hidden).toBe(false);
      drawer.destroy();
    });

    // The table's OPEN reads CLOSE from this (notion-spec-2 §25.3): every show reports, a repeat in the same mode too.
    it('reports each show to onShown', () => {
      const onShown = vi.fn();
      const drawer = new DatabaseCardDrawer(createOptions({ onShown }));

      drawer.open(ROW, 'side');
      drawer.open({ ...ROW, id: 'row-2' });
      drawer.open({ ...ROW, id: 'row-2' }, 'center');

      expect(onShown).toHaveBeenCalledTimes(3);
      drawer.destroy();
    });

    it('marks the mode button expanded while its menu is open', () => {
      const drawer = new DatabaseCardDrawer(createOptions());

      drawer.open(ROW, 'side');
      const mode = q('[data-blok-database-peek-mode]');

      mode?.click();
      expect(mode?.getAttribute('aria-expanded')).toBe('true');
      drawer.destroy();
      expect(mode?.getAttribute('aria-expanded')).toBe('false');
    });

    // notion-spec-2 §12 (S2:160): Switch peek mode lists Side peek, Center peek, Full page, New tab.
    it('opens the row\'s link in a new tab from the mode menu, and has no such row for a row with no link', () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      const drawer = new DatabaseCardDrawer(createOptions({ rowLink: (rowId) => `https://x.io/#${rowId}?full` }));

      drawer.open(ROW, 'side');
      q('[data-blok-database-peek-mode]')?.click();
      document.querySelector<HTMLElement>('[data-blok-item-name="row-page-mode-new-tab"]')?.click();

      expect(open).toHaveBeenCalledExactlyOnceWith('https://x.io/#row-1?full', '_blank', 'noopener');
      drawer.destroy();

      const bare = new DatabaseCardDrawer(createOptions({ rowLink: () => undefined }));

      bare.open(ROW, 'side');
      q('[data-blok-database-peek-mode]')?.click();
      expect(document.querySelector('[data-blok-item-name="row-page-mode-new-tab"]')).toBeNull();
      bare.destroy();
    });

    // S2:160: Notion reads "New tab", not the file preview's "Open in new tab".
    it('reads "New tab" on the mode menu\'s new-tab row', () => {
      const en = JSON.parse(readFileSync(resolve(__dirname, '../../../../src/components/i18n/locales/en.json'), 'utf8')) as Record<string, string>;
      const drawer = new DatabaseCardDrawer(createOptions({
        i18n: { ...i18n(), t: (key: string) => en[key] ?? key },
        rowLink: (rowId) => `https://x.io/#${rowId}?full`,
      }));

      drawer.open(ROW, 'side');
      q('[data-blok-database-peek-mode]')?.click();

      expect(q('[data-blok-item-name="row-page-mode-new-tab"]')?.textContent?.trim()).toBe('New tab');
      drawer.destroy();
    });

    it('copies the row link from the bar, and has no Copy link without row actions', () => {
      const drawer = new DatabaseCardDrawer(createOptions({ rowActions: () => actions }));

      drawer.open(ROW, 'side');
      q('[data-blok-database-peek-copy-link]')?.click();

      expect(actions.onCopyLink).toHaveBeenCalledOnce();
      drawer.destroy();

      const bare = new DatabaseCardDrawer(createOptions());

      bare.open(ROW, 'side');
      expect(q('[data-blok-database-peek-copy-link]')?.hidden).toBe(true);
      bare.destroy();
    });

    // notion-motion.md "Side peek top bar": Notion shows these while the pointer is anywhere over the peek.
    it('reveals the mode switcher, the separators and the row steps only while the peek is hovered or the bar holds keyboard focus', () => {
      const css = readFileSync(resolve(__dirname, '../../../../src/styles/database.css'), 'utf8');
      // An open mode menu keeps them shown, as in Notion, while the pointer is in the menu.
      const rule = /\[data-blok-database-drawer\]:not\(:hover\) \[data-blok-database-drawer-toolbar\]:not\(:has\(:focus-visible\)\):not\(:has\(\[data-blok-database-peek-mode\]\[aria-expanded="true"\]\)\) :is\(([^)]*)\)\s*\{\s*opacity:\s*0;/.exec(css);

      expect(rule?.[1].split(',').map((x) => x.trim()).sort()).toStrictEqual([
        '[data-blok-database-peek-mode]',
        '[data-blok-database-peek-next]',
        '[data-blok-database-peek-prev]',
        '[data-blok-database-peek-separator]',
      ]);
    });
  });

  // feel/findings-rowpage R06: Notion's hints on close, expand and "•••"; none on mode, prev and next.
  describe('top bar hints', () => {
    // Earlier tests clear the body, which detaches the tooltip singleton: start a fresh one.
    beforeEach(() => {
      destroyTooltip();
      vi.useFakeTimers();
    });

    afterEach(() => {
      destroyTooltip();
      vi.useRealTimers();
    });

    const hintOf = (selector: string): string | null => {
      hover(q(selector));
      vi.advanceTimersByTime(HINT_DELAY - 1);
      const early = shownHint();

      vi.advanceTimersByTime(1);
      const text = shownHint()?.text ?? null;

      q(selector)?.dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(500);

      return early === null ? text : 'shown before the delay';
    };

    it('hints close with Escape, expand, and "•••", after the hint delay', () => {
      const drawer = new DatabaseCardDrawer(createOptions({ i18n: i18n(), rowActions: () => ({ onOpenIn: vi.fn(), onCopyLink: vi.fn(), properties: [] }) }));

      drawer.open(ROW, 'side');

      expect(hintOf('[data-blok-database-drawer-close]')).toBe('tools.database.close Esc');
      expect(hintOf('[data-blok-database-peek-expand]')).toBe('tools.database.peekExpand');
      expect(hintOf('[data-blok-database-peek-actions]')).toBe('tools.database.peekActionsHint');
      expect(hintOf('[data-blok-database-peek-copy-link]')).toBe('tools.database.tableCopyLink');
      expect(hintOf('[data-blok-database-peek-mode]')).toBeNull();
      expect(hintOf('[data-blok-database-peek-prev]')).toBeNull();
      drawer.destroy();
    });

    // notion-motion.md "Side peek top bar": "Next page ⌃⇧J". Off a Mac the step is Ctrl+J (stepOf).
    it.each([
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'tools.database.peekNext ⌃⇧J'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'tools.database.peekNext Ctrl+J'],
    ])('hints next with its shortcut on %s', (userAgent, hint) => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
      const drawer = new DatabaseCardDrawer(createOptions({ i18n: i18n() }));

      drawer.open(ROW, 'side');

      expect(hintOf('[data-blok-database-peek-next]')).toBe(hint);
      drawer.destroy();
    });
  });

  describe('page scroll under a peek', () => {
    const pageOverflow = (): string => document.body.style.overflow;

    it('locks the page while the side peek is open and frees it at once on close', () => {
      const drawer = new DatabaseCardDrawer(createOptions());

      drawer.open(ROW, 'side');
      expect(pageOverflow()).toBe('hidden');

      drawer.close();
      expect(pageOverflow()).toBe('');
      drawer.destroy();
    });

    it('locks the page under the center peek', () => {
      const drawer = new DatabaseCardDrawer(createOptions());

      drawer.open(ROW, 'center');
      expect(pageOverflow()).toBe('hidden');
      drawer.destroy();
    });

    it('frees the page on a full page and locks it again back in a peek', () => {
      const drawer = new DatabaseCardDrawer(createOptions());

      drawer.open(ROW, 'side');
      drawer.open(ROW, 'full');
      expect(pageOverflow()).toBe('');

      drawer.open(ROW, 'side');
      expect(pageOverflow()).toBe('hidden');
      drawer.destroy();
    });

    it('frees the page when destroyed while open', () => {
      const drawer = new DatabaseCardDrawer(createOptions());

      drawer.open(ROW, 'side');
      drawer.destroy();
      expect(pageOverflow()).toBe('');
    });

    it('gives back the overflow the host set', () => {
      const drawer = new DatabaseCardDrawer(createOptions());

      document.body.style.overflow = 'clip';
      drawer.open(ROW, 'side');
      drawer.close();
      expect(pageOverflow()).toBe('clip');
      drawer.destroy();
      document.body.style.overflow = '';
    });
  });

  // feel/findings-rowpage R17: a full page has no mode switcher or row steps, and its bar shows where it is.
  describe('full page bar', () => {
    const shown = (selector: string): boolean => [...document.querySelectorAll<HTMLElement>(selector)].some((el) => !el.hidden);

    it('drops the mode switcher, the row steps and their rules', () => {
      const drawer = new DatabaseCardDrawer(createOptions());

      drawer.open(ROW, 'full');

      expect(shown('[data-blok-database-peek-mode]')).toBe(false);
      expect(shown('[data-blok-database-peek-prev]')).toBe(false);
      expect(shown('[data-blok-database-peek-next]')).toBe(false);
      expect(shown('[data-blok-database-peek-separator]')).toBe(false);
      drawer.open(ROW, 'side');
      expect(shown('[data-blok-database-peek-mode]')).toBe(true);
      expect(shown('[data-blok-database-peek-separator]')).toBe(true);
      drawer.destroy();
    });

    it('shows a "database / page" path that follows the title, and the database crumb goes back', () => {
      const onClose = vi.fn();
      const drawer = new DatabaseCardDrawer(createOptions({ databaseTitle: () => 'Tasks', onClose }));

      drawer.open(ROW, 'side');
      expect(shown('[data-blok-database-peek-crumbs]')).toBe(false);
      drawer.open(ROW, 'full');

      const crumbs = (): string => q('[data-blok-database-peek-crumbs]')?.textContent ?? '';

      expect(shown('[data-blok-database-peek-crumbs]')).toBe(true);
      expect(crumbs()).toBe('Tasks/Card');

      const title = q<HTMLTextAreaElement>('[data-blok-database-drawer-title]');

      if (title !== null) title.value = 'Renamed';
      title?.dispatchEvent(new Event('input'));
      expect(crumbs()).toBe('Tasks/Renamed');

      q('[data-blok-database-peek-crumb="database"]')?.click();
      expect(drawer.isOpen).toBe(false);
      expect(onClose).toHaveBeenCalledOnce();
    });
    it('names an untitled database by its placeholder', () => {
      const drawer = new DatabaseCardDrawer(createOptions({ databaseTitle: () => '', i18n: i18n() }));

      drawer.open(ROW, 'full');

      expect(q('[data-blok-database-peek-crumb="database"]')?.textContent).toBe('tools.database.titlePlaceholder');
      drawer.destroy();
    });

    // The full page and center peek title is 40px, the side peek's 32px: its box must grow with the mode.
    it('fits the title box again when the mode changes its size', () => {
      const drawer = new DatabaseCardDrawer(createOptions());

      drawer.open(ROW, 'side');
      const title = q<HTMLTextAreaElement>('[data-blok-database-drawer-title]');

      if (title === null) throw new Error('no title');
      Object.defineProperty(title, 'scrollHeight', { configurable: true, get: () => 48 });
      drawer.open(ROW, 'full');

      expect(title.style.height).toBe('48px');
      drawer.destroy();
    });
  });

  // feel/findings-rowpage R20: Notion's center peek keeps a 708px column centred in its 960px box.
  it('centres a 708px column in the center peek, its title inset 8px', () => {
    const css = readFileSync(resolve(__dirname, '../../../../src/styles/database.css'), 'utf8');
    const body = (selector: string): string => css.match(new RegExp(`${selector.replace(/[[\]().*+?^$|\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

    // Half of 960, less half of 708, less one 8px scrollbar gutter: 118 each side.
    expect(body('[data-blok-database-drawer][data-peek-mode="center"] [data-blok-database-drawer-content]')).toContain('padding-inline: max(var(--blok-space-4), calc(50% - 354px - var(--blok-space-2)))');
    expect(body('[data-blok-database-drawer][data-peek-mode="center"] [data-blok-database-drawer-title]')).toContain('padding-inline: var(--blok-space-2)');
  });

  // feel/findings-rowpage R27: Notion's "•••" menu has 28px rows and ends with who edited the page last.
  describe('"•••" menu', () => {
    it('ends with the "Last edited" footer and uses 28px rows', () => {
      const drawer = new DatabaseCardDrawer(createOptions({
        i18n: i18n(),
        rowActions: () => ({ onOpenIn: vi.fn(), onCopyLink: vi.fn(), properties: [] }),
        pageFooter: () => ({ lastEdited: { name: 'Ada', time: 'Today at 3:52 AM' }, counts: { words: 1, characters: 4 } }),
      }));

      drawer.open(ROW, 'side');
      q('[data-blok-database-peek-actions]')?.click();
      const menu = q('[data-blok-popover-opened]');

      expect(menu?.getAttribute('data-blok-popover-custom-class')).toContain('blok-database-header-menu');
      expect(menu?.querySelector('[data-blok-database-row-menu-footer]')?.textContent).toBe('tools.database.rowLastEditedByToday at 3:52 AMtools.database.rowWordCount');
      drawer.destroy();
    });

    it('has no footer when the host gives none', () => {
      const drawer = new DatabaseCardDrawer(createOptions({ i18n: i18n(), rowActions: () => ({ onOpenIn: vi.fn(), onCopyLink: vi.fn(), properties: [] }) }));

      drawer.open(ROW, 'side');
      q('[data-blok-database-peek-actions]')?.click();

      expect(q('[data-blok-database-row-menu-footer]')).toBeNull();
      drawer.destroy();
    });
  });

  // feel/findings-rowpage R11: Notion's side peek starts the header hover row 4px under the 44px bar (y 48).
  it('starts the side peek page 4px under its top bar', () => {
    const css = readFileSync(resolve(__dirname, '../../../../src/styles/database.css'), 'utf8');
    const body = css.match(/\[data-blok-database-drawer\]\[data-peek-mode="side"\] \[data-blok-database-drawer-content\]\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(body).toContain('padding-block-start: var(--blok-space-1)');
  });
});


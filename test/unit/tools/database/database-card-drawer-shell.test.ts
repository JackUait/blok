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
    it('leave a side peek open', () => {
      const page = document.createElement('p');

      document.body.appendChild(page);
      const drawer = new DatabaseCardDrawer(createOptions());

      drawer.open(ROW, 'side');
      page.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

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

  // Clicks beside a side peek reach other databases, so one page holds one peek, as in Notion.
  describe('one peek per page', () => {
    const shareHost = (): { host: HTMLElement; options: () => CardDrawerOptions } => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        cb(0);

        return 0;
      });
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);
      const host = document.createElement('div');

      vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, 800, 800));
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

    it('keeps the page inset of the new peek when the old one finishes sliding out', () => {
      const { host, options } = shareHost();
      const firstOptions = options();
      const first = new DatabaseCardDrawer(firstOptions);
      const second = new DatabaseCardDrawer(options());

      first.open(ROW, 'side');
      second.open({ ...ROW, id: 'row-2' }, 'side');
      firstOptions.wrapper.querySelector('[data-blok-database-drawer]')?.dispatchEvent(new Event('transitionend'));

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

    // Notion fades these in only while the pointer is on the bar.
    it('reveals the mode switcher, the separators and the row steps only while the bar is hovered or holds keyboard focus', () => {
      const css = readFileSync(resolve(__dirname, '../../../../src/styles/database.css'), 'utf8');
      const rule = /\[data-blok-database-drawer-toolbar\]:not\(:hover\):not\(:has\(:focus-visible\)\) :is\(([^)]*)\)\s*\{\s*opacity:\s*0;/.exec(css);

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
      expect(hintOf('[data-blok-database-peek-next]')).toBeNull();
      drawer.destroy();
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
});

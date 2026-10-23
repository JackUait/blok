import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';
import type { CardDrawerOptions } from '../../../../src/tools/database/database-card-drawer';
import type { DatabaseRow } from '../../../../src/tools/database/types';
import type { I18n } from '../../../../types';

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
});

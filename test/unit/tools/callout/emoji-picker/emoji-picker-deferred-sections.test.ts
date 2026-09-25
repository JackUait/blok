/**
 * Sections after the first skip rendering until they near the viewport
 * (`content-visibility: auto` in src/styles/emoji-picker.css). jsdom has no
 * content-visibility, so these tests pin the contract the stylesheet reads,
 * and that no layout read reaches into a section that is out of view — such
 * a read forces the browser to render that section after all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiPicker } from '../../../../../src/tools/callout/emoji-picker';

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
}));

vi.mock('@emoji-mart/data', () => {
  const emojis: Record<string, unknown> = {};
  const category = (id: string, count: number, firstCodePoint: number, keywords: string[]): { id: string; emojis: string[] } => {
    const ids = Array.from({ length: count }, (_, index) => `${id}-${index}`);

    ids.forEach((emojiId, index) => {
      const native = String.fromCodePoint(firstCodePoint + index);

      emojis[emojiId] = { id: emojiId, name: `${id} ${index}`, keywords, skins: [{ native, unified: '' }, { native: `${native}🏻`, unified: '' }], version: 1 };
    });

    return { id, emojis: ids };
  };

  emojis.wave = {
    id: 'wave', name: 'Waving Hand', keywords: ['hello'], version: 1,
    skins: [{ native: '👋', unified: '1f44b' }, { native: '👋🏻', unified: '1f44b-1f3fb' }],
  };

  const people = category('people', 11, 0x1F600, ['face']);

  people.emojis.unshift('wave');

  return {
    default: {
      categories: [
        people,
        category('nature', 3, 0x1F330, ['shared']),
        category('symbols', 25, 0x1F400, ['shared']),
      ],
      emojis,
      aliases: {},
    },
  };
});

const SECTION_BOXES: Readonly<Record<string, { top: number; height: number }>> = {
  people: { top: 0, height: 120 },
  nature: { top: 120, height: 80 },
  symbols: { top: 200, height: 160 },
};

describe('EmojiPicker deferred sections', () => {
  let picker: EmojiPicker;
  let anchor: HTMLButtonElement;
  let element: HTMLElement;
  let narrow: boolean;
  const animateDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');

  const body = (): HTMLElement => {
    const node = element.querySelector<HTMLElement>('[data-emoji-picker-body]');

    if (node === null) {
      throw new Error('Missing picker body');
    }

    return node;
  };

  const section = (category: string): HTMLElement => {
    const node = element.querySelector<HTMLElement>(`[data-emoji-section="${category}"]`);

    if (node === null) {
      throw new Error(`Missing section: ${category}`);
    }

    return node;
  };

  const frame = (): void => {
    vi.advanceTimersByTime(20);
  };

  const scrollBody = (top: number): void => {
    body().scrollTop = top;
    body().dispatchEvent(new Event('scroll'));
    frame();
  };

  /** Lays the sections out as SECTION_BOXES says, in a 100px-tall body. */
  const layOut = (): void => {
    Object.defineProperties(body(), {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 360 },
    });

    for (const [category, box] of Object.entries(SECTION_BOXES)) {
      Object.defineProperties(section(category), {
        offsetTop: { configurable: true, value: box.top },
        offsetHeight: { configurable: true, value: box.height },
      });
    }
  };

  /** Counts every geometry read on the section's buttons and glyphs. */
  const watchReads = (category: string): { count: number } => {
    const reads = { count: 0 };
    const nodes = section(category).querySelectorAll<HTMLElement>('[data-emoji-native], [data-emoji-glyph]');

    for (const node of nodes) {
      for (const property of ['offsetTop', 'offsetHeight'] as const) {
        Object.defineProperty(node, property, {
          configurable: true,
          get: () => {
            reads.count += 1;

            return 0;
          },
        });
      }
    }

    return reads;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    narrow = false;
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(max-width: 380px)' && narrow,
    })));
    localStorage.clear();
    anchor = document.createElement('button');
    anchor.getBoundingClientRect = () => new DOMRect(40, 100, 30, 24);
    document.body.appendChild(anchor);
    picker = new EmojiPicker({
      onSelect: vi.fn(), onRemove: vi.fn(),
      i18n: { t: (value: string) => value }, locale: 'en',
    });
    element = picker.getElement();
    document.body.appendChild(element);
  });

  afterEach(() => {
    picker.close();

    if (animateDescriptor === undefined) {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    } else {
      Object.defineProperty(HTMLElement.prototype, 'animate', animateDescriptor);
    }

    element.remove();
    anchor.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('defers every section after the first and publishes its row count for the size estimate', async () => {
    await picker.open(anchor);

    expect(section('people').hasAttribute('data-emoji-section-deferred')).toBe(false);
    expect(section('people').style.getPropertyValue('--emoji-rows')).toBe('');
    expect(section('nature').hasAttribute('data-emoji-section-deferred')).toBe(true);
    expect(section('nature').style.getPropertyValue('--emoji-rows')).toBe('1');
    expect(section('symbols').hasAttribute('data-emoji-section-deferred')).toBe(true);
    expect(section('symbols').style.getPropertyValue('--emoji-rows')).toBe('3');
  });

  it('counts rows at eight columns on the narrow layout', async () => {
    narrow = true;
    await picker.open(anchor);

    expect(section('symbols').style.getPropertyValue('--emoji-rows')).toBe('4');
  });

  it('defers search result sections after the first the same way', async () => {
    await picker.open(anchor);
    picker.setQuery('shared');

    expect(section('nature').hasAttribute('data-emoji-section-deferred')).toBe(false);
    expect(section('symbols').hasAttribute('data-emoji-section-deferred')).toBe(true);
    expect(section('symbols').style.getPropertyValue('--emoji-rows')).toBe('3');
  });

  it('publishes the laid-out row track of the first grid, not a cell rect taken mid opening animation', async () => {
    const realGetComputedStyle = window.getComputedStyle.bind(window);

    // The picker opens scaled down, so a transformed rect reads short.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-emoji-native') ? new DOMRect(0, 0, 34.17, 34.17) : new DOMRect(0, 0, 0, 0);
    });
    // A square cell's width is 35.5938px, but the row track snaps up to 35.6094px.
    vi.spyOn(window, 'getComputedStyle').mockImplementation((node: Element) => {
      const style = realGetComputedStyle(node);

      if (node.hasAttribute('data-emoji-native')) {
        Object.defineProperty(style, 'height', { configurable: true, value: '35.5938px' });
      }

      if (node.hasAttribute('data-emoji-grid')) {
        Object.defineProperty(style, 'gridTemplateRows', { configurable: true, value: '35.6094px 35.6094px' });
      }

      return style;
    });

    await picker.open(anchor);

    expect(body().style.getPropertyValue('--emoji-cell')).toBe('35.6094px');
  });

  it('never measures reel rows inside a section that is out of view', async () => {
    await picker.open(anchor);
    layOut();
    const symbolsReads = watchReads('symbols');

    scrollBody(10);

    expect(symbolsReads.count).toBe(0);
  });

  it('curls the edge rows of a section reached by scrolling past the first screen', async () => {
    await picker.open(anchor);
    layOut();
    scrollBody(10);

    const glyphs = [...section('symbols').querySelectorAll<HTMLElement>('[data-emoji-glyph]')];

    glyphs.forEach((glyph, index) => {
      Object.defineProperties(glyph, {
        offsetTop: { configurable: true, value: 240 + Math.floor(index / 10) * 40 },
        offsetHeight: { configurable: true, value: 40 },
      });
    });

    // The view is 240–340: the symbols row at 320–360 sits on the bottom edge.
    scrollBody(240);

    expect(glyphs[20]?.style.transform).toContain('rotateX(');
    expect(glyphs[10]?.style.transform).toBe('');
  });

  it('animates the skin swap of emoji in view inside a deferred section', async () => {
    const animated: Element[] = [];

    // jsdom has no Web Animations.
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: function (this: HTMLElement) {
        animated.push(this);

        return { cancel: vi.fn(), onfinish: null };
      },
    });
    await picker.open(anchor);
    layOut();
    scrollBody(240);
    const button = section('symbols').querySelectorAll<HTMLElement>('[data-emoji-native]')[10];

    // A deferred section contains layout, so it is its buttons' offsetParent.
    Object.defineProperties(button, {
      offsetParent: { configurable: true, value: section('symbols') },
      offsetTop: { configurable: true, value: 50 },
      offsetHeight: { configurable: true, value: 36 },
    });
    element.querySelector<HTMLButtonElement>('[data-emoji-picker-skin-toggle]')?.click();
    element.querySelectorAll<HTMLButtonElement>('[data-emoji-picker-skin-tone] button')[1]?.click();

    expect(animated.some(glyph => button?.contains(glyph))).toBe(true);
  });

  it('does not read the geometry of off-screen sections when switching skin tone', async () => {
    await picker.open(anchor);
    layOut();
    const symbolsReads = watchReads('symbols');
    const toggle = element.querySelector<HTMLButtonElement>('[data-emoji-picker-skin-toggle]');

    toggle?.click();
    element.querySelectorAll<HTMLButtonElement>('[data-emoji-picker-skin-tone] button')[1]?.click();

    const wave = [...element.querySelectorAll('[data-emoji-native]')].find(node => node.getAttribute('data-emoji-native') === '👋');

    expect(symbolsReads.count).toBe(0);
    expect(wave?.textContent).toBe('👋🏻');
  });
});

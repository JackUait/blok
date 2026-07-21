import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, within, act, fireEvent } from '@testing-library/react';
import { Features, EMBED_ROWS, LANGUAGE_COUNT, pickLocaleIndex } from './Features';
import { I18nProvider } from '../../contexts/I18nContext';

const renderFeatures = () =>
  render(
    <I18nProvider>
      <Features />
    </I18nProvider>
  );

describe('Features', () => {
  afterEach(() => {
    localStorage.removeItem('blok-docs-locale');
  });

  // Regression guard for the embeds carousel: a viewer must never see the same
  // logo twice at once. Far more rows than can ever be co-visible (7) are checked
  // for any consecutive window — each holds a disjoint set of services, so no
  // matter how the marquee scrolls, the visible band can't repeat a logo.
  it('never stacks the same embed logo across co-visible rows', () => {
    const WINDOW = 7;
    for (let start = 0; start + WINDOW <= EMBED_ROWS.length; start++) {
      const titles = EMBED_ROWS.slice(start, start + WINDOW).flatMap((row) =>
        row.items.map((s) => s.title)
      );
      expect(new Set(titles).size, `rows ${start}..${start + WINDOW - 1}`).toBe(titles.length);
    }
  });

  // Regression guard for the embeds marquee "half-gap jump". Each row duplicates
  // its items and scrolls translateX(-50%) -> 0 for a seamless loop, so the track
  // must be two identical halves. With a flex `gap`, the track width is
  // 2N*item + (2N-1)*gap, so -50% is one copy MINUS half a gap: every cycle the
  // row snapped sideways by ~6px (the visible jump). The fix is per-item spacing
  // (each tile owns its trailing margin) so -50% lands exactly on the seam. Lock
  // both invariants so the jump can never return.
  it('spaces the embeds marquee per tile, not with flex gap', () => {
    const { container } = renderFeatures();
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>('.bento-marquee-r')
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const tiles = Array.from(row.querySelectorAll<HTMLElement>('.embed-tile'));
      // Two identical halves are the precondition for a seamless translateX(-50%).
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles.length % 2).toBe(0);
      // A flex `gap` on the track reintroduces the half-gap snap.
      expect(row.className).not.toMatch(/(^|\s)gap-/);
      // Spacing lives on each tile instead, so the track is exactly tileable.
      for (const tile of tiles) {
        expect(tile.className).toMatch(/(^|\s)mr-3(\s|$)/);
      }
    }
  });

  // The Clean JSON preview is reused at two very different widths: the wide grid
  // tile and the narrow drawer hero. Long lines must soft-wrap (editor-style) at a
  // readable size rather than clip or shrink to fit. Lock the wrapping code cells
  // so it can't regress to a single non-wrapping <pre>.
  it('lets the Clean JSON preview wrap long lines instead of clipping', () => {
    const { container } = renderFeatures();
    const codeCells = container.querySelectorAll('code[class*="whitespace-pre-wrap"]');
    expect(codeCells.length).toBeGreaterThan(0);
    // one code cell per logical JSON line (9), so wrapping keeps the gutter aligned
    expect(codeCells.length).toBe(9);
    // the highlighted value stays whole when a line wraps, never split mid-string
    // (scoped to the <code> so it can't collide with brand-tinted icon badges)
    const highlight = container.querySelector('code [class*="bg-brand-from"]');
    expect(highlight?.className).toContain('whitespace-nowrap');
  });

  // The Clean JSON flip card carries a fixed-height plate. On a wide tile the 9
  // lines fit unwrapped and look centred; in a NARROW column (mobile carousel) the
  // long lines soft-wrap and the object grows past a 15rem plate, so centring it
  // clips the opening braces off the top and the closing brace off the bottom —
  // the "broken" look. Lock the responsive cure: a taller plate on mobile that
  // drops to the compact 15rem only from `sm` up, and top-alignment on mobile so
  // the first line can never be centred out of view.
  it('gives the Clean JSON flip card a taller, top-aligned plate on mobile', () => {
    const { container } = renderFeatures();
    const inner = container.querySelector('.fi-flip-inner');
    expect(inner).not.toBeNull();
    // compact plate is preserved from `sm` up; the base (mobile) floor is taller
    expect(inner?.className).toMatch(/sm:min-h-\[15rem\]/);
    expect(inner?.className).toMatch(/(^|\s)min-h-\[(1[6-9]|2\d)(\.\d+)?rem\]/);
    // the code column tops-aligns on mobile, only centring once it fits unwrapped
    const codeWrap = container.querySelector('.fi-flip-face .font-mono')?.parentElement;
    expect(codeWrap?.className).toMatch(/(^|\s)justify-start(\s|$)/);
    expect(codeWrap?.className).toMatch(/sm:justify-center/);
  });

  // The "69 locales" tile rolls a greeting through every supported locale. Each
  // sign must have an EQUAL chance to appear — exactly 1/69 — so the locale picker
  // is a plain uniform draw over all entries, never one that excludes the current.
  describe('language sign picker', () => {
    it('offers exactly 69 locales so each draw is 1/69', () => {
      expect(LANGUAGE_COUNT).toBe(69);
    });

    it('gives every locale an equal 1/69 share across the random range', () => {
      // Sweep the picker across evenly-spaced inputs over [0, 1). With one sample
      // per 1/(N·k) slice, every language must land in exactly the same number of
      // buckets — a uniform 1/N distribution, no language favored or starved.
      const PER_BUCKET = 1000;
      const samples = LANGUAGE_COUNT * PER_BUCKET;
      const counts = new Array(LANGUAGE_COUNT).fill(0);
      for (let i = 0; i < samples; i++) {
        // Sample each equal-width slice at its midpoint. Exact boundaries can
        // round into a neighbor when LANGUAGE_COUNT is not binary-friendly.
        counts[pickLocaleIndex(() => (i + 0.5) / samples)]++;
      }
      expect(counts.every((c) => c > 0)).toBe(true); // every language reachable
      expect(new Set(counts).size).toBe(1); // and all equally likely
      expect(counts[0]).toBe(PER_BUCKET);
    });

    it('can return the current locale again — a true 1/69 draw, not 1/68', () => {
      // Excluding the current sign would make others 1/68 and the current 0, which
      // is not equal. A genuine 1/69 draw must be able to repeat the same sign.
      const current = 10;
      expect(pickLocaleIndex(() => current / LANGUAGE_COUNT)).toBe(current);
    });
  });

  it('should render a section element with id="features"', () => {
    renderFeatures();

    const section = screen.getByRole('region', { name: /features/i });
    expect(section).toBeInTheDocument();
  });

  it('should render the section header without an eyebrow kicker', () => {
    renderFeatures();

    expect(screen.queryByText('Why Blok')).not.toBeInTheDocument();
    // The title is split by <br /> tags
    expect(screen.getByText((content) => content.includes('Built for developers'))).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('designed for users'))).toBeInTheDocument();
  });

  it('should render the section description', () => {
    renderFeatures();

    expect(
      screen.getByText((content) => content.includes('Everything you need to ship a modern block editor'))
    ).toBeInTheDocument();
  });

  it('should render all 9 feature cards as buttons', () => {
    renderFeatures();

    const featureCards = screen.getAllByRole('button', { name: /learn more about/i });
    expect(featureCards).toHaveLength(9);
  });

  it('should render the clean JSON pillar as a title-only tile', () => {
    renderFeatures();

    expect(screen.getByText('Typed JSON, never HTML')).toBeInTheDocument();
    // Pillars are now title-only — the descriptive prose moved into the modal.
    expect(screen.queryByText((content) => content.includes('typed JSON blocks'))).not.toBeInTheDocument();
  });

  it('should render the block library pillar as a title-only tile', () => {
    renderFeatures();

    expect(screen.getByText('Every block, built in')).toBeInTheDocument();
    expect(
      screen.queryByText((content) => content.includes('Notion-like blocks'))
    ).not.toBeInTheDocument();
  });

  it('should render the extensibility pillar as a title-only tile', () => {
    renderFeatures();

    const button = screen.getByRole('button', { name: 'Learn more about extending Blok' });
    const withinButton = within(button);
    expect(withinButton.getByText('Bring your own blocks')).toBeInTheDocument();
    expect(withinButton.queryByText((content) => content.includes('block tunes'))).not.toBeInTheDocument();
  });

  it('should render the secondary capabilities as title-only cards', () => {
    renderFeatures();

    // Secondary cards are scannable: title present, descriptive prose removed.
    // The "/" renders as a <kbd> keycap, so assert the heading's accessible name
    // (which still reads "Type / to add anything") rather than a single text node.
    expect(screen.getByRole('heading', { name: 'Type / to add anything' })).toBeInTheDocument();
    expect(screen.getByText('Spreadsheet-grade tables')).toBeInTheDocument();
    expect(screen.getByText('Embed 100+ services')).toBeInTheDocument();
    expect(screen.getByText('Conflict-free undo & redo')).toBeInTheDocument();
    expect(screen.getByText('69 locales, RTL-ready')).toBeInTheDocument();
    expect(screen.getByText('Image, video & audio')).toBeInTheDocument();

    // The wordy descriptions that made the section feel crowded are gone.
    expect(screen.queryByText((content) => content.includes('Markdown shortcuts'))).not.toBeInTheDocument();
    expect(screen.queryByText((content) => content.includes('every row is a block'))).not.toBeInTheDocument();
    expect(screen.queryByText((content) => content.includes('Merged cells'))).not.toBeInTheDocument();
    expect(screen.queryByText((content) => content.includes('Paste a link to embed'))).not.toBeInTheDocument();
    expect(screen.queryByText((content) => content.includes('Yjs-backed'))).not.toBeInTheDocument();
    expect(screen.queryByText((content) => content.includes('right-to-left support'))).not.toBeInTheDocument();
  });

  it('should render feature cards with accessible labels', () => {
    renderFeatures();

    const expectedLabels = [
      'Learn more about Clean JSON output',
      'Learn more about the block library',
      'Learn more about extending Blok',
      'Learn more about the toolbox and Markdown',
      'Learn more about tables',
      'Learn more about embeds',
      'Learn more about undo and redo',
      'Learn more about internationalization',
    ];

    expectedLabels.forEach((label) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  // Mobile was re-imagined away from a peek-carousel (cramped diorama + dots,
  // only one pillar visible at a time) into a calm vertical index: the pillars
  // stack as full-width statement rows, the capabilities sit in an icon grid, and
  // the rich dioramas open in the drawer on tap. Lock the carousel's removal so it
  // can't creep back.
  it('no longer renders a mobile pillar carousel', () => {
    const { container } = renderFeatures();

    // the pagination dots are gone — there is no swipeable slide deck to page
    expect(screen.queryAllByRole('button', { name: /^Go to / })).toHaveLength(0);
    // and the pillar track is no longer a horizontal snap-scroller
    expect(container.querySelector('.snap-x')).toBeNull();
    expect(container.querySelector('[class*="overflow-x-auto"]')).toBeNull();
  });

  it('stacks the pillars vertically on mobile (flex column, not a scroller)', () => {
    renderFeatures();

    const pillar = screen.getByRole('button', { name: 'Learn more about Clean JSON output' });
    const track = pillar.parentElement;
    expect(track?.className).toMatch(/(^|\s)flex-col(\s|$)/);
    // from lg up the same buttons dissolve into the bento via display:contents
    expect(track?.className).toContain('lg:contents');
  });

  it('does not badge the mobile tiles with a brand-tinted glyph', () => {
    const { container } = renderFeatures();

    // The little pink glyph badge that used to sit beside each title on mobile
    // was removed — the live diorama already carries the tile, so the badge only
    // added visual noise. No tile header may reintroduce the brand-tinted chip…
    expect(container.querySelector('.bg-primary\\/10')).toBeNull();
    // …and the feature glyphs (only ever rendered inside that badge) are gone.
    for (const icon of [
      'fi-json', 'fi-blocks', 'fi-ext', // pillars
      'fi-slash', 'fi-table', 'fi-embed', 'fi-history', 'fi-globe', 'fi-media', // capabilities
    ]) {
      expect(container.querySelector(`.${icon}`), icon).toBeNull();
    }
  });

  // The first mobile redesign stripped every tile down to an icon + title, which
  // read as a dull corporate list. The signature live dioramas are back on every
  // tile at all sizes — what makes the product feel alive — so no tile may gate
  // its diorama behind `lg` (the old "hidden ... lg:flex" pattern). Lock it.
  it('renders the live dioramas inline on mobile, not gated behind lg', () => {
    const { container } = renderFeatures();

    const lgGated = Array.from(container.querySelectorAll('[class*="lg:flex"]')).filter(
      (el) => /(^|\s)hidden(\s|$)/.test(el.className),
    );
    expect(lgGated).toHaveLength(0);
    // and a known diorama (the embeds logo river) is actually in the tree
    expect(container.querySelector('.bento-marquee-r')).not.toBeNull();

    // one diorama per row on mobile: the capability grid is a single column
    // below md (tablet restores the 3-up grid; lg dissolves into the bento).
    const capGrid = screen.getByRole('button', { name: 'Learn more about embeds' }).parentElement;
    expect(capGrid?.className).toMatch(/(^|\s)grid-cols-1(\s|$)/);
    expect(capGrid?.className).toContain('md:grid-cols-3');
    expect(capGrid?.className).not.toMatch(/(^|\s)grid-cols-2(\s|$)/);

    // this mounts the full animated section; the default 5s is tight on a loaded
    // machine (see the known heavy-render flake cluster), so give it headroom.
  }, 15000);

  it('stacks the Embeds tile above the Tables tile in the bento grid', () => {
    renderFeatures();

    // Both capability tiles span the middle two columns of the lg bento, so their
    // lg:order-* is what decides which one sits on top. Embeds (order-2) must come
    // before Tables (order-5) — the two were swapped from their original stacking.
    const embeds = screen.getByRole('button', { name: 'Learn more about embeds' });
    const tables = screen.getByRole('button', { name: 'Learn more about tables' });
    expect(embeds.className).toContain('lg:order-2');
    expect(tables.className).toContain('lg:order-5');
  });

  // The mobile-clipping fix windowed every discrete capability diorama to a fixed
  // 6.75rem box (overflow-hidden) so nothing was cut off in the single-column
  // stack. But that inner clip leaked onto desktop too, cropping the taller
  // dioramas (the slash menu, the table) mid-content at 6.75rem instead of letting
  // them fill to the card border — the bento cell's own overflow-hidden is the
  // real window. Lock the desktop release: mobile keeps the floor + clip, but from
  // `lg` up every non-embeds diorama wrapper drops the hard clip.
  it('releases the capability diorama window on desktop instead of hard-clipping', () => {
    const { container } = renderFeatures();

    // the grow-to-fit capability dioramas (media, undo, tables, languages) all carry
    // the mobile height floor; the embeds tile uses a fixed h-[6.75rem] marquee
    // window, and the slash menu uses a fixed h-[6.75rem] teaser clip — both are
    // intentionally excluded from the grow-to-fit floor group.
    const dioramaWraps = Array.from(
      container.querySelectorAll<HTMLElement>('div'),
    ).filter((el) => /(^|\s)min-h-\[6\.75rem\]/.test(el.className));
    expect(dioramaWraps).toHaveLength(4);

    for (const wrap of dioramaWraps) {
      // mobile keeps the clip so the floor can't be overrun in the stacked column
      expect(wrap.className).toMatch(/(^|\s)overflow-hidden(\s|$)/);
      // ...but desktop releases it so the diorama fills to the card border rather
      // than cropping mid-content at the inner 6.75rem box
      expect(wrap.className).toMatch(/(^|\s)lg:overflow-visible(\s|$)/);
    }
  });

  // Find the slash diorama's window wrapper (the div holding the SlashViz card).
  // Scoped to the slash button, so the fixed h-[6.75rem] teaser clip is unambiguous.
  const findSlashWindow = (slash: HTMLElement) =>
    Array.from(slash.querySelectorAll<HTMLElement>('div')).find((el) =>
      /(^|\s)h-\[6\.75rem\]/.test(el.className),
    );

  it('top-aligns the slash diorama so a tall menu never rides over the tile title', () => {
    renderFeatures();
    const slash = screen.getByRole('button', {
      name: 'Learn more about the toolbox and Markdown',
    });
    const wrap = findSlashWindow(slash);
    expect(wrap).toBeDefined();
    // the SlashViz root is the diorama card — the direct child of the wrapper
    const card = wrap?.querySelector<HTMLElement>(':scope > div');
    expect(card?.className).toMatch(/(^|\s)self-start(\s|$)/);
  });

  // The slash menu has one capped width (max-w-[14rem]) + mx-auto so it reads as the
  // same card in every container instead of stretching full-bleed to each. It shows
  // as a clipped teaser everywhere — desktop bento cell, drawer, AND mobile — via a
  // fixed h-[6.75rem] window (NOT the grow-to-fit min-h-[6.75rem] floor), so on mobile
  // it clips at the tile's bottom edge rather than unfurling to its full height.
  // Lock the capped width and the fixed-clip window.
  it('caps the slash menu width and clips it to a fixed teaser on mobile', () => {
    renderFeatures();
    const slash = screen.getByRole('button', {
      name: 'Learn more about the toolbox and Markdown',
    });
    const wrap = findSlashWindow(slash);
    // a fixed teaser clip on mobile, not the grow-to-fit full-menu floor
    expect(wrap?.className).toMatch(/(^|\s)h-\[6\.75rem\](\s|$)/);
    expect(wrap?.className).not.toMatch(/(^|\s)min-h-\[6\.75rem\](\s|$)/);
    // mobile clips, desktop releases
    expect(wrap?.className).toMatch(/(^|\s)overflow-hidden(\s|$)/);
    expect(wrap?.className).toMatch(/(^|\s)lg:overflow-visible(\s|$)/);
    // the card itself is capped to one width and centred
    const card = wrap?.querySelector<HTMLElement>(':scope > div');
    expect(card?.className).toMatch(/(^|\s)max-w-\[14rem\](\s|$)/);
    expect(card?.className).toMatch(/(^|\s)mx-auto(\s|$)/);
  });

  // Every other diorama fills its tile, so the tile's cursor-following glow blob
  // (.bento-spot) is hidden behind it and only the soft edge shows. The slash menu
  // is a floating card with a padding ring around it, so the raw blob bled through
  // that ring — worst at a touched edge on mobile. The slash tile therefore skips
  // the blob entirely and relies on the menu's own brand edge-light; every other
  // tile still renders it. Lock both halves so the bleed can't regress.
  it('omits the raw glow blob on the slash tile but keeps it on the others', () => {
    renderFeatures();
    const slash = screen.getByRole('button', {
      name: 'Learn more about the toolbox and Markdown',
    });
    expect(slash.querySelector('.bento-spot')).toBeNull();

    // a sibling capability tile (tables) still carries the blob
    const tables = screen.getByRole('button', {
      name: 'Learn more about tables',
    });
    expect(tables.querySelector('.bento-spot')).not.toBeNull();
  });

  // Every diorama animation is gated behind the cursor: `:hover` in CSS,
  // `pointermove` in JS. A touch device has no cursor, so the dioramas froze at
  // their rest frame. The cure mirrors each hover animation onto an
  // `.is-touch-active` state the tile carries while a finger is on it — so the
  // markup must carry a `group-[.is-touch-active]:` companion next to every
  // `group-hover:` animation, never hover-only. Lock the two representative ones.
  describe('touch gestures (dioramas come alive under the finger, never on autoscroll)', () => {
    // Make framer-motion + the touch-play hook see a coarse, hoverless device.
    const asTouchDevice = () => {
      const real = window.matchMedia;
      window.matchMedia = vi.fn().mockImplementation((q: string) => ({
        matches: /hover: none|pointer: coarse/.test(q),
        media: q,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })) as unknown as typeof window.matchMedia;
      return () => {
        window.matchMedia = real;
      };
    };

    it('mirrors the Tables column-resize animation onto the touch-active state', () => {
      const { container } = renderFeatures();
      const grid = container.querySelector('[class*="grid-rows-[repeat(7"]');
      expect(grid).not.toBeNull();
      // the desktop hover path is preserved...
      expect(grid?.className).toContain('group-hover:grid-cols-');
      // ...and mirrored so a finger pressing the tile fires the same resize
      expect(grid?.className).toContain('group-[.is-touch-active]:grid-cols-');
    });

    it('mirrors the Media waveform equalizer onto the touch-active state', () => {
      const { container } = renderFeatures();
      const bar = container.querySelector('[class*="group-hover:animate-[audio-eq"]');
      expect(bar).not.toBeNull();
      expect(bar?.className).toContain('group-[.is-touch-active]:animate-[audio-eq');
    }, 15000);

    // The autoplay is gone: a tile plays only while a finger is on it. Pressing
    // wakes it (so the hover choreography runs under the touch), lifting settles it.
    it('wakes the pressed tile and settles it when the finger lifts', () => {
      const restore = asTouchDevice();
      try {
        renderFeatures();
        const tile = screen.getByRole('button', { name: 'Learn more about tables' });
        expect(tile.classList.contains('is-touch-active')).toBe(false);

        act(() => {
          fireEvent.pointerDown(tile, { pointerType: 'touch', clientX: 20, clientY: 20 });
        });
        expect(tile.classList.contains('is-touch-active')).toBe(true);

        act(() => {
          fireEvent.pointerUp(tile, { pointerType: 'touch', clientX: 20, clientY: 20 });
        });
        expect(tile.classList.contains('is-touch-active')).toBe(false);
      } finally {
        restore();
      }
    }, 15000);

    // A plain tap is still the way into the detail drawer.
    it('opens the feature modal on a plain tap', () => {
      const restore = asTouchDevice();
      try {
        renderFeatures();
        const tile = screen.getByRole('button', { name: 'Learn more about tables' });
        expect(screen.queryByRole('dialog')).toBeNull();

        act(() => {
          fireEvent.pointerDown(tile, { pointerType: 'touch', clientX: 20, clientY: 20 });
          fireEvent.pointerUp(tile, { pointerType: 'touch', clientX: 20, clientY: 20 });
          fireEvent.click(tile);
        });
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      } finally {
        restore();
      }
    }, 15000);

    // Dragging a finger across the tile is an "explore" gesture — it plays the
    // diorama and must NOT fall through to opening the modal.
    it('plays the diorama without opening the modal when the finger drags across it', () => {
      const restore = asTouchDevice();
      try {
        renderFeatures();
        const tile = screen.getByRole('button', { name: 'Learn more about tables' });

        act(() => {
          fireEvent.pointerDown(tile, { pointerType: 'touch', clientX: 20, clientY: 20 });
          fireEvent.pointerMove(tile, { pointerType: 'touch', clientX: 96, clientY: 24 });
        });
        expect(tile.classList.contains('is-touch-active')).toBe(true);

        act(() => {
          fireEvent.pointerUp(tile, { pointerType: 'touch', clientX: 96, clientY: 24 });
          fireEvent.click(tile);
        });
        expect(screen.queryByRole('dialog')).toBeNull();
      } finally {
        restore();
      }
    }, 15000);
  });

  it('should render Russian strings when locale is ru', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    render(
      <I18nProvider>
        <Features />
      </I18nProvider>
    );
    expect(screen.queryByText('Почему Blok')).not.toBeInTheDocument();
    expect(screen.getByText('Типизированный JSON, не HTML')).toBeInTheDocument();
  });

  // Opening a feature drawer never changes the route, so the global page-view
  // tracking cannot see it — it needs its own event.
  describe('analytics', () => {
    const gtagHost = (): Window & { gtag?: unknown } => window;

    beforeEach(() => {
      vi.clearAllMocks();
      gtagHost().gtag = vi.fn();
    });

    afterEach(() => {
      delete gtagHost().gtag;
      vi.restoreAllMocks();
    });

    const gtagCalls = (): unknown[][] => {
      const gtag = gtagHost().gtag;
      if (!vi.isMockFunction(gtag)) {
        throw new Error('window.gtag was not stubbed');
      }
      return gtag.mock.calls;
    };

    it('reports opening a feature drawer', () => {
      renderFeatures();

      fireEvent.click(
        screen.getByRole('button', { name: 'Learn more about tables' })
      );

      expect(gtagCalls()).toContainEqual([
        'event',
        'feature_modal_open',
        { feature: 'cyan' },
      ]);
    });

    // The dimension must stay comparable across locales, so it carries the
    // feature's stable key rather than its translated title.
    it('keeps the feature dimension stable when the locale changes', () => {
      localStorage.setItem('blok-docs-locale', 'ru');
      renderFeatures();

      // Russian UI — same feature, so the same identifier must be reported.
      fireEvent.click(
        screen.getByRole('button', { name: 'Подробнее о чистом JSON' })
      );

      expect(gtagCalls()).toContainEqual([
        'event',
        'feature_modal_open',
        { feature: 'coral' },
      ]);
    });
  });
});

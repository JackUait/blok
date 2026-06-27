import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

  // The "68 languages" tile rolls a greeting through every supported locale. Each
  // sign must have an EQUAL chance to appear — exactly 1/68 — so the locale picker
  // is a plain uniform draw over all entries, never one that excludes the current.
  describe('language sign picker', () => {
    it('offers exactly 68 languages so each draw is 1/68', () => {
      expect(LANGUAGE_COUNT).toBe(68);
    });

    it('gives every language an equal 1/68 share across the random range', () => {
      // Sweep the picker across evenly-spaced inputs over [0, 1). With one sample
      // per 1/(N·k) slice, every language must land in exactly the same number of
      // buckets — a uniform 1/N distribution, no language favored or starved.
      const PER_BUCKET = 1000;
      const samples = LANGUAGE_COUNT * PER_BUCKET;
      const counts = new Array(LANGUAGE_COUNT).fill(0);
      for (let i = 0; i < samples; i++) {
        counts[pickLocaleIndex(() => i / samples)]++;
      }
      expect(counts.every((c) => c > 0)).toBe(true); // every language reachable
      expect(new Set(counts).size).toBe(1); // and all equally likely
      expect(counts[0]).toBe(PER_BUCKET);
    });

    it('can return the current language again — a true 1/68 draw, not 1/67', () => {
      // Excluding the current sign would make others 1/67 and the current 0, which
      // is not equal. A genuine 1/68 draw must be able to repeat the same sign.
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
      screen.queryByText((content) => content.includes('Notion-style blocks'))
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
    expect(screen.getByText('68 languages, RTL-ready')).toBeInTheDocument();
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
      'Learn more about the slash menu and Markdown',
      'Learn more about tables',
      'Learn more about embeds',
      'Learn more about undo and redo',
      'Learn more about internationalization',
    ];

    expectedLabels.forEach((label) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  it('should render carousel pagination dots, one per pillar feature', () => {
    renderFeatures();

    // The three pillars become a swipeable carousel on mobile, paginated by dots.
    const dots = screen.getAllByRole('button', { name: /^Go to / });
    expect(dots).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Go to Typed JSON, never HTML' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to Every block, built in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to Bring your own blocks' })).toBeInTheDocument();
  });

  it('should mark the first pillar as the current carousel slide initially', () => {
    renderFeatures();

    expect(screen.getByRole('button', { name: 'Go to Typed JSON, never HTML' })).toHaveAttribute(
      'aria-current',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Go to Every block, built in' })).not.toHaveAttribute(
      'aria-current',
      'true'
    );
  });

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
});

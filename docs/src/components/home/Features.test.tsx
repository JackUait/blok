import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Features, EMBED_ROWS } from './Features';
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

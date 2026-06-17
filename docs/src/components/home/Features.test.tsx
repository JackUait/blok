import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Features } from './Features';
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

  it('should render Clean JSON output feature', () => {
    renderFeatures();

    expect(screen.getByText('Clean JSON output')).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('typed JSON blocks'))).toBeInTheDocument();
  });

  it('should render the block library feature', () => {
    renderFeatures();

    expect(screen.getByText('Blocks for everything')).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('Notion-style blocks'))
    ).toBeInTheDocument();
  });

  it('should render the extensibility feature', () => {
    renderFeatures();

    const button = screen.getByRole('button', { name: 'Learn more about extending Blok' });
    const withinButton = within(button);
    expect(withinButton.getByText('Extensible by design')).toBeInTheDocument();
    expect(withinButton.getByText((content) => content.includes('block tunes'))).toBeInTheDocument();
  });

  it('should render Slash menu & Markdown feature', () => {
    renderFeatures();

    expect(screen.getByText('Slash menu & Markdown')).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('Markdown shortcuts'))
    ).toBeInTheDocument();
  });

  it('should render Databases & boards feature', () => {
    renderFeatures();

    expect(screen.getByText('Databases & boards')).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('every row is a block'))
    ).toBeInTheDocument();
  });

  it('should render Tables feature', () => {
    renderFeatures();

    expect(screen.getByText('Tables that behave')).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('Merged cells'))).toBeInTheDocument();
  });

  it('should render Embeds feature', () => {
    renderFeatures();

    expect(screen.getByText('Embeds & link previews')).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('100+ services'))
    ).toBeInTheDocument();
  });

  it('should render Undo & redo feature', () => {
    renderFeatures();

    expect(screen.getByText('Undo & redo')).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('Yjs-backed'))
    ).toBeInTheDocument();
  });

  it('should render 68 languages feature', () => {
    renderFeatures();

    expect(screen.getByText('68 languages, RTL-ready')).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('right-to-left support'))
    ).toBeInTheDocument();
  });

  it('should render feature cards with accessible labels', () => {
    renderFeatures();

    const expectedLabels = [
      'Learn more about Clean JSON output',
      'Learn more about the block library',
      'Learn more about extending Blok',
      'Learn more about the slash menu and Markdown',
      'Learn more about databases',
      'Learn more about tables',
      'Learn more about embeds',
      'Learn more about undo and redo',
      'Learn more about internationalization',
    ];

    expectedLabels.forEach((label) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  it('should render Russian strings when locale is ru', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    render(
      <I18nProvider>
        <Features />
      </I18nProvider>
    );
    expect(screen.queryByText('Почему Blok')).not.toBeInTheDocument();
    expect(screen.getByText('Чистый JSON')).toBeInTheDocument();
  });
});

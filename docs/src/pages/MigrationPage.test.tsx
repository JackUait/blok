import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MigrationPage } from './MigrationPage';
import {
  MIGRATION_STEPS,
  DIFF_CHANGES,
} from '../components/migration/migration-data';
import { I18nProvider } from '../contexts/I18nContext';
import enJson from '../i18n/en.json';

const m = enJson.migration;

const renderMigrationPage = () =>
  render(
    <MemoryRouter>
      <I18nProvider>
        <MigrationPage />
      </I18nProvider>
    </MemoryRouter>
  );

describe('MigrationPage', () => {
  it('should render the Nav component and main landmark', () => {
    renderMigrationPage();

    expect(screen.getByTestId('nav')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('should render the hero heading with eyebrow', () => {
    renderMigrationPage();

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(m.heroBlok);
    expect(screen.getByText(m.heroEyebrow)).toBeInTheDocument();
  });

  it('should render the rewritten hero description', () => {
    renderMigrationPage();

    expect(screen.getByText(m.heroDescription)).toBeInTheDocument();
  });

  it('should not render a standalone command block in the hero', () => {
    renderMigrationPage();

    expect(screen.queryByTestId('hero-command')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Dry run — prints the plan, writes nothing.'),
    ).not.toBeInTheDocument();
  });

  it('should render the rewrite preview card in the hero', () => {
    renderMigrationPage();

    const preview = screen.getByTestId('hero-rewrite-preview');
    expect(preview).toHaveTextContent(DIFF_CHANGES[0].removed);
    expect(preview).toHaveTextContent(DIFF_CHANGES[0].added);
  });

  it('should link the rewrite preview to the full changes section', () => {
    renderMigrationPage();

    const preview = screen.getByTestId('hero-rewrite-preview');
    const link = within(preview).getByRole('link');
    expect(link).toHaveAttribute('href', '#changes');
  });

  it('should not render a hero fact row', () => {
    renderMigrationPage();

    expect(screen.queryByTestId('hero-facts')).not.toBeInTheDocument();
    expect(screen.queryByText('One codemod command')).not.toBeInTheDocument();
  });

  it('should render the step rail with anchors for every section', () => {
    renderMigrationPage();

    const nav = screen.getByRole('navigation', { name: m.stepRailLabel });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(MIGRATION_STEPS.length);
  });

  it('should render every anchored step section', () => {
    renderMigrationPage();

    MIGRATION_STEPS.forEach((step) => {
      const section = document.getElementById(step.id);
      expect(section).not.toBeNull();
    });
  });

  it('should render the codemod card inside the codemod section', () => {
    renderMigrationPage();

    const section = document.getElementById('codemod');
    expect(section).not.toBeNull();
    expect(within(section as HTMLElement).getByTestId('codemod-card')).toBeInTheDocument();
  });

  it('should not render a trailing CTA section', () => {
    renderMigrationPage();

    expect(screen.queryByText('Ready to Migrate?')).not.toBeInTheDocument();
    expect(screen.queryByText('Try the Demo')).not.toBeInTheDocument();
    expect(screen.queryByText('View API Docs')).not.toBeInTheDocument();
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MigrationPage } from './MigrationPage';
import {
  MIGRATION_STEPS,
  CODEMOD_DRY_RUN_COMMAND,
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

  it('should promote the dry-run command into the hero', () => {
    renderMigrationPage();

    const heroCommand = screen.getByTestId('hero-command');
    expect(heroCommand).toHaveTextContent(CODEMOD_DRY_RUN_COMMAND);
    expect(screen.getByText(m.heroCommandHint)).toBeInTheDocument();
  });

  it('should render the fact row instead of marketing stat cards', () => {
    renderMigrationPage();

    const facts = screen.getByTestId('hero-facts');
    expect(facts).toHaveTextContent(m.factOneCommand);
    expect(facts).toHaveTextContent(m.factToolsMapped);
    expect(facts).toHaveTextContent(m.factAlias);
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

  it('should render the CTA with demo and docs links', () => {
    renderMigrationPage();

    expect(screen.getByText(m.ctaTitle)).toBeInTheDocument();
    expect(screen.getByText(m.ctaTryDemo).closest('a')).toHaveAttribute('href', '/demo');
    expect(screen.getByText(m.ctaViewDocs).closest('a')).toHaveAttribute('href', '/docs');
  });
});

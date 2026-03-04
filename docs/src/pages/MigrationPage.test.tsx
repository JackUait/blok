import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MigrationPage } from './MigrationPage';
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
  it('should render the Nav component', () => {
    renderMigrationPage();

    const nav = screen.getByTestId('nav');
    expect(nav).toBeInTheDocument();
  });

  it('should render the migration hero title', () => {
    renderMigrationPage();

    // heroFromEditorJS appears in the hero title and also in the CSS reference legend
    expect(screen.getAllByText(m.heroFromEditorJS).length).toBeGreaterThanOrEqual(1);
    // Blok appears in the gradient span within the h1 title
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(m.heroBlok);
  });

  it('should render the migration hero description', () => {
    renderMigrationPage();

    expect(screen.getByText(m.heroDescription)).toBeInTheDocument();
  });

  it('should render the CodemodCard component', () => {
    renderMigrationPage();

    expect(screen.getByTestId('codemod-card')).toBeInTheDocument();
  });

  it('should render the main element', () => {
    renderMigrationPage();

    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
  });

  it('should render the hero section with heading', () => {
    renderMigrationPage();

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent(m.heroBlok);
  });

  it('should render navigation links', () => {
    renderMigrationPage();

    const nav = screen.getByTestId('nav');
    expect(nav).toBeInTheDocument();
  });
});

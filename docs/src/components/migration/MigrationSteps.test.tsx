import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { I18nProvider } from '../../contexts/I18nContext';
import { MigrationSteps } from './MigrationSteps';
import enJson from '../../i18n/en.json';

const m = enJson.migration;

const renderMigrationSteps = () =>
  render(
    <I18nProvider>
      <MigrationSteps />
    </I18nProvider>
  );

describe('MigrationSteps', () => {
  it('should render the component', () => {
    renderMigrationSteps();

    expect(screen.getByTestId('migration-section')).toBeInTheDocument();
  });

  it('should render What Gets Transformed section heading', () => {
    renderMigrationSteps();

    expect(screen.getByText(m.step2Title)).toBeInTheDocument();
  });

  it('should render the section description', () => {
    renderMigrationSteps();

    expect(screen.getByText(m.step2Description)).toBeInTheDocument();
  });

  it('should render 6 change cards', () => {
    renderMigrationSteps();

    const cards = screen.getAllByTestId('change-card');
    expect(cards).toHaveLength(6);
  });

  it('should render Imports change card', () => {
    renderMigrationSteps();

    expect(screen.getByText(m.changeImports)).toBeInTheDocument();
  });

  it('should render Tool Imports change card', () => {
    renderMigrationSteps();

    expect(screen.getByText(m.changeToolImports)).toBeInTheDocument();
  });

  it('should render Types change card', () => {
    renderMigrationSteps();

    expect(screen.getByText(m.changeTypes)).toBeInTheDocument();
  });

  it('should render CSS Selectors change card', () => {
    renderMigrationSteps();

    expect(screen.getByText(m.changeCssSelectors)).toBeInTheDocument();
  });

  it('should render Default Holder change card', () => {
    renderMigrationSteps();

    expect(screen.getByText(m.changeDefaultHolder)).toBeInTheDocument();
  });

  it('should render Data Attributes change card', () => {
    renderMigrationSteps();

    expect(screen.getByText(m.changeDataAttributes)).toBeInTheDocument();
  });

  it('should render CSS Selector Reference section heading', () => {
    renderMigrationSteps();

    expect(screen.getByText(m.step3Title)).toBeInTheDocument();
  });

  it('should render CSS reference description', () => {
    renderMigrationSteps();

    expect(screen.getByText(m.step3Description)).toBeInTheDocument();
  });

  it('should render the CSS mappings table headers', () => {
    renderMigrationSteps();

    const referenceCard = screen.getByTestId('migration-table');
    expect(within(referenceCard).getByText(m.heroFromEditorJS)).toBeInTheDocument();
    expect(within(referenceCard).getByText(m.heroBlok)).toBeInTheDocument();
  });

  it('should render .codex-editor mapping in table', () => {
    renderMigrationSteps();

    expect(screen.getByText('.codex-editor')).toBeInTheDocument();
  });

  it('should render .ce-block mapping in table', () => {
    renderMigrationSteps();

    const table = screen.getByTestId('migration-table');
    const withinTable = within(table);
    expect(withinTable.getByText('.ce-block')).toBeInTheDocument();
  });

  it('should render [data-blok-element] mapping in table', () => {
    renderMigrationSteps();

    const table = screen.getByTestId('migration-table');
    const withinTable = within(table);
    expect(withinTable.getByText('[data-blok-element]')).toBeInTheDocument();
  });

  it('should render both migration sections', () => {
    renderMigrationSteps();

    expect(screen.getByTestId('migration-section')).toBeInTheDocument();
    expect(screen.getByTestId('css-reference-section')).toBeInTheDocument();
  });

  it('should render changes grid container', () => {
    renderMigrationSteps();

    expect(screen.getByTestId('changes-grid')).toBeInTheDocument();
  });

  it('should render migration table', () => {
    renderMigrationSteps();

    expect(screen.getByTestId('migration-table')).toBeInTheDocument();
  });

  it('should render removed and added code diffs in each change card', () => {
    renderMigrationSteps();

    const cards = screen.getAllByTestId('change-card');
    // Use Unicode minus sign (−) which is used in the component
    const diffMarkers = screen.getAllByText('−');
    const addMarkers = screen.getAllByText('+');

    expect(cards).toHaveLength(6);
    expect(diffMarkers.length).toBeGreaterThanOrEqual(6);
    expect(addMarkers.length).toBeGreaterThanOrEqual(6);
  });

  it('should render code elements for each change', () => {
    renderMigrationSteps();

    const codeElements = screen.getAllByRole('code');

    expect(codeElements.length).toBeGreaterThan(0);
  });

  it('should render each change card with title and diff', () => {
    renderMigrationSteps();

    const cards = screen.getAllByTestId('change-card');

    cards.forEach((card) => {
      const withinCard = within(card);
      const heading = withinCard.queryByRole('heading', { level: 3 });
      const codeElements = withinCard.getAllByRole('code');

      expect(heading).toBeInTheDocument();
      expect(codeElements.length).toBe(2);
    });
  });

  it('should render reference card with proper header legend', () => {
    renderMigrationSteps();

    const referenceCard = screen.getByTestId('migration-table');

    // Legend shows EditorJS → Blok transformation direction
    expect(within(referenceCard).getByText(m.heroFromEditorJS)).toBeInTheDocument();
    expect(within(referenceCard).getByText(m.heroBlok)).toBeInTheDocument();
    // Count is interpolated: "{count} selectors" with CSS_MAPPINGS.length = 8
    expect(within(referenceCard).getByText(m.selectorsCount.replace('{count}', '8'))).toBeInTheDocument();
  });
});

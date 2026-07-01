import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../contexts/I18nContext';
import { MigrationSteps } from './MigrationSteps';
import { BLOK_VERSION_BREAKING_CHANGES } from './migration-data';
import enJson from '../../i18n/en.json';

const m = enJson.migration;

const renderMigrationSteps = () =>
  render(
    <MemoryRouter>
      <I18nProvider>
        <MigrationSteps />
      </I18nProvider>
    </MemoryRouter>
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

  it('should not draw its own bordered/card box around each change card (the grid gap separates items instead)', () => {
    renderMigrationSteps();

    const cards = screen.getAllByTestId('change-card');
    cards.forEach((card) => {
      expect(card.className).not.toMatch(/bg-card/);
      expect(card.className).not.toMatch(/shadow/);
    });
  });

  it('should keep the bordered box around each removed/added diff row', () => {
    renderMigrationSteps();

    const removedRow = screen.getAllByText('−')[0].closest('div');
    const addedRow = screen.getAllByText('+')[0].closest('div');

    expect(removedRow?.className).toMatch(/\bborder\b/);
    expect(addedRow?.className).toMatch(/\bborder\b/);
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

  it('should render the Custom Tools section heading and description', () => {
    renderMigrationSteps();

    const section = screen.getByTestId('custom-tools-section');
    expect(within(section).getByText(m.step4Title)).toBeInTheDocument();
    expect(within(section).getByText(m.step4Description)).toBeInTheDocument();
  });

  it('should render the inline-tool render → MenuConfig before/after sample', () => {
    renderMigrationSteps();

    const section = screen.getByTestId('custom-tools-section');
    // Heading naming the inline-tool change
    expect(within(section).getByText(m.customInlineToolTitle)).toBeInTheDocument();
    // Before: returns an HTMLElement; After: returns a MenuConfig
    expect(within(section).getByText(m.customInlineToolBefore)).toBeInTheDocument();
    expect(within(section).getByText(m.customInlineToolAfter)).toBeInTheDocument();
  });

  it('should reassure that custom block tools port largely unchanged', () => {
    renderMigrationSteps();

    const section = screen.getByTestId('custom-tools-section');
    expect(within(section).getByText(m.customBlockToolTitle)).toBeInTheDocument();
    expect(within(section).getByText(m.customBlockToolNote)).toBeInTheDocument();
  });

  it('should render the drop-in EditorJS alias note', () => {
    renderMigrationSteps();

    const note = screen.getByTestId('alias-note');
    expect(within(note).getByText(m.aliasNoteTitle)).toBeInTheDocument();
    expect(within(note).getByText(m.aliasNoteDescription)).toBeInTheDocument();
    expect(within(note).getByText(m.aliasNoteCode)).toBeInTheDocument();
  });

  it('should render the wrapLegacyInlineTool fast-path card', () => {
    renderMigrationSteps();

    const section = screen.getByTestId('custom-tools-section');
    expect(within(section).getByText(m.customInlineToolFastPathTitle)).toBeInTheDocument();
    expect(within(section).getByText(m.customInlineToolFastPathNote)).toBeInTheDocument();
    expect(within(section).getByText(m.customInlineToolFastPathCode)).toBeInTheDocument();
  });

  it('should render the dropped-fields warnings note', () => {
    renderMigrationSteps();

    const note = screen.getByTestId('dropped-fields-note');
    expect(within(note).getByText(m.droppedFieldsTitle)).toBeInTheDocument();
    expect(within(note).getByText(m.droppedFieldsWarning)).toBeInTheDocument();
  });

  it('should render the linkTool.meta.site_name dropped field row', () => {
    renderMigrationSteps();

    const note = screen.getByTestId('dropped-fields-note');
    expect(within(note).getByText('linkTool')).toBeInTheDocument();
    expect(within(note).getByText('meta.site_name')).toBeInTheDocument();
  });

  it('should not draw its own bordered/card box around the dropped-fields note (a divider inside it still separates the table)', () => {
    renderMigrationSteps();

    const note = screen.getByTestId('dropped-fields-note');
    expect(note.className).not.toMatch(/\bborder\b/);
    expect(note.className).not.toMatch(/bg-secondary/);
  });

  it('should keep the bordered box around the nested dropped-fields table', () => {
    renderMigrationSteps();

    const note = screen.getByTestId('dropped-fields-note');
    const nestedBox = within(note).getByText('linkTool').closest('.divide-y')?.parentElement;
    expect(nestedBox?.className).toMatch(/\bborder\b/);
  });

  it('should render the supported Editor.js versions section', () => {
    renderMigrationSteps();

    const section = screen.getByTestId('supported-versions-section');
    expect(within(section).getByText(m.supportedVersionsTitle)).toBeInTheDocument();
    expect(within(section).getByText(m.supportedVersionsDescription)).toBeInTheDocument();
    // Target line statement names the 2.x line
    expect(within(section).getByText(m.supportedVersionsTarget)).toBeInTheDocument();
  });

  it('should render the compatibility matrix rows', () => {
    renderMigrationSteps();

    const matrix = screen.getByTestId('compatibility-matrix');
    const rows = within(matrix).getAllByTestId('compatibility-row');
    expect(rows.length).toBeGreaterThanOrEqual(8);
    // Grounded rows: a drop-in tool, a runtime-migrated tool, and a not-bundled tool
    expect(within(matrix).getByText('paragraph')).toBeInTheDocument();
    expect(within(matrix).getByText('linkTool')).toBeInTheDocument();
    expect(within(matrix).getByText('checklist')).toBeInTheDocument();
  });

  it('should render the Blok upgrade (Blok -> Blok) section heading and description', () => {
    renderMigrationSteps();

    const section = screen.getByTestId('blok-upgrade-section');
    expect(within(section).getByText(m.blokUpgradeTitle)).toBeInTheDocument();
    expect(within(section).getByText(m.blokUpgradeDescription)).toBeInTheDocument();
  });

  it('should render one row per grounded Blok breaking change', () => {
    renderMigrationSteps();

    const table = screen.getByTestId('blok-upgrade-table');
    const rows = within(table).getAllByTestId('blok-upgrade-row');
    expect(rows).toHaveLength(BLOK_VERSION_BREAKING_CHANGES.length);

    BLOK_VERSION_BREAKING_CHANGES.forEach((change) => {
      expect(within(table).getByText(`v${change.version}`)).toBeInTheDocument();
      const description = m[change.descriptionKey.replace('migration.', '') as keyof typeof m];
      expect(within(table).getByText(description as string)).toBeInTheDocument();
    });
  });

  it('should link each Blok breaking-change row back to the changelog', () => {
    renderMigrationSteps();

    const table = screen.getByTestId('blok-upgrade-table');
    const links = within(table).getAllByRole('link', { name: m.blokUpgradeViewChangelog });
    expect(links).toHaveLength(BLOK_VERSION_BREAKING_CHANGES.length);
    links.forEach((link) => {
      expect(link).toHaveAttribute('href', '/changelog');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MigrationSteps } from './MigrationSteps';
import {
  CSS_MAPPINGS,
  DIFF_CHANGES,
  COMPATIBILITY_GROUPS,
} from './migration-data';
import { I18nProvider } from '../../contexts/I18nContext';
import enJson from '../../i18n/en.json';

const m = enJson.migration;

const renderSteps = () =>
  render(
    <MemoryRouter>
      <I18nProvider>
        <MigrationSteps />
      </I18nProvider>
    </MemoryRouter>
  );

describe('MigrationSteps', () => {
  describe('what changes (diff card)', () => {
    it('should render a single diff card with one row per change', () => {
      renderSteps();

      const rows = within(screen.getByTestId('changes-diff')).getAllByTestId('change-row');
      expect(rows).toHaveLength(DIFF_CHANGES.length);
    });

    it('should show before and after code in each row', () => {
      renderSteps();

      const rows = screen.getAllByTestId('change-row');
      expect(rows[0]).toHaveTextContent("import EditorJS from '@editorjs/editorjs';");
      expect(rows[0]).toHaveTextContent("import { Blok } from '@jackuait/blok';");
    });

    it('should anchor the section as #changes', () => {
      renderSteps();

      expect(screen.getByTestId('changes-section')).toHaveAttribute('id', 'changes');
    });
  });

  describe('css selector reference', () => {
    it('should render one row per CSS mapping', () => {
      renderSteps();

      const table = screen.getByTestId('migration-table');
      CSS_MAPPINGS.forEach((mapping) => {
        expect(within(table).getByText(mapping.editorjs)).toBeInTheDocument();
        expect(within(table).getByText(mapping.blok)).toBeInTheDocument();
      });
    });

    it('should anchor the section as #css', () => {
      renderSteps();

      expect(screen.getByTestId('css-reference-section')).toHaveAttribute('id', 'css');
    });
  });

  describe('custom tools', () => {
    it('should render the three custom-tool migration paths', () => {
      renderSteps();

      expect(screen.getByText(m.customInlineToolTitle)).toBeInTheDocument();
      expect(screen.getByText(m.customInlineToolFastPathTitle)).toBeInTheDocument();
      expect(screen.getByText(m.customBlockToolTitle)).toBeInTheDocument();
    });

    it('should render the dropped-fields warning table', () => {
      renderSteps();

      const note = screen.getByTestId('dropped-fields-note');
      expect(note).toHaveTextContent(m.droppedFieldsTitle);
      expect(note).toHaveTextContent(m.droppedFieldsQuoteBlock);
    });

    it('should anchor the section as #tools', () => {
      renderSteps();

      expect(screen.getByTestId('custom-tools-section')).toHaveAttribute('id', 'tools');
    });
  });

  describe('verify compatibility (grouped matrix)', () => {
    it('should render the three compatibility groups with titles and hints', () => {
      renderSteps();

      const groups = screen.getAllByTestId('compatibility-group');
      expect(groups).toHaveLength(COMPATIBILITY_GROUPS.length);
      expect(screen.getByText(m.compatGroupDropIn)).toBeInTheDocument();
      expect(screen.getByText(m.compatGroupAuto)).toBeInTheDocument();
      expect(screen.getByText(m.compatGroupNotBundled)).toBeInTheDocument();
      expect(screen.getByText(m.compatGroupAutoHint)).toBeInTheDocument();
    });

    it('should render every tool as a chip inside its group', () => {
      renderSteps();

      const groups = screen.getAllByTestId('compatibility-group');
      COMPATIBILITY_GROUPS.forEach((group, index) => {
        group.tools.forEach((tool) => {
          expect(within(groups[index]).getByText(tool)).toBeInTheDocument();
        });
      });
    });

    it('should render the target line and stub notes', () => {
      renderSteps();

      expect(screen.getByText(m.supportedVersionsTarget)).toBeInTheDocument();
      expect(screen.getByTestId('compatibility-stub-note')).toBeInTheDocument();
    });

    it('should anchor the section as #verify', () => {
      renderSteps();

      expect(screen.getByTestId('supported-versions-section')).toHaveAttribute('id', 'verify');
    });
  });

  describe('upgrading within Blok (coda)', () => {
    it('should not render the Blok → Blok upgrade coda', () => {
      renderSteps();

      expect(screen.queryByTestId('blok-upgrade-section')).not.toBeInTheDocument();
      expect(screen.queryByTestId('blok-upgrade-table')).not.toBeInTheDocument();
      expect(screen.queryAllByTestId('blok-upgrade-row')).toHaveLength(0);
    });

    it('should end on the verify step', () => {
      renderSteps();

      expect(screen.getByTestId('supported-versions-section')).toBeInTheDocument();
      expect(screen.queryByText('Upgrading within Blok')).not.toBeInTheDocument();
    });
  });
});

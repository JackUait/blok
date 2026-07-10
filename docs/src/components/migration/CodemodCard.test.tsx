import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CodemodCard } from './CodemodCard';
import { CODEMOD_DRY_RUN_COMMAND, CODEMOD_APPLY_COMMAND } from './migration-data';
import { I18nProvider } from '../../contexts/I18nContext';
import enJson from '../../i18n/en.json';

const m = enJson.migration;

const renderCard = () =>
  render(
    <I18nProvider>
      <CodemodCard />
    </I18nProvider>
  );

describe('CodemodCard', () => {
  it('should render the codemod card', () => {
    renderCard();

    expect(screen.getByTestId('codemod-card')).toBeInTheDocument();
  });

  it('should show the dry-run and apply commands at the same time (session, no tabs)', () => {
    renderCard();

    const dryRun = screen.getByTestId('codemod-step-dry-run');
    const apply = screen.getByTestId('codemod-step-apply');
    expect(dryRun).toHaveTextContent(CODEMOD_DRY_RUN_COMMAND);
    expect(apply).toHaveTextContent(CODEMOD_APPLY_COMMAND);
  });

  it('should not render tab buttons', () => {
    renderCard();

    expect(screen.queryByTestId('codemod-tab-dry-run')).not.toBeInTheDocument();
    expect(screen.queryByTestId('codemod-tab-apply')).not.toBeInTheDocument();
  });

  it('should label the dry-run step as preview and the apply step as apply', () => {
    renderCard();

    expect(within(screen.getByTestId('codemod-step-dry-run')).getByText(m.codemodStepDryRun)).toBeInTheDocument();
    expect(within(screen.getByTestId('codemod-step-apply')).getByText(m.codemodStepApply)).toBeInTheDocument();
  });

  it('should render all codemod option flags with descriptions', () => {
    renderCard();

    const options = screen.getByTestId('codemod-options');
    expect(within(options).getByText('--dry-run')).toBeInTheDocument();
    expect(within(options).getByText('--verbose')).toBeInTheDocument();
    expect(within(options).getByText('--use-library-i18n')).toBeInTheDocument();
    expect(within(options).getByText(m.codemodDryRunDescription)).toBeInTheDocument();
    expect(within(options).getByText(m.codemodVerboseDescription)).toBeInTheDocument();
    expect(within(options).getByText(m.codemodI18nDescription)).toBeInTheDocument();
  });

  it('should render the drop-in alias note', () => {
    renderCard();

    const note = screen.getByTestId('alias-note');
    expect(note).toHaveTextContent(m.aliasNoteTitle);
    expect(note).toHaveTextContent(m.aliasNoteCode);
  });
});

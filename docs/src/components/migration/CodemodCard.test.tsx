import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CodemodCard } from './CodemodCard';

describe('CodemodCard', () => {
  it('should render a div with codemod-card class', () => {
    render(<CodemodCard />);

    expect(screen.getByTestId('codemod-card')).toBeInTheDocument();
  });

  it('should render the codemod icon', () => {
    render(<CodemodCard />);

    expect(screen.getByTestId('codemod-icon')).toBeInTheDocument();
  });

  it('should render the title', () => {
    render(<CodemodCard />);

    expect(screen.getByText('Automated Codemod')).toBeInTheDocument();
  });

  it('should render the description', () => {
    render(<CodemodCard />);

    expect(
      screen.getByText('The fastest way to migrate is using our automated codemod. It handles imports, selectors, types, and configuration.')
    ).toBeInTheDocument();
  });

  it('should render two tabs', () => {
    render(<CodemodCard />);

    expect(screen.getByText('Dry Run')).toBeInTheDocument();
    expect(screen.getByText('Apply')).toBeInTheDocument();
  });

  it('should have dry-run tab active by default', () => {
    render(<CodemodCard />);

    const dryRunTab = screen.getByTestId('codemod-tab-dry-run');
    expect(dryRunTab).toHaveClass('active');

    const applyTab = screen.getByTestId('codemod-tab-apply');
    expect(applyTab).not.toHaveClass('active');
  });

  it('should switch to apply tab when clicked', () => {
    render(<CodemodCard />);

    const applyTab = screen.getByTestId('codemod-tab-apply');
    fireEvent.click(applyTab);

    expect(applyTab).toHaveClass('active');

    const dryRunTab = screen.getByTestId('codemod-tab-dry-run');
    expect(dryRunTab).not.toHaveClass('active');
  });

  it('should render dry-run code by default', () => {
    render(<CodemodCard />);

    // CodeBlock stores code in data-code attribute for copy functionality
    const copyButton = screen.getByLabelText('Copy');
    expect(copyButton).toHaveAttribute('data-code', 'npx -p @jackuait/blok migrate-from-editorjs ./src --dry-run');
  });

  it('should render apply code when apply tab is active', () => {
    render(<CodemodCard />);

    const applyTab = screen.getByTestId('codemod-tab-apply');
    fireEvent.click(applyTab);

    const copyButton = screen.getByLabelText('Copy');
    expect(copyButton).toHaveAttribute('data-code', 'npx -p @jackuait/blok migrate-from-editorjs ./src');
  });

  it('should render codemod-options section', () => {
    render(<CodemodCard />);

    expect(screen.getByText('Options')).toBeInTheDocument();
  });

  it('should render the options table', () => {
    render(<CodemodCard />);

    expect(screen.getByText('--dry-run')).toBeInTheDocument();
    expect(screen.getByText('--verbose')).toBeInTheDocument();
    expect(screen.getByText('--use-library-i18n')).toBeInTheDocument();
  });

  it('should render option descriptions', () => {
    render(<CodemodCard />);

    expect(screen.getByText('Preview changes without modifying files')).toBeInTheDocument();
    expect(screen.getByText('Show detailed output for each file processed')).toBeInTheDocument();
    expect(screen.getByText("Use Blok's built-in translations (68 languages)")).toBeInTheDocument();
  });

  it('should have codemod-tabs div', () => {
    render(<CodemodCard />);

    expect(screen.getByTestId('codemod-tabs')).toBeInTheDocument();
  });

  it('should have codemod-tab buttons', () => {
    render(<CodemodCard />);

    expect(screen.getByTestId('codemod-tab-dry-run')).toBeInTheDocument();
    expect(screen.getByTestId('codemod-tab-apply')).toBeInTheDocument();
  });

  it('should have codemod-content div', () => {
    render(<CodemodCard />);

    expect(screen.getByTestId('codemod-content')).toBeInTheDocument();
  });

  it('should have codemod-panel divs', () => {
    render(<CodemodCard />);

    expect(screen.getByTestId('codemod-panel-dry-run')).toBeInTheDocument();
    expect(screen.getByTestId('codemod-panel-apply')).toBeInTheDocument();
  });

  it('should have codemod-options div', () => {
    render(<CodemodCard />);

    expect(screen.getByTestId('codemod-options')).toBeInTheDocument();
  });

  it('should have codemod-options-title h4', () => {
    render(<CodemodCard />);

    const title = screen.getByTestId('codemod-options-title');
    expect(title).toHaveTextContent('Options');
  });

  it('should have migration-table class on table', () => {
    render(<CodemodCard />);

    expect(screen.getByTestId('migration-table')).toBeInTheDocument();
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CodemodCard } from './CodemodCard';

describe('CodemodCard', () => {
  it('should render a div with codemod-card class', () => {
    render(<CodemodCard />);

    const card = document.querySelector('.codemod-card');
    expect(card).toBeInTheDocument();
  });

  it('should render the codemod icon', () => {
    render(<CodemodCard />);

    const icon = document.querySelector('.codemod-icon');
    expect(icon).toBeInTheDocument();
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

    const dryRunTab = screen.getByText('Dry Run');
    expect(dryRunTab.closest('button')).toHaveClass('active');

    const applyTab = screen.getByText('Apply');
    expect(applyTab.closest('button')).not.toHaveClass('active');
  });

  it('should switch to apply tab when clicked', () => {
    render(<CodemodCard />);

    const applyTab = screen.getByText('Apply');
    fireEvent.click(applyTab);

    expect(applyTab.closest('button')).toHaveClass('active');

    const dryRunTab = screen.getByText('Dry Run');
    expect(dryRunTab.closest('button')).not.toHaveClass('active');
  });

  it('should render dry-run code by default', () => {
    render(<CodemodCard />);

    // CodeBlock content may be highlighted, so we check for partial text
    expect(screen.getByText((content) => content.includes('npx'))).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('--dry-run'))).toBeInTheDocument();
  });

  it('should render apply code when apply tab is active', () => {
    render(<CodemodCard />);

    const applyTab = screen.getByText('Apply');
    fireEvent.click(applyTab);

    expect(screen.getByText((content) => content.includes('npx'))).toBeInTheDocument();
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
    const { container } = render(<CodemodCard />);

    const tabs = container.querySelector('.codemod-tabs');
    expect(tabs).toBeInTheDocument();
  });

  it('should have codemod-tab buttons', () => {
    const { container } = render(<CodemodCard />);

    const tabs = container.querySelectorAll('.codemod-tab');
    expect(tabs.length).toBe(2);
  });

  it('should have codemod-content div', () => {
    const { container } = render(<CodemodCard />);

    const content = container.querySelector('.codemod-content');
    expect(content).toBeInTheDocument();
  });

  it('should have codemod-panel divs', () => {
    const { container } = render(<CodemodCard />);

    const panels = container.querySelectorAll('.codemod-panel');
    expect(panels.length).toBe(2);
  });

  it('should have codemod-options div', () => {
    const { container } = render(<CodemodCard />);

    const options = container.querySelector('.codemod-options');
    expect(options).toBeInTheDocument();
  });

  it('should have codemod-options-title h4', () => {
    const { container } = render(<CodemodCard />);

    const title = container.querySelector('.codemod-options-title');
    expect(title?.textContent).toBe('Options');
  });

  it('should have migration-table class on table', () => {
    const { container } = render(<CodemodCard />);

    const table = container.querySelector('.migration-table');
    expect(table).toBeInTheDocument();
  });
});

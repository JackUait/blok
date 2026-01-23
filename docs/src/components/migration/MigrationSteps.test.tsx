import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MigrationSteps } from './MigrationSteps';

describe('MigrationSteps', () => {
  it('should render a fragment', () => {
    const { container } = render(<MigrationSteps />);

    expect(container.firstChild).not.toBe(null);
  });

  it('should render What Gets Transformed section', () => {
    render(<MigrationSteps />);

    expect(screen.getByText('What Gets Transformed')).toBeInTheDocument();
  });

  it('should render the section description', () => {
    render(<MigrationSteps />);

    expect(
      screen.getByText('The codemod handles all the breaking changes automatically.')
    ).toBeInTheDocument();
  });

  it('should render 6 change cards', () => {
    const { container } = render(<MigrationSteps />);

    const cards = container.querySelectorAll('.change-card');
    expect(cards.length).toBe(6);
  });

  it('should render Imports change card', () => {
    render(<MigrationSteps />);

    expect(screen.getByText('Imports')).toBeInTheDocument();
  });

  it('should render Tool Imports change card', () => {
    render(<MigrationSteps />);

    expect(screen.getByText('Tool Imports')).toBeInTheDocument();
  });

  it('should render Types change card', () => {
    render(<MigrationSteps />);

    expect(screen.getByText('Types')).toBeInTheDocument();
  });

  it('should render CSS Selectors change card', () => {
    render(<MigrationSteps />);

    expect(screen.getByText('CSS Selectors')).toBeInTheDocument();
  });

  it('should render Default Holder change card', () => {
    render(<MigrationSteps />);

    expect(screen.getByText('Default Holder')).toBeInTheDocument();
  });

  it('should render Data Attributes change card', () => {
    render(<MigrationSteps />);

    expect(screen.getByText('Data Attributes')).toBeInTheDocument();
  });

  it('should render CSS Selector Reference section', () => {
    render(<MigrationSteps />);

    expect(screen.getByText('CSS Selector Reference')).toBeInTheDocument();
  });

  it('should render CSS reference description', () => {
    render(<MigrationSteps />);

    expect(
      screen.getByText('Reference for manually updating your CSS selectors.')
    ).toBeInTheDocument();
  });

  it('should render the CSS mappings table', () => {
    render(<MigrationSteps />);

    expect(screen.getByText('EditorJS')).toBeInTheDocument();
    expect(screen.getByText('Blok')).toBeInTheDocument();
  });

  it('should render .codex-editor mapping', () => {
    render(<MigrationSteps />);

    // The content may be in code tags which are treated differently
    expect(screen.getByText((content) => content.includes('codex-editor'))).toBeInTheDocument();
  });

  it('should render .ce-block mapping', () => {
    render(<MigrationSteps />);

    // The content may be in code tags which are treated differently
    expect(screen.getByText((content) => content.includes('ce-block'))).toBeInTheDocument();
  });

  it('should render [data-blok-element] mapping', () => {
    render(<MigrationSteps />);

    // The content may be in code tags which are treated differently
    expect(screen.getByText((content) => content.includes('data-blok-element'))).toBeInTheDocument();
  });

  it('should have migration-section sections', () => {
    const { container } = render(<MigrationSteps />);

    const sections = container.querySelectorAll('.migration-section');
    expect(sections.length).toBe(2);
  });

  it('should have changes-grid div', () => {
    const { container } = render(<MigrationSteps />);

    const grid = container.querySelector('.changes-grid');
    expect(grid).toBeInTheDocument();
  });

  it('should have change-card elements', () => {
    const { container } = render(<MigrationSteps />);

    const cards = container.querySelectorAll('.change-card');
    expect(cards.length).toBe(6);
  });

  it('should have change-card-header divs', () => {
    const { container } = render(<MigrationSteps />);

    const headers = container.querySelectorAll('.change-card-header');
    expect(headers.length).toBe(6);
  });

  it('should have change-card-title h3s', () => {
    const { container } = render(<MigrationSteps />);

    const titles = container.querySelectorAll('.change-card-title');
    expect(titles.length).toBe(6);
  });

  it('should have change-card-content divs', () => {
    const { container } = render(<MigrationSteps />);

    const contents = container.querySelectorAll('.change-card-content');
    expect(contents.length).toBe(6);
  });

  it('should have diff-block divs', () => {
    const { container } = render(<MigrationSteps />);

    const diffs = container.querySelectorAll('.diff-block');
    expect(diffs.length).toBe(6);
  });

  it('should have diff-removed and diff-added divs', () => {
    const { container } = render(<MigrationSteps />);

    const removed = container.querySelectorAll('.diff-removed');
    const added = container.querySelectorAll('.diff-added');
    expect(removed.length).toBe(6);
    expect(added.length).toBe(6);
  });

  it('should have diff-marker spans', () => {
    const { container } = render(<MigrationSteps />);

    const markers = container.querySelectorAll('.diff-marker');
    expect(markers.length).toBeGreaterThan(0);
  });

  it('should have reference-table-wrapper div', () => {
    const { container } = render(<MigrationSteps />);

    const wrapper = container.querySelector('.reference-table-wrapper');
    expect(wrapper).toBeInTheDocument();
  });

  it('should have migration-table on reference section', () => {
    const { container } = render(<MigrationSteps />);

    const tables = container.querySelectorAll('.migration-table');
    expect(tables.length).toBe(1);
  });

  it('should have reference-table class on table', () => {
    const { container } = render(<MigrationSteps />);

    const table = container.querySelector('.reference-table');
    expect(table).toBeInTheDocument();
  });
});

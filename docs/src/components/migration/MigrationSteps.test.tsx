import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MigrationSteps } from './MigrationSteps';

describe('MigrationSteps', () => {
  it('should render the component', () => {
    render(<MigrationSteps />);

    expect(screen.getByTestId('migration-section')).toBeInTheDocument();
  });

  it('should render What Gets Transformed section heading', () => {
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
    render(<MigrationSteps />);

    const cards = screen.getAllByTestId('change-card');
    expect(cards).toHaveLength(6);
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

  it('should render CSS Selector Reference section heading', () => {
    render(<MigrationSteps />);

    expect(screen.getByText('CSS Selector Reference')).toBeInTheDocument();
  });

  it('should render CSS reference description', () => {
    render(<MigrationSteps />);

    expect(
      screen.getByText('Reference for manually updating your CSS selectors.')
    ).toBeInTheDocument();
  });

  it('should render the CSS mappings table headers', () => {
    render(<MigrationSteps />);

    expect(screen.getByText('EditorJS')).toBeInTheDocument();
    expect(screen.getByText('Blok')).toBeInTheDocument();
  });

  it('should render .codex-editor mapping in table', () => {
    render(<MigrationSteps />);

    expect(screen.getByText('.codex-editor')).toBeInTheDocument();
  });

  it('should render .ce-block mapping in table', () => {
    render(<MigrationSteps />);

    const table = screen.getByTestId('migration-table');
    const withinTable = within(table);
    expect(withinTable.getByText('.ce-block')).toBeInTheDocument();
  });

  it('should render [data-blok-element] mapping in table', () => {
    render(<MigrationSteps />);

    const table = screen.getByTestId('migration-table');
    const withinTable = within(table);
    expect(withinTable.getByText('[data-blok-element]')).toBeInTheDocument();
  });

  it('should render both migration sections', () => {
    render(<MigrationSteps />);

    expect(screen.getByTestId('migration-section')).toBeInTheDocument();
    expect(screen.getByTestId('css-reference-section')).toBeInTheDocument();
  });

  it('should render changes grid container', () => {
    render(<MigrationSteps />);

    expect(screen.getByTestId('changes-grid')).toBeInTheDocument();
  });

  it('should render migration table', () => {
    render(<MigrationSteps />);

    expect(screen.getByTestId('migration-table')).toBeInTheDocument();
  });

  it('should render removed and added code diffs in each change card', () => {
    render(<MigrationSteps />);

    const cards = screen.getAllByTestId('change-card');
    const diffMarkers = screen.getAllByText('-');
    const addMarkers = screen.getAllByText('+');

    expect(cards).toHaveLength(6);
    expect(diffMarkers.length).toBeGreaterThanOrEqual(6);
    expect(addMarkers.length).toBeGreaterThanOrEqual(6);
  });

  it('should render code elements for each change', () => {
    render(<MigrationSteps />);

    const codeElements = screen.getAllByRole('code');

    expect(codeElements.length).toBeGreaterThan(0);
  });

  it('should render each change card with title and diff', () => {
    render(<MigrationSteps />);

    const cards = screen.getAllByTestId('change-card');

    cards.forEach((card) => {
      const withinCard = within(card);
      const heading = withinCard.queryByRole('heading', { level: 3 });
      const codeElements = withinCard.getAllByRole('code');

      expect(heading).toBeInTheDocument();
      expect(codeElements.length).toBe(2);
    });
  });

  it('should render table with proper structure', () => {
    render(<MigrationSteps />);

    const table = screen.getByTestId('migration-table');
    const withinTable = within(table);

    expect(withinTable.getByRole('columnheader', { name: 'EditorJS' })).toBeInTheDocument();
    expect(withinTable.getByRole('columnheader', { name: 'Blok' })).toBeInTheDocument();
  });
});

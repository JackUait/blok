import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MigrationCard } from './MigrationCard';

describe('MigrationCard', () => {
  it('should render a section element', () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    const section = document.querySelector('.migration');
    expect(section).toBeInTheDocument();
  });

  it('should render the migration card', () => {
    const { container } = render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    const card = container.querySelector('.migration-card');
    expect(card).toBeInTheDocument();
  });

  it('should render the migration icon', () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    const icon = document.querySelector('.migration-icon');
    expect(icon).toBeInTheDocument();
  });

  it('should render the title', () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    expect(screen.getByText('Migrating from EditorJS?')).toBeInTheDocument();
  });

  it('should render the description', () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    expect(
      screen.getByText('Blok is designed as a drop-in replacement. Use our automated codemod to switch in minutes, not hours.')
    ).toBeInTheDocument();
  });

  it('should render the migration code', () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    expect(screen.getByText('npx -p @jackuait/blok migrate-from-editorjs ./src')).toBeInTheDocument();
  });

  it('should render the View Migration Guide button', () => {
    render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    const button = screen.getByText('View Migration Guide');
    expect(button).toBeInTheDocument();
    expect(button.closest('a')).toHaveAttribute('href', '/migration');
  });

  it('should have migration-content div', () => {
    const { container } = render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    const content = container.querySelector('.migration-content');
    expect(content).toBeInTheDocument();
  });

  it('should have migration-code element', () => {
    const { container } = render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    const codeElement = container.querySelector('.migration-code');
    expect(codeElement).toBeInTheDocument();
  });

  it('should have code element inside migration-code', () => {
    const { container } = render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    const code = container.querySelector('.migration-code code');
    expect(code).toBeInTheDocument();
  });

  it('should have migration-title', () => {
    const { container } = render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    const title = container.querySelector('.migration-title');
    expect(title).toBeInTheDocument();
  });

  it('should have migration-description', () => {
    const { container } = render(
      <MemoryRouter>
        <MigrationCard />
      </MemoryRouter>
    );

    const description = container.querySelector('.migration-description');
    expect(description).toBeInTheDocument();
  });
});

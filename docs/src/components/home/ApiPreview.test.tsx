import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiPreview } from './ApiPreview';

describe('ApiPreview', () => {
  it('should render a section element with id="api"', () => {
    render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    const section = screen.getByTestId('api-preview-section');
    expect(section).toBeInTheDocument();
    expect(section).toHaveAttribute('id', 'api');
  });

  it('should render the section header', () => {
    render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    // The title is split by <br /> tags, so we need to find it by partial text
    expect(screen.getByText((content) => content.includes('Powerful APIs'))).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('for every use case'))).toBeInTheDocument();
  });

  it('should render the section description', () => {
    render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    expect(
      screen.getByText('Access every aspect of the editor through our comprehensive API surface.')
    ).toBeInTheDocument();
  });

  it('should render 3 API cards', () => {
    render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    expect(screen.getByTestId('api-card-core-methods')).toBeInTheDocument();
    expect(screen.getByTestId('api-card-blocks-api')).toBeInTheDocument();
    expect(screen.getByTestId('api-card-events')).toBeInTheDocument();
  });

  it('should render Core Methods card', () => {
    render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    expect(screen.getByText('Core Methods')).toBeInTheDocument();
    expect(screen.getByText('save()')).toBeInTheDocument();
    expect(screen.getByText('render(data)')).toBeInTheDocument();
    expect(screen.getByText('focus()')).toBeInTheDocument();
    expect(screen.getByText('clear()')).toBeInTheDocument();
  });

  it('should render Blocks API card', () => {
    render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    expect(screen.getByText('Blocks API')).toBeInTheDocument();
    expect(screen.getByText('blocks.delete()')).toBeInTheDocument();
    expect(screen.getByText('blocks.insert()')).toBeInTheDocument();
    expect(screen.getByText('blocks.move()')).toBeInTheDocument();
    expect(screen.getByText('blocks.update()')).toBeInTheDocument();
  });

  it('should render Events card', () => {
    render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('on(event, fn)')).toBeInTheDocument();
    expect(screen.getByText('off(event, fn)')).toBeInTheDocument();
    expect(screen.getByText('emit(event, data)')).toBeInTheDocument();
  });



  it('should render method descriptions', () => {
    render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    expect(screen.getByText('Extract content as JSON')).toBeInTheDocument();
    expect(screen.getByText('Render from JSON data')).toBeInTheDocument();
    expect(screen.getByText('Set cursor focus')).toBeInTheDocument();
    expect(screen.getByText('Clear all blocks')).toBeInTheDocument();
  });

  it('should render View Full API Reference link', () => {
    render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: 'View Full API Reference' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/docs');
  });

  it('should have api-grid div', () => {
    render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    const grid = screen.getByTestId('api-grid');
    expect(grid).toBeInTheDocument();
  });

  it('should have api-cta div', () => {
    render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    const cta = screen.getByTestId('api-cta');
    expect(cta).toBeInTheDocument();
  });

  it('should have api-card-header elements', () => {
    render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    const headers = screen.getAllByTestId('api-card-header');
    expect(headers).toHaveLength(3);
  });

  it('should have api-card-content elements', () => {
    render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    const contents = screen.getAllByTestId('api-card-content');
    expect(contents).toHaveLength(3);
  });

  it('should have api-method elements', () => {
    render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    const methods = screen.getAllByTestId('api-method');
    expect(methods.length).toBeGreaterThan(0);
  });
});

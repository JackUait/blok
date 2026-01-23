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

    const section = document.getElementById('api');
    expect(section).toBeInTheDocument();
  });

  it('should render the section header', () => {
    render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    expect(screen.getByText('API Reference')).toBeInTheDocument();
    // The title is split by <br /> tags, so we need to find it by partial text
    expect(screen.getByText((content) => content.includes('Powerful APIs'))).toBeInTheDocument();
    expect(screen.getByText('for every use case')).toBeInTheDocument();
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
    const { container } = render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    const cards = container.querySelectorAll('.api-card');
    expect(cards.length).toBe(3);
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

  it('should render return types', () => {
    render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    // These return types appear in the component but may be split across elements
    expect(screen.getByText((content) => content.includes('Promise'))).toBeInTheDocument();
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

    const link = screen.getByText('View Full API Reference');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/docs');
  });

  it('should have api-grid div', () => {
    const { container } = render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    const grid = container.querySelector('.api-grid');
    expect(grid).toBeInTheDocument();
  });

  it('should have api-cta div', () => {
    const { container } = render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    const cta = container.querySelector('.api-cta');
    expect(cta).toBeInTheDocument();
  });

  it('should have api-card-header elements', () => {
    const { container } = render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    const headers = container.querySelectorAll('.api-card-header');
    expect(headers.length).toBe(3);
  });

  it('should have api-card-content elements', () => {
    const { container } = render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    const contents = container.querySelectorAll('.api-card-content');
    expect(contents.length).toBe(3);
  });

  it('should have api-method elements', () => {
    const { container } = render(
      <MemoryRouter>
        <ApiPreview />
      </MemoryRouter>
    );

    const methods = container.querySelectorAll('.api-method');
    expect(methods.length).toBeGreaterThan(0);
  });
});

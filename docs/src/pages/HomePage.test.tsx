import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from './HomePage';

describe('HomePage', () => {
  it('should render the Nav component', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    const nav = document.querySelector('[data-nav]');
    expect(nav).toBeInTheDocument();
  });

  it('should render the Footer component', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    const footer = document.querySelector('.footer');
    expect(footer).toBeInTheDocument();
  });

  it('should render the Hero section', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    const heroContent = document.querySelector('[data-hero-content]');
    expect(heroContent).toBeInTheDocument();
  });

  it('should render the Features section', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    const features = document.getElementById('features');
    expect(features).toBeInTheDocument();
  });

  it('should render the QuickStart section', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    const quickStart = document.getElementById('quick-start');
    expect(quickStart).toBeInTheDocument();
  });

  it('should render the ApiPreview section', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    const api = document.getElementById('api');
    expect(api).toBeInTheDocument();
  });

  it('should render the MigrationCard section', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    const migration = document.querySelector('.migration');
    expect(migration).toBeInTheDocument();
  });

  it('should render a main element', () => {
    const { container } = render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    const main = container.querySelector('main');
    expect(main).toBeInTheDocument();
  });

  it('should have navigation links', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    const nav = document.querySelector('[data-nav]');
    expect(nav).toBeInTheDocument();
  });
});

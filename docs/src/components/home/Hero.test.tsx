import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Hero } from './Hero';

describe('Hero', () => {
  it('should render the eyebrow text', () => {
    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    expect(screen.getByText('Open-Source Editor')).toBeInTheDocument();
  });

  it('should render the main title', () => {
    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    expect(screen.getByText('Build beautiful')).toBeInTheDocument();
    expect(screen.getByText('block-based editors')).toBeInTheDocument();
  });

  it('should render the description', () => {
    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    expect(screen.getByText(/Blok is a highly extensible/)).toBeInTheDocument();
    expect(screen.getByText(/Notion-like editing experience/)).toBeInTheDocument();
  });

  it('should render the Get Started button with correct link', () => {
    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    const getStartedLink = screen.getByRole('link', { name: 'Get Started' });
    expect(getStartedLink).toBeInTheDocument();
    expect(getStartedLink).toHaveAttribute('href', '/#quick-start');
  });

  it('should render the Try it out button with correct link', () => {
    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    const tryItOutLink = screen.getByRole('link', { name: /Try it out/ });
    expect(tryItOutLink).toBeInTheDocument();
    expect(tryItOutLink).toHaveAttribute('href', '/demo');
  });

  it('should have data-hero-content attribute', () => {
    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    expect(screen.getByTestId('hero-content')).toBeInTheDocument();
  });

  it('should have data-hero-demo attribute', () => {
    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    expect(screen.getByTestId('hero-demo')).toBeInTheDocument();
  });

  it('should render the mascot image', () => {
    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    const mascot = screen.getByAltText(/Blok mascot/);
    expect(mascot).toBeInTheDocument();
    expect(mascot).toHaveAttribute('src', '/mascot.png');
  });
});

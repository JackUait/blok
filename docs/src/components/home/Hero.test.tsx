import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Hero } from './Hero';

describe('Hero', () => {
  it('should render a section element', () => {
    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    const section = document.querySelector('.hero');
    expect(section).toBeInTheDocument();
  });

  it('should render the eyebrow text', () => {
    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    expect(screen.getByText('Documentation')).toBeInTheDocument();
  });

  it('should render the main title', () => {
    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    expect(screen.getByText('Beautiful block-based')).toBeInTheDocument();
    expect(screen.getByText('rich text editing')).toBeInTheDocument();
  });

  it('should render the description', () => {
    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    expect(screen.getByText(/Blok is a headless/)).toBeInTheDocument();
    expect(screen.getByText(/Notion-like editing experience/)).toBeInTheDocument();
  });

  it('should render the Get Started button', () => {
    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    const getStartedButton = screen.getByText('Get Started');
    expect(getStartedButton).toBeInTheDocument();
    expect(getStartedButton.closest('a')).toHaveAttribute('href', '/#quick-start');
  });

  it('should render the GitHub link', () => {
    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    const githubLink = screen.getByText('View on GitHub');
    expect(githubLink).toBeInTheDocument();
    expect(githubLink.closest('a')).toHaveAttribute('href', 'https://github.com/JackUait/blok');
    expect(githubLink.closest('a')).toHaveAttribute('target', '_blank');
  });

  it('should render the editor mockup', () => {
    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    expect(screen.getByText('Welcome to Blok')).toBeInTheDocument();
    expect(screen.getByText(/A powerful block-based editor/)).toBeInTheDocument();
    expect(screen.getByText('Headless architecture')).toBeInTheDocument();
    expect(screen.getByText('Slash commands')).toBeInTheDocument();
    expect(screen.getByText('Drag & drop')).toBeInTheDocument();
  });

  it('should render the Try it live button', () => {
    render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    expect(screen.getByText('Try it live')).toBeInTheDocument();
  });

  it('should have data-hero-content attribute', () => {
    const { container } = render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    const heroContent = container.querySelector('[data-hero-content]');
    expect(heroContent).toBeInTheDocument();
  });

  it('should have data-hero-demo attribute', () => {
    const { container } = render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    const heroDemo = container.querySelector('[data-hero-demo]');
    expect(heroDemo).toBeInTheDocument();
  });

  it('should have hero-bg div with blur elements', () => {
    const { container } = render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    const heroBg = container.querySelector('.hero-bg');
    expect(heroBg).toBeInTheDocument();

    const blurs = container.querySelectorAll('.hero-blur');
    expect(blurs.length).toBe(3);
  });

  it('should have editor-dots in the editor header', () => {
    const { container } = render(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>
    );

    const dots = container.querySelectorAll('.editor-dots span');
    expect(dots.length).toBe(3);
  });
});

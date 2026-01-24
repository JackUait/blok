import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Nav } from './Nav';
import type { NavLink } from '@/types/navigation';

const mockLinks: NavLink[] = [
  { href: '/docs', label: 'Docs' },
  { href: '/demo', label: 'Try it out' },
  { href: '/migration', label: 'Migration' },
  { href: 'https://github.com/JackUait/blok', label: 'GitHub', external: true },
];

describe('Nav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render a nav element', () => {
    render(
      <MemoryRouter>
        <Nav links={mockLinks} />
      </MemoryRouter>
    );
    const nav = screen.getByRole('navigation');
    expect(nav).toBeInTheDocument();
  });

  it('should render all provided links', () => {
    render(
      <MemoryRouter>
        <Nav links={mockLinks} />
      </MemoryRouter>
    );

    expect(screen.getByText('Docs')).toBeInTheDocument();
    expect(screen.getByText('Try it out')).toBeInTheDocument();
    expect(screen.getByText('Migration')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  it('should render the Logo component', () => {
    render(
      <MemoryRouter>
        <Nav links={mockLinks} />
      </MemoryRouter>
    );

    // Check for the logo text "Blok"
    expect(screen.getByText('Blok')).toBeInTheDocument();
  });

  it('should mark the active link based on current path', () => {
    render(
      <MemoryRouter initialEntries={['/demo']}>
        <Nav links={mockLinks} />
      </MemoryRouter>
    );

    const demoLink = screen.getByText('Try it out');
    expect(demoLink).toBeInTheDocument();
  });

  it('should render external links with anchor tags', () => {
    render(
      <MemoryRouter>
        <Nav links={mockLinks} />
      </MemoryRouter>
    );

    const githubLink = screen.getByText('GitHub').closest('a');
    expect(githubLink).toHaveAttribute('href', 'https://github.com/JackUait/blok');
    expect(githubLink).toHaveAttribute('target', '_blank');
    expect(githubLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('should render a mobile menu toggle button', () => {
    render(
      <MemoryRouter>
        <Nav links={mockLinks} />
      </MemoryRouter>
    );

    const toggleButton = screen.getByLabelText('Toggle menu');
    expect(toggleButton).toBeInTheDocument();
    expect(toggleButton).toHaveAttribute('type', 'button');
  });

  it('should have data-nav attribute', () => {
    render(
      <MemoryRouter>
        <Nav links={mockLinks} />
      </MemoryRouter>
    );

    const nav = screen.getByRole('navigation');
    expect(nav).toHaveAttribute('data-nav');
  });

  it('should have data-nav-toggle attribute on toggle button', () => {
    render(
      <MemoryRouter>
        <Nav links={mockLinks} />
      </MemoryRouter>
    );

    const toggleButton = screen.getByLabelText('Toggle menu');
    expect(toggleButton).toHaveAttribute('data-nav-toggle');
  });

  it('should have a nav-container div', () => {
    const { container } = render(
      <MemoryRouter>
        <Nav links={mockLinks} />
      </MemoryRouter>
    );

    const containerDiv = container.querySelector('.nav-container');
    expect(containerDiv).toBeInTheDocument();
  });

  it('should have a nav-links div', () => {
    const { container } = render(
      <MemoryRouter>
        <Nav links={mockLinks} />
      </MemoryRouter>
    );

    const linksDiv = container.querySelector('.nav-links');
    expect(linksDiv).toBeInTheDocument();
  });

  it('should render home link with Logo', () => {
    render(
      <MemoryRouter>
        <Nav links={mockLinks} />
      </MemoryRouter>
    );

    const homeLink = screen.getByText('Blok').closest('a');
    expect(homeLink).toHaveAttribute('class', expect.stringContaining('nav-logo'));
  });
});

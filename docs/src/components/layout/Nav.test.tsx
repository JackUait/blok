import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Nav } from './Nav';
import { I18nProvider } from '../../contexts/I18nContext';
import type { NavLink } from '@/types/navigation';

const mockLinks: NavLink[] = [
  { href: '/docs', label: 'Docs' },
  { href: '/demo', label: 'Demo' },
  { href: '/migration', label: 'Migration' },
  { href: 'https://github.com/JackUait/blok', label: 'GitHub', external: true },
];

const TestWrapper: React.FC<{ children: React.ReactNode; initialPath?: string }> = ({
  children,
  initialPath = '/',
}) => (
  <MemoryRouter initialEntries={[initialPath]}>
    <I18nProvider>{children}</I18nProvider>
  </MemoryRouter>
);

describe('Nav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render a nav element', () => {
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );
    const nav = screen.getByRole('navigation');
    expect(nav).toBeInTheDocument();
  });

  it('should render all provided links', () => {
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );

    expect(screen.getByText('Docs')).toBeInTheDocument();
    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.getByText('Migration')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  it('should render the Logo component', () => {
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );

    // Logo renders as an img element with alt="Blok"
    const logo = screen.getByRole('img', { name: 'Blok' });
    expect(logo).toBeInTheDocument();
  });

  it('should mark the active link based on current path', () => {
    render(
      <TestWrapper initialPath="/demo">
        <Nav links={mockLinks} />
      </TestWrapper>
    );

    const demoLink = screen.getByText('Demo');
    expect(demoLink).toBeInTheDocument();
  });

  it('should render external links with anchor tags', () => {
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );

    const githubLink = screen.getByRole('link', { name: 'GitHub' });
    expect(githubLink).toHaveAttribute('href', 'https://github.com/JackUait/blok');
    expect(githubLink).toHaveAttribute('target', '_blank');
    expect(githubLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('should render a mobile menu toggle button', () => {
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );

    const toggleButton = screen.getByLabelText('Toggle menu');
    expect(toggleButton).toBeInTheDocument();
    expect(toggleButton).toHaveAttribute('type', 'button');
  });

  it('should have data-nav attribute', () => {
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );

    const nav = screen.getByRole('navigation');
    expect(nav).toHaveAttribute('data-nav');
  });

  it('should have data-nav-toggle attribute on toggle button', () => {
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );

    const toggleButton = screen.getByLabelText('Toggle menu');
    expect(toggleButton).toHaveAttribute('data-nav-toggle');
  });

  it('should render home link with Logo', () => {
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );

    // The home link has Logo image and "Blok" text
    const homeLink = screen.getByRole('link', { name: /Blok/i });
    expect(homeLink).toHaveAttribute('href', '/');
  });
});

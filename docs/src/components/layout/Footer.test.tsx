import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Footer } from './Footer';

describe('Footer', () => {
  it('should render a footer element', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    );
    const footer = screen.getByRole('contentinfo');
    expect(footer).toBeInTheDocument();
  });

  it('should render the Blok logo', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    );
    expect(screen.getByText('Blok')).toBeInTheDocument();
  });

  it('should render the tagline', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    );
    expect(
      screen.getByText('Block-based rich text editor for modern applications.')
    ).toBeInTheDocument();
  });

  it('should render Documentation section', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    );

    expect(screen.getByText('Documentation')).toBeInTheDocument();
    expect(screen.getByText('Quick Start')).toBeInTheDocument();
    expect(screen.getByText('API Reference')).toBeInTheDocument();
    expect(screen.getByText('Migration Guide')).toBeInTheDocument();
  });

  it('should render Resources section', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    );

    expect(screen.getByText('Resources')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('npm')).toBeInTheDocument();
    expect(screen.getByText('Examples')).toBeInTheDocument();
  });

  it('should render Community section', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    );

    expect(screen.getByText('Community')).toBeInTheDocument();
    expect(screen.getByText('Issues')).toBeInTheDocument();
    expect(screen.getByText('Discussions')).toBeInTheDocument();
    expect(screen.getByText('Contributing')).toBeInTheDocument();
  });

  it('should have external links with correct attributes', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    );

    const githubLink = screen.getByText('GitHub').closest('a');
    expect(githubLink).toHaveAttribute('target', '_blank');
    expect(githubLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('should render the copyright notice', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    );

    expect(screen.getByText(/2025 JackUait/)).toBeInTheDocument();
  });

  it('should render the Apache 2.0 license link', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    );

    const licenseLink = screen.getByText('Apache 2.0');
    expect(licenseLink).toBeInTheDocument();
    expect(licenseLink.closest('a')).toHaveAttribute('href', 'https://www.apache.org/licenses/LICENSE-2.0');
  });

  it('should have a footer-brand div', () => {
    const { container } = render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    );

    const brandDiv = container.querySelector('.footer-brand');
    expect(brandDiv).toBeInTheDocument();
  });

  it('should have footer-links div', () => {
    const { container } = render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    );

    const linksDiv = container.querySelector('.footer-links');
    expect(linksDiv).toBeInTheDocument();
  });

  it('should have footer-bottom div', () => {
    const { container } = render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    );

    const bottomDiv = container.querySelector('.footer-bottom');
    expect(bottomDiv).toBeInTheDocument();
  });
});

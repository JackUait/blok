import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../contexts/I18nContext';
import { Footer } from './Footer';

const renderFooter = () =>
  render(
    <I18nProvider>
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    </I18nProvider>
  );

describe('Footer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should render a footer element', () => {
    renderFooter();
    const footer = screen.getByRole('contentinfo');
    expect(footer).toBeInTheDocument();
  });

  it('should render the Blok mascot', () => {
    renderFooter();
    expect(screen.getByAltText('Blok mascot')).toBeInTheDocument();
  });

  it('should render the tagline', () => {
    renderFooter();
    expect(
      screen.getByText(/friendly block-based rich text editor for modern applications/i)
    ).toBeInTheDocument();
  });

  it('should render Documentation section', () => {
    renderFooter();

    expect(screen.getByText('Documentation')).toBeInTheDocument();
    expect(screen.getByText('Quick Start')).toBeInTheDocument();
    expect(screen.getByText('API Reference')).toBeInTheDocument();
    expect(screen.getByText('Migration Guide')).toBeInTheDocument();
  });

  it('should render Resources section', () => {
    renderFooter();

    expect(screen.getByText('Resources')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('npm')).toBeInTheDocument();
    expect(screen.getByText('Live Demo')).toBeInTheDocument();
  });

  it('should render Community section', () => {
    renderFooter();

    expect(screen.getByText('Community')).toBeInTheDocument();
    expect(screen.getByText('Issues')).toBeInTheDocument();
    expect(screen.getByText('Discussions')).toBeInTheDocument();
    expect(screen.getByText('Contributing')).toBeInTheDocument();
  });

  it('should have external links with correct attributes', () => {
    renderFooter();

    const githubLink = screen.getByTestId('github-link');
    expect(githubLink).toHaveAttribute('target', '_blank');
    expect(githubLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('should render the copyright notice', () => {
    renderFooter();

    expect(screen.getByText(/2026 JackUait/)).toBeInTheDocument();
  });

  it('should render the Apache 2.0 license link', () => {
    renderFooter();

    const licenseLink = screen.getByTestId('license-link');
    expect(licenseLink).toBeInTheDocument();
    expect(licenseLink).toHaveAttribute('href', 'https://www.apache.org/licenses/LICENSE-2.0');
  });

  it('should have a footer-brand div', () => {
    renderFooter();

    expect(screen.getByTestId('footer-brand')).toBeInTheDocument();
  });

  it('should have footer-links div', () => {
    renderFooter();

    expect(screen.getByTestId('footer-links')).toBeInTheDocument();
  });

  it('should have footer-bottom div', () => {
    renderFooter();

    expect(screen.getByTestId('footer-bottom')).toBeInTheDocument();
  });

  it('should render translated strings when locale is Russian', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    renderFooter();
    expect(screen.getByText('Документация')).toBeInTheDocument();
    expect(screen.getByText('Быстрый старт')).toBeInTheDocument();
    expect(screen.getByText('Справочник API')).toBeInTheDocument();
    expect(screen.getByText('Руководство по миграции')).toBeInTheDocument();
  });
});

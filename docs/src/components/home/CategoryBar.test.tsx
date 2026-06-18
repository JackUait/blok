import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../contexts/I18nContext';
import { CategoryBar } from './CategoryBar';

const renderBar = (initialPath = '/') =>
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <CategoryBar />
      </MemoryRouter>
    </I18nProvider>
  );

describe('CategoryBar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders a navigation landmark labelled for browsing the docs', () => {
    renderBar();
    expect(
      screen.getByRole('navigation', { name: /browse the documentation/i })
    ).toBeInTheDocument();
  });

  it('renders every category as a link', () => {
    renderBar();

    const expected: Array<[RegExp, string]> = [
      [/get started/i, '/'],
      [/^docs$/i, '/docs'],
      [/^tools$/i, '/tools'],
      [/^playground$/i, '/demo'],
      [/^migration$/i, '/migration'],
      [/^changelog$/i, '/changelog'],
    ];

    expected.forEach(([name, href]) => {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('href', href);
    });
  });

  it('does not render recipes or integrations categories', () => {
    renderBar();
    expect(screen.queryByRole('link', { name: /^recipes$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^integrations$/i })).not.toBeInTheDocument();
  });

  it('marks the category matching the current route as current', () => {
    renderBar('/tools');
    const active = screen.getByRole('link', { name: /^tools$/i });
    expect(active).toHaveAttribute('aria-current', 'page');

    const inactive = screen.getByRole('link', { name: /^migration$/i });
    expect(inactive).not.toHaveAttribute('aria-current');
  });

  it('marks "Get started" as current on the home route', () => {
    renderBar('/');
    const active = screen.getByRole('link', { name: /get started/i });
    expect(active).toHaveAttribute('aria-current', 'page');
  });

  it('renders translated labels in Russian', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    renderBar();
    expect(screen.getByRole('link', { name: /начало работы/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^документация$/i })).toBeInTheDocument();
  });
});

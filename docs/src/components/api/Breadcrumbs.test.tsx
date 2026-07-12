import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Breadcrumbs } from './Breadcrumbs';
import { I18nProvider } from '../../contexts/I18nContext';

const Providers = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <I18nProvider>{children}</I18nProvider>
  </MemoryRouter>
);

describe('Breadcrumbs', () => {
  it('renders the trail through the real sidebar hierarchy for a nested section', () => {
    render(
      <Providers>
        <Breadcrumbs currentId="caret-api" pageTitle="Caret API" />
      </Providers>,
    );

    const nav = screen.getByTestId('api-breadcrumbs');
    expect(nav).toHaveTextContent('Docs');
    expect(nav).toHaveTextContent('Editing');
    expect(nav).toHaveTextContent('Caret API');
  });

  it('renders the current page as plain (non-link) text', () => {
    render(
      <Providers>
        <Breadcrumbs currentId="caret-api" pageTitle="Caret API" />
      </Providers>,
    );

    const current = screen.getByText('Caret API');
    expect(current.closest('a')).toBeNull();
    expect(current).toHaveAttribute('aria-current', 'page');
  });

  it('links the group crumb to the first page in that group', () => {
    // "history-api" is the last module in the "editing" group, whose first
    // module is "caret-api" — a different page, so the link is meaningfully
    // distinct from the current page.
    render(
      <Providers>
        <Breadcrumbs currentId="history-api" pageTitle="History API" />
      </Providers>,
    );

    const groupLink = screen.getByRole('link', { name: 'Editing' });
    expect(groupLink).toHaveAttribute('href', '/docs/caret-api');
  });

  it('links the "Docs" crumb to the docs entry point', () => {
    render(
      <Providers>
        <Breadcrumbs currentId="caret-api" pageTitle="Caret API" />
      </Providers>,
    );

    const docsLink = screen.getByRole('link', { name: 'Docs' });
    expect(docsLink).toHaveAttribute('href', '/docs/quick-start');
  });
});

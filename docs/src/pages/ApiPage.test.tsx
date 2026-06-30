import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '../contexts/I18nContext';
import { ApiPage } from './ApiPage';

vi.mock('../components/common/CodeBlock', () => ({
  CodeBlock: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <I18nProvider>
        <Routes>
          <Route path="/docs/*" element={<ApiPage />} />
        </Routes>
      </I18nProvider>
    </MemoryRouter>,
  );

describe('ApiPage routing', () => {
  it('renders a single module at /docs/caret-api', () => {
    renderAt('/docs/caret-api');
    expect(screen.getByText('Caret API')).toBeInTheDocument();
    expect(screen.queryByText('Selection API')).toBeNull();
  });

  it('/docs redirects to quick-start content', () => {
    renderAt('/docs');
    // Quick Start section element is rendered by the module body
    expect(screen.getByTestId('quick-start')).toBeInTheDocument();
  });

  it('sidebar marks the active module', () => {
    renderAt('/docs/caret-api');
    expect(screen.getByTestId('api-sidebar-link-caret-api')).toHaveClass('active');
  });
});

describe('ApiPage structure', () => {
  it('renders the Nav component', () => {
    renderAt('/docs/caret-api');
    expect(screen.getByTestId('nav')).toBeInTheDocument();
  });

  it('renders the API sidebar', () => {
    renderAt('/docs/caret-api');
    expect(screen.getByTestId('api-sidebar')).toBeInTheDocument();
  });

  it('renders the main api content area', () => {
    renderAt('/docs/caret-api');
    expect(screen.getByTestId('api-main')).toBeInTheDocument();
  });

  it('has the api-docs container', () => {
    renderAt('/docs/caret-api');
    expect(screen.getByTestId('api-docs')).toBeInTheDocument();
  });
});

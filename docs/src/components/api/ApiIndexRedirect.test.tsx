// docs/src/components/api/ApiIndexRedirect.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams, useLocation } from 'react-router-dom';
import { I18nProvider } from '../../contexts/I18nContext';
import { ApiIndexRedirect } from './ApiIndexRedirect';

// Sink component renders the matched moduleId param and the current hash so we
// can assert which module the redirect landed on and that anchors are preserved
// (window.location is unreliable in jsdom).
const Sink = () => {
  const { moduleId } = useParams<{ moduleId: string }>();
  const { hash } = useLocation();
  return (
    <>
      <div data-blok-testid="landed">{moduleId}</div>
      <div data-blok-testid="hash">{hash}</div>
    </>
  );
};

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <I18nProvider>
        <Routes>
          <Route path="/docs" element={<ApiIndexRedirect />} />
          <Route path="/docs/:moduleId" element={<Sink />} />
        </Routes>
      </I18nProvider>
    </MemoryRouter>,
  );

describe('ApiIndexRedirect', () => {
  it('renders the docs hub instead of redirecting when there is no legacy hash', () => {
    // A bare <Navigate> left /docs as an empty shell in the prerendered HTML,
    // so the reference had no crawlable parent page.
    renderAt('/docs');
    expect(screen.getByTestId('docs-hub')).toBeInTheDocument();
    expect(screen.queryByTestId('landed')).not.toBeInTheDocument();
  });

  it('routes a legacy section hash', () => {
    renderAt('/docs#caret-api');
    expect(screen.getByTestId('landed').textContent).toContain('caret-api');
  });

  it('routes a legacy anchor hash to the module page preserving the anchor', () => {
    renderAt('/docs#config-holder');
    expect(screen.getByTestId('landed').textContent).toContain('config');
    expect(screen.getByTestId('hash').textContent).toContain('config-holder');
  });
});

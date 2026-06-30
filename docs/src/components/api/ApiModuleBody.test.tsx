// docs/src/components/api/ApiModuleBody.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '../../contexts/I18nContext';
import { ApiModuleBody } from './ApiModuleBody';

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <I18nProvider>
        <Routes>
          <Route path="/docs/:moduleId" element={<ApiModuleBody />} />
          <Route path="/docs/quick-start" element={<div data-blok-testid="qs">qs</div>} />
        </Routes>
      </I18nProvider>
    </MemoryRouter>,
  );

describe('ApiModuleBody', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the matching section only', () => {
    renderAt('/docs/caret-api');
    expect(screen.getByText('Caret API')).toBeInTheDocument();
    expect(screen.queryByText('Selection API')).toBeNull();
    expect(screen.getByTestId('api-pagination')).toBeInTheDocument();
  });

  it('redirects unknown module to quick-start', () => {
    renderAt('/docs/not-a-module');
    expect(screen.getByTestId('qs')).toBeInTheDocument();
  });

  it('scrolls to the hash anchor on cold load', async () => {
    // The vitest setup (test/vitest.setup.ts) pre-mocks HTMLElement.prototype.scrollIntoView
    // as a vi.fn() and requestAnimationFrame as setTimeout(cb, 16). vi.clearAllMocks() in
    // beforeEach resets call history so we get a clean slate here.
    renderAt('/docs/caret-api#caret-api-caret-focus');

    // Assert the target element is rendered before waiting for the scroll.
    expect(document.getElementById('caret-api-caret-focus')).not.toBeNull();

    // The rAF fires asynchronously (via setTimeout 16 ms in jsdom); waitFor drains it.
    await waitFor(() => {
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'auto',
        block: 'start',
      });
    });
  });
});

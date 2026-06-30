// docs/src/components/api/ApiModuleBody.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '../../contexts/I18nContext';
import { FrameworkProvider } from '../../contexts/FrameworkContext';
import { ApiModuleBody } from './ApiModuleBody';

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <I18nProvider>
        <FrameworkProvider>
          <Routes>
            <Route path="/docs/:moduleId" element={<ApiModuleBody />} />
            <Route path="/docs/quick-start" element={<div data-blok-testid="qs">qs</div>} />
          </Routes>
        </FrameworkProvider>
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
    // "Caret API" also appears in the breadcrumb trail now, so scope to the
    // page's h1 rather than asserting on the bare text.
    expect(screen.getByRole('heading', { level: 1, name: 'Caret API' })).toBeInTheDocument();
    expect(screen.queryByText('Selection API')).toBeNull();
    expect(screen.getByTestId('api-pagination')).toBeInTheDocument();
  });

  it('redirects unknown module to quick-start', () => {
    renderAt('/docs/not-a-module');
    expect(screen.getByTestId('qs')).toBeInTheDocument();
  });

  it('keeps Prev/Next within the current sidebar group, not the full flattened list', () => {
    // "history-api" is the last module in the "editing" group
    // (caret-api, selection-api, styles-api, history-api). Globally the next
    // module would be "toolbar-api" (start of the "interface" group), but
    // pagination is scoped per-group, so Next must be absent here.
    renderAt('/docs/history-api');

    expect(screen.getByTestId('api-pagination-prev')).toHaveAttribute('href', '/docs/styles-api');
    expect(screen.queryByTestId('api-pagination-next')).toBeNull();
  });

  it('does not show Prev for the first module of a group, even though earlier groups exist', () => {
    // "core" is the first module of the "core" group. Globally the previous
    // module would be "custom-block-tool" (end of the "gettingStarted" group), but
    // pagination is scoped per-group, so Prev must be absent here.
    renderAt('/docs/core');

    expect(screen.queryByTestId('api-pagination-prev')).toBeNull();
    expect(screen.getByTestId('api-pagination-next')).toHaveAttribute('href', '/docs/config');
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

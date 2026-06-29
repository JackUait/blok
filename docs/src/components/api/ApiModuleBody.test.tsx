// docs/src/components/api/ApiModuleBody.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});

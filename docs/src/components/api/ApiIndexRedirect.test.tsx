// docs/src/components/api/ApiIndexRedirect.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';
import { ApiIndexRedirect } from './ApiIndexRedirect';

// Sink component renders the matched moduleId param so we can assert
// which module the redirect landed on (window.location is unreliable in jsdom).
const Sink = () => {
  const { moduleId } = useParams<{ moduleId: string }>();
  return <div data-blok-testid="landed">{moduleId}</div>;
};

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/docs" element={<ApiIndexRedirect />} />
        <Route path="/docs/:moduleId" element={<Sink />} />
      </Routes>
    </MemoryRouter>,
  );

describe('ApiIndexRedirect', () => {
  it('defaults to quick-start', () => {
    renderAt('/docs');
    expect(screen.getByTestId('landed').textContent).toContain('quick-start');
  });

  it('routes a legacy section hash', () => {
    renderAt('/docs#caret-api');
    expect(screen.getByTestId('landed').textContent).toContain('caret-api');
  });
});

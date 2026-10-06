import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { VersionBanner } from './VersionBanner';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <VersionBanner />
    </MemoryRouter>,
  );

describe('VersionBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('tells an archive reader which version they are on and links to latest', () => {
    vi.stubEnv('VITE_DOCS_VERSION', '1.12');
    vi.stubEnv('BASE_URL', '/v/1.12/');
    renderAt('/docs/table');
    expect(screen.getByText(/1\.12/)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/');
  });

  it('speaks Russian inside the /ru tree and links to the Russian latest', () => {
    vi.stubEnv('VITE_DOCS_VERSION', '1.12');
    vi.stubEnv('BASE_URL', '/v/1.12/');
    renderAt('/ru/docs/table');
    expect(screen.getByRole('link')).toHaveAttribute('href', '/ru/');
    expect(screen.getByRole('status').textContent).toMatch(/[а-я]/);
  });

  it('flags /next/ as unreleased', () => {
    vi.stubEnv('VITE_DOCS_VERSION', 'next');
    vi.stubEnv('BASE_URL', '/next/');
    renderAt('/');
    expect(screen.getByRole('status').textContent).toMatch(/unreleased/i);
  });

  it('renders nothing on the root build', () => {
    vi.stubEnv('VITE_DOCS_VERSION', '1.15');
    vi.stubEnv('BASE_URL', '/');
    const { container } = renderAt('/');
    expect(container).toBeEmptyDOMElement();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { VersionPicker } from './VersionPicker';

const manifest = {
  latest: '1.15',
  versions: [
    { id: 'next', label: 'Next', path: '/next/' },
    { id: '1.15', label: '1.15', path: '/' },
    { id: '1.14', label: '1.14', path: '/v/1.14/' },
  ],
};

const respond = (body: unknown, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

const renderAt = (path: string, basename?: string) =>
  render(
    <MemoryRouter basename={basename} initialEntries={[`${basename ?? ''}${path}`]}>
      <VersionPicker />
    </MemoryRouter>,
  );

describe('VersionPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_DOCS_VERSION', '1.14');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('still shows the current version when versions.json cannot be loaded', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('offline')));
    renderAt('/docs/table', '/v/1.14');
    const trigger = screen.getByRole('button', { name: /1\.14/ });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getAllByRole('menuitem')).toHaveLength(1));
  });

  it('links every version to the same page and keeps the locale', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) =>
      String(url).endsWith('pages.json')
        ? respond(['/', '/ru', '/ru/docs/table'])
        : respond(manifest),
    );
    renderAt('/ru/docs/table', '/v/1.14');
    fireEvent.click(screen.getByRole('button', { name: /1\.14/ }));
    const latest = await screen.findByRole('menuitem', { name: /1\.15/ });
    await waitFor(() => expect(latest).toHaveAttribute('href', '/ru/docs/table/'));
  });

  it('marks the current version with a check and primary ink, not a fill', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => respond(manifest));
    renderAt('/', '/v/1.14');
    fireEvent.click(screen.getByRole('button', { name: /1\.14/ }));
    const current = await screen.findByRole('menuitem', { name: /1\.14/ });
    const other = await screen.findByRole('menuitem', { name: /1\.15/ });
    expect(current).toHaveAttribute('aria-current', 'true');
    // Only the hover fill is allowed; a resting fill or blue ink is a selected-state violation.
    expect(current.className.split(/\s+/).filter((c) => c.startsWith('bg-'))).toEqual([]);
    expect(current.className).not.toMatch(/blue/);
    expect(current.className).toContain('text-foreground');
    expect(other.className).not.toContain('text-foreground');
  });
});

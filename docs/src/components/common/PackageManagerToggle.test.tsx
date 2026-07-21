import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { I18nProvider } from '../../contexts/I18nContext';
import { PackageManagerToggle } from './PackageManagerToggle';

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider>{children}</I18nProvider>
);

type GtagWindow = Window & typeof globalThis & { gtag?: (...args: unknown[]) => void };

const gtagWindow = window as GtagWindow;

describe('PackageManagerToggle', () => {
  let gtagSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    gtagSpy = vi.fn();
    gtagWindow.gtag = gtagSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete gtagWindow.gtag;
  });

  it('marks yarn as the default selection', () => {
    render(<PackageManagerToggle />, { wrapper });

    expect(screen.getByRole('button', { name: /yarn/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /npm/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('notifies the consumer when a manager is selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PackageManagerToggle onChange={onChange} />, { wrapper });

    await user.click(screen.getByRole('button', { name: /bun/i }));

    expect(onChange).toHaveBeenCalledWith('bun');
    expect(screen.getByRole('button', { name: /bun/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  describe('analytics', () => {
    it('tracks the selected package manager', async () => {
      const user = userEvent.setup();
      render(<PackageManagerToggle />, { wrapper });

      await user.click(screen.getByRole('button', { name: /npm/i }));

      expect(gtagSpy).toHaveBeenCalledWith('event', 'select_package_manager', {
        manager: 'npm',
      });
    });

    it('does not track when the already active manager is re-selected', async () => {
      const user = userEvent.setup();
      render(<PackageManagerToggle />, { wrapper });

      await user.click(screen.getByRole('button', { name: /yarn/i }));

      expect(gtagSpy).not.toHaveBeenCalled();
    });
  });
});

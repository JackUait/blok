import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../contexts/I18nContext';
import { FrameworkProvider, useFramework } from '../../contexts/FrameworkContext';
import { FrameworkToggle } from './FrameworkToggle';

const Providers = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <I18nProvider>
      <FrameworkProvider>{children}</FrameworkProvider>
    </I18nProvider>
  </MemoryRouter>
);

/** Surfaces the active framework so a click can be asserted through context. */
const ActiveProbe = () => {
  const { framework } = useFramework();
  return <span data-blok-testid="active-framework">{framework}</span>;
};

type GtagWindow = Window & typeof globalThis & { gtag?: (...args: unknown[]) => void };

const gtagWindow = window as GtagWindow;

describe('FrameworkToggle', () => {
  let gtagSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    gtagSpy = vi.fn();
    gtagWindow.gtag = gtagSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete gtagWindow.gtag;
  });

  it('renders a button for each supported framework', () => {
    render(
      <Providers>
        <FrameworkToggle />
      </Providers>,
    );

    expect(screen.getByRole('button', { name: /JavaScript/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /React/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Vue/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Angular/i })).toBeInTheDocument();
  });

  it('marks the active framework with aria-pressed', () => {
    render(
      <Providers>
        <FrameworkToggle />
      </Providers>,
    );

    expect(screen.getByRole('button', { name: /JavaScript/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /React/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('updates the shared framework when a button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <FrameworkToggle />
        <ActiveProbe />
      </Providers>,
    );

    await user.click(screen.getByRole('button', { name: /Vue/i }));

    expect(screen.getByTestId('active-framework')).toHaveTextContent('vue');
    expect(screen.getByRole('button', { name: /Vue/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  describe('analytics', () => {
    it('tracks a framework selection with the framework id', async () => {
      const user = userEvent.setup();
      render(
        <Providers>
          <FrameworkToggle />
        </Providers>,
      );

      await user.click(screen.getByRole('button', { name: /Angular/i }));

      expect(gtagSpy).toHaveBeenCalledWith('event', 'select_framework', {
        framework: 'angular',
      });
    });

    it('does not track when the already active framework is clicked', async () => {
      const user = userEvent.setup();
      render(
        <Providers>
          <FrameworkToggle />
        </Providers>,
      );

      await user.click(screen.getByRole('button', { name: /JavaScript/i }));

      expect(gtagSpy).not.toHaveBeenCalled();
    });
  });
});

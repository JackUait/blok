import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { I18nProvider } from '../../contexts/I18nContext';
import { FrameworkProvider, useFramework } from '../../contexts/FrameworkContext';
import { FrameworkToggle } from './FrameworkToggle';

const Providers = ({ children }: { children: ReactNode }) => (
  <I18nProvider>
    <FrameworkProvider>{children}</FrameworkProvider>
  </I18nProvider>
);

/** Surfaces the active framework so a click can be asserted through context. */
const ActiveProbe = () => {
  const { framework } = useFramework();
  return <span data-blok-testid="active-framework">{framework}</span>;
};

describe('FrameworkToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
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
});

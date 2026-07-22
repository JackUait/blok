import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const importFresh = async () => {
  vi.resetModules();
  const mod = await import('./PageTransition');
  return mod.PageTransition;
};

describe('PageTransition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the first route opaque so the prerendered markup is paintable', async () => {
    const PageTransition = await importFresh();

    render(
      <PageTransition>
        <p>first paint</p>
      </PageTransition>,
    );

    const wrapper = screen.getByText('first paint').parentElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper?.style.opacity).not.toBe('0');
  });

  it('animates in on every route after the first', async () => {
    const PageTransition = await importFresh();

    const first = render(
      <PageTransition>
        <p>first paint</p>
      </PageTransition>,
    );
    first.unmount();

    render(
      <PageTransition>
        <p>second route</p>
      </PageTransition>,
    );

    const wrapper = screen.getByText('second route').parentElement;
    expect(wrapper?.style.opacity).toBe('0');
  });
});

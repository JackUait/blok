import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indicatorMove, mountNavIndicator } from '../../../src/playground/nav-indicator';

describe('indicatorMove', () => {
  it('lets the right edge lead when the pill travels right', () => {
    const move = indicatorMove({ left: 0, right: 80 }, { left: 100, right: 200 });

    expect(move.rightDelay).toBe(0);
    expect(move.leftDelay).toBeGreaterThan(0);
    expect(move).toMatchObject({ left: 100, right: 200 });
  });

  it('lets the left edge lead when the pill travels left', () => {
    const move = indicatorMove({ left: 100, right: 200 }, { left: 0, right: 80 });

    expect(move.leftDelay).toBe(0);
    expect(move.rightDelay).toBeGreaterThan(0);
  });

  it('moves both edges together when the pill stays put', () => {
    const move = indicatorMove({ left: 10, right: 50 }, { left: 10, right: 50 });

    expect(move.leftDelay).toBe(0);
    expect(move.rightDelay).toBe(0);
  });
});

describe('mountNavIndicator', () => {
  const tabRect = (tab: HTMLElement, left: number, width: number): void => {
    Object.defineProperty(tab, 'offsetLeft', { configurable: true, value: left });
    Object.defineProperty(tab, 'offsetWidth', { configurable: true, value: width });
  };

  const build = (): { nav: HTMLElement; tabs: HTMLElement[] } => {
    const nav = document.createElement('nav');
    const tabs = [0, 1].map(() => nav.appendChild(document.createElement('a')));

    tabRect(tabs[0], 5, 80);
    tabRect(tabs[1], 90, 120);
    Object.defineProperty(nav, 'clientWidth', { configurable: true, value: 300 });
    document.body.appendChild(nav);

    return { nav, tabs };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('paints the active pill under the selected tab', () => {
    const { nav, tabs } = build();
    const indicator = mountNavIndicator(nav);

    indicator.select(tabs[1], { animate: false });

    const pill = nav.querySelector<HTMLElement>('[data-pg-nav-pill="active"]');

    expect(pill?.style.left).toBe('90px');
    expect(pill?.style.right).toBe('90px');
    expect(nav.hasAttribute('data-pg-nav-ready')).toBe(true);
  });

  it('shows the hover pill only while a tab is hovered', () => {
    const { nav, tabs } = build();

    mountNavIndicator(nav);
    tabs[0].dispatchEvent(new Event('pointerenter'));

    const ghost = nav.querySelector<HTMLElement>('[data-pg-nav-pill="hover"]');

    expect(ghost?.style.left).toBe('5px');
    expect(ghost?.dataset.visible).toBe('true');

    nav.dispatchEvent(new Event('pointerleave'));

    expect(ghost?.dataset.visible).toBe('false');
  });

  it('keeps the pills behind the tab labels', () => {
    const { nav } = build();

    mountNavIndicator(nav);

    expect(nav.firstElementChild?.getAttribute('data-pg-nav-pill')).toBe('hover');
    expect(nav.children[1]?.getAttribute('data-pg-nav-pill')).toBe('active');
    nav.querySelectorAll('[data-pg-nav-pill]').forEach((pill) => {
      expect(pill.getAttribute('aria-hidden')).toBe('true');
    });
  });
});

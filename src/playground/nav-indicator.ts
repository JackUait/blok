/**
 * The playground nav's sliding pills: one black pill under the selected tab,
 * one gray pill under the hovered tab. Each pill moves its two edges on their
 * own clock, so the leading edge sets off first and the pill stretches across
 * the gap before it settles.
 */

interface Edges {
  left: number;
  right: number;
}

interface Move extends Edges {
  leftDelay: number;
  rightDelay: number;
}

const TRAILING_EDGE_DELAY_MS = 90;

export const indicatorMove = (from: Edges, to: Edges): Move => {
  const travelsRight = to.left > from.left;
  const travelsLeft = to.left < from.left;

  return {
    ...to,
    leftDelay: travelsRight ? TRAILING_EDGE_DELAY_MS : 0,
    rightDelay: travelsLeft ? TRAILING_EDGE_DELAY_MS : 0,
  };
};

const createPill = (kind: 'active' | 'hover'): HTMLElement => {
  const pill = document.createElement('span');

  pill.className = `playground-nav__pill playground-nav__pill--${kind}`;
  pill.setAttribute('data-pg-nav-pill', kind);
  pill.setAttribute('aria-hidden', 'true');

  return pill;
};

// `right` is an inset from the nav's padding box, not a width.
const edgesOf = (nav: HTMLElement, tab: HTMLElement): Edges => ({
  left: tab.offsetLeft,
  right: nav.clientWidth - tab.offsetLeft - tab.offsetWidth,
});

const paint = (pill: HTMLElement, move: Move, animate: boolean): void => {
  pill.setAttribute('data-animate', String(animate));
  Object.assign(pill.style, {
    transitionDelay: animate ? `${move.leftDelay}ms, ${move.rightDelay}ms, 0ms` : '0ms',
    left: `${move.left}px`,
    right: `${move.right}px`,
  });
};

export interface NavIndicator {
  select(tab: HTMLElement, options?: { animate?: boolean }): void;
}

export const mountNavIndicator = (nav: HTMLElement): NavIndicator => {
  const hoverPill = createPill('hover');
  const activePill = createPill('active');

  nav.prepend(hoverPill, activePill);

  const state: { active: HTMLElement | null; activeEdges: Edges | null; hoverEdges: Edges | null } = {
    active: null,
    activeEdges: null,
    hoverEdges: null,
  };

  const select = (tab: HTMLElement, { animate = true } = {}): void => {
    const to = edgesOf(nav, tab);
    const from = state.activeEdges ?? to;

    paint(activePill, indicatorMove(from, to), animate && state.activeEdges !== null);
    state.active = tab;
    state.activeEdges = to;
    nav.setAttribute('data-pg-nav-ready', '');
  };

  const hover = (tab: HTMLElement): void => {
    const to = edgesOf(nav, tab);
    const wasVisible = hoverPill.dataset.visible === 'true';
    // A pill that fades in starts where it appears; only a visible one glides.
    const from = wasVisible && state.hoverEdges ? state.hoverEdges : to;

    paint(hoverPill, indicatorMove(from, to), wasVisible);
    state.hoverEdges = to;
    hoverPill.setAttribute('data-visible', 'true');
  };

  nav.querySelectorAll<HTMLElement>('[role="tab"], a').forEach((tab) => {
    tab.addEventListener('pointerenter', () => hover(tab));
  });
  nav.addEventListener('pointerleave', () => {
    hoverPill.setAttribute('data-visible', 'false');
  });

  // Tab widths shift when the web font lands or the nav reflows.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (state.active) {
        select(state.active, { animate: false });
      }
    }).observe(nav);
  }

  return { select };
};

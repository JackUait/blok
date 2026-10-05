/**
 * Spring motion for the find bar. Paint only: the bar's layout box never
 * moves, so the host's placement stays exact from the first frame.
 */

export interface Spring {
  stiffness: number;
  damping: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Corner {
  block: 'top' | 'bottom';
  inline: 'left' | 'center' | 'right';
}

export interface GrowFrames {
  skin: Keyframe[];
  clip: Keyframe[];
  duration: number;
}

/** Tuned against the GIFs the user approved; see the design doc. */
export const SPRINGS = {
  wide: { stiffness: 200, damping: 17 },
  tall: { stiffness: 320, damping: 19 },
  soft: { stiffness: 260, damping: 20 },
  bouncy: { stiffness: 380, damping: 16 },
} as const satisfies Record<string, Spring>;

/** The dot the bar blooms from, in px. */
export const DOT = 40;

const SETTLE = 0.001;
const MAX_SECONDS = 4;
const STEP_SECONDS = 0.01;

const px = (value: number): string => `${Math.round(value * 100) / 100}px`;

/** Progress of a unit-mass spring let go at 0 toward 1, `seconds` in. */
export const springAt = ({ stiffness, damping }: Spring, seconds: number): number => {
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * w0);

  if (zeta >= 1) {
    return 1 - Math.exp(-w0 * seconds) * (1 + w0 * seconds);
  }

  const wd = w0 * Math.sqrt(1 - zeta * zeta);

  return 1 - Math.exp(-zeta * w0 * seconds) * (Math.cos(wd * seconds) + ((zeta * w0) / wd) * Math.sin(wd * seconds));
};

const isSettled = (spring: Spring, seconds: number): boolean =>
  Math.abs(1 - springAt(spring, seconds)) < SETTLE && Math.abs(1 - springAt(spring, seconds + 0.05)) < SETTLE;

const settleSeconds = (spring: Spring, seconds: number): number =>
  seconds >= MAX_SECONDS || isSettled(spring, seconds) ? seconds : settleSeconds(spring, seconds + STEP_SECONDS);

/** Milliseconds until the spring stays within 0.1% of rest. */
export const settleMs = (spring: Spring): number => Math.round(settleSeconds(spring, 0) * 1000);

/** A CSS linear() easing that traces the spring, ending exactly at 1. */
export const springEasing = (spring: Spring): { easing: string; duration: number } => {
  const duration = settleMs(spring);
  const samples = 40;
  const points = Array.from({ length: samples + 1 }, (_, i) =>
    i === samples ? 1 : Math.round(springAt(spring, (duration / 1000) * (i / samples)) * 10000) / 10000);

  return { easing: `linear(${points.join(', ')})`, duration };
};

/** The corner the bar grows from: its anchored corner, mirrored in RTL. */
export const cornerOf = (placement: string, rtl: boolean): Corner => {
  const block = placement.startsWith('bottom') ? 'bottom' : 'top';

  if (placement.endsWith('center')) {
    return { block, inline: 'center' };
  }

  return { block, inline: placement.endsWith('end') !== rtl ? 'right' : 'left' };
};

const leftOf = (inline: Corner['inline'], full: number, width: number): number => {
  switch (inline) {
    case 'left':
      return 0;
    case 'right':
      return full - width;
    case 'center':
      return (full - width) / 2;
  }
};

/**
 * Keyframes that grow a box from `from` to `full`, width and height on their
 * own springs. clip-path is one property and cannot take two easings, so both
 * springs are sampled into linear keyframes; play them with `easing: 'linear'`.
 */
export const growFrames = (
  full: Size,
  from: Size,
  corner: Corner,
  options: { springs: { width: Spring; height: Spring }; radius: { from: number; to: number }; pinch?: number; steps?: number }
): GrowFrames => {
  const { springs, radius, pinch = 0, steps = 30 } = options;
  const duration = Math.max(settleMs(springs.width), settleMs(springs.height));
  const frames = Array.from({ length: steps + 1 }, (_, i) => {
    const last = i === steps;
    const seconds = (duration / 1000) * (i / steps);
    const pw = last ? 1 : springAt(springs.width, seconds);
    const ph = last ? 1 : springAt(springs.height, seconds);
    // A quick inward squeeze that peaks at 18% and is gone by 36%.
    const squeeze = last ? 0 : pinch * Math.max(0, Math.sin(Math.PI * Math.min(1, i / steps / 0.36)));
    const width = from.width + (full.width - from.width) * pw - squeeze;
    const height = from.height + (full.height - from.height) * ph;
    const left = leftOf(corner.inline, full.width, width);
    const top = corner.block === 'top' ? 0 : full.height - height;
    const round = radius.from + (radius.to - radius.from) * Math.min(1, ph);

    return {
      skin: { left: px(left), top: px(top), width: px(width), height: px(height), borderRadius: px(round) },
      clip: { clipPath: `inset(${px(top)} ${px(full.width - left - width)} ${px(full.height - top - height)} ${px(left)} round ${px(round)})` },
    };
  });

  return {
    skin: frames.map((frame): Keyframe => frame.skin),
    clip: frames.map((frame): Keyframe => frame.clip),
    duration,
  };
};

export interface BloomParts {
  dock: HTMLElement;
  bar: HTMLElement;
  field: HTMLElement;
  query: HTMLElement;
  /** null while a word hops in: the hop lands the counter. */
  counter: HTMLElement | null;
  /** In reading order. */
  controls: HTMLElement[];
}

export const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const canAnimate = (element: Element): boolean => typeof element.animate === 'function';

const sizeOf = (element: HTMLElement): Size => ({ width: element.offsetWidth, height: element.offsetHeight });

const radiusOf = (element: HTMLElement): number => parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;

const startEdge = (element: HTMLElement): 'left' | 'right' => getComputedStyle(element).direction === 'rtl' ? 'right' : 'left';

/**
 * Grow the bar out of a dot in its corner, then land its parts in reading
 * order. Part animations fill backwards only, so nothing stays inline after.
 */
export const bloom = (parts: BloomParts, corner: Corner): Animation[] => {
  const { dock, bar } = parts;

  if (prefersReducedMotion() || !canAnimate(bar)) {
    return [];
  }

  const frames = growFrames(sizeOf(bar), { width: DOT, height: DOT }, corner, {
    springs: { width: SPRINGS.wide, height: SPRINGS.tall },
    radius: { from: DOT / 2, to: radiusOf(bar) },
  });
  const sampled = { duration: frames.duration, easing: 'linear' };
  const soft = springEasing(SPRINGS.soft);
  const pop = springEasing(SPRINGS.bouncy);
  const edge = startEdge(dock);
  const animations = [
    dock.animate(frames.skin, { ...sampled, pseudoElement: '::before' }),
    bar.animate(frames.clip, sampled),
    bar.animate([{ opacity: 0 }, { opacity: 1 }], { duration: frames.duration * 0.25, easing: 'ease-out' }),
    parts.field.animate(
      [{ transform: 'scaleX(0.2)', transformOrigin: `${edge} center`, opacity: 0 }, { transform: 'none', transformOrigin: `${edge} center`, opacity: 1 }],
      { ...soft, delay: 60, fill: 'backwards' }
    ),
    parts.query.animate(
      [{ translate: `${edge === 'left' ? -8 : 8}px 0`, opacity: 0 }, { translate: '0 0', opacity: 1 }],
      { ...soft, delay: 160, fill: 'backwards' }
    ),
    // No end opacity: a disabled control rests at 0.4 and must land there, not pop down from 1.
    ...parts.controls.map((control, index) => control.animate(
      [{ transform: 'scale(0.3) rotate(-30deg)', opacity: 0 }, { transform: 'none' }],
      { ...pop, delay: 120 + 45 * index, fill: 'backwards' }
    )),
  ];

  // `translate`, not `transform`: the counter's bump keyframes own transform.
  if (parts.counter !== null) {
    animations.push(parts.counter.animate(
      [{ translate: '0 10px', opacity: 0 }, { translate: '0 0', opacity: 1 }],
      { ...pop, delay: 240, fill: 'backwards' }
    ));
  }

  return animations;
};

/**
 * The bar just grew taller (the replace row snapped open): spring the skin
 * and clip from the old size, pinching in a little as it stretches.
 */
export const stretch = (
  parts: { dock: HTMLElement; bar: HTMLElement; field: HTMLElement; buttons: HTMLElement[] },
  from: Size,
  corner: Corner
): Animation[] => {
  const { dock, bar } = parts;

  if (prefersReducedMotion() || !canAnimate(bar)) {
    return [];
  }

  const round = radiusOf(bar);
  const frames = growFrames(sizeOf(bar), from, corner, {
    springs: { width: SPRINGS.soft, height: SPRINGS.tall },
    radius: { from: round, to: round },
    pinch: 14,
  });
  const sampled = { duration: frames.duration, easing: 'linear' };
  const soft = springEasing(SPRINGS.soft);
  const pop = springEasing(SPRINGS.bouncy);

  return [
    dock.animate(frames.skin, { ...sampled, pseudoElement: '::before' }),
    bar.animate(frames.clip, sampled),
    parts.field.animate(
      [{ transform: 'translateY(-36px) scaleY(0.6)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { ...soft, delay: 40, fill: 'backwards' }
    ),
    // No end opacity, as in bloom: Replace is disabled until there is a match.
    ...parts.buttons.map((button, index) => button.animate(
      [{ transform: 'translateY(-24px) scale(0.6)', opacity: 0 }, { transform: 'none' }],
      { ...pop, delay: 110 + 60 * index, fill: 'backwards' }
    )),
  ];
};

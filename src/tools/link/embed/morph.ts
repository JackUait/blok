/**
 * Turns one embed window scene into the next. One card reshapes on springs and
 * carries every part with it; the old parts fall away, the new ones land in
 * reading order, and the scene's floating part (the hero) hops across.
 */

/** A box in the scene's 200×120 view box, by its centre. */
export interface CardBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  r: number;
}

export interface Pose {
  dx: number;
  dy: number;
  scale: number;
}

export interface HopPose extends Pose {
  rotate: number;
}

export type LandingKind = 'grow' | 'rise' | 'draw' | 'fill' | 'lift' | 'pop';

export interface Landing {
  kind: LandingKind;
  /** ms from the morph start */
  start: number;
  origin?: string;
  /** A part this big would bounce past the card's edges, so it settles without overshoot. */
  soft: boolean;
}

const MORPH_MS = 920;
const STEPS = 72;
const EXIT_MS = 160;
const HERO_DELAY_MS = 40;
const OLD_HERO_MS = 140;
// The card hands over to the scene's real outline (a dog-eared page, a dashed frame) in this last part.
const HAND_OVER = 0.82;

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number): number => t * t;

/** Damped spring from 0 to 1, `ms` after it starts. */
const spring = (ms: number, zeta: number, omega: number): number => {
  if (ms <= 0) {
    return 0;
  }

  const t = ms / 1000;
  const damped = omega * Math.sqrt(1 - zeta * zeta);

  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + (zeta * omega / damped) * Math.sin(damped * t));
};

const timeAt = (i: number): number => (i / STEPS) * MORPH_MS;

// The last step is pinned to 1, so every animation ends exactly at rest.
const sample = (fn: (ms: number) => number): number[] =>
  Array.from({ length: STEPS + 1 }, (_, i) => (i === STEPS ? 1 : fn(timeAt(i))));

// Width and height ride different springs, so the card squashes and stretches.
const POSITION = sample((ms) => spring(ms, 0.68, 13));
const WIDTH = sample((ms) => spring(ms, 0.6, 12.5));
const HEIGHT = sample((ms) => spring(ms, 0.6, 10.5));
const RADIUS = sample((ms) => spring(ms, 0.7, 12));

/** The card at every step of the morph. */
export function cardFrames(from: CardBox, to: CardBox): CardBox[] {
  return POSITION.map((_, i) => (i === STEPS ? { ...to } : {
    cx: lerp(from.cx, to.cx, POSITION[i]),
    cy: lerp(from.cy, to.cy, POSITION[i]),
    w: Math.max(4, lerp(from.w, to.w, WIDTH[i])),
    h: Math.max(4, lerp(from.h, to.h, HEIGHT[i])),
    r: Math.max(0, lerp(from.r, to.r, RADIUS[i])),
  }));
}

/** Where a part drawn for the `home` card sits on `card`. */
export function riderOffset(part: CardBox, home: CardBox, card: CardBox): Pose {
  const scale = Math.min(card.w / home.w, card.h / home.h);

  return {
    dx: card.cx + (part.cx - home.cx) * scale - part.cx,
    dy: card.cy + (part.cy - home.cy) * scale - part.cy,
    scale,
  };
}

const KINDS: Array<[LandingKind, string[]]> = [
  ['grow', ['line', 'cell', 'track']],
  ['rise', ['bar', 'chart-bar']],
  ['draw', ['trend', 'tick', 'road', 'link']],
  ['fill', ['progress']],
  ['lift', ['hill', 'park']],
];

/** How a new part arrives, and when: the scene builds left to right, top to bottom. */
export function landingOf(part: { classes: string[]; box: CardBox; index: number }, card: CardBox): Landing {
  const has = (name: string): boolean => part.classes.includes(`blok-media-preview__${name}`);
  const kind = KINDS.find(([, names]) => names.some(has))?.[0] ?? 'pop';
  const across = clamp01((part.box.cx - (card.cx - card.w / 2)) / card.w);
  const down = clamp01((part.box.cy - (card.cy - card.h / 2)) / card.h);
  const reading = 60 + across * 150 + down * 60;
  const soft = (part.box.w * part.box.h) / (card.w * card.h) > 0.4;

  if (has('bar')) {
    return { kind, start: 120 + part.index * 22, origin: 'center', soft };
  }

  if (has('chart-bar')) {
    return { kind, start: 150 + across * card.w * 1.6, origin: 'center bottom', soft };
  }

  const starts: Record<LandingKind, number> = { grow: reading, rise: reading, draw: has('tick') ? 380 : 260, fill: 300, lift: reading, pop: reading };

  return { kind, start: starts[kind], origin: kind === 'grow' || kind === 'fill' ? 'left center' : undefined, soft };
}

/** The new hero's flight from the old hero spot: an arc with a spin, a stretch, and a bounce. */
export function heroHop(from: CardBox, to: CardBox): HopPose[] {
  const dx = from.cx - to.cx;
  const dy = from.cy - to.cy;
  const lift = Math.min(34, 10 + Math.hypot(dx, dy) * 0.45);
  const startScale = Math.min(2.2, Math.max(0.45, Math.sqrt((from.w * from.h) / Math.max(1, to.w * to.h))));
  const spin = (dx > 0 ? -1 : 1) * 24;

  return Array.from({ length: STEPS + 1 }, (_, i) => {
    if (i === STEPS) {
      return { dx: 0, dy: 0, scale: 1, rotate: 0 };
    }

    const k = i === 0 ? 0 : spring(timeAt(i) - HERO_DELAY_MS, 0.52, 11.5);
    const arc = Math.sin(Math.PI * clamp01(k));

    return {
      dx: dx * (1 - k),
      dy: dy * (1 - k) - arc * lift,
      scale: lerp(startScale, 1, k) * (1 + arc * 0.14),
      rotate: spin * (1 - k) || 0,
    };
  });
}

// ---- DOM ----

interface Matrix { a: number; b: number; c: number; d: number; e: number; f: number }

const apply = (m: Matrix, x: number, y: number): [number, number] => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];

// Shape space → scene space, through any group transforms between them.
const toScene = (el: SVGGraphicsElement): DOMMatrix | null => {
  const own = el.getScreenCTM();
  const scene = el.ownerSVGElement?.getScreenCTM();

  return own && scene ? scene.inverse().multiply(own) : null;
};

/** A vector in scene space, as the same vector in the element's own space. */
const localVector = (el: SVGGraphicsElement, dx: number, dy: number): [number, number] => {
  const m = toScene(el)?.inverse();

  if (!m) {
    return [dx, dy];
  }

  const [ax, ay] = apply(m, 0, 0);
  const [bx, by] = apply(m, dx, dy);

  return [bx - ax, by - ay];
};

const sceneBox = (el: SVGGraphicsElement): CardBox => {
  const { x, y, width, height } = el.getBBox();
  const m = toScene(el);
  const [cx, cy] = m ? apply(m, x + width / 2, y + height / 2) : [x + width / 2, y + height / 2];
  const rx = el.tagName === 'rect' ? parseFloat(getComputedStyle(el).rx) || 0 : 8;

  return { cx, cy, w: width, h: height, r: Math.min(rx, width / 2, height / 2) };
};

const LAYER = '.blok-media-preview__layer';
const SVG_NS = 'http://www.w3.org/2000/svg';

const bodyOf = (svg: SVGSVGElement): SVGGraphicsElement | null => svg.querySelector<SVGGraphicsElement>('[id$="-s"]');

// The floating part, when it is a group of its own (a document's front sheet carries the body, so it stays on the card).
const heroOf = (svg: SVGSVGElement): SVGGElement | null => {
  const hero = svg.querySelector<SVGGElement>('g[id$="-f"]');

  return hero !== null && hero.querySelector('[id$="-s"]') === null ? hero : null;
};

const partsOf = (svg: SVGSVGElement, hero: Element | null): SVGGraphicsElement[] =>
  Array.from(svg.querySelectorAll<SVGGraphicsElement>(`${LAYER} :is(rect, circle, ellipse, path)`))
    .filter((el) => !el.id.endsWith('-s') && !(hero?.contains(el) ?? false));

const opacityOf = (el: Element): number => {
  const value = parseFloat(getComputedStyle(el).opacity);

  return Number.isNaN(value) ? 1 : value;
};

/** True where the morph can measure parts and animate them. */
export const canMorph = (svg: SVGSVGElement): boolean =>
  typeof svg.getBBox === 'function' && typeof svg.animate === 'function' && typeof svg.getScreenCTM === 'function';

export interface Morph {
  animations: Animation[];
  /** Takes away the helper shapes and the old scene's parts. Safe to call twice. */
  cleanup(): void;
}

const linear = { duration: MORPH_MS, easing: 'linear', fill: 'both' } as const;
const afterCard: Keyframe[] = [{ opacity: 0 }, { opacity: 0, offset: HAND_OVER }, { opacity: 1 }];
const handOver = (p: number): number => (p < HAND_OVER ? 1 : lerp(1, 0, (p - HAND_OVER) / (1 - HAND_OVER)));

const cardKeyframes = (frames: CardBox[], extra: (p: number) => Keyframe): Keyframe[] => frames.map((card, i) => ({
  offset: i / STEPS,
  x: `${card.cx - card.w / 2}px`,
  y: `${card.cy - card.h / 2}px`,
  width: `${card.w}px`,
  height: `${card.h}px`,
  rx: `${card.r}px`,
  ry: `${card.r}px`,
  ...extra(i / STEPS),
}));

const isGeometry = (el: SVGGraphicsElement): el is SVGGeometryElement =>
  typeof (el as Partial<SVGGeometryElement>).getTotalLength === 'function';

interface Ride {
  alpha: (ms: number) => number;
  // A pose on top of the ride; sx/sy stretch one axis.
  pose: (ms: number) => { scale?: number; sx?: number; sy?: number; dy?: number };
  draw?: (ms: number) => number;
}

const ride = (el: SVGGraphicsElement, home: CardBox, cards: CardBox[], motion: Ride): Animation => {
  const own = sceneBox(el);
  const rest = opacityOf(el);
  const length = motion.draw !== undefined && isGeometry(el) ? el.getTotalLength() : 0;

  return el.animate(cards.map((card, i) => {
    const ms = timeAt(i);
    const at = riderOffset(own, home, card);
    const pose = motion.pose(ms);
    const [x, y] = localVector(el, at.dx, at.dy + (pose.dy ?? 0));
    const scale = at.scale * (pose.scale ?? 1);
    const frame: Keyframe = {
      offset: i / STEPS,
      translate: `${x}px ${y}px`,
      scale: `${scale * (pose.sx ?? 1)} ${scale * (pose.sy ?? 1)}`,
      opacity: rest * motion.alpha(ms),
    };

    if (length > 0 && motion.draw) {
      frame.strokeDasharray = `${length} ${length}`;
      frame.strokeDashoffset = `${length * (1 - motion.draw(ms))}`;
    }

    return frame;
  }), linear);
};

const arrival = (landing: Landing): Ride => {
  const fade = (ms: number): number => easeOut(clamp01((ms - landing.start) / 160));
  const after = (ms: number): number => ms - landing.start;

  switch (landing.kind) {
    case 'grow':
      return { alpha: fade, pose: (ms) => ({ sx: Math.max(0.02, spring(after(ms), 0.66, 17)) }) };
    case 'rise':
      return {
        alpha: (ms) => easeOut(clamp01(after(ms) / 90)),
        pose: (ms) => ({ sy: Math.max(0.02, spring(after(ms), 0.42, 17)) }),
      };
    case 'draw':
      return { alpha: (ms) => (ms > landing.start ? 1 : 0), pose: () => ({}), draw: (ms) => easeOut(clamp01(after(ms) / 380)) };
    case 'fill':
      return { alpha: (ms) => (ms > landing.start ? 1 : 0), pose: (ms) => ({ sx: Math.max(0.02, spring(after(ms), 0.6, 9)) }) };
    case 'lift':
      return { alpha: fade, pose: (ms) => ({ dy: (1 - spring(after(ms), 0.5, 17)) * 18 }) };
    case 'pop':
      return { alpha: fade, pose: (ms) => ({ scale: Math.max(0.02, lerp(0.3, 1, spring(after(ms), landing.soft ? 0.9 : 0.5, 17))) }) };
  }
};

const departure: Ride = {
  alpha: (ms) => 1 - easeIn(clamp01(ms / EXIT_MS)),
  pose: (ms) => ({ scale: lerp(1, 0.86, clamp01(ms / EXIT_MS)), dy: easeIn(clamp01(ms / EXIT_MS)) * 5 }),
};

/**
 * Morphs `prev` into `next`. Both scenes must be laid out, in one stage cell.
 * The old parts move into `next` for the ride, so `prev` keeps only its defs
 * (its clip paths and filters) and must stay in the document until cleanup.
 */
export function morphScene(prev: SVGSVGElement, next: SVGSVGElement): Morph {
  const oldBody = bodyOf(prev);
  const newBody = bodyOf(next);
  const layer = newBody?.closest(LAYER);

  if (oldBody === null || newBody === null || layer === null || layer === undefined) {
    return { animations: [], cleanup: () => undefined };
  }

  const oldHero = heroOf(prev);
  const newHero = heroOf(next);
  const oldParts = partsOf(prev, oldHero);
  const newParts = partsOf(next, newHero);
  const from = sceneBox(oldBody);
  const to = sceneBox(newBody);
  const oldHeroBox = oldHero ? sceneBox(oldHero) : null;
  const newHeroBox = newHero ? sceneBox(newHero) : null;
  const newParked = newParts.map((el) => ({ el, landing: landingOf({ classes: Array.from(el.classList), box: sceneBox(el), index: parseFloat(el.style.getPropertyValue('--i')) || 0 }, to) }));
  const cards = cardFrames(from, to);
  const animations: Animation[] = [];
  const helpers: Element[] = [];
  const play = (animation: Animation): void => {
    animations.push(animation);
  };

  // The card sits right under the new body's own sheet, so back sheets stay behind it
  // and the old parts, lifted on top of it, stay in front of the new scene's floor.
  const card = document.createElementNS(SVG_NS, 'rect');
  const lifted = document.createElementNS(SVG_NS, 'g');
  const sheet = Array.from(layer.children).find((child) => child.contains(newBody)) ?? newBody;
  const dashed = (el: Element): boolean => el.classList.contains('blok-media-preview__dashed');
  const gaps = [dashed(oldBody) ? 3.5 : 0, dashed(newBody) ? 3.5 : 0];

  card.setAttribute('class', 'blok-media-preview__frame');
  sheet.before(card);
  card.after(lifted);
  prev.querySelectorAll(LAYER).forEach((oldLayer) => lifted.append(oldLayer));
  helpers.push(card, lifted);

  play(card.animate(cardKeyframes(cards, (p) => ({
    opacity: handOver(p),
    ...(gaps[0] + gaps[1] > 0 ? { strokeDasharray: `3 ${lerp(gaps[0], gaps[1], clamp01(p * 2.5))}` } : {}),
  })), linear));
  play(newBody.animate(afterCard, { duration: MORPH_MS, fill: 'both' }));
  play(oldBody.animate([{ opacity: 0 }, { opacity: 0 }], { duration: MORPH_MS, fill: 'both' }));

  // The floor shadow follows the card, not either scene.
  next.querySelectorAll('use.blok-media-preview__cast').forEach((use) => {
    const cast = document.createElementNS(SVG_NS, 'rect');

    cast.setAttribute('class', use.getAttribute('class') ?? '');
    use.after(cast);
    helpers.push(cast);
    play(use.animate(afterCard, { duration: MORPH_MS, fill: 'both' }));
    play(cast.animate(cardKeyframes(cards, (p) => ({ opacity: handOver(p) })), linear));
  });
  // A <use> copy does not follow its source's animation, so drop shadows wait until the parts land.
  next.querySelectorAll('.blok-media-preview__drop').forEach((drop) => play(drop.animate(
    [{ opacity: 0 }, { opacity: 0, offset: 0.8 }, { opacity: opacityOf(drop) }],
    { duration: MORPH_MS + 120, fill: 'both' }
  )));
  lifted.querySelectorAll('.blok-media-preview__drop').forEach((drop) => drop.remove());

  oldParts.forEach((el) => play(ride(el, from, cards, departure)));
  newParked.forEach(({ el, landing }) => {
    if (landing.origin !== undefined) {
      el.style.setProperty('transform-origin', landing.origin);
    }

    play(ride(el, to, cards, arrival(landing)));
  });

  if (newHero !== null && newHeroBox !== null) {
    const source = oldHeroBox ?? { ...from, w: newHeroBox.w * 0.3, h: newHeroBox.h * 0.3 };

    play(newHero.animate(heroHop(source, newHeroBox).map((pose, i) => {
      const [x, y] = localVector(newHero, pose.dx, pose.dy);

      return {
        offset: i / STEPS,
        translate: `${x}px ${y}px`,
        rotate: `${pose.rotate}deg`,
        scale: `${pose.scale}`,
        opacity: easeOut(clamp01((timeAt(i) - HERO_DELAY_MS) / 120)),
      };
    }), linear));
  }

  if (oldHero !== null && oldHeroBox !== null) {
    // Leaps a third of the way toward the new hero spot and is gone as the new one takes off.
    const target = newHeroBox ?? to;
    const toward = target.cx - oldHeroBox.cx;
    const [x, y] = localVector(oldHero, toward * 0.35, (target.cy - oldHeroBox.cy) * 0.35 - 14);

    play(oldHero.animate([
      { translate: '0px 0px', rotate: '0deg', scale: '1', opacity: 1 },
      { translate: `${x}px ${y}px`, rotate: `${toward > 0 ? 14 : -14}deg`, scale: '0.9', opacity: 0 },
    ], { duration: OLD_HERO_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'both' }));
  }

  next.classList.add('blok-media-preview--morphing');

  return {
    animations,
    cleanup: () => {
      animations.forEach((animation) => animation.cancel());
      helpers.forEach((helper) => helper.remove());
      newParked.forEach(({ el }) => el.style.removeProperty('transform-origin'));
      next.classList.remove('blok-media-preview--morphing');
    },
  };
}

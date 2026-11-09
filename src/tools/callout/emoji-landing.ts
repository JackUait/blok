import { emojiColor } from '../../components/utils/emoji/emoji-color';

/** The landings the design kept; one plays at random on each pick. */
export const LANDINGS = ['launch', 'swap', 'stamp', 'comet', 'portal', 'bubble', 'slingshot', 'beam', 'confetti'] as const;

export type Landing = typeof LANDINGS[number];

/**
 * A random landing that is not the previous one, so two picks in a row never look the same.
 * @param previous - the landing that played last, if any
 * @param random - a [0, 1) source; injectable for tests
 */
export function chooseLanding(previous: Landing | null, random: () => number = Math.random): Landing {
  const pool = LANDINGS.filter(landing => landing !== previous);

  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

export interface LandingScene {
  /** Where the picked glyph was on screen. */
  from: DOMRect;
  /** The element that shows the icon; it already holds the new emoji. */
  face: HTMLElement;
  /** The callout box, nudged by some landings. */
  surface: HTMLElement;
  previous: string;
  next: string;
}

interface Point {
  x: number;
  y: number;
}

type Frames = Keyframe[];

const FALLBACK_COLOR = 'rgb(160, 160, 160)';

/**
 * Plays one landing on a fixed overlay over the page.
 * @param kind - which landing
 * @param scene - the pick and the icon it lands on
 * @returns a function that stops the landing at once and leaves the icon showing
 */
export function playLanding(kind: Landing, scene: LandingScene): () => void {
  const run = new LandingRun(scene);

  RUNNERS[kind](run, scene);
  run.markScheduled();

  return () => run.cancel();
}

class LandingRun {
  public readonly overlay: HTMLElement;
  public readonly color: string;
  private readonly face: HTMLElement;
  private readonly pending = new Set<Animation>();
  private readonly timers = new Set<number>();
  private cancelled = false;
  private scheduled = false;

  constructor(scene: LandingScene) {
    this.face = scene.face;
    this.color = emojiColor(scene.next) ?? FALLBACK_COLOR;
    this.overlay = document.createElement('div');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;pointer-events:none;overflow:hidden;';
    document.body.appendChild(this.overlay);
  }

  public tag(kind: Landing): void {
    this.overlay.setAttribute('data-blok-emoji-landing', kind);
  }

  /** Center of a rect in viewport coordinates. */
  public center(rect: DOMRect): Point {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  public slot(): Point {
    return this.center(this.face.getBoundingClientRect());
  }

  public hideSlot(): void {
    this.face.style.visibility = 'hidden';
  }

  public ghost(glyph: string, size = 24): HTMLElement {
    const ghost = document.createElement('span');

    ghost.textContent = glyph;
    ghost.style.cssText = `position:absolute;left:0;top:0;width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;display:grid;place-items:center;font-size:${Math.round(size * 0.9)}px;line-height:1;will-change:transform;`;
    this.overlay.append(ghost);

    return ghost;
  }

  public dot(css: string): HTMLElement {
    const dot = document.createElement('span');

    dot.style.cssText = `position:absolute;${css}`;
    this.overlay.append(dot);

    return dot;
  }

  /**
   * Starts a tracked animation. `then` runs only if it finishes, never after a cancel.
   * @param element - what to animate
   * @param frames - keyframes
   * @param options - timing
   * @param then - follow-up once it finishes
   */
  public animate(element: Element, frames: Frames, options: KeyframeAnimationOptions, then?: () => void): void {
    if (this.cancelled) {
      return;
    }

    if (typeof element.animate !== 'function') {
      then?.();

      return;
    }

    const animation = element.animate(frames, options);

    this.pending.add(animation);
    animation.finished.then(() => {
      this.pending.delete(animation);

      if (!this.cancelled) {
        then?.();
        this.maybeEnd();
      }
    }, () => {
      this.pending.delete(animation);
    });
  }

  public later(ms: number, then: () => void): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);

      if (!this.cancelled) {
        then();
        this.maybeEnd();
      }
    }, ms);

    this.timers.add(id);
  }

  /** Shows the icon in its seat with a closing flourish. */
  public settle(frames: Frames, duration = 420): void {
    this.face.style.visibility = '';
    this.animate(this.face, frames, { duration, easing: 'ease-out' });
  }

  public ring(point: Point, size = 40, color = this.color): void {
    const ring = this.dot(`left:${point.x - size / 2}px;top:${point.y - size / 2}px;width:${size}px;height:${size}px;border-radius:50%;border:2px solid ${color};box-sizing:border-box;`);

    this.animate(ring, [{ transform: 'scale(.3)', opacity: 0.9 }, { transform: 'scale(1.7)', opacity: 0 }], { duration: 560, easing: 'cubic-bezier(.2,.7,.3,1)' }, () => ring.remove());
  }

  public markScheduled(): void {
    this.scheduled = true;
    this.maybeEnd();
  }

  public cancel(): void {
    if (this.cancelled) {
      return;
    }

    this.cancelled = true;

    for (const animation of this.pending) {
      animation.cancel();
    }

    for (const id of this.timers) {
      window.clearTimeout(id);
    }

    this.pending.clear();
    this.timers.clear();
    this.teardown();
  }

  private maybeEnd(): void {
    if (this.scheduled && !this.cancelled && this.pending.size === 0 && this.timers.size === 0) {
      this.cancelled = true;
      this.teardown();
    }
  }

  private teardown(): void {
    this.overlay.remove();
    this.face.style.visibility = '';
  }
}

const bezier = (a: Point, c: Point, b: Point, t: number): Point => {
  const u = 1 - t;

  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
};

const path = (a: Point, c: Point, b: Point, steps: number, ease: (t: number) => number): Point[] =>
  Array.from({ length: steps + 1 }, (_, index) => bezier(a, c, b, ease(index / steps)));

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Keeps a curve's control point on screen. */
const clampX = (x: number): number => Math.max(30, Math.min(window.innerWidth - 30, x));

const RUNNERS: Record<Landing, (run: LandingRun, scene: LandingScene) => void> = {
  /** Takes off with a trail of echoes, shrinks into the seat, and a ring marks the landing. */
  launch(run, { from, next }) {
    run.tag('launch');

    const a = run.center(from);
    const b = run.slot();
    const c = { x: clampX(Math.max(a.x, b.x) + 160), y: Math.min(a.y, b.y) - 30 };
    const frames = path(a, c, b, 18, easeInOutCubic).map((p, index) => ({
      transform: `translate(${p.x}px, ${p.y}px) scale(${(1.4 - 0.45 * (index / 18)).toFixed(3)}) rotate(${Math.sin((index / 18) * Math.PI) * -18}deg)`,
    }));

    run.hideSlot();

    [4, 3, 2, 1].forEach((echo) => {
      const trail = run.ghost(next);

      trail.style.opacity = String(0.42 / echo);
      trail.style.filter = `blur(${echo * 0.8}px)`;
      run.animate(trail, frames, { duration: 760, delay: echo * 34, easing: 'linear', fill: 'both' }, () => trail.remove());
    });

    const ghost = run.ghost(next);

    ghost.style.filter = `drop-shadow(0 6px 10px ${run.color})`;
    run.animate(ghost, frames, { duration: 760, easing: 'linear', fill: 'forwards' }, () => {
      ghost.remove();
      run.ring(b);
      run.settle([{ transform: 'scale(1.5)' }, { transform: 'scale(.88)' }, { transform: 'none' }]);
    });
  },

  /** Knocks the old icon off its seat and flips into place like a coin. */
  swap(run, { from, next, previous, surface }) {
    run.tag('swap');

    const a = run.center(from);
    const b = run.slot();
    const c = { x: b.x - 70, y: Math.min(a.y, b.y) - 50 };
    const ghost = run.ghost(next);

    run.hideSlot();
    run.animate(ghost, path(a, c, b, 14, t => 1 - (1 - t) ** 2.4).map((p, index) => ({
      transform: `translate(${p.x}px, ${p.y}px) scale(${(1.3 - 0.3 * (index / 14)).toFixed(3)}) rotate(${(index / 14) * 360}deg)`,
    })), { duration: 460, easing: 'linear', fill: 'forwards' }, () => {
      ghost.remove();

      if (previous !== '') {
        const knocked = run.ghost(previous);

        run.animate(knocked, [
          { transform: `translate(${b.x}px, ${b.y}px) rotate(0deg)`, easing: 'cubic-bezier(.2,.7,.4,1)' },
          { transform: `translate(${b.x + 26}px, ${b.y - 34}px) rotate(70deg)`, offset: 0.24, easing: 'cubic-bezier(.55,0,1,.6)' },
          { transform: `translate(${b.x + 78}px, ${b.y + 300}px) rotate(320deg)`, opacity: 0 },
        ], { duration: 1000, fill: 'forwards' }, () => knocked.remove());
      }

      run.settle([
        { transform: 'perspective(120px) rotateY(-180deg) scale(1.25)' },
        { transform: 'perspective(120px) rotateY(25deg) scale(1.05)', offset: 0.7 },
        { transform: 'none' },
      ], 560);
      run.animate(surface, [{ transform: 'translateX(0)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(1px)' }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
    });
  },

  /** Lifts toward you over a growing shadow, hangs, then slams down and kicks up dust. */
  stamp(run, { from, next, surface }) {
    run.tag('stamp');

    const a = run.center(from);
    const b = run.slot();
    const top = { x: b.x, y: b.y - 54 };
    const shadow = run.dot(`left:${b.x - 14}px;top:${b.y + 7}px;width:28px;height:8px;border-radius:50%;background:rgba(0,0,0,.28);filter:blur(2px);`);
    const ghost = run.ghost(next);

    run.hideSlot();
    run.animate(shadow, [
      { transform: 'scale(.2)', opacity: 0 },
      { transform: 'scale(.55)', opacity: 0.35, offset: 0.5 },
      { transform: 'scale(.6)', opacity: 0.35, offset: 0.74 },
      { transform: 'scale(1.15)', opacity: 0.9 },
    ], { duration: 720, fill: 'forwards' });
    run.animate(ghost, [
      { transform: `translate(${a.x}px, ${a.y}px) scale(1.2) rotate(0deg)`, easing: 'cubic-bezier(.2,.8,.25,1)' },
      { transform: `translate(${top.x}px, ${top.y}px) scale(2.9) rotate(-8deg)`, offset: 0.5, easing: 'ease-in-out' },
      { transform: `translate(${top.x}px, ${top.y - 5}px) scale(3) rotate(-4deg)`, offset: 0.74, easing: 'cubic-bezier(.6,0,1,1)' },
      { transform: `translate(${b.x}px, ${b.y}px) scale(1) rotate(0deg)` },
    ], { duration: 720, fill: 'forwards' }, () => {
      ghost.remove();
      shadow.remove();

      Array.from({ length: 12 }, (_, index) => index).forEach((index) => {
        const side = index % 2 === 0 ? -1 : 1;
        const size = 3 + Math.random() * 3;
        const dust = run.dot(`left:${b.x - size / 2}px;top:${b.y + 8}px;width:${size}px;height:${size}px;border-radius:50%;background:${run.color};`);

        run.animate(dust, [
          { transform: 'translate(0,0)', opacity: 1 },
          { transform: `translate(${side * (14 + Math.random() * 26)}px, ${-4 - Math.random() * 12}px) scale(.4)`, opacity: 0 },
        ], { duration: 520, easing: 'cubic-bezier(.1,.8,.3,1)' }, () => dust.remove());
      });

      run.animate(surface, [{ transform: 'none' }, { transform: 'translateY(2px) scale(.996)' }, { transform: 'translateY(-1px)' }, { transform: 'none' }], { duration: 300, easing: 'ease-out' });
      run.settle([{ transform: 'scale(1.5, .55)' }, { transform: 'scale(.88, 1.18)' }, { transform: 'scale(1.04, .97)' }, { transform: 'none' }], 460);
    });
  },

  /** Swoops in a wide curve with a tail in its own colour; the callout glows on landing. */
  comet(run, { from, next, surface }) {
    run.tag('comet');

    const a = run.center(from);
    const b = run.slot();
    const c = { x: clampX(Math.max(a.x, b.x) + 200), y: Math.min(a.y, b.y) - 70 };
    const steps = 26;
    const duration = 800;
    const points = path(a, c, b, steps, t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2));

    run.hideSlot();
    points.slice(0, steps).forEach((p, index) => {
      const size = 9 - (index / steps) * 3;
      const spark = run.dot(`left:${p.x - size / 2}px;top:${p.y - size / 2}px;width:${size}px;height:${size}px;border-radius:50%;background:${run.color};filter:blur(1.5px);opacity:0;`);

      run.animate(spark, [{ opacity: 0.85, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.15)' }], { duration: 380, delay: (index / steps) * duration, easing: 'ease-out' }, () => spark.remove());
    });

    const ghost = run.ghost(next);

    ghost.style.filter = `drop-shadow(0 0 8px ${run.color})`;
    run.animate(ghost, points.map((p, index) => ({ transform: `translate(${p.x}px, ${p.y}px) scale(${(1.3 - 0.3 * (index / steps)).toFixed(3)})` })), { duration, easing: 'linear', fill: 'forwards' }, () => {
      ghost.remove();

      const box = surface.getBoundingClientRect();
      const glow = run.dot(`left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;border-radius:8px;background:radial-gradient(240px 90px at ${b.x - box.left}px 50%, ${run.color}, transparent 80%);`);

      run.animate(glow, [{ opacity: 0.45 }, { opacity: 0 }], { duration: 1100, easing: 'ease-out' }, () => glow.remove());
      run.ring(b, 36);
      run.settle([{ transform: 'scale(1.6)', filter: `drop-shadow(0 0 10px ${run.color})` }, { transform: 'scale(.92)' }, { transform: 'none', filter: 'none' }], 520);
    });
  },

  /** Drops through a hole under the pick and pops up out of a hole under the seat. */
  portal(run, { from, next }) {
    run.tag('portal');

    const a = run.center(from);
    const b = run.slot();
    const hole = (p: Point, width: number): HTMLElement =>
      run.dot(`left:${p.x - width / 2}px;top:${p.y - 6}px;width:${width}px;height:12px;border-radius:50%;background:radial-gradient(closest-side, rgba(0,0,0,.9), rgba(0,0,0,.55) 60%, rgba(0,0,0,0));transform:scale(0);`);
    const first = hole({ x: a.x, y: a.y + 10 }, 34);
    const ghost = run.ghost(next);

    run.hideSlot();
    run.animate(first, [{ transform: 'scale(0)' }, { transform: 'scale(1)', offset: 0.35 }, { transform: 'scale(1)', offset: 0.75 }, { transform: 'scale(0)' }], { duration: 560, fill: 'forwards' }, () => first.remove());
    run.animate(ghost, [
      { transform: `translate(${a.x}px, ${a.y}px) scale(1.2)` },
      { transform: `translate(${a.x}px, ${a.y - 6}px) scale(1.3, 1.1)`, offset: 0.3 },
      { transform: `translate(${a.x}px, ${a.y + 12}px) scale(.2, .7)`, opacity: 0 },
    ], { duration: 420, easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'forwards' }, () => {
      ghost.remove();

      const second = hole({ x: b.x, y: b.y + 11 }, 30);
      const rising = run.ghost(next);

      run.animate(second, [{ transform: 'scale(0)' }, { transform: 'scale(1)', offset: 0.3 }, { transform: 'scale(1)', offset: 0.6 }, { transform: 'scale(0)' }], { duration: 620, fill: 'forwards' }, () => second.remove());
      run.animate(rising, [
        { transform: `translate(${b.x}px, ${b.y + 12}px) scale(.2, .7)`, opacity: 0 },
        { transform: `translate(${b.x}px, ${b.y - 16}px) scale(1.25)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${b.x}px, ${b.y}px) scale(1)` },
      ], { duration: 460, delay: 140, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' }, () => {
        rising.remove();
        run.settle([{ transform: 'scale(1.2, .8)' }, { transform: 'none' }], 260);
      });
    });
  },

  /** Floats over in a wobbling soap bubble that pops on the seat. */
  bubble(run, { from, next }) {
    run.tag('bubble');

    const a = run.center(from);
    const b = run.slot();
    const bubble = run.dot('left:0;top:0;width:42px;height:42px;margin:-21px 0 0 -21px;border-radius:50%;display:grid;place-items:center;font-size:22px;line-height:1;'
      + 'background:radial-gradient(circle at 32% 28%, rgba(255,255,255,.9), rgba(255,255,255,0) 22%),conic-gradient(from 40deg, rgba(255,120,200,.22), rgba(120,200,255,.22), rgba(140,255,180,.22), rgba(255,230,120,.22), rgba(255,120,200,.22));'
      + 'box-shadow:inset 0 0 0 1px rgba(255,255,255,.75), inset 0 -4px 10px rgba(120,160,255,.25), 0 4px 12px rgba(0,0,0,.08);');
    const steps = 20;
    const drift = Array.from({ length: steps }, (_, index) => {
      const t = (index + 1) / steps;
      const eased = 1 - (1 - t) ** 2;
      const wobble = Math.sin(t * Math.PI * 6) * 0.06;
      const scale = 1.05 - 0.1 * t;

      return {
        transform: `translate(${a.x + (b.x - a.x) * eased + Math.sin(t * Math.PI * 3) * 16 * (1 - t)}px, ${a.y + (b.y - a.y) * eased}px) scale(${((1 + wobble) * scale).toFixed(3)}, ${((1 - wobble) * scale).toFixed(3)})`,
      };
    });
    const frames: Frames = [{ transform: `translate(${a.x}px, ${a.y}px) scale(.3)`, opacity: 0 }, ...drift];

    bubble.textContent = next;

    run.hideSlot();
    run.animate(bubble, frames, { duration: 1150, easing: 'linear', fill: 'forwards' }, () => {
      bubble.remove();

      Array.from({ length: 10 }, (_, index) => index).forEach((index) => {
        const angle = (index / 10) * Math.PI * 2;
        const distance = 20 + Math.random() * 10;
        const drop = run.dot(`left:${b.x - 2}px;top:${b.y - 2}px;width:4px;height:4px;border-radius:50%;background:rgba(150,190,255,.7);box-shadow:inset 0 0 0 1px rgba(255,255,255,.8);`);

        run.animate(drop, [
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          { transform: `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance + 6}px) scale(.3)`, opacity: 0 },
        ], { duration: 420, easing: 'cubic-bezier(.1,.8,.3,1)' }, () => drop.remove());
      });

      run.ring(b, 44, 'rgba(150,190,255,.8)');
      run.settle([{ transform: 'translateY(-4px) scale(1.15)' }, { transform: 'translateY(1px) scale(1.1, .9)' }, { transform: 'none' }], 380);
    });
  },

  /** A band stretches from the seat; the emoji pulls back, snaps in and wobbles like jelly. */
  slingshot(run, { from, next }) {
    run.tag('slingshot');

    const a = run.center(from);
    const b = run.slot();
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    const pull = { x: a.x + (dx / distance) * 44, y: a.y + (dy / distance) * 44 };
    const band = run.dot(`left:${b.x}px;top:${b.y - 1}px;height:2px;width:1px;border-radius:2px;background:rgba(120,120,120,.7);transform-origin:0 50%;transform:rotate(${angle}rad) scaleX(${distance});`);
    const ghost = run.ghost(next);

    run.hideSlot();
    run.animate(band, [
      { transform: `rotate(${angle}rad) scaleX(${distance})`, opacity: 0 },
      { transform: `rotate(${angle}rad) scaleX(${distance})`, opacity: 1, offset: 0.1 },
      { transform: `rotate(${angle}rad) scaleX(${distance + 44})`, opacity: 1, offset: 0.6, easing: 'cubic-bezier(.7,0,1,1)' },
      { transform: `rotate(${angle}rad) scaleX(0)`, opacity: 0.6 },
    ], { duration: 640, fill: 'forwards' }, () => band.remove());
    run.animate(ghost, [
      { transform: `translate(${a.x}px, ${a.y}px) scale(1.2)`, easing: 'cubic-bezier(.3,0,.2,1)' },
      { transform: `translate(${pull.x}px, ${pull.y}px) scale(1.45, 1.1) rotate(${-angle}rad)`, offset: 0.6, easing: 'cubic-bezier(.7,0,1,1)' },
      { transform: `translate(${b.x}px, ${b.y}px) scale(1.1, .9) rotate(0rad)` },
    ], { duration: 640, fill: 'forwards' }, () => {
      ghost.remove();
      run.ring(b, 34);
      run.settle([
        { transform: 'rotate(0deg) scale(1.3, .75)' }, { transform: 'rotate(-14deg) scale(1.05)' }, { transform: 'rotate(10deg)' },
        { transform: 'rotate(-6deg)' }, { transform: 'rotate(3deg)' }, { transform: 'none' },
      ], 620);
    });
  },

  /** Breaks into sparks of its colour that stream to the seat and re-form there. */
  beam(run, { from, next }) {
    run.tag('beam');

    const a = run.center(from);
    const b = run.slot();
    const ghost = run.ghost(next);

    run.hideSlot();
    run.animate(ghost, [
      { transform: `translate(${a.x}px, ${a.y}px) scale(1.3)`, filter: 'blur(0px)', opacity: 1 },
      { transform: `translate(${a.x}px, ${a.y}px) scale(1.6)`, filter: 'blur(4px)', opacity: 0 },
    ], { duration: 200, easing: 'ease-in', fill: 'forwards' }, () => ghost.remove());

    Array.from({ length: 26 }, (_, index) => index).forEach((index) => {
      const size = 2 + Math.random() * 3.5;
      const start = { x: a.x + (Math.random() - 0.5) * 22, y: a.y + (Math.random() - 0.5) * 22 };
      const control = { x: (start.x + b.x) / 2 + (Math.random() - 0.5) * 120, y: (start.y + b.y) / 2 + (Math.random() - 0.5) * 80 };
      const shade = index % 3 === 0 ? `color-mix(in srgb, ${run.color} 55%, white)` : run.color;
      const spark = run.dot(`left:${-size / 2}px;top:${-size / 2}px;width:${size}px;height:${size}px;border-radius:50%;background:${shade};box-shadow:0 0 6px ${run.color};`);

      run.animate(spark, path(start, control, b, 10, t => t * t * (3 - 2 * t)).map((p, step) => ({
        transform: `translate(${p.x}px, ${p.y}px) scale(${step === 10 ? 0.3 : 1})`,
        opacity: step === 0 ? 0 : 1,
      })), { duration: 560, delay: 60 + Math.random() * 200, easing: 'linear', fill: 'both' }, () => spark.remove());
    });

    run.later(820, () => {
      run.ring(b, 30);
      run.settle([
        { transform: 'scale(.3)', filter: 'blur(5px) brightness(1.6)', opacity: 0.3 },
        { transform: 'scale(1.25)', filter: 'blur(0px) brightness(1.2)', opacity: 1, offset: 0.6 },
        { transform: 'none', filter: 'none' },
      ], 460);
    });
  },

  /** Lands with a pop and a burst of confetti in its colours. */
  confetti(run, { from, next }) {
    run.tag('confetti');

    const a = run.center(from);
    const b = run.slot();
    const c = { x: (a.x + b.x) / 2 + 40, y: Math.min(a.y, b.y) - 40 };
    const ghost = run.ghost(next);

    run.hideSlot();
    run.animate(ghost, path(a, c, b, 12, t => 1 - (1 - t) ** 2).map((p, index) => ({
      transform: `translate(${p.x}px, ${p.y}px) scale(${(1.3 - (0.3 * index) / 12).toFixed(3)})`,
    })), { duration: 420, easing: 'linear', fill: 'forwards' }, () => {
      ghost.remove();

      const palette = [run.color, `color-mix(in srgb, ${run.color} 50%, white)`, `color-mix(in srgb, ${run.color} 70%, black)`, '#f2c94c', '#eb5757', '#6fcf97', '#bb6bd9'];

      Array.from({ length: 30 }, (_, index) => index).forEach((index) => {
        const width = 3 + Math.random() * 3;
        const height = 6 + Math.random() * 5;
        const piece = run.dot(`left:${b.x - width / 2}px;top:${b.y - height / 2}px;width:${width}px;height:${height}px;border-radius:1px;background:${palette[index % palette.length]};`);
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
        const speed = 50 + Math.random() * 60;
        const px = Math.cos(angle) * speed;
        const py = Math.sin(angle) * speed;
        const spin = (Math.random() - 0.5) * 900;

        run.animate(piece, [
          { transform: 'translate(0,0) rotate(0deg)', opacity: 1, easing: 'cubic-bezier(.1,.7,.3,1)' },
          { transform: `translate(${px}px, ${py}px) rotate(${spin / 3}deg) rotateX(180deg)`, opacity: 1, offset: 0.35, easing: 'cubic-bezier(.5,0,.9,.6)' },
          { transform: `translate(${px * 1.4}px, ${py + 150}px) rotate(${spin}deg) rotateX(720deg)`, opacity: 0 },
        ], { duration: 1300 + Math.random() * 400, fill: 'forwards' }, () => piece.remove());
      });

      run.settle([{ transform: 'scale(.6)' }, { transform: 'scale(1.45) rotate(-10deg)' }, { transform: 'scale(.95) rotate(4deg)' }, { transform: 'none' }], 520);
    });
  },
};

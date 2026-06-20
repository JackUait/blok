import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../contexts/I18nContext';
import { Button } from '@/components/ui/button';
import {
  CARD_KEYS,
  LAYOUTS,
  VIEW_KEYS,
  SPIN_VIEWS,
  posesForVariant,
  identityPoses,
  type CardKey,
  type Pose,
} from './heroFormations';

/** Build a transform string with a FIXED function order, so the Web Animations API
 *  interpolates each component smoothly between keyframes (a mismatched function list
 *  would make it fall back to a discrete jump). `translateZ` sets the card's depth in
 *  the stack's perspective volume — the basis of the pointer parallax. */
const toTransform = (p: Pose): string =>
  `translate(${p.tx}px, ${p.ty}px) translateZ(${p.tz}px) rotateX(${p.rx}deg) rotateY(${p.ry}deg) ` +
  `rotate(${p.rot}deg) skewX(${p.kx}deg) scale(${p.scale})`;

/** Six-dot drag handle — the universal "grab this block" affordance. */
const BlockHandle: React.FC<{ tone?: 'light' }> = ({ tone }) => (
  <svg
    width="7"
    height="13"
    viewBox="0 0 7 13"
    className={`mt-1 shrink-0 opacity-50 transition-opacity duration-300 group-hover:opacity-90 ${
      tone === 'light' ? 'fill-background/45' : 'fill-muted-foreground/70'
    }`}
  >
    <circle cx="2" cy="2.5" r="1.05" />
    <circle cx="5" cy="2.5" r="1.05" />
    <circle cx="2" cy="6.5" r="1.05" />
    <circle cx="5" cy="6.5" r="1.05" />
    <circle cx="2" cy="10.5" r="1.05" />
    <circle cx="5" cy="10.5" r="1.05" />
  </svg>
);

/* ── Block-type gallery ───────────────────────────────────────────────────────────
 * The hero stack is a rolling tour of Blok's block types. Each non-ring view reveals a
 * different quartet; the bodies below render a recognisable mini-version of each kind. */
type BlockKind =
  | 'heading'
  | 'quote'
  | 'callout'
  | 'todo'
  | 'bulletList'
  | 'numberList'
  | 'toggle'
  | 'image'
  | 'table'
  | 'bookmark'
  | 'bookmarkRich'
  | 'video'
  | 'audio'
  | 'embed'
  | 'embedSocial'
  | 'embedMap'
  | 'columns'
  | 'database'
  | 'code';

const renderBlockBody = (kind: BlockKind): React.ReactNode => {
  switch (kind) {
    case 'heading':
      return (
        <div className="w-full space-y-2">
          <div className="h-3 w-4/5 rounded-md bg-brand-gradient" />
          <div className="h-2 w-full rounded-full bg-muted" />
        </div>
      );
    case 'quote':
      return (
        <div className="flex w-full items-stretch gap-2.5">
          <span className="w-1 shrink-0 rounded-full bg-primary/70" />
          <div className="flex-1 space-y-2">
            <div className="h-2 w-full rounded-full bg-muted-foreground/25" />
            <div className="h-2 w-3/5 rounded-full bg-muted" />
          </div>
        </div>
      );
    case 'callout':
      return (
        <div className="flex w-full items-center gap-2.5 rounded-lg bg-primary/10 px-2.5 py-1.5">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/20 text-primary">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.45.96 1.05 1.1 1.7h5c.14-.65.5-1.25 1.1-1.7A6 6 0 0 0 12 3Z" />
            </svg>
          </span>
          <div className="flex-1 space-y-1.5">
            <div className="h-2 w-full rounded-full bg-primary/30" />
            <div className="h-2 w-2/3 rounded-full bg-primary/20" />
          </div>
        </div>
      );
    case 'todo':
      return (
        <div className="w-full space-y-2.5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-4 shrink-0 items-center justify-center rounded-[5px] bg-primary text-primary-foreground">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span className="h-2 flex-1 rounded-full bg-muted-foreground/25" />
          </div>
          <div className="flex items-center gap-2.5">
            <span className="size-4 shrink-0 rounded-[5px] border-2 border-border" />
            <span className="h-2 w-4/5 rounded-full bg-muted" />
          </div>
        </div>
      );
    case 'bulletList':
      return (
        <div className="w-full space-y-2">
          {['w-full', 'w-4/5', 'w-3/5'].map((w, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/55" />
              <span className={`h-2 rounded-full bg-muted ${w}`} />
            </div>
          ))}
        </div>
      );
    case 'numberList':
      return (
        <div className="w-full space-y-2">
          {['w-full', 'w-3/4', 'w-3/5'].map((w, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <span className="w-2.5 shrink-0 text-center text-[9px] font-bold leading-none text-muted-foreground/60">{i + 1}</span>
              <span className={`h-2 rounded-full bg-muted ${w}`} />
            </div>
          ))}
        </div>
      );
    case 'toggle':
      return (
        <div className="w-full space-y-2">
          <div className="flex items-center gap-2">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground/60">
              <polyline points="9 6 15 12 9 18" />
            </svg>
            <span className="h-2 flex-1 rounded-full bg-muted-foreground/25" />
          </div>
          <span className="ml-[17px] block h-2 w-2/5 rounded-full bg-muted" />
        </div>
      );
    case 'image':
      return (
        <div className="w-full space-y-2.5">
          <div className="relative h-20 w-full overflow-hidden rounded-lg bg-muted">
            <span className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2.5" />
                <circle cx="8.5" cy="9.5" r="1.8" />
                <path d="m4 17 5-4 4 3 3-2 4 3" />
              </svg>
            </span>
          </div>
          <div className="h-2 w-1/2 rounded-full bg-muted" />
        </div>
      );
    case 'table':
      return (
        <div className="w-full overflow-hidden rounded-lg border border-border">
          {[0, 1, 2, 3].map((r) => (
            <div key={r} className={`grid grid-cols-3 ${r < 3 ? 'border-b border-border' : ''}`}>
              {[0, 1, 2].map((c) => (
                <div key={c} className={`flex h-[22px] items-center px-2 ${c < 2 ? 'border-r border-border' : ''} ${r === 0 ? 'bg-muted/60' : ''}`}>
                  <span className={`h-1.5 rounded-full ${r === 0 ? 'w-3/4 bg-muted-foreground/40' : 'w-1/2 bg-muted'}`} />
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    case 'bookmark':
      return (
        <div className="flex w-full items-center gap-3 rounded-lg border border-border p-2.5">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="size-3.5 shrink-0 rounded-full bg-brand-gradient" />
              <span className="h-2 w-2/3 rounded-full bg-muted-foreground/35" />
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted" />
            <div className="h-1.5 w-1/2 rounded-full bg-muted" />
            <div className="h-1.5 w-2/5 rounded-full bg-primary/40" />
          </div>
          <div className="size-[58px] shrink-0 rounded-md bg-muted" />
        </div>
      );
    case 'bookmarkRich':
      return (
        <div className="w-full overflow-hidden rounded-lg border border-border">
          <div className="relative h-11 w-full bg-muted">
            <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-foreground/10 to-transparent" />
          </div>
          <div className="space-y-1.5 px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <span className="size-3 shrink-0 rounded-full bg-brand-gradient" />
              <span className="h-2 w-1/3 rounded-full bg-muted-foreground/35" />
            </div>
            <div className="h-2 w-3/4 rounded-full bg-muted-foreground/25" />
            <div className="h-1.5 w-1/2 rounded-full bg-muted" />
          </div>
        </div>
      );
    case 'video':
      return (
        <div className="w-full space-y-2.5">
          <div className="relative h-20 w-full overflow-hidden rounded-lg bg-muted">
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-9 items-center justify-center rounded-full bg-foreground/70 pl-0.5 text-background">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <polygon points="6 4 20 12 6 20 6 4" />
                </svg>
              </span>
            </span>
          </div>
          <div className="h-2 w-1/2 rounded-full bg-muted" />
        </div>
      );
    case 'audio':
      return (
        <div className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient pl-0.5 text-background">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="6 4 20 12 6 20 6 4" />
            </svg>
          </span>
          <div className="flex-1 space-y-2">
            <div className="h-2 w-2/3 rounded-full bg-muted-foreground/30" />
            {/* a static waveform — the first bars are "played" (brand), the rest pending */}
            <div className="flex h-5 items-center gap-[3px]">
              {[9, 15, 7, 18, 11, 21, 13, 8, 17, 10, 19, 12, 6, 16, 9, 14, 7, 11].map((h, i) => (
                <span
                  key={i}
                  className={`w-[3px] shrink-0 rounded-full ${i < 7 ? 'bg-primary/80' : 'bg-muted-foreground/25'}`}
                  style={{ height: `${h}px` }}
                />
              ))}
            </div>
          </div>
        </div>
      );
    case 'embed':
      return (
        <div className="w-full overflow-hidden rounded-lg border border-border">
          <div className="relative h-[58px] w-full bg-muted">
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-6 w-9 items-center justify-center rounded-md bg-primary pl-0.5 text-primary-foreground">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <polygon points="6 4 20 12 6 20 6 4" />
                </svg>
              </span>
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-2">
            <span className="size-2.5 shrink-0 rounded-full bg-muted-foreground/30" />
            <span className="h-1.5 w-1/2 rounded-full bg-muted" />
          </div>
        </div>
      );
    case 'embedSocial':
      return (
        <div className="w-full space-y-2 rounded-lg border border-border p-2.5">
          <div className="flex items-center gap-2">
            <span className="size-7 shrink-0 rounded-full bg-muted" />
            <div className="flex-1 space-y-1">
              <span className="block h-2 w-1/2 rounded-full bg-muted-foreground/35" />
              <span className="block h-1.5 w-1/3 rounded-full bg-muted" />
            </div>
            <span className="shrink-0 text-primary">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            </span>
          </div>
          <div className="space-y-1.5">
            <div className="h-2 w-full rounded-full bg-muted" />
            <div className="h-2 w-4/5 rounded-full bg-muted" />
          </div>
        </div>
      );
    case 'embedMap':
      return (
        <div className="relative h-[88px] w-full overflow-hidden rounded-lg border border-border bg-muted">
          {/* faux streets + a green block, then a centred location pin */}
          <span className="absolute inset-x-0 top-1/3 h-[3px] bg-card/80" />
          <span className="absolute inset-y-0 left-1/3 w-[3px] bg-card/80" />
          <span className="absolute inset-x-0 bottom-1/4 h-[2px] -rotate-6 bg-card/60" />
          <span className="absolute right-2 top-2 size-6 rounded-[3px] bg-chart-3/30" />
          <span className="absolute bottom-2 left-2 size-5 rounded-[3px] bg-chart-1/20" />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full text-primary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 21s-6-5.7-6-10a6 6 0 0 1 12 0c0 4.3-6 10-6 10z" />
              <circle cx="12" cy="11" r="2.2" fill="white" />
            </svg>
          </span>
        </div>
      );
    case 'columns':
      return (
        <div className="flex w-full gap-2.5">
          {[0, 1].map((col) => (
            <div key={col} className="flex-1 space-y-2 rounded-lg bg-muted/50 p-2">
              <div className="h-2 w-full rounded-full bg-muted" />
              <div className="h-2 w-4/5 rounded-full bg-muted" />
              <div className="h-2 w-3/5 rounded-full bg-muted" />
            </div>
          ))}
        </div>
      );
    case 'database':
      return (
        <div className="w-full overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[1.4fr_1fr] border-b border-border bg-muted/60">
            <div className="flex h-[20px] items-center border-r border-border px-2">
              <span className="h-1.5 w-3/5 rounded-full bg-muted-foreground/40" />
            </div>
            <div className="flex h-[20px] items-center px-2">
              <span className="h-1.5 w-1/2 rounded-full bg-muted-foreground/40" />
            </div>
          </div>
          {['bg-primary/70', 'bg-chart-3', 'bg-chart-4'].map((pill, i) => (
            <div key={i} className={`grid grid-cols-[1.4fr_1fr] ${i < 2 ? 'border-b border-border' : ''}`}>
              <div className="flex h-[20px] items-center border-r border-border px-2">
                <span className="h-1.5 w-3/4 rounded-full bg-muted" />
              </div>
              <div className="flex h-[20px] items-center px-2">
                <span className={`h-2.5 w-2/3 rounded-full ${pill}`} />
              </div>
            </div>
          ))}
        </div>
      );
    case 'code':
      return (
        <div className="w-full space-y-2">
          <div className="flex gap-2">
            <span className="h-2 w-12 rounded-full bg-chart-1" />
            <span className="h-2 flex-1 rounded-full bg-background/20" />
          </div>
          <div className="flex gap-2 pl-4">
            <span className="h-2 w-10 rounded-full bg-chart-4" />
            <span className="h-2 flex-1 rounded-full bg-background/20" />
          </div>
          <div className="flex gap-2 pl-4">
            <span className="h-2 w-16 rounded-full bg-chart-3" />
            <span className="h-2 w-10 rounded-full bg-background/20" />
          </div>
          <div className="flex gap-2">
            <span className="h-2 w-9 rounded-full bg-background/20" />
            <span className="h-2 w-20 rounded-full bg-background/20" />
          </div>
        </div>
      );
  }
};

/** Fixed body height per slot, so swapping block types never changes a card's height —
 *  the formation REST_Y constants stay valid across every set. */
const SLOT_BODY_H: Record<CardKey, string> = { a: 'h-9', b: 'h-[42px]', c: 'h-[98px]', d: 'h-14', e: 'h-16' };

/** The pool of block types each slot may show. On every swap the engine picks a fresh
 *  random kind per slot (never an immediate repeat), so the displayed quartet is an
 *  unpredictable mix rather than a fixed, view-linked set. Pools are grouped by slot so
 *  heights stay constant (the formation REST_Y holds); the dark slot is the code anchor. */
const SLOT_KINDS: Record<CardKey, readonly BlockKind[]> = {
  a: ['heading', 'quote', 'callout'],
  b: ['todo', 'bulletList', 'numberList', 'toggle'],
  c: ['image', 'table', 'bookmarkRich', 'video', 'embed', 'embedSocial', 'embedMap', 'database'],
  d: ['code'],
  e: ['bookmark', 'audio', 'columns'],
};
/** The opening quintet — a clean first impression before the shuffle kicks in. */
const INITIAL_KINDS: readonly BlockKind[] = ['heading', 'todo', 'image', 'code', 'bookmark'];

/** One block card in the stack, built as a 3D SLAB so it has real thickness: the styled
 *  card is the front face, and two extruded side "walls" sit at its left/right edges. When
 *  the card flips edge-on (rotateY → 90° mid-transition) those walls turn to face the
 *  viewer, so you see the solid side of a card — not a flat, zero-thickness sprite.
 *  The slot drives the formation identity (`.hero-card-*`) + fixed height; the kind drives
 *  the content + tone (code = the dark anchor). */
const HeroCard: React.FC<{ slot: CardKey; kind: BlockKind }> = ({ slot, kind }) => {
  const dark = kind === 'code';
  return (
    <div className={`hero-card-${slot} hero-slab`} data-blok-testid="hero-card">
      <span className={`hero-slab-edge hero-slab-edge-l ${dark ? 'hero-slab-edge--dark' : ''}`} aria-hidden="true" />
      <span className={`hero-slab-edge hero-slab-edge-r ${dark ? 'hero-slab-edge--dark' : ''}`} aria-hidden="true" />
      <div
        className={`hero-slab-face flex items-start gap-3 rounded-2xl border p-3.5 shadow-card transition-shadow duration-300 hover:shadow-card-hover ${
          dark ? 'border-foreground/10 bg-foreground' : 'border-border bg-card'
        }`}
      >
        <BlockHandle tone={dark ? 'light' : undefined} />
        <div className={`flex flex-1 flex-col justify-center ${SLOT_BODY_H[slot]}`}>{renderBlockBody(kind)}</div>
      </div>
    </div>
  );
};

export const Hero: React.FC = () => {
  const { t } = useI18n();
  const stackRef = useRef<HTMLAnchorElement>(null);
  // The block type currently rendered in each slot (a→e). The engine reshuffles it on
  // every transition so the visible quintet is a fresh random mix — a tour of Blok's
  // block types that isn't tied to any particular formation.
  const [kinds, setKinds] = useState<readonly BlockKind[]>(INITIAL_KINDS);

  // Formation engine — endlessly re-arranges the hero blocks through a *shuffled*
  // set of views. Each leg bends through a perpendicular waypoint (curved arc, not
  // a straight slide) and orbit-like views spin the whole stack a full turn. Driven
  // here rather than in CSS because the order is randomised every cycle. The per-card
  // `transform` wander (index.css) composes on top via distinct transform properties.
  useEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;

    const prefersReduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const found = CARD_KEYS.map((k) => stack.querySelector<HTMLElement>(`.hero-card-${k}`));
    const els = found.filter((el): el is HTMLElement => el !== null);
    // Bail in reduced-motion and in environments without the Web Animations API (jsdom).
    if (prefersReduced || els.length < CARD_KEYS.length || typeof els[0].animate !== 'function') {
      return;
    }

    const rand = (min: number, max: number): number => min + Math.random() * (max - min);
    const sign = (): number => (Math.random() < 0.5 ? -1 : 1);
    const wait = (ms: number): Promise<void> =>
      new Promise((resolve) => window.setTimeout(resolve, ms));

    let running = true;
    let paused = false;
    let cardAnims: Animation[] = [];
    let stackAnim: Animation | null = null;
    let stackDeg = 0;
    let current = identityPoses();
    let currentView = '__initial__';
    let previousView = '__initial__';

    // Random next view, never the current one and never an immediate echo of the one
    // before — so the sequence reads shuffled, not cyclic.
    const pickNextView = (): string => {
      let view = currentView;
      while (view === currentView || view === previousView) {
        view = VIEW_KEYS[Math.floor(Math.random() * VIEW_KEYS.length)];
      }
      previousView = currentView;
      currentView = view;
      return view;
    };

    // Bake the just-finished pose into inline styles, then drop the old animations so
    // they don't pile up — the next leg starts seamlessly from the committed value.
    const commitAndClear = (): void => {
      for (const a of cardAnims) {
        try {
          a.commitStyles();
        } catch {
          /* element detached mid-teardown */
        }
        a.cancel();
      }
      cardAnims = [];
      if (stackAnim) {
        try {
          stackAnim.commitStyles();
        } catch {
          /* noop */
        }
        stackAnim.cancel();
        stackAnim = null;
      }
    };

    const transitionTo = (next: Pose[], spin: boolean): number => {
      const duration = rand(1300, 1900);
      cardAnims = els.map((el, i) => {
        const a = current[i];
        const b = next[i];
        const dx = b.tx - a.tx;
        const dy = b.ty - a.ty;
        const len = Math.hypot(dx, dy) || 1;
        const s = sign();
        const amp = rand(26, 46);
        const flip = sign(); // each card flips a random direction — organic, not in lock-step
        // A card is "hidden" at either end when it's parked out of this/the previous view
        // (scale ~0). Those legs are an appear/disappear, not a flip-morph — so they grow or
        // shrink cleanly toward the midpoint scale, and the leftover parked↔parked legs never
        // pop into view. Active↔active legs keep the recede-through-the-arc scale dip.
        const aHidden = a.scale < 0.05;
        const bHidden = b.scale < 0.05;
        const hiddenLeg = aHidden || bHidden;
        // Curved waypoint: bow the midpoint perpendicular to the path (an arc, not a
        // straight slide), dip the scale so the block recedes through the curve, and pop it
        // toward the viewer in depth. Crucially, swing rotateY to a steep EDGE-ON angle: at
        // the midpoint the card is a near-invisible sliver, and the engine swaps the block
        // kind exactly then — so the block visibly FLIPS into a different one (a morph),
        // rather than cross-fading. It swings back to the destination tilt showing the new face.
        const waypoint: Pose = {
          tx: (a.tx + b.tx) / 2 + (-dy / len) * amp * s,
          ty: (a.ty + b.ty) / 2 + (dx / len) * amp * s,
          tz: (a.tz + b.tz) / 2 + rand(40, 90),
          rot: (a.rot + b.rot) / 2 + rand(3, 7) * sign(),
          scale: hiddenLeg ? (a.scale + b.scale) / 2 : Math.max(0.4, Math.min(a.scale, b.scale) - 0.05),
          rx: (a.rx + b.rx) / 2,
          // Turn to a STEEP angle, but never the full 90° edge-on — a degenerate sliver is
          // the one orientation that always looks flat/strange. At ~74° the card stays a
          // believable foreshortened slab turning in space (face projected to ~28% width),
          // foreshortened enough to mask the block-kind swap, while a thin slice of the side
          // wall reads as real thickness instead of a paper edge. Appear/disappear legs skip
          // the flip and stay face-on, so a materialising card grows cleanly instead of
          // turning edge-on and flashing its grey side wall.
          ry: hiddenLeg ? (a.ry + b.ry) / 2 : 74 * flip,
          kx: 0,
        };
        // Opacity stays pinned at 1 for active↔active legs — any opacity < 1 would force
        // `transform-style: flat` per the CSS Transforms spec, collapsing the 3D side walls
        // into a paper-thin sliver exactly at the flip. Only appear/disappear legs fade (the
        // card is tiny there, so the brief flattening never shows) so parked cards vanish
        // completely instead of leaving a stray speck.
        const oA = aHidden ? 0 : 1;
        const oB = bHidden ? 0 : 1;
        const oMid = hiddenLeg ? 0.35 : 1;
        return el.animate(
          [
            { transform: toTransform(a), opacity: oA, easing: 'cubic-bezier(0.4, 0.05, 0.55, 0.95)' },
            { transform: toTransform(waypoint), opacity: oMid, offset: 0.5, easing: 'cubic-bezier(0.34, 1.15, 0.5, 1)' },
            { transform: toTransform(b), opacity: oB },
          ],
          { duration, fill: 'forwards' }
        );
      });

      const fromDeg = stackDeg;
      stackDeg = spin ? stackDeg + 360 : Math.round(stackDeg / 360) * 360;
      if (fromDeg !== stackDeg) {
        // Spin the orbit on the individual `rotate` property (not `transform`) so it
        // composes with the pointer-parallax tilt that lives on `transform`.
        stackAnim = stack.animate(
          [{ rotate: `${fromDeg}deg` }, { rotate: `${stackDeg}deg` }],
          {
            duration: spin ? duration + 700 : duration,
            fill: 'forwards',
            easing: spin ? 'cubic-bezier(0.45, 0.05, 0.55, 0.95)' : 'ease-in-out',
          }
        );
      }
      return duration;
    };

    let curKinds = INITIAL_KINDS.slice();
    let swapTimer = 0;
    void (async (): Promise<void> => {
      await wait(1500); // let the static stack read before it comes alive
      while (running) {
        while (paused && running) await wait(120);
        if (!running) break;
        commitAndClear();
        const view = pickNextView();
        const counts = Object.keys(LAYOUTS[view]).map(Number);
        const count = counts[Math.floor(Math.random() * counts.length)];
        const variants = LAYOUTS[view][count];
        const variant = variants[Math.floor(Math.random() * variants.length)];
        const next = posesForVariant(variant);
        const duration = transitionTo(next, SPIN_VIEWS.has(view));
        // Reshuffle the blocks at the transition midpoint — exactly when the cards blink to
        // their dimmest — so the fresh, random quintet only emerges as they fade back in.
        // Each slot draws a new kind from its own pool, never repeating its current one.
        swapTimer = window.setTimeout(() => {
          if (!running) return;
          curKinds = CARD_KEYS.map((slot, i) => {
            const pool = SLOT_KINDS[slot];
            if (pool.length < 2) return pool[0];
            let k = curKinds[i];
            while (k === curKinds[i]) k = pool[Math.floor(Math.random() * pool.length)];
            return k;
          });
          setKinds(curKinds);
        }, duration / 2);
        try {
          await Promise.all(cardAnims.map((a) => a.finished));
        } catch {
          /* cancelled on teardown */
        }
        if (!running) break;
        current = next;
        await wait(rand(2100, 3300)); // hold the formation — fewer, bolder views earn a longer beat
      }
    })();

    // Hover freezes the formation in place so a reader can study the blocks — while the
    // pointer still drives the parallax tilt, so you can lean the frozen scene around.
    const onEnter = (): void => {
      paused = true;
      for (const a of cardAnims) if (a.playState === 'running') a.pause();
      if (stackAnim && stackAnim.playState === 'running') stackAnim.pause();
    };
    const onLeave = (): void => {
      paused = false;
      for (const a of cardAnims) if (a.playState === 'paused') a.play();
      if (stackAnim && stackAnim.playState === 'paused') stackAnim.play();
      // Ease the tilt back to rest when the pointer leaves.
      stack.style.setProperty('--hero-tilt-x', '0deg');
      stack.style.setProperty('--hero-tilt-y', '0deg');
    };
    // Parallax: tilt the whole stack toward the pointer. Because each card sits at its
    // own translateZ in the perspective volume, near and far cards shift by different
    // amounts under the tilt — true depth parallax, not a flat sway. CSS reads the two
    // custom properties in `.hero-stack { transform: rotateX(var) rotateY(var) }`.
    const TILT_MAX = 13; // degrees at the edge
    const onMove = (e: MouseEvent): void => {
      const r = stack.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
      stack.style.setProperty('--hero-tilt-y', `${clamp(dx) * TILT_MAX}deg`);
      stack.style.setProperty('--hero-tilt-x', `${clamp(-dy) * TILT_MAX}deg`);
    };
    stack.addEventListener('mouseenter', onEnter);
    stack.addEventListener('mouseleave', onLeave);
    stack.addEventListener('mousemove', onMove);

    return () => {
      running = false;
      window.clearTimeout(swapTimer);
      stack.removeEventListener('mouseenter', onEnter);
      stack.removeEventListener('mouseleave', onLeave);
      stack.removeEventListener('mousemove', onMove);
      for (const a of cardAnims) a.cancel();
      if (stackAnim) stackAnim.cancel();
    };
  }, []);

  const handleScrollToQuickStart = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    const target = document.getElementById('quick-start');
    target?.scrollIntoView({ behavior: 'auto' });
  };

  return (
    <section className="relative overflow-hidden pt-28 pb-16 sm:pt-32 sm:pb-24">
      {/* Soft brand wash backdrop */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <div className="absolute -top-32 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute right-[-8rem] top-24 size-[24rem] rounded-full bg-chart-3/10 blur-3xl" />
        {/* faint dotted grid — gives the empty space texture without noise */}
        <div className="absolute inset-0 opacity-[0.4] [background-image:radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]" />
      </div>

      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="text-center lg:text-left" data-blok-testid="hero-content">
          <h1 className="animate-in fade-in slide-in-from-bottom-3 fill-mode-both text-4xl font-extrabold leading-[1.05] tracking-tight duration-700 sm:text-5xl lg:text-6xl">
            {t('home.hero.title')}
            <br />
            <span className="text-brand-gradient">{t('home.hero.titleGradient')}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground duration-700 animate-in fade-in slide-in-from-bottom-3 fill-mode-both delay-100 lg:mx-0">
            {t('home.hero.description')}
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 duration-700 animate-in fade-in slide-in-from-bottom-3 fill-mode-both delay-200 sm:flex-row lg:justify-start">
            <Button variant="brand" size="lg" asChild>
              <a href="#quick-start" onClick={handleScrollToQuickStart}>
                {t('home.hero.ctaGetStarted')}
              </a>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link to="/demo">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                {t('home.hero.ctaTryItOut')}
              </Link>
            </Button>
          </div>
        </div>

        <div className="relative flex justify-center lg:justify-end" data-blok-testid="hero-demo">
          <div className="hero-float group relative duration-1000 animate-in fade-in zoom-in-95 fill-mode-both delay-150">
            {/* the noodle sunset blooms behind the stack */}
            <div
              className="hero-blob pointer-events-none absolute -inset-8 -z-10 bg-brand-gradient opacity-25 blur-3xl transition-opacity duration-500 group-hover:opacity-40"
              aria-hidden="true"
            />

            {/* Everything is a block — a loose stack of real block types, each with its
                own drag handle. The whole stack endlessly re-choreographs itself through a
                curated set of bold gestures — exploded view, diagonal cascade, spinning
                orbit, resting list — and each card flips edge-on mid-move to morph into a
                different block type, so the quintet keeps changing. The dark
                code block anchors the bottom. Hover freezes the formation; the stack opens
                the playground. */}
            <Link
              ref={stackRef}
              to="/demo"
              className="hero-stack relative flex w-72 max-w-full flex-col gap-3.5 sm:w-80"
              aria-label={t('home.hero.mascotAriaLabel')}
            >
              {/* Five block cards — each slot shows a random block kind, reshuffled per
                  transition (a tour of capabilities); the slot keeps each card's formation
                  identity + height stable. */}
              {CARD_KEYS.map((slot, i) => (
                <HeroCard key={slot} slot={slot} kind={kinds[i]} />
              ))}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
};

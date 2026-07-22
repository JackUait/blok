import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from '../common/Link';
import { useI18n } from '../../contexts/I18nContext';
import { Typo } from '../common/Typo';
import { Button } from '@/components/ui/button';
import {
  CARD_KEYS,
  LAYOUTS,
  SPIN_VIEWS,
  TRANSIT_Z,
  posesForVariant,
  pickNextAnimation,
  createKindSequencer,
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
const BlockHandle: React.FC = () => (
  <svg
    width="7"
    height="13"
    viewBox="0 0 7 13"
    className="mt-1 shrink-0 fill-muted-foreground/70 opacity-50 transition-opacity duration-300 group-hover:opacity-90"
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
    // Big title — a subtle "H1" level tag + a warm brand-gradient title bar (the only gradient
    // bar in the set), so a heading reads as a prominent title without a heavy black slab.
    case 'heading':
      return (
        <div className="flex w-full items-center gap-2.5">
          <span className="shrink-0 text-xs font-bold leading-none text-muted-foreground/55">H1</span>
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-4/5 rounded-full bg-brand-gradient" />
            <div className="hero-type h-1.5 w-1/2 rounded-full bg-muted" />
          </div>
        </div>
      );
    // A big curly quotation mark + italic-slanted (skewed) text against a coral rule —
    // unmistakably a pull-quote, not a plain bar group.
    case 'quote':
      return (
        <div className="flex w-full items-start gap-2">
          <span className="-mt-2 font-serif text-[34px] leading-none text-primary/40" aria-hidden="true">
            &ldquo;
          </span>
          <div className="mt-1 flex-1 space-y-2">
            <div className="hero-pulse h-2 w-full -skew-x-12 rounded-full bg-muted-foreground/30" />
            <div className="h-2 w-2/3 -skew-x-12 rounded-full bg-muted" />
          </div>
        </div>
      );
    // Coral-tinted notice panel + lightbulb with matching coral text lines — the one filled
    // block in its slot. (Coral, not grey: grey bars looked muddy on the pink fill.)
    case 'callout':
      return (
        <div className="flex w-full items-center gap-2.5 rounded-lg bg-primary/10 px-2.5 py-1.5">
          <span className="hero-pulse flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/20 text-primary">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.45.96 1.05 1.1 1.7h5c.14-.65.5-1.25 1.1-1.7A6 6 0 0 0 12 3Z" />
            </svg>
          </span>
          <div className="flex-1 space-y-1.5">
            <div className="h-2 w-full rounded-full bg-primary/35" />
            <div className="h-2 w-2/3 rounded-full bg-primary/25" />
          </div>
        </div>
      );
    // Square checkboxes — one ticked (coral), one completing itself on a loop.
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
            {/* this one completes itself on a loop — box fills, tick draws, then resets */}
            <span className="hero-check-box flex size-4 shrink-0 items-center justify-center rounded-[5px] border-2 border-border text-primary-foreground">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline className="hero-check-draw" points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span className="h-2 w-4/5 rounded-full bg-muted" />
          </div>
        </div>
      );
    // Round coral bullets — distinct from todo's squares.
    case 'bulletList':
      return (
        <div className="w-full space-y-2">
          {['w-full', 'w-4/5', 'w-3/5'].map((w, i) => (
            <div key={i} className="hero-pulse flex items-center gap-2.5" style={{ animationDelay: `${i * 0.32}s` }}>
              <span className="size-1.5 shrink-0 rounded-full bg-primary/70" />
              <span className={`h-2 rounded-full bg-muted ${w}`} />
            </div>
          ))}
        </div>
      );
    // Amber ordinals "1. 2. 3." — distinct from bullet dots and the toggle.
    case 'numberList':
      return (
        <div className="w-full space-y-2">
          {['w-full', 'w-3/4', 'w-3/5'].map((w, i) => (
            <div key={i} className="hero-pulse flex items-center gap-2.5" style={{ animationDelay: `${i * 0.32}s` }}>
              <span className="w-3 shrink-0 text-right text-[10px] font-bold leading-none text-chart-2">{i + 1}.</span>
              <span className={`h-2 rounded-full bg-muted ${w}`} />
            </div>
          ))}
        </div>
      );
    // Disclosure triangle + an INDENTED nested body hanging off a left rule — reads as collapsible.
    case 'toggle':
      return (
        <div className="w-full space-y-2">
          <div className="flex items-center gap-2">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="hero-chevron shrink-0 text-foreground/55">
              <polyline points="9 6 15 12 9 18" />
            </svg>
            <span className="h-2.5 flex-1 rounded-full bg-muted-foreground/30" />
          </div>
          <div className="ml-[5px] space-y-1.5 border-l-2 border-border pl-3">
            <span className="block h-2 w-4/5 rounded-full bg-muted" />
            <span className="block h-2 w-3/5 rounded-full bg-muted" />
          </div>
        </div>
      );
    // A real-looking PHOTO — warm gradient sky, a sun and a mountain range — not a grey box.
    case 'image':
      return (
        <div className="w-full space-y-2">
          <div className="relative h-[70px] w-full overflow-hidden rounded-lg bg-gradient-to-b from-chart-4/25 to-primary/15">
            <span className="absolute right-4 top-3 size-4 rounded-full bg-chart-4/70" />
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-2/3 w-full text-muted-foreground/30" fill="currentColor" aria-hidden="true">
              <path d="M0 40 L26 14 L44 32 L62 8 L82 30 L100 18 L100 40 Z" />
            </svg>
          </div>
          <div className="h-1.5 w-1/3 rounded-full bg-muted" />
        </div>
      );
    // Plain data grid with a header row — uniform cells, no colour (vs the database's tags).
    case 'table':
      return (
        <div className="w-full overflow-hidden rounded-lg border border-border">
          {[0, 1, 2, 3].map((r) => (
            <div key={r} className={`grid grid-cols-3 ${r < 3 ? 'border-b border-border' : ''}`}>
              {[0, 1, 2].map((c) => (
                <div key={c} className={`flex h-[22px] items-center px-2 ${c < 2 ? 'border-r border-border' : ''} ${r === 0 ? 'bg-muted/60' : ''}`}>
                  <span
                    className={`h-1.5 rounded-full ${r === 0 ? 'w-3/4 bg-muted-foreground/40' : 'hero-pulse w-1/2 bg-muted'}`}
                    style={r === 0 ? undefined : { animationDelay: `${r * 0.22 + c * 0.08}s` }}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    // Horizontal link card — favicon + title + url, with a thumbnail pinned right.
    case 'bookmark':
      return (
        <div className="flex w-full items-center gap-3 rounded-lg border border-border p-2.5">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="hero-pulse size-3.5 shrink-0 rounded-full bg-brand-gradient" />
              <span className="h-2 w-2/3 rounded-full bg-muted-foreground/35" />
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted" />
            <div className="h-1.5 w-1/2 rounded-full bg-muted" />
            <div className="flex items-center gap-1 pt-0.5">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-primary/60">
                <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
                <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19" />
              </svg>
              <span className="h-1.5 w-2/5 rounded-full bg-primary/40" />
            </div>
          </div>
          <div className="size-[58px] shrink-0 rounded-md bg-gradient-to-br from-muted to-secondary" />
        </div>
      );
    // Vertical preview card — full-width image header, then favicon + title + description below.
    case 'bookmarkRich':
      return (
        <div className="w-full overflow-hidden rounded-lg border border-border">
          <div className="h-11 w-full bg-gradient-to-br from-primary/15 to-chart-4/20" />
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
    // Dark cinematic thumbnail with a play button AND a scrubber + filled progress — clearly video.
    case 'video':
      return (
        <div className="w-full space-y-2">
          <div className="relative h-[82px] w-full overflow-hidden rounded-lg bg-foreground/85">
            {/* play sits in the area ABOVE the scrubber so the two don't crowd each other */}
            <span className="absolute inset-x-0 top-0 bottom-5 flex items-center justify-center">
              <span className="hero-pop flex size-8 items-center justify-center rounded-full bg-background/90 pl-0.5 text-foreground">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <polygon points="6 4 20 12 6 20 6 4" />
                </svg>
              </span>
            </span>
            {/* transport scrubber pinned to the bottom edge */}
            <span className="absolute inset-x-2.5 bottom-2.5 h-1 rounded-full bg-background/25">
              <span className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-primary" />
              <span className="absolute -top-1 left-2/5 size-3 -translate-x-1/2 rounded-full bg-primary shadow-sm" />
            </span>
          </div>
          <div className="h-1.5 w-1/2 rounded-full bg-muted" />
        </div>
      );
    // Rounded "player" pill — gradient play disc + a live equaliser.
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
            {/* a live equaliser — the first bars are "played" (brand), the rest pending; each
                bar rises and falls on an offset cycle so the waveform reads as now-playing */}
            <div className="flex h-5 items-center gap-[3px]">
              {[9, 15, 7, 18, 11, 21, 13, 8, 17, 10, 19, 12, 6, 16, 9, 14, 7, 11].map((h, i) => (
                <span
                  key={i}
                  className={`hero-eq-bar w-[3px] shrink-0 rounded-full ${i < 7 ? 'bg-primary/80' : 'bg-muted-foreground/25'}`}
                  style={{ height: `${h}px`, animationDelay: `${-((i % 7) * 0.13)}s`, animationDuration: `${0.9 + (i % 4) * 0.12}s` }}
                />
              ))}
            </div>
          </div>
        </div>
      );
    // Embedded iframe — a browser chrome bar (traffic lights + URL) over a framed play area.
    case 'embed':
      return (
        <div className="w-full overflow-hidden rounded-lg border border-border">
          <div className="flex items-center gap-1.5 border-b border-border bg-muted/50 px-2.5 py-1.5">
            <span className="size-2 shrink-0 rounded-full bg-chart-3/60" />
            <span className="size-2 shrink-0 rounded-full bg-chart-4/70" />
            <span className="size-2 shrink-0 rounded-full bg-muted-foreground/30" />
            <span className="ml-1.5 h-2 flex-1 rounded-full bg-card" />
          </div>
          <div className="relative flex h-[54px] items-center justify-center bg-muted/30">
            <span className="hero-pop flex h-6 w-9 items-center justify-center rounded-md bg-primary pl-0.5 text-primary-foreground">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
            </span>
          </div>
        </div>
      );
    // Social post — round gradient avatar, handle, platform glyph, and a like/reply engagement row.
    case 'embedSocial':
      return (
        <div className="w-full space-y-2 rounded-lg border border-border p-2.5">
          <div className="flex items-center gap-2">
            <span className="size-7 shrink-0 rounded-full bg-brand-gradient" />
            <div className="flex-1 space-y-1">
              <span className="block h-2 w-1/2 rounded-full bg-muted-foreground/40" />
              <span className="block h-1.5 w-1/3 rounded-full bg-muted" />
            </div>
            <span className="hero-pulse shrink-0 text-primary">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            </span>
          </div>
          <div className="space-y-1.5">
            <div className="h-2 w-full rounded-full bg-muted" />
            <div className="h-2 w-4/5 rounded-full bg-muted" />
          </div>
          <div className="flex items-center gap-3 pt-0.5">
            <span className="flex items-center gap-1 text-primary/70">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
              <span className="h-1.5 w-5 rounded-full bg-muted" />
            </span>
            <span className="flex items-center gap-1 text-muted-foreground/50">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              <span className="h-1.5 w-4 rounded-full bg-muted" />
            </span>
          </div>
        </div>
      );
    case 'embedMap':
      return (
        <div className="relative h-[88px] w-full overflow-hidden rounded-lg border border-border bg-muted">
          {/* faux streets + land blocks, then a centred location pin */}
          <span className="absolute inset-x-0 top-1/3 h-[3px] bg-card/80" />
          <span className="absolute inset-y-0 left-1/3 w-[3px] bg-card/80" />
          <span className="absolute inset-x-0 bottom-1/4 h-[2px] -rotate-6 bg-card/60" />
          <span className="absolute right-2 top-2 size-6 rounded-[3px] bg-chart-3/30" />
          <span className="absolute bottom-2 left-2 size-5 rounded-[3px] bg-chart-1/20" />
          <span className="hero-pin absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full text-primary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 21s-6-5.7-6-10a6 6 0 0 1 12 0c0 4.3-6 10-6 10z" />
              <circle cx="12" cy="11" r="2.2" fill="white" />
            </svg>
          </span>
        </div>
      );
    // Two side-by-side mini-pages, each with its own little heading — a layout, not a list.
    case 'columns':
      return (
        <div className="flex w-full gap-2.5">
          {[0, 1].map((col) => (
            <div key={col} className="hero-pulse flex-1 space-y-1.5 rounded-lg border border-border/70 bg-muted/40 p-2" style={{ animationDelay: `${col * 0.6}s` }}>
              <div className={`h-2 rounded-full bg-muted-foreground/30 ${col === 0 ? 'w-3/5' : 'w-1/2'}`} />
              <div className="h-1.5 w-full rounded-full bg-muted" />
              <div className="h-1.5 w-4/5 rounded-full bg-muted" />
              <div className="h-1.5 w-3/5 rounded-full bg-muted" />
            </div>
          ))}
        </div>
      );
    // Database table — header with a view title + coloured STATUS TAG pills per row (the colour
    // is what sets it apart from the plain table).
    case 'database':
      return (
        <div className="w-full overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[1.4fr_1fr] border-b border-border bg-muted/60">
            <div className="flex h-[20px] items-center gap-1.5 border-r border-border px-2">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground/50">
                <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
              </svg>
              <span className="h-1.5 w-1/2 rounded-full bg-muted-foreground/40" />
            </div>
            <div className="flex h-[20px] items-center px-2">
              <span className="h-1.5 w-1/2 rounded-full bg-muted-foreground/40" />
            </div>
          </div>
          {[
            { tint: 'bg-primary/15', text: 'text-primary' },
            { tint: 'bg-chart-3/15', text: 'text-chart-3' },
            { tint: 'bg-chart-4/20', text: 'text-chart-4' },
          ].map((tag, i) => (
            <div key={i} className={`grid grid-cols-[1.4fr_1fr] ${i < 2 ? 'border-b border-border' : ''}`}>
              <div className="flex h-[20px] items-center border-r border-border px-2">
                <span className="h-1.5 w-3/4 rounded-full bg-muted" />
              </div>
              <div className="flex h-[20px] items-center px-2">
                <span className={`hero-pulse flex h-3 w-2/3 items-center gap-1 rounded-full px-1.5 ${tag.tint} ${tag.text}`} style={{ animationDelay: `${i * 0.3}s` }}>
                  <span className="size-1.5 shrink-0 rounded-full bg-current" />
                  <span className="h-1 flex-1 rounded-full bg-current opacity-50" />
                </span>
              </div>
            </div>
          ))}
        </div>
      );
    // Code — a line-number gutter beside coral/amber syntax tokens and a blinking caret.
    case 'code':
      return (
        <div className="flex w-full gap-2.5">
          <div className="flex w-3 shrink-0 flex-col items-end gap-1.5 pt-px text-[8px] font-bold leading-none text-muted-foreground/40">
            <span>1</span><span>2</span><span>3</span><span>4</span>
          </div>
          <div className="flex-1 space-y-1.5">
            <div className="flex gap-2">
              <span className="h-2 w-12 rounded-full bg-chart-1" />
              <span className="h-2 flex-1 rounded-full bg-muted-foreground/25" />
            </div>
            <div className="flex gap-2 pl-4">
              <span className="h-2 w-10 rounded-full bg-chart-4" />
              <span className="h-2 flex-1 rounded-full bg-muted-foreground/25" />
            </div>
            <div className="flex gap-2 pl-4">
              <span className="h-2 w-16 rounded-full bg-chart-3" />
              <span className="h-2 w-10 rounded-full bg-muted-foreground/25" />
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-9 rounded-full bg-muted-foreground/25" />
              <span className="h-2 w-16 rounded-full bg-muted-foreground/25" />
              {/* a blinking insertion caret — the code block reads as a live editor */}
              <span className="hero-caret h-3.5 w-[2px] shrink-0 rounded-[1px] bg-foreground/70" />
            </div>
          </div>
        </div>
      );
  }
};

/** Fixed body height per slot, so swapping block types never changes a card's height —
 *  the formation REST_Y constants stay valid across every set. */
const SLOT_BODY_H: Record<CardKey, string> = { a: 'h-9', b: 'h-[42px]', c: 'h-[98px]', d: 'h-14' };

/** The pool of block types each slot may show. On every swap the engine deals the next kind
 *  per slot from a shuffle bag (`createKindSequencer`) — every kind in a slot's pool appears
 *  once before any repeats, so each block gets equal, evenly-spaced airtime rather than some
 *  clustering while others go unseen. Pools are grouped by slot so heights stay constant
 *  (the formation REST_Y holds). Slot `d` is always on screen (it's in every formation), so
 *  it gets a varied medium-height pool — code is just one of its options, not a fixture on
 *  every loop. The big media slot `c` also carries the rich blocks that used to live in the
 *  retired 5th slot (bookmark/audio/columns), so no block-type design is lost. */
export const SLOT_KINDS: Record<CardKey, readonly BlockKind[]> = {
  a: ['heading', 'quote', 'callout'],
  b: ['todo', 'bulletList'],
  c: ['image', 'table', 'bookmarkRich', 'video', 'embed', 'embedSocial', 'embedMap', 'database', 'bookmark', 'audio', 'columns'],
  d: ['code', 'toggle', 'numberList'],
};
/** The opening quartet — a clean first impression before the shuffle kicks in. */
const INITIAL_KINDS: readonly BlockKind[] = ['heading', 'todo', 'image', 'code'];

/** The opening formation — the calm four-card resting column (the full {a,b,c,d} set). */
const OPENING_VARIANT = LAYOUTS.stack[4][0];

/** One block card in the stack, built as a 3D SLAB so it has real thickness: the styled
 *  card is the front face, and two extruded side "walls" sit at its left/right edges. When
 *  the card flips edge-on (rotateY → 90° mid-transition) those walls turn to face the
 *  viewer, so you see the solid side of a card — not a flat, zero-thickness sprite.
 *  The slot drives the formation identity (`.hero-card-*`) + fixed height; the kind drives
 *  the content. Every card (code included) uses the themed card surface, so it's white in the
 *  light theme and dark in the dark theme — the code block reads by its syntax colours, not by
 *  an inverted background. */
const HeroCard: React.FC<{ slot: CardKey; kind: BlockKind }> = ({ slot, kind }) => {
  return (
    <div className={`hero-card-${slot} hero-slab`} data-blok-testid="hero-card">
      <span className="hero-slab-edge hero-slab-edge-l" aria-hidden="true" />
      <span className="hero-slab-edge hero-slab-edge-r" aria-hidden="true" />
      <div className="hero-slab-face flex items-start gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-card transition-shadow duration-300 hover:shadow-card-hover">
        <BlockHandle />
        <div className={`flex flex-1 flex-col justify-center ${SLOT_BODY_H[slot]}`}>{renderBlockBody(kind)}</div>
      </div>
    </div>
  );
};

export const Hero: React.FC = () => {
  const { t } = useI18n();
  const stackRef = useRef<HTMLAnchorElement>(null);
  // The block type currently rendered in each slot (a→d). The engine reshuffles it on
  // every transition so the visible set is a fresh random mix — a tour of Blok's
  // block types that isn't tied to any particular formation.
  const [kinds, setKinds] = useState<readonly BlockKind[]>(INITIAL_KINDS);

  // Formation engine — endlessly re-arranges the hero blocks through a *shuffled*
  // set of views. Each leg bends through a perpendicular waypoint (curved arc, not
  // a straight slide) and orbit-like views spin the whole stack a full turn. Driven
  // here rather than in CSS because the order is randomised every cycle. The per-card
  // `transform` wander (index.css) composes on top via distinct transform properties.
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;

    const prefersReduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const found = CARD_KEYS.map((k) => stack.querySelector<HTMLElement>(`.hero-card-${k}`));
    const els = found.filter((el): el is HTMLElement => el !== null);

    // Seat the stack on its opening four-card formation before the first paint, so the
    // cards start in the authored stack@4 column rather than their raw flex-flow positions.
    // Applied even when the loop below bails, so reduced-motion and no-WAAPI environments
    // still rest on the composed formation.
    const openingPoses = posesForVariant(OPENING_VARIANT);
    found.forEach((el, i) => {
      if (!el) return;
      el.style.transform = toTransform(openingPoses[i]);
      el.style.opacity = openingPoses[i].scale < 0.05 ? '0' : '1';
    });

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
    let current = openingPoses;
    // The previous animation (view + the view before it + count), so the picker can guarantee
    // the next one never repeats the last gesture or block count — no animation twice in a row.
    let prevPick: { view: string; viewBefore: string; count: number } | null = null;

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
        // straight slide), dip the scale so the block recedes through the curve, and float it
        // toward the viewer on its depth lane. Crucially, swing rotateY to a steep EDGE-ON
        // angle: at the midpoint the card is a near-invisible sliver, and the engine swaps the
        // block kind exactly then — so the block visibly FLIPS into a different one (a morph),
        // rather than cross-fading. It swings back to the destination tilt showing the new face.
        const waypoint: Pose = {
          tx: (a.tx + b.tx) / 2 + (-dy / len) * amp * s,
          ty: (a.ty + b.ty) / 2 + (dx / len) * amp * s,
          // Each card rides its own depth lane through the bunched-up midpoint, so two cards
          // crossing the same screen region are always depth-sorted — one slab slides cleanly
          // OVER another instead of interpenetrating. (Resting formations keep their authored
          // depth; this only governs the waypoint where the paths converge.)
          tz: TRANSIT_Z[CARD_KEYS[i]],
          rot: (a.rot + b.rot) / 2 + rand(3, 7) * sign(),
          // Genuinely recede mid-arc: two big neighbouring cards (e.g. the tall media card and
          // the code block) swap slots by crossing the centre, so if they stayed near full size
          // they'd visibly collide. Shrinking them well down at the waypoint — on top of the
          // edge-on flip and the depth-lane occlusion — keeps the crossing reading as cards
          // swooping back and past each other, not slabs ramming together. Appear/disappear legs
          // grow/shrink cleanly at their own (collision-free) slot, so they keep the gentle mid scale.
          scale: hiddenLeg
            ? (a.scale + b.scale) / 2
            : Math.max(0.42, Math.min(a.scale, b.scale) - 0.34),
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

    // Deal kinds from a per-slot shuffle bag (not independent random draws), so every block in
    // a slot's pool gets equal, evenly-spaced airtime instead of some clustering while others go
    // unseen. Seed it with the opening quartet so the first swap already differs from it.
    const opening: Partial<Record<CardKey, BlockKind>> = {
      a: INITIAL_KINDS[0],
      b: INITIAL_KINDS[1],
      c: INITIAL_KINDS[2],
      d: INITIAL_KINDS[3],
    };
    const sequencer = createKindSequencer(SLOT_KINDS, Math.random, opening);
    let swapTimer = 0;
    void (async (): Promise<void> => {
      await wait(1500); // let the static stack read before it comes alive
      while (running) {
        while (paused && running) await wait(120);
        if (!running) break;
        commitAndClear();
        const viewBefore: string = prevPick?.view ?? '__initial__';
        const { view, count, variantIndex } = pickNextAnimation(prevPick, Math.random);
        prevPick = { view, viewBefore, count };
        const variant = LAYOUTS[view][count][variantIndex];
        stack.dataset.heroAnim = `${view}@${count}#${variantIndex}`;
        const next = posesForVariant(variant);
        const duration = transitionTo(next, SPIN_VIEWS.has(view));
        // Reshuffle the blocks at the transition midpoint — exactly when the cards blink to
        // their dimmest — so the fresh, random mix only emerges as they fade back in.
        // Each slot draws a new kind from its own pool, never repeating its current one.
        swapTimer = window.setTimeout(() => {
          if (!running) return;
          const dealt = sequencer.next();
          setKinds(CARD_KEYS.map((slot) => dealt[slot]));
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
            <Typo>{t('home.hero.title')}</Typo>
            <br />
            <span className="text-brand-gradient"><Typo>{t('home.hero.titleGradient')}</Typo></span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground duration-700 animate-in fade-in slide-in-from-bottom-3 fill-mode-both delay-100 lg:mx-0">
            <Typo>{t('home.hero.description')}</Typo>
          </p>
          <div className="mt-9 hidden flex-col items-center justify-center gap-3 duration-700 animate-in fade-in slide-in-from-bottom-3 fill-mode-both delay-200 sm:flex sm:flex-row lg:justify-start">
            <Button variant="brand" size="lg" asChild>
              <Link to="/docs"><Typo>{t('home.hero.ctaGetStarted')}</Typo></Link>
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
                <Typo>{t('home.hero.ctaTryItOut')}</Typo>
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
                different block type, so the set keeps changing. The code block
                anchors the bottom. Hover freezes the formation; the stack opens
                the playground. */}
            <Link
              ref={stackRef}
              to="/demo"
              className="hero-stack relative flex w-72 max-w-full flex-col gap-3.5 sm:w-80"
              aria-label={t('home.hero.mascotAriaLabel')}
            >
              {/* Four block cards — each slot shows a random block kind, reshuffled per
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

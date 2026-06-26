import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useSpring,
  type Variants,
} from "framer-motion";
import { SectionReveal } from "../common/SectionReveal";
import { FeatureModal, type FeatureDetail } from "./FeatureModal";
import { EMBED_SERVICES, type EmbedService } from "./embed-services";
import { useI18n } from "../../contexts/I18nContext";

// The capabilities below the pillars rise, scale up and de-blur in sequence as
// the mosaic scrolls into view — the Apple bento "develops" rather than popping.
const gridVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.96, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: { type: "spring", stiffness: 240, damping: 26 },
  },
};

// Each pillar springs up to full size as it becomes the focused card in the
// mobile carousel, and rests slightly smaller + dimmed while it's a peeking
// neighbour. On the desktop bento every card is in view at once, so they all
// sit focused.
const pillarVariants: Variants = {
  unfocused: { scale: 0.88, opacity: 0.5 },
  focused: {
    scale: 1,
    opacity: 1,
    transition: { type: "spring", stiffness: 260, damping: 26 },
  },
};

// Bouncy spring for hover lift + tap feedback — a touch of overshoot gives the
// tiles a playful, alive feel without feeling sluggish.
const hoverSpring = { type: "spring", stiffness: 380, damping: 20 } as const;

// The peak tilt, in degrees, a tile leans toward the cursor.
const TILT = 5;

// Cursor-reactive 3D tilt + specular glow — the Apple bento signature. The tilt
// rides framer springs (so it eases in and recoils on leave) and the glow is a
// CSS radial fed the pointer position through --mx/--my. Pointer-fine + motion
// only: touch carousels and reduced-motion users get a flat, still tile.
const useTilt = () => {
  const reduce = useReducedMotion();
  const rotateX = useSpring(0, { stiffness: 170, damping: 18, mass: 0.4 });
  const rotateY = useSpring(0, { stiffness: 170, damping: 18, mass: 0.4 });

  if (reduce) {
    return { style: undefined, handlers: {} as Record<string, never> };
  }

  return {
    style: { rotateX, rotateY, transformPerspective: 1000 },
    handlers: {
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        if (e.pointerType !== "mouse") return;
        const el = e.currentTarget;
        const rect = el.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;
        rotateX.set((0.5 - py) * TILT * 2);
        rotateY.set((px - 0.5) * TILT * 2);
        el.style.setProperty("--mx", `${px * 100}%`);
        el.style.setProperty("--my", `${py * 100}%`);
      },
      onPointerLeave: () => {
        rotateX.set(0);
        rotateY.set(0);
      },
    },
  };
};

/* ============================================================================
   Tile visuals — each bento cell carries a little hand-built diorama of what the
   feature actually DOES, instead of a lone glyph. Everything is drawn from the
   shared design tokens (--card, --secondary, --border, --brand-*), so each tile
   flips with the light/dark site toggle, and each runs one slow loop so the
   mosaic reads as alive. All decorative, so the wrappers are aria-hidden and the
   surrounding <button> owns the accessible label.
   ========================================================================== */

// The showpiece: Blok's headless output rendered as a tiny syntax-lit editor
// pane with a live caret, lit by a warm brand glow bleeding in from the corner.
const CleanJsonViz: React.FC = () => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<HTMLSpanElement>(null);
  const dividerRef = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();

  // Light the editor's border where the tile's glow blob touches it — driven off
  // the whole tile (not just the pane) so the edge reacts to the blob, not the
  // bare cursor, matching the chip-grid behaviour. Both the outer ring and the
  // inner header divider share one mask: the header sits flush at the pane's
  // top-left, so the pane-relative coordinates line up on it too.
  useEffect(() => {
    if (reduce) return;
    const wrap = wrapRef.current;
    const tile = wrap?.closest(".bento-tile");
    if (!wrap || !tile) return;

    const apply = (clientX: number | null, clientY: number | null) => {
      const edges = [edgeRef.current, dividerRef.current];
      if (clientX === null || clientY === null) {
        edges.forEach((edge) => edge && (edge.style.opacity = "0"));
        return;
      }
      const r = wrap.getBoundingClientRect();
      const mask = `radial-gradient(${CHIP_GLOW_RADIUS}px circle at ${clientX - r.left}px ${clientY - r.top}px, #000 0%, transparent 62%)`;
      edges.forEach((edge) => {
        if (!edge) return;
        edge.style.opacity = "1";
        edge.style.maskImage = mask;
        edge.style.webkitMaskImage = mask;
      });
    };

    const onMove = (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.pointerType === "mouse") apply(pe.clientX, pe.clientY);
    };
    const onLeave = () => apply(null, null);

    tile.addEventListener("pointermove", onMove);
    tile.addEventListener("pointerleave", onLeave);
    return () => {
      tile.removeEventListener("pointermove", onMove);
      tile.removeEventListener("pointerleave", onLeave);
    };
  }, [reduce]);

  return (
  <div
    ref={wrapRef}
    aria-hidden="true"
    className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-secondary shadow-sm"
  >
    <span
      ref={edgeRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 rounded-2xl border-[1.5px] border-brand-from opacity-0 transition-opacity duration-200"
    />
    <div className="relative flex items-center gap-1.5 border-b border-border/50 px-4 py-2.5">
      <span
        ref={dividerRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-20 border-b border-brand-from opacity-0 transition-opacity duration-200"
      />
      <span className="size-2.5 rounded-full bg-foreground/15" />
      <span className="size-2.5 rounded-full bg-foreground/15" />
      <span className="size-2.5 rounded-full bg-foreground/15" />
      <span className="ml-2 flex items-center font-mono text-[11px] tracking-tight text-muted-foreground">
        editor.save()
        <span className="bento-caret ml-0.5 inline-block h-3 w-px bg-primary" />
      </span>
    </div>
    <pre className="relative flex-1 overflow-hidden px-5 py-4 font-mono text-[12.5px] leading-[1.85] text-muted-foreground">
      {"{\n  "}
      <span className="text-brand-gradient font-semibold">"blocks"</span>
      {": [\n    { "}
      <span className="text-muted-foreground/60">"id"</span>
      {": "}
      <span className="text-primary">"x1"</span>
      {",\n      "}
      <span className="text-muted-foreground/60">"type"</span>
      {": "}
      <span className="text-primary">"paragraph"</span>
      {",\n      "}
      <span className="text-muted-foreground/60">"data"</span>
      {": { "}
      <span className="text-muted-foreground/60">"text"</span>
      {": "}
      <span className="text-primary">"Hello"</span>
      {" } },\n    { "}
      <span className="text-muted-foreground/60">"id"</span>
      {": "}
      <span className="text-primary">"x2"</span>
      {",\n      "}
      <span className="text-muted-foreground/60">"type"</span>
      {": "}
      <span className="text-primary">"header"</span>
      {",\n      "}
      <span className="text-muted-foreground/60">"data"</span>
      {": { "}
      <span className="text-muted-foreground/60">"level"</span>
      {": "}
      <span className="text-foreground">2</span>
      {" } }\n  ],\n  "}
      <span className="text-brand-gradient font-semibold">"version"</span>
      {": "}
      <span className="text-primary">"0.19.0"</span>
      {"\n}"}
    </pre>
  </div>
  );
};

// One glyph per shipped block type — a duotone palette you could scan: crisp
// strokes carrying soft currentColor fills for mass. At rest every glyph is
// muted; when the blob touches a chip its lit copy adopts the block's own accent.
const BLOCK_CHIPS: { label: string; color: string; path: React.ReactNode }[] = [
  {
    label: "Table",
    color: "#4c6fff",
    path: (
      <>
        <path d="M6 4.75h12a2.25 2.25 0 0 1 2.25 2.25V9.5H3.75V7A2.25 2.25 0 0 1 6 4.75Z" fill="currentColor" fillOpacity="0.16" stroke="none" />
        <rect x="3.75" y="4.75" width="16.5" height="14.5" rx="3" />
        <path d="M3.75 9.5h16.5M10 9.5v9.75" />
      </>
    ),
  },
  {
    label: "Database",
    color: "#8b5cf6",
    path: (
      <>
        <ellipse cx="12" cy="5.75" rx="7" ry="2.6" fill="currentColor" fillOpacity="0.16" stroke="none" />
        <path d="M5 5.75v12.5c0 1.43 3.13 2.6 7 2.6s7-1.17 7-2.6V5.75" />
        <ellipse cx="12" cy="5.75" rx="7" ry="2.6" />
        <path d="M5 12c0 1.43 3.13 2.6 7 2.6s7-1.17 7-2.6" />
      </>
    ),
  },
  {
    label: "Columns",
    color: "#16a34a",
    path: (
      <>
        <rect x="3.75" y="4.75" width="6.5" height="14.5" rx="2" fill="currentColor" fillOpacity="0.16" stroke="none" />
        <rect x="3.75" y="4.75" width="6.5" height="14.5" rx="2" />
        <rect x="13.75" y="4.75" width="6.5" height="14.5" rx="2" />
      </>
    ),
  },
  {
    label: "Callout",
    color: "#f2922e",
    path: (
      <>
        <rect x="3.5" y="5" width="17" height="14" rx="3.5" fill="currentColor" fillOpacity="0.12" stroke="none" />
        <rect x="3.5" y="5" width="17" height="14" rx="3.5" />
        <path d="M7 8.75v6.5" strokeWidth="2.1" />
        <path d="M10.75 10h6M10.75 14h4" />
      </>
    ),
  },
  {
    label: "Code",
    color: "#e94e7a",
    path: (
      <>
        <rect x="3.25" y="4.75" width="17.5" height="14.5" rx="3.5" fill="currentColor" fillOpacity="0.1" stroke="none" />
        <rect x="3.25" y="4.75" width="17.5" height="14.5" rx="3.5" />
        <path d="M9 9.75 6.5 12 9 14.25M15 9.75 17.5 12 15 14.25M13 8.75 11 15.25" />
      </>
    ),
  },
  {
    label: "Media",
    color: "#0ea5a4",
    path: (
      <>
        <rect x="3.5" y="5" width="17" height="14" rx="3.5" fill="currentColor" fillOpacity="0.1" stroke="none" />
        <rect x="3.5" y="5" width="17" height="14" rx="3.5" />
        <circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" stroke="none" />
        <path d="M4 16.5 8 13l2.75 2.4L15 10l5.5 5.25" />
      </>
    ),
  },
  {
    label: "Embed",
    color: "#ef4444",
    path: (
      <>
        <rect x="3.5" y="5.5" width="17" height="13" rx="3.5" fill="currentColor" fillOpacity="0.1" stroke="none" />
        <rect x="3.5" y="5.5" width="17" height="13" rx="3.5" />
        <path d="M10.25 9.4 15 12l-4.75 2.6Z" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    label: "Toggle",
    color: "#6366f1",
    path: (
      <>
        <path d="M6 8 10 11.5 6 15Z" fill="currentColor" fillOpacity="0.18" />
        <path d="M13 9.5h5.5M13 13.75h5.5" />
      </>
    ),
  },
];

// The palette, drawn once. The `lit` copy paints each chip in its own block
// accent (border + glyph + label) and is stacked over the muted base, then
// revealed through a radial mask at the cursor — so the chips the blob touches
// light up crisply in their own colour, which the base copy can't show.
const ChipGrid: React.FC<{ lit?: boolean }> = ({ lit }) => (
  <div className="grid h-full w-full grid-cols-4 gap-2">
    {BLOCK_CHIPS.map((chip) => (
      <div
        key={chip.label}
        style={lit ? { color: chip.color, borderColor: chip.color } : undefined}
        className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border py-2.5 ${
          lit ? "fi-chip-lit" : "fi-chip-base border-border/50 bg-card text-muted-foreground"
        }`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {chip.path}
        </svg>
        <span className="text-[10px] font-semibold leading-none tracking-tight">{chip.label}</span>
      </div>
    ))}
  </div>
);

// Radius of the brand spotlight revealed over masked layers, in px — matched to
// the tile's visible glow blob (.bento-spot, 226×200 + ~1.2× squash + blur, so it
// reaches ~140px from the cursor) so an element lights the instant the glow
// visually touches it rather than lagging until the cursor is right on top. The
// reveal fades out at 62% → ~143px, tracking the blob's edge.
const CHIP_GLOW_RADIUS = 230;

// How far the cursor's "pull" reaches, in px. Sized so a chip starts rising about
// when the glow blob starts colouring it — the lit chips and the lifted chips are
// the same ones, instead of the old one-shot wave that fired regardless of where
// the pointer was.
const CHIP_LIFT_RADIUS = 200;

const BlocksViz: React.FC = () => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const litRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  // The palette behaves like a dock: each chip magnifies toward the pointer (lift
  // + scale + a soft shadow that grows with proximity) and the lit copy is
  // revealed through a matching radial mask — both driven off the whole tile, so
  // the chips respond the moment the glow reaches them, even from over the title.
  useEffect(() => {
    if (reduce) return;
    const wrap = wrapRef.current;
    const lit = litRef.current;
    const tile = wrap?.closest(".bento-tile");
    if (!wrap || !lit || !tile) return;

    const baseChips = Array.from(wrap.querySelectorAll<HTMLElement>(".fi-chip-base"));
    const litChips = Array.from(lit.querySelectorAll<HTMLElement>(".fi-chip-lit"));

    // Resting chip centres in wrap-local coords. offset* is layout-based, so it's
    // immune to the transforms we write back — no measure/transform feedback loop.
    let centers: Array<{ x: number; y: number }> = [];
    const measure = () => {
      centers = baseChips.map((c) => ({
        x: c.offsetLeft + c.offsetWidth / 2,
        y: c.offsetTop + c.offsetHeight / 2,
      }));
    };
    measure();

    const reset = () => {
      lit.style.opacity = "0";
      baseChips.forEach((bc, i) => {
        bc.style.transform = "";
        bc.style.boxShadow = "";
        if (litChips[i]) litChips[i].style.transform = "";
      });
    };

    const apply = (clientX: number, clientY: number) => {
      const r = wrap.getBoundingClientRect();
      const lx = clientX - r.left;
      const ly = clientY - r.top;

      // Colour reveal: the lit copy is unmasked in a radius around the cursor.
      const mask = `radial-gradient(${CHIP_GLOW_RADIUS}px circle at ${lx}px ${ly}px, #000 0%, transparent 62%)`;
      lit.style.opacity = "1";
      lit.style.maskImage = mask;
      lit.style.webkitMaskImage = mask;

      // Proximity magnify: closer chips rise more, smoothstep falloff.
      baseChips.forEach((bc, i) => {
        const c = centers[i];
        const t = Math.max(0, 1 - Math.hypot(lx - c.x, ly - c.y) / CHIP_LIFT_RADIUS);
        const inf = t * t * (3 - 2 * t);
        const transform = `translateY(${(-12 * inf).toFixed(2)}px) scale(${(1 + 0.08 * inf).toFixed(3)})`;
        bc.style.transform = transform;
        bc.style.boxShadow =
          inf > 0.01
            ? `0 ${(11 * inf).toFixed(1)}px ${(22 * inf).toFixed(1)}px -8px rgba(17, 12, 10, ${(0.24 * inf).toFixed(3)})`
            : "";
        if (litChips[i]) litChips[i].style.transform = transform;
      });
    };

    const onMove = (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.pointerType === "mouse") apply(pe.clientX, pe.clientY);
    };

    tile.addEventListener("pointermove", onMove);
    tile.addEventListener("pointerleave", reset);
    window.addEventListener("resize", measure);
    return () => {
      tile.removeEventListener("pointermove", onMove);
      tile.removeEventListener("pointerleave", reset);
      window.removeEventListener("resize", measure);
    };
  }, [reduce]);

  return (
    <div ref={wrapRef} aria-hidden="true" className="relative w-full">
      <ChipGrid />
      <div
        ref={litRef}
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200"
      >
        <ChipGrid lit />
      </div>
    </div>
  );
};

// "Bring your own blocks" told without a line of code — because the value lands
// for anyone, not just developers. We frame it as a live block-picker dropdown
// that floats up out of the tile and spills past its right + bottom borders (the
// tile clips it), so it reads as one slice of a larger menu — the "popover
// poking over the container edge" feel that worked best. The picker lists a
// familiar block, a custom one marked "yours" to make "custom" tangible, and an
// inviting dashed row to add whatever block you dream up. No jargon.
const PAGE_BLOCKS: { label: string; glyph: React.ReactNode; mine?: boolean }[] = [
  // document with text lines — duotone: soft-filled page behind crisp strokes
  {
    label: "Text",
    glyph: (
      <>
        <rect x="4.75" y="3.5" width="14.5" height="17" rx="3.2" fill="currentColor" fillOpacity="0.15" stroke="none" />
        <rect x="4.75" y="3.5" width="14.5" height="17" rx="3.2" />
        <path d="M8 8.5h8M8 12h8M8 15.5h5" />
      </>
    ),
  },
  // checkbox — a to-do block, duotone tile with a crisp tick
  {
    label: "To-do",
    glyph: (
      <>
        <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="4.2" fill="currentColor" fillOpacity="0.15" stroke="none" />
        <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="4.2" />
        <path d="M8 12.2l2.7 2.7L16 9.3" />
      </>
    ),
  },
  // rounded bar chart — a custom "Poll" block someone added themselves
  {
    label: "Poll",
    mine: true,
    glyph: (
      <>
        <path d="M4 20.25h16" />
        <g className="fi-poll-bar" style={{ animationDelay: "0.30s" }}>
          <rect x="5.5" y="11.5" width="3.6" height="6.5" rx="1.3" fill="currentColor" fillOpacity="0.2" stroke="none" />
          <rect x="5.5" y="11.5" width="3.6" height="6.5" rx="1.3" />
        </g>
        <g className="fi-poll-bar" style={{ animationDelay: "0.47s" }}>
          <rect x="10.2" y="6.5" width="3.6" height="11.5" rx="1.3" fill="currentColor" fillOpacity="0.2" stroke="none" />
          <rect x="10.2" y="6.5" width="3.6" height="11.5" rx="1.3" />
        </g>
        <g className="fi-poll-bar" style={{ animationDelay: "0.385s" }}>
          <rect x="14.9" y="9" width="3.6" height="9" rx="1.3" fill="currentColor" fillOpacity="0.2" stroke="none" />
          <rect x="14.9" y="9" width="3.6" height="9" rx="1.3" />
        </g>
      </>
    ),
  },
];

const ExtensibleViz: React.FC = () => {
  const cardRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<HTMLSpanElement>(null);
  const addLitRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  // Light the picker's border where the tile's glow blob touches it — the same
  // tile-wide pointer tracking the other tiles use, but measured against the
  // floating dropdown card (which bleeds past the tile edges).
  useEffect(() => {
    if (reduce) return;
    const card = cardRef.current;
    const tile = card?.closest(".bento-tile");
    if (!card || !tile) return;

    // Each masked layer (border ring + the "add your own" reveal) measures its
    // own box, so a single cursor position lights both correctly wherever they
    // sit in the card.
    const apply = (clientX: number | null, clientY: number | null) => {
      [edgeRef.current, addLitRef.current].forEach((el) => {
        if (!el) return;
        if (clientX === null || clientY === null) {
          el.style.opacity = "0";
          return;
        }
        const r = el.getBoundingClientRect();
        const mask = `radial-gradient(${CHIP_GLOW_RADIUS}px circle at ${clientX - r.left}px ${clientY - r.top}px, #000 0%, transparent 62%)`;
        el.style.opacity = "1";
        el.style.maskImage = mask;
        el.style.webkitMaskImage = mask;
      });
    };

    const onMove = (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.pointerType === "mouse") apply(pe.clientX, pe.clientY);
    };

    // :hover drives the enter animation, but it can't fire a one-shot on the way
    // out — so on pointerleave we tag the card to play a "relax" gesture, then
    // clear the tag (on re-enter or once it has run) so the next leave replays it.
    let leaveTimer: ReturnType<typeof setTimeout>;
    const onEnter = () => {
      window.clearTimeout(leaveTimer);
      card.classList.remove("byob-leaving");
    };
    const onLeave = () => {
      apply(null, null);
      card.classList.add("byob-leaving");
      window.clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => card.classList.remove("byob-leaving"), 760);
    };

    tile.addEventListener("pointerenter", onEnter);
    tile.addEventListener("pointermove", onMove);
    tile.addEventListener("pointerleave", onLeave);
    return () => {
      window.clearTimeout(leaveTimer);
      card.classList.remove("byob-leaving");
      tile.removeEventListener("pointerenter", onEnter);
      tile.removeEventListener("pointermove", onMove);
      tile.removeEventListener("pointerleave", onLeave);
    };
  }, [reduce]);

  return (
  <div aria-hidden="true" className="relative h-full min-h-[150px] w-full">
    {/* Floating block-picker dropdown — wider than the tile's viz column and
        anchored top-left so it bleeds over the right + bottom borders. */}
    <div ref={cardRef} className="absolute left-[6%] top-[8px] w-[145%] overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[0_24px_55px_-14px_rgba(0,0,0,0.25)]">
      {/* brand border revealed where the glow blob touches the picker's edge */}
      <span
        ref={edgeRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-30 rounded-2xl border-[1.5px] border-brand-from opacity-0 transition-opacity duration-200"
      />
      <div className="flex flex-col gap-1 px-2 pt-2 pb-6">
        {PAGE_BLOCKS.map((block, i) => (
          <div
            key={block.label}
            style={{ animationDelay: `${0.03 + i * 0.08}s`, ...(block.mine ? { borderColor: "var(--brand-from)" } : {}) }}
            className={`fi-row flex items-center gap-2.5 rounded-xl border px-3 py-1.5 ${
              block.mine ? "bg-primary/[0.06]" : "border-transparent"
            }`}
          >
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-[10px] ${
                block.mine
                  ? "bg-linear-to-br from-brand-from to-brand-to text-white shadow-[0_4px_12px_-2px_rgba(233,78,122,0.5)] ring-1 ring-inset ring-white/25 transition-transform duration-300 ease-out lg:group-hover:scale-[1.07]"
                  : "border border-border/60 bg-card text-muted-foreground shadow-sm"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                {block.glyph}
              </svg>
            </span>
            <span className={`text-[12px] font-semibold tracking-tight ${block.mine ? "text-foreground" : "text-muted-foreground"}`}>
              {block.label}
            </span>
            {block.mine && (
              <span className="fi-byob-badge ml-1.5 inline-block origin-center whitespace-nowrap rounded-full bg-linear-to-r from-brand-from to-brand-to px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                by you
              </span>
            )}
          </div>
        ))}

        {/* The invitation: gray at rest, its brand colour revealed only where the
            glow blob masks over it (lit duplicate stacked above the gray base). */}
        <div className="fi-row relative" style={{ animationDelay: `${0.03 + PAGE_BLOCKS.length * 0.08}s` }}>
          <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-border px-3 py-1.5 text-muted-foreground">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[10px] border border-dashed border-border">
              <svg className="fi-byob-plus" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 6v12M6 12h12" />
              </svg>
            </span>
            <span className="text-[12px] font-semibold tracking-tight">Add your own block</span>
          </div>
          <div
            ref={addLitRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200"
          >
            <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-primary px-3 py-1.5 text-primary">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-[10px] border border-dashed border-primary">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 6v12M6 12h12" />
                </svg>
              </span>
              <span className="text-[12px] font-semibold tracking-tight">Add your own block</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  );
};

// A faithful replica of Blok's real slash menu — the toolbox popover you get the
// instant you type "/" in the editor. Everything mirrors the popover's own design
// tokens so it reads as the genuine article rather than a stylised stand-in:
//   • white card, the app's exact border + layered shadow
//   • w-6 / rounded-lg icon chips on bg rgba(55,53,47,.06)  (--blok-popover-icon-bg)
//   • the block's real letter glyph (T, H₁…) and its Markdown shortcut on the right
//   • the current block highlighted in Blok blue rgba(35,131,226,.14) (--blok-item-focus-bg)
// Rows are the literal top of the menu (Text, Heading 1–3), in order.
// "H" with a subscript level — Blok's own heading-icon shape, set in the docs
// display font so it reads as a crafted glyph rather than plain text.
const Hn: React.FC<{ n: string }> = ({ n }) => (
  <span className="flex items-baseline font-bold leading-none">
    <span className="text-[13px]">H</span>
    <span className="text-[8.5px] font-semibold">{n}</span>
  </span>
);

// Polished duotone glyphs for the list-style blocks the hover search surfaces.
const slashIcon = (paths: React.ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {paths}
  </svg>
);

type SlashRow = { label: string; glyph: React.ReactNode; shortcut?: string; current?: boolean };

// Two result sets the diorama swaps between: the resting menu (you've typed
// "text") and what a live search for a to-do block surfaces on hover.
const SLASH_REST_QUERY = "text";
const SLASH_HOVER_QUERY = "to-do";

const SLASH_REST_RESULTS: SlashRow[] = [
  { label: "Text", current: true, glyph: <span className="text-[13px] font-bold leading-none">T</span> },
  { label: "Heading 1", shortcut: "#", glyph: <Hn n="1" /> },
  { label: "Heading 2", shortcut: "##", glyph: <Hn n="2" /> },
];

const SLASH_HOVER_RESULTS: SlashRow[] = [
  {
    label: "To-do list",
    current: true,
    shortcut: "[]",
    glyph: slashIcon(
      <>
        <rect x="4" y="4.5" width="15" height="15" rx="4.5" fill="currentColor" fillOpacity="0.16" stroke="none" />
        <rect x="4" y="4.5" width="15" height="15" rx="4.5" />
        <path d="M7.8 12l2.5 2.5L16 9" strokeWidth="2" />
      </>,
    ),
  },
  {
    label: "Toggle list",
    shortcut: ">",
    glyph: slashIcon(
      <>
        <path d="M7 7.5l5 4-5 4Z" fill="currentColor" fillOpacity="0.18" />
        <path d="M14.5 9.5h4M14.5 13.5h4" />
      </>,
    ),
  },
  {
    label: "Bulleted list",
    shortcut: "-",
    glyph: slashIcon(
      <>
        <path d="M9.5 8h9.5M9.5 12h9.5M9.5 16h6.5" />
        <circle cx="5.5" cy="8" r="1.25" fill="currentColor" stroke="none" />
        <circle cx="5.5" cy="12" r="1.25" fill="currentColor" stroke="none" />
        <circle cx="5.5" cy="16" r="1.25" fill="currentColor" stroke="none" />
      </>,
    ),
  },
];

const SlashRowView: React.FC<{ row: SlashRow }> = ({ row }) => (
  <motion.div
    layout
    initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
    exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
    transition={{ duration: 0.24, ease: "easeOut" }}
    className={`flex items-center gap-3 rounded-xl px-2.5 py-2 ${
      row.current ? "bg-primary/[0.07]" : ""
    }`}
  >
    <span
      className={`flex size-7 shrink-0 items-center justify-center rounded-[11px] ${
        row.current
          ? "bg-linear-to-br from-brand-from to-brand-to text-white shadow-[0_4px_12px_-2px_rgba(233,78,122,0.5)] ring-1 ring-inset ring-white/25"
          : "border border-border/60 bg-secondary text-foreground/70 shadow-sm"
      }`}
    >
      {row.glyph}
    </span>
    <span className={`text-[13px] tracking-tight ${row.current ? "font-semibold text-foreground" : "font-medium text-foreground/90"}`}>
      {row.label}
    </span>
    {row.shortcut && (
      <span className="ml-auto font-mono text-[11px] text-muted-foreground/55">{row.shortcut}</span>
    )}
  </motion.div>
);

// Blok's slash menu, dressed for the docs: a search field carrying the "/" query
// over the result list, styled in the bento's house language (rounded card,
// designed shadow, squircle chips, brand-gradient current row). Hovering the tile
// plays a live search — the typed query erases and retypes "/to-do", and the
// results filter from the text/heading set to the list-block set as it goes.
const SlashViz: React.FC = () => {
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<HTMLSpanElement>(null);
  const [query, setQuery] = useState(SLASH_REST_QUERY);
  const [results, setResults] = useState<SlashRow[]>(SLASH_REST_RESULTS);
  // queryRef mirrors `query` so a freshly-started sequence can erase from wherever
  // the caret currently sits; genRef invalidates any in-flight sequence the moment
  // the pointer enters or leaves again.
  const queryRef = useRef(query);
  const genRef = useRef(0);

  useEffect(() => {
    if (reduce) return;
    const tile = rootRef.current?.closest(".bento-tile");
    if (!tile) return;

    const setQ = (s: string) => {
      queryRef.current = s;
      setQuery(s);
    };

    const play = async (word: string, rows: SlashRow[]) => {
      const gen = ++genRef.current;
      const wait = (ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms));
      // erase whatever's there
      for (let i = queryRef.current.length - 1; i >= 0; i--) {
        if (genRef.current !== gen) return;
        setQ(queryRef.current.slice(0, i));
        await wait(45);
      }
      if (genRef.current !== gen) return;
      setResults(rows);
      await wait(150);
      // type the new query
      for (let i = 1; i <= word.length; i++) {
        if (genRef.current !== gen) return;
        setQ(word.slice(0, i));
        await wait(65);
      }
    };

    const onEnter = () => void play(SLASH_HOVER_QUERY, SLASH_HOVER_RESULTS);
    const onLeave = () => void play(SLASH_REST_QUERY, SLASH_REST_RESULTS);

    // Light the card's border pink where the tile's glow blob touches it — the
    // same radial-mask edge-light the JSON / Tables / Blocks tiles use.
    const applyEdge = (clientX: number | null, clientY: number | null) => {
      const edge = edgeRef.current;
      const root = rootRef.current;
      if (!edge || !root) return;
      if (clientX === null || clientY === null) {
        edge.style.opacity = "0";
        return;
      }
      const r = root.getBoundingClientRect();
      const mask = `radial-gradient(${CHIP_GLOW_RADIUS}px circle at ${clientX - r.left}px ${clientY - r.top}px, #000 0%, transparent 62%)`;
      edge.style.opacity = "1";
      edge.style.maskImage = mask;
      edge.style.webkitMaskImage = mask;
    };
    const onMove = (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.pointerType === "mouse") applyEdge(pe.clientX, pe.clientY);
    };
    const onEdgeLeave = () => applyEdge(null, null);

    tile.addEventListener("pointerenter", onEnter);
    tile.addEventListener("pointerleave", onLeave);
    tile.addEventListener("pointermove", onMove);
    tile.addEventListener("pointerleave", onEdgeLeave);
    return () => {
      genRef.current++;
      tile.removeEventListener("pointerenter", onEnter);
      tile.removeEventListener("pointerleave", onLeave);
      tile.removeEventListener("pointermove", onMove);
      tile.removeEventListener("pointerleave", onEdgeLeave);
    };
  }, [reduce]);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="relative w-full overflow-hidden rounded-2xl border border-border/60 bg-card p-2 shadow-[0_20px_44px_-18px_rgba(0,0,0,0.22)]"
    >
      {/* Brand border revealed where the tile's glow blob touches the card. */}
      <span
        ref={edgeRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-30 rounded-2xl border-[1.5px] border-brand-from opacity-0 transition-opacity duration-200"
      />
      {/* Search field — the "/" query you typed, with a live caret. */}
      <div className="mb-1.5 flex items-center gap-2 rounded-xl bg-secondary/60 px-2.5 py-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground/70">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span className="flex items-center font-mono text-[12.5px] tracking-tight text-foreground">
          <span className="text-muted-foreground">/</span>
          {query}
          <span className="bento-caret ml-px inline-block h-3.5 w-px bg-primary" />
        </span>
      </div>

      <div className="flex flex-col">
        <AnimatePresence mode="popLayout" initial={false}>
          {results.map((row) => (
            <SlashRowView key={row.label} row={row} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

// A calm little spreadsheet that plays one animation when the whole tile is
// hovered: the Task column resizes wider while the table's real blue (#3b82f6)
// resize line glides along the moving Task | Owner edge. Nothing is interactive
// per-cell; reduced-motion users get the plain static table.
const TABLE_HEADERS: { label: string; cls: string }[] = [
  { label: "Group", cls: "col-start-1 rounded-tl-lg" },
  { label: "Task", cls: "col-start-2" },
  { label: "Owner", cls: "col-start-3" },
  { label: "Date", cls: "col-start-4 rounded-tr-lg" },
];

const TablesViz: React.FC = () => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();

  // Light the table's border with brand pink where the tile's glow blob touches
  // it — the same blob-tracked radial reveal the JSON pane and chip grid use.
  useEffect(() => {
    if (reduce) return;
    const wrap = wrapRef.current;
    const tile = wrap?.closest(".bento-tile");
    if (!wrap || !tile) return;

    const apply = (clientX: number | null, clientY: number | null) => {
      const edge = edgeRef.current;
      if (!edge) return;
      if (clientX === null || clientY === null) {
        edge.style.opacity = "0";
        return;
      }
      const r = wrap.getBoundingClientRect();
      const mask = `radial-gradient(${CHIP_GLOW_RADIUS}px circle at ${clientX - r.left}px ${clientY - r.top}px, #000 0%, transparent 62%)`;
      edge.style.opacity = "1";
      edge.style.maskImage = mask;
      edge.style.webkitMaskImage = mask;
    };

    const onMove = (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.pointerType === "mouse") apply(pe.clientX, pe.clientY);
    };
    const onLeave = () => apply(null, null);

    tile.addEventListener("pointermove", onMove);
    tile.addEventListener("pointerleave", onLeave);
    return () => {
      tile.removeEventListener("pointermove", onMove);
      tile.removeEventListener("pointerleave", onLeave);
    };
  }, [reduce]);

  return (
    // bg-card gives the table an opaque base so the tile's hover glow can't bleed
    // through the semi-transparent gridlines and cell tints.
    <div ref={wrapRef} aria-hidden="true" className="relative w-full self-start rounded-xl bg-card text-[10px] font-medium leading-tight">
      {/* brand border revealed where the glow blob touches the table */}
      <span
        ref={edgeRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-30 rounded-xl border-[1.5px] border-brand-from opacity-0 transition-opacity duration-200"
      />
      {/* The table is taller than its tile, so the lower rows spill past the
          bottom edge (the tile clips them) — a spreadsheet that keeps going. */}
      <div className="grid w-full grid-cols-[0.7fr_1.6fr_1fr_0.85fr] grid-rows-[repeat(7,auto)] gap-[3px] rounded-xl border border-border/60 bg-border/60 p-[3px] transition-[grid-template-columns] duration-500 ease-out motion-safe:group-hover:grid-cols-[0.7fr_1.95fr_0.65fr_0.85fr]">
      {/* heading row */}
      {TABLE_HEADERS.map(({ label, cls }) => (
        <div
          key={label}
          className={`${cls} row-start-1 flex h-6 items-center bg-secondary px-2 font-semibold text-muted-foreground`}
        >
          {label}
        </div>
      ))}

      {/* group "Web" — a merged cell spanning its two task rows */}
      <div className="col-start-1 row-start-2 row-span-2 flex items-center justify-center bg-secondary text-center font-semibold text-muted-foreground">Web</div>
      <div className="col-start-2 row-start-2 flex items-center overflow-hidden bg-card px-2 py-1.5 text-foreground/80"><span className="truncate">Landing page</span></div>
      {/* background-coloured cell */}
      <div className="col-start-3 row-start-2 flex items-center overflow-hidden bg-[#16a34a]/14 px-2 py-1.5 text-foreground/80"><span className="truncate">Ann</span></div>
      <div className="col-start-4 row-start-2 flex items-center overflow-hidden bg-card px-2 py-1.5 text-muted-foreground"><span className="truncate">Jun 24</span></div>

      <div className="col-start-2 row-start-3 flex items-center overflow-hidden bg-card px-2 py-1.5 text-foreground/80"><span className="truncate">Checkout</span></div>
      {/* text-coloured cell — the other cell-colour mode */}
      <div className="col-start-3 row-start-3 flex items-center overflow-hidden bg-card px-2 py-1.5 font-semibold text-primary"><span className="truncate">Lee</span></div>
      <div className="col-start-4 row-start-3 flex items-center overflow-hidden bg-card px-2 py-1.5 text-muted-foreground"><span className="truncate">Jul 02</span></div>

      {/* group "App" */}
      <div className="col-start-1 row-start-4 row-span-2 flex items-center justify-center bg-secondary text-center font-semibold text-muted-foreground">App</div>
      <div className="col-start-2 row-start-4 flex items-center overflow-hidden bg-card px-2 py-1.5 text-foreground/80"><span className="truncate">Onboarding</span></div>
      <div className="col-start-3 row-start-4 flex items-center overflow-hidden bg-card px-2 py-1.5 text-foreground/80"><span className="truncate">Max</span></div>
      <div className="col-start-4 row-start-4 flex items-center overflow-hidden bg-card px-2 py-1.5 text-muted-foreground"><span className="truncate">Aug 03</span></div>

      <div className="col-start-2 row-start-5 flex items-center overflow-hidden bg-card px-2 py-1.5 text-foreground/80"><span className="truncate">Settings</span></div>
      {/* background-coloured cell */}
      <div className="col-start-3 row-start-5 flex items-center overflow-hidden bg-[#3b82f6]/12 px-2 py-1.5 text-foreground/80"><span className="truncate">Zoe</span></div>
      <div className="col-start-4 row-start-5 flex items-center overflow-hidden bg-card px-2 py-1.5 text-muted-foreground"><span className="truncate">Aug 10</span></div>

      {/* group "Mobile" — these rows are the ones that bleed off the bottom */}
      <div className="col-start-1 row-start-6 row-span-2 flex items-center justify-center bg-secondary text-center font-semibold text-muted-foreground">Mobile</div>
      <div className="col-start-2 row-start-6 flex items-center overflow-hidden bg-card px-2 py-1.5 text-foreground/80"><span className="truncate">Release</span></div>
      <div className="col-start-3 row-start-6 flex items-center overflow-hidden bg-card px-2 py-1.5 text-foreground/80"><span className="truncate">Kim</span></div>
      <div className="col-start-4 row-start-6 flex items-center overflow-hidden bg-card px-2 py-1.5 text-muted-foreground"><span className="truncate">Sep 01</span></div>

      <div className="col-start-2 row-start-7 flex items-center overflow-hidden bg-card px-2 py-1.5 text-foreground/80"><span className="truncate">Hotfix</span></div>
      <div className="col-start-3 row-start-7 flex items-center overflow-hidden bg-card px-2 py-1.5 text-foreground/80"><span className="truncate">Sam</span></div>
      <div className="col-start-4 row-start-7 flex items-center overflow-hidden bg-card px-2 py-1.5 text-muted-foreground"><span className="truncate">Sep 05</span></div>

      {/* the real blue resize line, parked on the Task | Owner edge — rides along
          as the column widens on hover */}
      <span className="pointer-events-none relative z-20 col-start-3 row-start-1 row-span-7">
        <span className="absolute inset-y-0 -left-[2px] w-[2px] bg-[#3b82f6] opacity-0 transition-opacity duration-150 motion-safe:group-hover:opacity-100" />
      </span>
      </div>
    </div>
  );
};

// Every embed provider Blok supports, in its own brand colour. Real logos come
// from simple-icons (see embed-services.ts, generated from the link/embed
// registry); the handful simple-icons no longer ships render as brand monograms.
// A glossy app-icon tile gives each real depth rather than a flat dot.
const serviceInitials = (title: string): string => {
  const words = title.replace(/[()]/g, "").split(/[\s.]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const caps = words[0].match(/[A-Z]/g);
  if (caps && caps.length >= 2) return caps.slice(0, 2).join("");
  return words[0].slice(0, 2).toUpperCase();
};

const ServiceIcon: React.FC<{ service: EmbedService }> = ({ service }) => (
  <span
    data-svc={service.title}
    className="embed-tile relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[12px] text-white shadow-[0_5px_7px_-3px_rgba(0,0,0,0.2)] ring-1 ring-black/5"
    style={{ background: service.hex ?? "#64748B" }}
  >
    {!service.img && <span className="pointer-events-none absolute inset-0 bg-linear-to-b from-white/25 to-transparent" />}
    {service.img ? (
      <img
        src={service.img}
        alt=""
        loading="lazy"
        decoding="async"
        className={service.pad ? "relative size-[35px] object-contain" : service.cover ? "relative size-full object-cover" : "relative size-7 object-contain"}
      />
    ) : service.path ? (
      <svg width="20" height="20" viewBox={`0 0 ${service.vb ?? 24} ${service.vb ?? 24}`} fill={service.fg ?? "currentColor"} aria-hidden="true" className="relative">
        <path d={service.path} />
      </svg>
    ) : (
      <span className="relative text-[11px] font-bold tracking-tight">{serviceInitials(service.title)}</span>
    )}
  </span>
);

// The full roster scrolls right on a seamless loop — an endless stream of
// integrations that says "100+" better than any list. The viz is actually a tall
// band of rows; only the middle two show through the window at rest. On hover the
// whole band tilts (see EmbedsViz) and the extra rows fill in, so the icons read
// as one diagonal river flowing from the bottom-left to the top-right.
// Uniqueness guarantee: a viewer must never see the same logo twice at once. All
// rows scroll at the SAME speed and direction, so the band moves as one rigid
// sheet — the relative offset between rows is fixed forever. The roster (98) is
// cut into disjoint chunks of ROW_LEN (14): STAGGER === ROW_LEN means adjacent
// rows share NO service at all, so they can never collide however the window
// straddles a row's seamless copy. 98 = 7 × 14, so seven chunks tile the roster
// exactly and the 10 rows cycle through them; any run of ≤ 7 stacked rows (far
// more than are ever co-visible) shows seven distinct chunks. ROW_LEN also stays
// above the most columns ever visible in one row, so a row never shows its own
// second copy alongside the first. Result: the visible band is always repeat-free.
const EMBED_BAND_ROWS = 10;
const EMBED_ROW_LEN = 14;
const EMBED_ROW_STAGGER = 14;
// Each row scrolls at its own pace (adjacent rows always differ) so the band reads
// as parallel streams rather than one rigid sheet. This is safe for the no-repeat
// guarantee because uniqueness is structural, not synchronised: any co-visible rows
// (≤5 of 10, always inside a 7-row window) hold disjoint logo chunks, so they can
// never share a logo regardless of how their horizontal offsets drift apart.
const EMBED_ROW_DURS = ["30s", "44s", "36s", "50s", "40s"];
// Exported for the uniqueness regression test (Features.test.tsx).
export const EMBED_ROWS = Array.from({ length: EMBED_BAND_ROWS }, (_, i) => {
  const start = (i * EMBED_ROW_STAGGER) % EMBED_SERVICES.length;
  const rotated = [...EMBED_SERVICES.slice(start), ...EMBED_SERVICES.slice(0, start)];
  return { items: rotated.slice(0, EMBED_ROW_LEN) };
});

// An eight-row band, vertically centred so it over-hangs its window top and
// bottom, with each row horizontally centred (over-hanging left and right). The
// window only shows the middle rows at rest; on hover the tile expands the window
// to full height and the band tilts + scales just enough that the diagonal still
// fills every corner. Rows scroll right, so the icons travel up to the right.
// Radius (px) of the cursor's influence and the peak scale a dead-centre tile
// reaches. Tiles fall off smoothly to scale 1 at the rim, so crossing the edge
// is continuous (no snap).
const MAG_RADIUS = 116;
const MAG_PEAK = 0.26;

// Deterministic per-tile jitter so the cluster never looks like a tidy dome:
// each tile pops to a slightly different size and cocks at its own angle.
const tileNoise = (i: number) => {
  const s = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
  return s - Math.floor(s); // 0..1, stable per index
};

// The band is wider than the tile and shifted left so the left-aligned, seamless
// marquee always covers from beyond the left edge to far past the right — no
// exposed edge at any scroll phase, even once rotated. A pointer-driven rAF loop
// swells whatever sits near the cursor in 2D (every direction, not just the row)
// with a per-tile size/tilt jitter, so the highlight reads as an organic, ever-
// shifting cluster instead of a predictable bump.
const EmbedsViz: React.FC = () => {
  const winRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const win = winRef.current;
    if (reduce || !win) return;

    const tiles = Array.from(win.querySelectorAll<HTMLElement>(".embed-tile"));
    const noise = tiles.map((_, i) => tileNoise(i));
    // Each tile eases toward its distance-based target instead of snapping, so
    // fast cursor moves (and the settle after the pointer leaves) read smoothly.
    const curScale = new Float32Array(tiles.length).fill(1);
    const curRot = new Float32Array(tiles.length);
    const EASE = 0.16; // lerp factor per frame
    let pointer: { x: number; y: number } | null = null;
    let raf = 0;
    let running = false;

    const frame = () => {
      let busy = false;
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        let tScale = 1;
        let tRot = 0;
        if (pointer) {
          const r = t.getBoundingClientRect();
          const dx = pointer.x - (r.left + r.width / 2);
          const dy = pointer.y - (r.top + r.height / 2);
          const d = Math.hypot(dx, dy);
          if (d < MAG_RADIUS) {
            const lin = 1 - d / MAG_RADIUS; // 0..1
            const f = lin * lin * (3 - 2 * lin); // smoothstep — softer shoulders
            const n = noise[i];
            tScale = 1 + MAG_PEAK * f * (0.7 + n * 0.5);
            tRot = (n - 0.5) * 11 * f;
          }
        }
        const s = curScale[i] + (tScale - curScale[i]) * EASE;
        const ro = curRot[i] + (tRot - curRot[i]) * EASE;
        const settled = Math.abs(s - 1) < 0.002 && Math.abs(ro) < 0.03;
        curScale[i] = settled ? 1 : s;
        curRot[i] = settled ? 0 : ro;
        if (settled) {
          if (t.style.transform) {
            t.style.transform = "";
            t.style.zIndex = "";
          }
        } else {
          t.style.transform = `scale(${curScale[i].toFixed(3)}) rotate(${curRot[i].toFixed(2)}deg)`;
          t.style.zIndex = String(2 + Math.round((curScale[i] - 1) * 6));
          busy = true;
        }
      }
      // Keep animating while the cursor is present or tiles are still settling.
      if (pointer || busy) {
        raf = requestAnimationFrame(frame);
      } else {
        running = false;
      }
    };

    const kick = () => {
      if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      pointer = { x: e.clientX, y: e.clientY };
      kick();
    };
    const onLeave = () => {
      pointer = null;
    };

    win.addEventListener("pointermove", onMove);
    win.addEventListener("pointerleave", onLeave);
    return () => {
      win.removeEventListener("pointermove", onMove);
      win.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, [reduce]);

  return (
    <div
      ref={winRef}
      aria-hidden="true"
      className="flex size-full items-center overflow-hidden"
      // The band overhangs the window top/bottom, so the row clipped just above
      // bleeds its drop shadow into the empty gap at the top edge. Fade the top and
      // bottom edges so that bleed dissolves into the card instead of reading as a
      // stray shadow line. The fade lands on the empty inter-row gap, not the icons.
      style={{
        maskImage: "linear-gradient(to bottom, transparent, #000 16px, #000 calc(100% - 16px), transparent)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 16px, #000 calc(100% - 16px), transparent)",
      }}
    >
      <div className="-ml-[22%] flex w-[144%] flex-col gap-3 transition-transform duration-[800ms] ease-out will-change-transform motion-safe:group-hover:[transform:rotate(-19deg)_scale(1.32)]">
        {EMBED_ROWS.map((row, r) => (
          <div
            key={r}
            className="flex w-max gap-3 bento-marquee-r"
            style={{ animationDuration: EMBED_ROW_DURS[r % EMBED_ROW_DURS.length] }}
          >
            {[...row.items, ...row.items].map((s, i) => (
              <ServiceIcon key={`${r}-${s.title}-${i}`} service={s} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

const UNDO_ARROW = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H9" />
  </svg>
);
const REDO_ARROW = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H15" />
  </svg>
);

// "Conflict-free" is the whole point: two people edit the same line at once, and
// undo reverts only your own change. So this is a shared paragraph with two named
// live cursors (Ana + Lee). Hovering the tile *undoes* Ana's word — it retracts
// into her caret and stays gone while you look (⌘Z) — and leaving the tile *redoes*
// it, springing back (⌘⇧Z). Lee's word never moves: the collision that never
// happens. Plain undo/redo buttons couldn't show it.
const UndoViz: React.FC = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<HTMLSpanElement>(null);
  const undoLitRef = useRef<HTMLSpanElement | null>(null);
  const redoLitRef = useRef<HTMLSpanElement | null>(null);
  const [phase, setPhase] = useState<"idle" | "undo" | "redo">("idle");
  const reduce = useReducedMotion();

  // Light the document border and the shortcut keycaps with brand pink where the
  // tile's glow blob touches them — each lit layer masked against its own rect,
  // the same blob-tracked radial reveal the other tiles use.
  useEffect(() => {
    if (reduce) return;
    const card = cardRef.current;
    const tile = card?.closest(".bento-tile");
    if (!card || !tile) return;

    const targets = [edgeRef, undoLitRef, redoLitRef];
    const apply = (clientX: number | null, clientY: number | null) => {
      for (const ref of targets) {
        const el = ref.current;
        if (!el) continue;
        if (clientX === null || clientY === null) {
          el.style.opacity = "0";
          continue;
        }
        const r = el.getBoundingClientRect();
        const mask = `radial-gradient(${CHIP_GLOW_RADIUS}px circle at ${clientX - r.left}px ${clientY - r.top}px, #000 0%, transparent 62%)`;
        el.style.opacity = "1";
        el.style.maskImage = mask;
        el.style.webkitMaskImage = mask;
      }
    };

    const onMove = (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.pointerType === "mouse") apply(pe.clientX, pe.clientY);
    };
    const onLeave = () => apply(null, null);

    tile.addEventListener("pointermove", onMove);
    tile.addEventListener("pointerleave", onLeave);
    return () => {
      tile.removeEventListener("pointermove", onMove);
      tile.removeEventListener("pointerleave", onLeave);
    };
  }, [reduce]);

  useEffect(() => {
    if (reduce) return;
    const tile = rootRef.current?.closest(".bento-tile");
    if (!tile) return;
    let redoTimer: ReturnType<typeof setTimeout>;
    const onEnter = () => {
      clearTimeout(redoTimer);
      setPhase("undo");
    };
    const onLeave = () => {
      setPhase("redo");
      // hold the redo cue briefly, then settle back to the resting state
      redoTimer = setTimeout(() => setPhase("idle"), 700);
    };
    tile.addEventListener("pointerenter", onEnter);
    tile.addEventListener("pointerleave", onLeave);
    return () => {
      clearTimeout(redoTimer);
      tile.removeEventListener("pointerenter", onEnter);
      tile.removeEventListener("pointerleave", onLeave);
    };
  }, [reduce]);

  const undone = phase === "undo";
  // While you undo, Lee keeps working: his word grows (caret advancing) on hover
  // and settles back on leave — two people editing at once, no collision.
  const typing = phase === "undo";

  return (
    <div ref={rootRef} aria-hidden="true" className="w-full">
      <div ref={cardRef} className="relative w-full rounded-xl border border-border/60 bg-card px-3 pb-3 pt-7">
        {/* brand border revealed where the glow blob touches the document */}
        <span
          ref={edgeRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30 rounded-xl border-[1.5px] border-brand-from opacity-0 transition-opacity duration-200"
        />
        {/* the co-edited line — both labelled cursors live in the same sentence */}
        <div className="flex h-3.5 items-center gap-1.5">
          <span className="h-1.5 w-6 rounded-full bg-foreground/12" />
          {/* Ana — her word retracts into the caret on undo, springs back on redo */}
          <span className="relative flex h-3.5 items-center">
            <CursorFlag
              name="Ana"
              className="bg-primary"
              style={{
                transform: undone ? "translateX(-1.75rem)" : "translateX(0)",
                transition: undone
                  ? "transform 360ms cubic-bezier(0.5,0,0.75,0)"
                  : "transform 560ms cubic-bezier(0.34,1.56,0.64,1)",
              }}
            />
            <span
              className="h-1.5 w-7 origin-left rounded-full bg-primary"
              style={{
                transform: undone ? "scaleX(0)" : "scaleX(1)",
                opacity: undone ? 0 : 1,
                transition: undone
                  ? "transform 360ms cubic-bezier(0.5,0,0.75,0), opacity 280ms ease-out"
                  : "transform 560ms cubic-bezier(0.34,1.56,0.64,1), opacity 360ms ease-in",
              }}
            />
            {/* the caret retreats left as the word deletes, then rides back on redo */}
            <span
              className="bento-caret ml-0.5 h-3.5 w-0.5 origin-center rounded-full bg-primary"
              style={{
                transform: undone ? "translateX(-1.75rem) scaleY(1.2)" : "translateX(0) scaleY(1)",
                transition: undone
                  ? "transform 360ms cubic-bezier(0.5,0,0.75,0)"
                  : "transform 560ms cubic-bezier(0.34,1.56,0.64,1)",
              }}
            />
          </span>
          <span className="h-1.5 w-3 rounded-full bg-foreground/12" />
          {/* Lee — keeps typing while you undo; his text never collides with Ana's */}
          <span className="relative flex h-3.5 items-center">
            <CursorFlag name="Lee" className="bg-indigo-500" />
            <span
              className="h-1.5 rounded-full bg-indigo-500"
              style={{
                width: typing ? "2.75rem" : "1.5rem",
                // grow in discrete jumps (keystroke-by-keystroke), settle smoothly
                transition: typing ? "width 760ms steps(6, end) 70ms" : "width 420ms ease-out",
              }}
            />
            <span className="bento-caret ml-0.5 h-3.5 w-0.5 rounded-full bg-indigo-500" style={{ animationDelay: "0.5s" }} />
          </span>
          <span className="h-1.5 flex-1 rounded-full bg-foreground/12" />
        </div>
        {/* the rest of the paragraph */}
        <div className="mt-2 flex flex-col gap-2">
          <span className="block h-1.5 w-11/12 rounded-full bg-foreground/12" />
          <span className="block h-1.5 w-2/3 rounded-full bg-foreground/12" />
        </div>

        {/* the shortcut cue cross-fades: ⌘Z as you undo, ⌘⇧Z as you redo on leave */}
        <ShortcutBadge show={phase === "undo"} icon={UNDO_ARROW} keys={["⌘", "Z"]} litRef={undoLitRef} />
        <ShortcutBadge show={phase === "redo"} icon={REDO_ARROW} keys={["⌘", "⇧", "Z"]} litRef={redoLitRef} />
      </div>
    </div>
  );
};

// A collaborator's name tab, sitting just above their caret — the speech-tab
// corner (squared bottom-right) points down at the cursor.
const CursorFlag: React.FC<{ name: string; className: string; style?: React.CSSProperties }> = ({ name, className, style }) => (
  <span
    style={style}
    className={`absolute bottom-full right-0 mb-1 whitespace-nowrap rounded-md rounded-br-[2px] px-1 py-px text-[7px] font-bold leading-[1.5] text-white shadow-sm ${className}`}
  >
    {name}
  </span>
);

// The undo/redo shortcut tag above the document, cross-fading with the phase.
// Each key is its own keycap; only the pill's own border lights brand pink where
// the glow blob touches it (via the litRef overlay) — the keycaps stay neutral.
const ShortcutBadge: React.FC<{
  show: boolean;
  icon: React.ReactNode;
  keys: string[];
  litRef: React.RefObject<HTMLSpanElement | null>;
}> = ({ show, icon, keys, litRef }) => (
  <span
    className="absolute -top-3 right-3 z-40 flex items-center gap-1.5 rounded-lg border border-border/60 bg-card px-2 py-1 shadow-md transition-all duration-300"
    style={{
      opacity: show ? 1 : 0,
      transform: show ? "translateY(0) scale(1)" : "translateY(3px) scale(0.92)",
    }}
  >
    <span className="text-primary">{icon}</span>
    <span className="flex items-center gap-0.5">
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-[4px] border border-border/70 bg-secondary px-1 text-[9px] font-semibold leading-none text-foreground/70 shadow-[0_1px_0_var(--border)]"
        >
          {k}
        </kbd>
      ))}
    </span>
    {/* the container's border lights brand pink where the glow blob touches it */}
    <span
      ref={litRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-lg border border-brand-from opacity-0 transition-opacity duration-200"
    />
  </span>
);

// The whole tile is a live editor field that rolls a phrase through all 68
// supported locales (src/components/i18n/locales) — the editor speaking every
// language. At rest it says hello; hovering switches to a casual "What's up?",
// still in all 68 tongues. RTL is read from the same canonical set, so those
// lines flip and the caret lands on the right edge — "RTL-ready" made watchable.
// Each entry is [code, hello, what's-up]; both share the locale's direction.
const RTL_GREET = new Set(["ar", "dv", "fa", "he", "ku", "ps", "sd", "ug", "ur", "yi"]);
const PHRASES = (
  [
    ["en", "Hello", "What's up?"], ["am", "ሰላም", "እንዴት ነህ?"], ["ar", "مرحبا", "ما الأخبار؟"],
    ["az", "Salam", "Nə var nə yox?"], ["bg", "Здравей", "Какво става?"], ["bn", "নমস্কার", "কী খবর?"],
    ["bs", "Zdravo", "Šta ima?"], ["cs", "Ahoj", "Co se děje?"], ["da", "Hej", "Hvad så?"],
    ["de", "Hallo", "Was geht?"], ["dv", "ހެލޯ", "ކިހިނެއް؟"], ["el", "Γεια", "Τι κάνεις;"],
    ["es", "Hola", "¿Qué tal?"], ["et", "Tere", "Kuidas läheb?"], ["fa", "سلام", "چه خبر؟"],
    ["fi", "Hei", "Mitä kuuluu?"], ["fil", "Kamusta", "Anong balita?"], ["fr", "Bonjour", "Quoi de neuf?"],
    ["gu", "નમસ્તે", "શું ચાલે છે?"], ["he", "שלום", "מה נשמע?"], ["hi", "नमस्ते", "क्या हाल है?"],
    ["hr", "Bok", "Što ima?"], ["hu", "Szia", "Mi újság?"], ["hy", "Բարև", "Ի՞նչ կա?"],
    ["id", "Halo", "Apa kabar?"], ["it", "Ciao", "Come va?"], ["ja", "こんにちは", "元気？"],
    ["ka", "გამარჯობა", "რა ხდება?"], ["km", "សួស្តី", "សុខសប្បាយទេ?"], ["kn", "ನಮಸ್ಕಾರ", "ಏನ್ ಸಮಾಚಾರ?"],
    ["ko", "안녕하세요", "잘 지내?"], ["ku", "سڵاو", "چۆنی؟"], ["lo", "ສະບາຍດີ", "ສະບາຍດີບໍ?"],
    ["lt", "Labas", "Kaip sekasi?"], ["lv", "Sveiki", "Kā iet?"], ["mk", "Здраво", "Како си?"],
    ["ml", "നമസ്കാരം", "എന്ത് വിശേഷം?"], ["mn", "Сайн уу", "Юу байна?"], ["mr", "नमस्कार", "काय चाललंय?"],
    ["ms", "Helo", "Apa khabar?"], ["my", "မင်္ဂလာပါ", "နေကောင်းလား?"], ["ne", "नमस्ते", "के छ?"],
    ["nl", "Hallo", "Hoe gaat het?"], ["no", "Hei", "Hva skjer?"], ["pa", "ਸਤ ਸ੍ਰੀ ਅਕਾਲ", "ਕੀ ਹਾਲ ਹੈ?"],
    ["pl", "Cześć", "Co słychać?"], ["ps", "سلام", "څنګه يې؟"], ["pt", "Olá", "Tudo bem?"],
    ["ro", "Bună", "Ce faci?"], ["ru", "Привет", "Как дела?"], ["sd", "سلام", "ڪيئن آهيو؟"],
    ["si", "ආයුබෝවන්", "කොහොමද?"], ["sk", "Ahoj", "Čo je nové?"], ["sl", "Živjo", "Kako si?"],
    ["sq", "Përshëndetje", "Si je?"], ["sr", "Здраво", "Како си?"], ["sv", "Hej", "Läget?"],
    ["sw", "Jambo", "Mambo?"], ["ta", "வணக்கம்", "எப்படி இருக்க?"], ["te", "నమస్కారం", "ఏంటి సంగతులు?"],
    ["th", "สวัสดี", "เป็นไงบ้าง?"], ["tr", "Merhaba", "Ne haber?"], ["ug", "سالام", "قانداق؟"],
    ["uk", "Привіт", "Як справи?"], ["ur", "سلام", "کیا حال ہے؟"], ["vi", "Xin chào", "Dạo này sao?"],
    ["yi", "העלא", "וואָס מאַכסטו?"], ["zh", "你好", "怎么样？"],
  ] as [string, string, string][]
).map(([code, hello, whatsup]) => ({ code, hello, whatsup, rtl: RTL_GREET.has(code) }));

type Greeting = { text: string; rtl: boolean };
// Resolve a locale to the word currently being typed — hello at rest, "what's
// up?" while hovered — keeping the locale's text direction.
const pickPhrase = (i: number, hover: boolean): Greeting => {
  const p = PHRASES[i];
  return { text: hover ? p.whatsup : p.hello, rtl: p.rtl };
};

// Random next locale, never the current one. Picks uniformly among the other
// N - 1 entries (map [0, N-2] over the gap left by `cur`), so every sign has an
// equal chance and no sign ever repeats back-to-back.
const randomIndex = (n: number): number => Math.floor(Math.random() * n);
const nextIndex = (cur: number, n: number): number => {
  const r = Math.floor(Math.random() * (n - 1));
  return r >= cur ? r + 1 : r;
};

const LanguagesViz: React.FC = () => {
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<HTMLSpanElement>(null);
  const hoverRef = useRef(false);
  // Start on a random sign so the first one shown isn't always English.
  const startIdx = useRef<number>(undefined as unknown as number);
  if (startIdx.current === undefined) startIdx.current = randomIndex(PHRASES.length);
  const [idx, setIdx] = useState(startIdx.current);
  const [active, setActive] = useState<Greeting>(() => pickPhrase(startIdx.current, false));
  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState<"typing" | "deleting">("typing");

  const chars = useMemo(() => Array.from(active.text), [active.text]);

  // Hovering anywhere on the tile switches the loop from "hello" to a casual
  // "What's up?" in the same language — the current word deletes and the new one
  // types in; the locale cycle keeps running underneath either way.
  useEffect(() => {
    const group = rootRef.current?.closest("button");
    if (!group) return;
    const onHover = (h: boolean) => () => {
      hoverRef.current = h;
      if (reduce) setActive((a) => pickPhrase(idx, h) ?? a);
      else setPhase("deleting"); // delete current, retype with the new field
    };
    const enter = onHover(true);
    const leave = onHover(false);
    group.addEventListener("mouseenter", enter);
    group.addEventListener("mouseleave", leave);
    return () => {
      group.removeEventListener("mouseenter", enter);
      group.removeEventListener("mouseleave", leave);
    };
  }, [reduce, idx]);

  // Light the field's border brand-pink only where the glow blob reaches the edge
  // — the same masked-edge reveal the other tiles use. Driven off the whole tile
  // so the lit arc trails the blob, masked through a field-relative radial.
  useEffect(() => {
    if (reduce) return;
    const tile = rootRef.current?.closest(".bento-tile");
    const field = fieldRef.current;
    if (!tile || !field) return;

    const apply = (clientX: number | null, clientY: number | null) => {
      const edge = edgeRef.current;
      if (!edge) return;
      if (clientX === null || clientY === null) {
        edge.style.opacity = "0";
        return;
      }
      const r = field.getBoundingClientRect();
      const mask = `radial-gradient(${CHIP_GLOW_RADIUS}px circle at ${clientX - r.left}px ${clientY - r.top}px, #000 0%, transparent 62%)`;
      edge.style.opacity = "1";
      edge.style.maskImage = mask;
      edge.style.webkitMaskImage = mask;
    };

    const onMove = (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.pointerType === "mouse") apply(pe.clientX, pe.clientY);
    };
    const onLeave = () => apply(null, null);

    tile.addEventListener("pointermove", onMove);
    tile.addEventListener("pointerleave", onLeave);
    return () => {
      tile.removeEventListener("pointermove", onMove);
      tile.removeEventListener("pointerleave", onLeave);
    };
  }, [reduce]);

  // Typewriter: type the active word char-by-char, hold, delete it, advance to the
  // next locale, and type that — looping all 68 in whichever field hover selects.
  // RTL words type from the right with the caret on their leading edge. One self-
  // rescheduling timer; the active word only swaps at count 0, so deletes never
  // visibly jump text. hoverRef is read live so a mid-cycle hover takes effect at
  // the next word boundary without restarting the loop.
  useEffect(() => {
    if (reduce) return;
    let t: number;
    if (phase === "typing") {
      if (count < chars.length) {
        t = window.setTimeout(() => setCount((c) => c + 1), 70);
      } else {
        t = window.setTimeout(() => setPhase("deleting"), 1200);
      }
    } else if (count > 0) {
      t = window.setTimeout(() => setCount((c) => c - 1), 32);
    } else {
      t = window.setTimeout(() => {
        const ni = nextIndex(idx, PHRASES.length);
        setIdx(ni);
        setActive(pickPhrase(ni, hoverRef.current));
        setPhase("typing");
      }, 240);
    }
    return () => window.clearTimeout(t);
  }, [phase, count, chars.length, idx, reduce]);

  const shown = reduce ? active.text : chars.slice(0, count).join("");

  // Some "what's up?" phrases are far longer than a one-word hello, so size the
  // line down to fit the field. Measure the FULL active phrase (hidden twin) once
  // per word — not the typed prefix — so the type size stays steady while it
  // types and never overflows. Anchored to the leading edge so the caret holds.
  const measureRef = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    const measure = measureRef.current;
    if (!field || !measure) return;
    const avail = field.clientWidth - 40 - 16; // px-5 padding + caret/gap reserve
    const w = measure.scrollWidth;
    setScale(w > avail && w > 0 ? Math.max(0.5, avail / w) : 1);
  }, [active.text]);

  return (
    <div ref={rootRef} aria-hidden="true" className="flex size-full items-center">
      <div ref={fieldRef} className="relative h-16 w-full overflow-hidden rounded-2xl border border-border/60 bg-secondary px-5 shadow-[inset_0_1px_3px_rgba(0,0,0,0.05)]">
        <span
          ref={edgeRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 rounded-2xl border-[1.5px] border-brand-from opacity-0 transition-opacity duration-200"
        />
        <div
          className={`flex h-full items-center gap-2.5 ${active.rtl ? "flex-row-reverse" : ""}`}
          style={{ transform: `scale(${scale})`, transformOrigin: active.rtl ? "right center" : "left center" }}
        >
          <span dir={active.rtl ? "rtl" : "ltr"} className="whitespace-nowrap text-[1.7rem] font-semibold tracking-tight text-foreground/90">
            {shown}
          </span>
          <span className="bento-caret inline-block h-7 w-[3px] shrink-0 rounded-full bg-brand-from" />
        </div>
        <span
          ref={measureRef}
          aria-hidden="true"
          className="pointer-events-none absolute -z-10 whitespace-nowrap text-[1.7rem] font-semibold tracking-tight opacity-0"
        >
          {active.text}
        </span>
      </div>
    </div>
  );
};

// Media blocks — image, video and audio. The top is a real-looking photo poster
// (sunset landscape) wearing a video play button + timestamp, so it reads as both
// an image and a playable video the way a real media block does; the bottom is an
// audio clip you can scrub. Concrete media a newcomer recognises at a glance —
// not an abstract swatch.
// Enough bars to span the full track (spread edge-to-edge via justify-between);
// the first third reads as the played portion (see PLAYED below).
const WAVE = [
  4, 7, 10, 6, 12, 8, 14, 9, 11, 7, 13, 6, 10, 15, 8, 12,
  7, 9, 5, 11, 8, 13, 6, 10, 7, 12, 9, 6, 8, 5,
];
const PLAYED = Math.round(WAVE.length / 3);

const MediaViz: React.FC = () => {
  const videoRef = useRef<HTMLDivElement>(null);
  const videoEdgeRef = useRef<HTMLSpanElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const audioEdgeRef = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();

  // Light each media block's border with brand pink where the tile's glow blob
  // touches it — the same blob-tracked radial reveal the JSON pane, chip grid and
  // table use. Each edge is masked against its own block's rect so the two blocks
  // light independently as the blob sweeps across them.
  useEffect(() => {
    if (reduce) return;
    const tile = videoRef.current?.closest(".bento-tile");
    if (!tile) return;

    const panes: Array<[HTMLDivElement | null, HTMLSpanElement | null]> = [
      [videoRef.current, videoEdgeRef.current],
      [audioRef.current, audioEdgeRef.current],
    ];

    const apply = (clientX: number | null, clientY: number | null) => {
      for (const [block, edge] of panes) {
        if (!block || !edge) continue;
        if (clientX === null || clientY === null) {
          edge.style.opacity = "0";
          continue;
        }
        const r = block.getBoundingClientRect();
        const mask = `radial-gradient(${CHIP_GLOW_RADIUS}px circle at ${clientX - r.left}px ${clientY - r.top}px, #000 0%, transparent 62%)`;
        edge.style.opacity = "1";
        edge.style.maskImage = mask;
        edge.style.webkitMaskImage = mask;
      }
    };

    const onMove = (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.pointerType === "mouse") apply(pe.clientX, pe.clientY);
    };
    const onLeave = () => apply(null, null);

    tile.addEventListener("pointermove", onMove);
    tile.addEventListener("pointerleave", onLeave);
    return () => {
      tile.removeEventListener("pointermove", onMove);
      tile.removeEventListener("pointerleave", onLeave);
    };
  }, [reduce]);

  return (
  <div aria-hidden="true" className="flex w-full flex-col gap-2">
    {/* Image / video: a sunset photo you can play. bg-card gives an opaque base so
        the tile's hover glow blob can't bleed pink through the translucent sky. */}
    <div ref={videoRef} className="relative h-[60px] overflow-hidden rounded-xl border border-border/60 bg-card">
      {/* brand border revealed where the glow blob touches the block */}
      <span
        ref={videoEdgeRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-30 rounded-xl border-[1.5px] border-brand-from opacity-0 transition-opacity duration-200"
      />
      {/* Layered dusk scene — each plane drifts at its own rate on hover for a soft
          parallax push, so the still reads as live footage the moment you reach play. */}
      <div className="absolute inset-0">
        {/* sky — cool dusk up high melting into warm rose, gold at the ridgeline */}
        <div className="absolute inset-0 bg-linear-to-b from-brand-from/45 via-brand-via/35 to-brand-to/55" />
        <div className="absolute inset-x-0 top-0 h-2/3 bg-linear-to-b from-violet-400/15 to-transparent" />
        {/* a lone wisp of cloud, drifting on hover */}
        <div className="absolute left-5 top-3 h-1.5 w-12 rounded-full bg-white/35 blur-[3px] transition-transform duration-[1600ms] ease-out motion-safe:group-hover:-translate-x-2" />
        {/* golden bloom pooling along the horizon beneath the sun */}
        <div className="absolute -bottom-1 right-1 h-9 w-28 rounded-[100%] bg-[radial-gradient(closest-side,_rgba(255,221,186,0.6),_rgba(255,221,186,0)_72%)] blur-[2px]" />
        {/* a pair of birds, far off in the evening sky */}
        <svg className="absolute left-8 top-2.5 w-7 text-foreground/25 transition-transform duration-[1600ms] ease-out motion-safe:group-hover:translate-x-1 motion-safe:group-hover:-translate-y-0.5" viewBox="0 0 28 9" fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" aria-hidden="true">
          <path d="M1 5 Q3 2.5 5 5 Q7 2.5 9 5" />
          <path d="M16 6.5 Q17.6 4.6 19 6.5 Q20.4 4.6 22 6.5" />
        </svg>
        {/* setting sun — a luminous core bleeding into a wide warm bloom, rising on hover */}
        <div className="absolute right-5 top-0 size-14 -translate-y-1 rounded-full bg-[radial-gradient(circle,_rgba(255,255,255,0.98)_0%,_rgba(255,250,242,0.7)_18%,_rgba(255,232,205,0.32)_42%,_rgba(255,232,205,0)_70%)] transition-transform duration-700 ease-out motion-safe:group-hover:-translate-y-2 motion-safe:group-hover:scale-110" />
        {/* distant range — a pale haze ridge, atmospheric perspective at its faintest */}
        <svg className="absolute inset-x-0 bottom-0 h-8 w-full origin-bottom text-foreground/8 transition-transform duration-[1400ms] ease-out motion-safe:group-hover:scale-[1.02]" viewBox="0 0 120 30" preserveAspectRatio="none" fill="currentColor" aria-hidden="true">
          <path d="M0 30 20 18 38 24 58 14 78 22 98 13 120 20 120 30Z" />
        </svg>
        {/* far range — hazy and pale, hung higher up the sky */}
        <svg className="absolute inset-x-0 bottom-0 h-7 w-full origin-bottom text-foreground/16 transition-transform duration-[1400ms] ease-out motion-safe:group-hover:scale-[1.05]" viewBox="0 0 120 28" preserveAspectRatio="none" fill="currentColor" aria-hidden="true">
          <path d="M0 28 16 14 30 20 50 9 68 18 88 8 104 16 120 11 120 28Z" />
        </svg>
        {/* near range — darker and lower, overlapping the far range to build depth */}
        <svg className="absolute inset-x-0 bottom-0 h-5 w-full origin-bottom text-foreground/34 transition-transform duration-[1400ms] ease-out motion-safe:group-hover:scale-[1.1]" viewBox="0 0 120 22" preserveAspectRatio="none" fill="currentColor" aria-hidden="true">
          <path d="M0 22 18 13 34 18 54 10 72 16 92 11 110 17 120 14 120 22Z" />
        </svg>
        {/* photographic vignette — warm, soft, frames the scene */}
        <div className="absolute inset-0 bg-[radial-gradient(120%_130%_at_50%_32%,_transparent_56%,_rgba(70,35,45,0.16)_100%)]" />
      </div>
      {/* video play button — a sonar ring pulses outward while hovered */}
      <span className="absolute inset-0 z-10 m-auto flex size-9 items-center justify-center rounded-full bg-white/95 text-primary shadow-md transition-transform duration-300 group-hover:scale-110">
        <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/70 opacity-0 motion-safe:group-hover:animate-ping" aria-hidden="true" />
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="relative translate-x-px">
          <path d="M8 5.5 19 12 8 18.5Z" />
        </svg>
      </span>
      {/* duration badge — the unmistakable "this is a video" cue */}
      <span className="absolute bottom-1.5 right-1.5 z-10 rounded bg-black/45 px-1 py-px font-mono text-[8px] font-medium text-white backdrop-blur-sm">0:24</span>
    </div>
    {/* Audio: a clip you can scrub — note chip, waveform playhead, duration. */}
    <div ref={audioRef} className="relative flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-2.5 py-2">
      {/* brand border revealed where the glow blob touches the block */}
      <span
        ref={audioEdgeRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-30 rounded-xl border-[1.5px] border-brand-from opacity-0 transition-opacity duration-200"
      />
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-linear-to-br from-brand-from to-brand-to text-white shadow-sm transition-transform duration-300 ease-out group-hover:scale-110 group-hover:-rotate-3">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 18V6l10-2.5V14" />
          <circle cx="6.5" cy="18" r="2.5" fill="currentColor" stroke="none" />
          <circle cx="16.5" cy="14" r="2.5" fill="currentColor" stroke="none" />
        </svg>
      </span>
      {/* Waveform — bars sit still as a frozen clip, then dance like a live
          equalizer while the tile is hovered (staggered phase per bar). */}
      <div className="flex flex-1 items-center justify-between">
        {WAVE.map((h, i) => (
          <span
            key={i}
            className={`w-[2px] rounded-full ${i < PLAYED ? "bg-primary" : "bg-foreground/25"} motion-safe:group-hover:animate-[audio-eq_700ms_ease-in-out_infinite]`}
            style={{ height: `${h}px`, animationDelay: `${i * -0.09}s`, animationDuration: `${0.66 + (i % 4) * 0.13}s` }}
          />
        ))}
      </div>
      <span className="shrink-0 font-mono text-[9px] text-muted-foreground">1:32</span>
    </div>
  </div>
  );
};

// Maps a feature's unique accent key → its bento span (lg only) + its diorama.
const TILE: Record<string, { span: string; viz: React.FC }> = {
  coral: { span: "lg:col-span-2 lg:row-span-2", viz: CleanJsonViz },
  green: { span: "lg:col-span-2", viz: BlocksViz },
  orange: { span: "lg:col-span-2", viz: ExtensibleViz },
  // The capability tiles use lg:order-* to drive the grid auto-placement into the
  // hero-led mosaic (Tables a 2×2 showpiece, the rest orbiting) without having to
  // reorder the FEATURES data. Pillars stay at the default order, so they fill the
  // top rows first.
  pink: { span: "lg:col-span-1 lg:order-1", viz: SlashViz },
  cyan: { span: "lg:col-span-2 lg:order-2", viz: TablesViz },
  media: { span: "lg:col-span-1 lg:order-3", viz: MediaViz },
  // Last row: a single tile, Embeds spanning the two middle columns, a single tile.
  yellow: { span: "lg:col-span-1 lg:order-4", viz: UndoViz },
  blue: { span: "lg:col-span-2 lg:order-5", viz: EmbedsViz },
  mauve: { span: "lg:col-span-1 lg:order-6", viz: LanguagesViz },
};

type TileProps = {
  feature: FeatureDetail;
  onOpen: (feature: FeatureDetail) => void;
};

// A defining pillar — the largest tiles in the mosaic. The hero (coral) stacks
// vertically with its diorama; the two wides run text-beside-diorama at lg.
const PillarTile: React.FC<
  TileProps & {
    index: number;
    isCarousel: boolean;
    activeIndex: number;
  }
> = ({ feature, index, isCarousel, activeIndex, onOpen }) => {
  const Viz = TILE[feature.accent].viz;
  const isHero = feature.accent === "coral";
  const tilt = useTilt();

  return (
    <motion.button
      type="button"
      variants={pillarVariants}
      initial={false}
      animate={!isCarousel || index === activeIndex ? "focused" : "unfocused"}
      data-pillar-focused={isCarousel && index === activeIndex ? "true" : undefined}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      transition={hoverSpring}
      style={tilt.style}
      {...tilt.handlers}
      className={`bento-tile group relative flex w-[74vw] shrink-0 snap-center cursor-pointer flex-col items-start gap-4 overflow-hidden rounded-3xl border border-border/60 bg-card p-7 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:w-auto md:shrink lg:w-auto ${TILE[feature.accent].span} ${
        isHero ? "lg:gap-3.5 lg:p-7" : "lg:flex-row lg:items-stretch"
      }`}
      onClick={() => onOpen(feature)}
      aria-label={feature.learnMore}
    >
      <span className="bento-spot" aria-hidden="true" />

      <div className={`relative z-10 flex flex-col ${isHero ? "" : "lg:w-[44%] lg:shrink-0 lg:justify-center"}`}>
        <h3 className={`text-balance font-extrabold leading-[1.05] tracking-tight ${isHero ? "text-[1.9rem] lg:text-[2.35rem]" : "text-[1.5rem] lg:text-[1.75rem]"}`}>
          {feature.title}
        </h3>
      </div>

      <div className={`relative z-10 flex w-full flex-1 ${isHero ? "items-stretch" : "items-center"}`}>
        <Viz />
      </div>
    </motion.button>
  );
};

// Renders a tile title, tinting any literal "/" with the brand gradient so the
// slash reads as the command character, not stray punctuation. Surrounding
// spacing is preserved verbatim, so it works for both "Type / to add anything"
// and the Russian "Введите /, чтобы…". Titles without a slash pass straight through.
const renderTitleWithSlashKey = (title: string): React.ReactNode => {
  if (!title.includes("/")) return title;
  return title.split("/").map((segment, i) => (
    <Fragment key={i}>
      {i > 0 && <span className="text-brand-gradient font-extrabold">/</span>}
      {segment}
    </Fragment>
  ));
};

// A supporting capability — a compact title chip below lg, unfolding into its
// own diorama tile in the bento.
const CapabilityTile: React.FC<TileProps> = ({ feature, onOpen }) => {
  const Viz = TILE[feature.accent].viz;
  const tilt = useTilt();
  // The embeds tile clears its title on hover so the diagonal river of logos can
  // flood the whole block.
  const isEmbeds = feature.accent === "blue";

  return (
    <motion.button
      type="button"
      variants={cardVariants}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      transition={hoverSpring}
      style={tilt.style}
      {...tilt.handlers}
      className={`bento-tile group relative flex min-h-[60px] cursor-pointer flex-col justify-center gap-3 overflow-hidden rounded-2xl border border-border/60 bg-card p-4 text-left transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:justify-start lg:p-5 ${isEmbeds ? "lg:transition-[gap,background-color] lg:group-hover:gap-0" : ""} ${TILE[feature.accent].span}`}
      onClick={() => onOpen(feature)}
      aria-label={feature.learnMore}
    >
      <span className="bento-spot" aria-hidden="true" />
      <div
        className={`relative z-10 grid ${
          isEmbeds
            ? "transition-[grid-template-rows] duration-[600ms] ease-[cubic-bezier(0.22,1,0.36,1)] lg:grid-rows-[1fr] lg:group-hover:grid-rows-[0fr]"
            : ""
        }`}
      >
        <div className={isEmbeds ? "min-h-0 overflow-hidden" : ""}>
          <div
            className={`flex w-full items-center gap-3.5 ${
              isEmbeds
                ? "transition-[transform,opacity,filter] duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] lg:group-hover:-translate-y-2 lg:group-hover:opacity-0 lg:group-hover:blur-[2px]"
                : ""
            }`}
          >
            <h3 className="flex-1 text-balance text-[1.05rem] font-bold leading-snug tracking-tight">
              {renderTitleWithSlashKey(feature.title)}
            </h3>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0 text-primary/40 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-primary lg:hidden"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>
      <div
        className={`relative z-10 hidden flex-1 items-center lg:flex ${
          isEmbeds
            ? "-mx-5 w-[calc(100%+2.5rem)] overflow-hidden transition-[margin] duration-500 ease-out lg:group-hover:-mb-8 lg:group-hover:-mt-10"
            : "w-full pt-1"
        }`}
      >
        <Viz />
      </div>
    </motion.button>
  );
};

export const Features: React.FC = () => {
  const { t } = useI18n();
  const [selectedFeature, setSelectedFeature] = useState<FeatureDetail | null>(
    null,
  );
  // On mobile the three pillars collapse into a horizontal snap-scroll carousel;
  // `activeIndex` drives the pagination dots and the focus scale-up. Only the
  // centred card grows to full size. From lg up everything reflows into a single
  // Apple-style bento mosaic, so the focus effect and dots are retired.
  const carouselRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isCarousel, setIsCarousel] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsCarousel(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const FEATURES = useMemo<FeatureDetail[]>(() => [
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="fi fi-json">
          {/* Braces cradling a value node */}
          <path d="M14 7.5C11.8 7.5 12.4 9.8 12.4 11.2 12.4 12.6 11.6 13.3 10.5 14 11.6 14.7 12.4 15.4 12.4 16.8 12.4 18.2 11.8 20.5 14 20.5" />
          <path d="M18 7.5C20.2 7.5 19.6 9.8 19.6 11.2 19.6 12.6 20.4 13.3 21.5 14 20.4 14.7 19.6 15.4 19.6 16.8 19.6 18.2 20.2 20.5 18 20.5" />
          <circle cx="16" cy="14" r="1.15" fill="currentColor" stroke="none" />
        </svg>
      ),
      title: t('home.features.cleanJson.title'),
      description: t('home.features.cleanJson.description'),
      learnMore: t('home.features.cleanJson.learnMore'),
      accent: "coral",
      tier: "primary",
      details: {
        summary: t('home.features.cleanJson.details.summary'),
        benefits: [
          t('home.features.cleanJson.details.benefit1'),
          t('home.features.cleanJson.details.benefit2'),
          t('home.features.cleanJson.details.benefit3'),
          t('home.features.cleanJson.details.benefit4'),
        ],
        codeExample: `const data = await editor.save();
// { blocks: [{ id: "x1", type: "paragraph", data: { text: "Hello" } }] }`,
        apiLink: "/docs#saver-api",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="fi fi-blocks">
          {/* Stacked blocks — the block library */}
          <rect x="5.5" y="5.5" width="11" height="9" rx="2.6" fill="currentColor" fillOpacity="0.12" />
          <rect x="16.5" y="10.5" width="11" height="9" rx="2.6" fill="currentColor" fillOpacity="0.12" />
          <rect x="9.5" y="17.5" width="11" height="9" rx="2.6" fill="currentColor" fillOpacity="0.22" />
        </svg>
      ),
      title: t('home.features.blockLibrary.title'),
      description: t('home.features.blockLibrary.description'),
      learnMore: t('home.features.blockLibrary.learnMore'),
      accent: "green",
      tier: "primary",
      details: {
        summary: t('home.features.blockLibrary.details.summary'),
        benefits: [
          t('home.features.blockLibrary.details.benefit1'),
          t('home.features.blockLibrary.details.benefit2'),
          t('home.features.blockLibrary.details.benefit3'),
          t('home.features.blockLibrary.details.benefit4'),
        ],
        codeExample: `import Blok from '@jackuait/blok/full';

// Tables, databases, columns, code, media and embeds — all registered
new Blok({ holder: 'editor' });`,
        apiLink: "/tools",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="fi fi-ext">
          {/* Dashed frame + plus — bring your own block */}
          <rect x="6" y="6" width="20" height="20" rx="5" strokeDasharray="3.5 3.6" fill="currentColor" fillOpacity="0.08" />
          <path d="M16 11.5v9M11.5 16h9" strokeWidth="2.4" />
        </svg>
      ),
      title: t('home.features.customBlocks.title'),
      description: t('home.features.customBlocks.description'),
      learnMore: t('home.features.customBlocks.learnMore'),
      accent: "orange",
      tier: "primary",
      details: {
        summary: t('home.features.customBlocks.details.summary'),
        benefits: [
          t('home.features.customBlocks.details.benefit1'),
          t('home.features.customBlocks.details.benefit2'),
          t('home.features.customBlocks.details.benefit3'),
          t('home.features.customBlocks.details.benefit4'),
        ],
        codeExample: `class MyTool {
  static get toolbox() {
    return { title: 'My Tool', icon: '<svg>...</svg>' };
  }
  render() { return document.createElement('div'); }
  save(element) { return { text: element.innerHTML }; }
}`,
        apiLink: "/docs#tools-api",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="fi fi-slash">
          {/* Command menu with a slash key */}
          <rect x="5" y="7.5" width="22" height="17" rx="5" fill="currentColor" fillOpacity="0.12" />
          <path d="M18.5 12 13.5 20" strokeWidth="2.3" />
        </svg>
      ),
      title: t('home.features.slashCommands.title'),
      description: t('home.features.slashCommands.description'),
      learnMore: t('home.features.slashCommands.learnMore'),
      accent: "pink",
      details: {
        summary: t('home.features.slashCommands.details.summary'),
        benefits: [
          t('home.features.slashCommands.details.benefit1'),
          t('home.features.slashCommands.details.benefit2'),
          t('home.features.slashCommands.details.benefit3'),
          t('home.features.slashCommands.details.benefit4'),
        ],
        codeExample: `new Blok({
  tools: {
    myBlock: {
      class: MyBlockTool,
      toolbox: { title: 'My Block', icon: '<svg>...</svg>' }
    }
  }
});`,
        apiLink: "/docs#toolbar-api",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="fi fi-table">
          {/* Table grid */}
          <rect x="5" y="7" width="22" height="18" rx="3.5" fill="currentColor" fillOpacity="0.10" />
          <path d="M5 13h22M5 19h22M12.5 7v18M19.5 7v18" strokeWidth="1.6" />
        </svg>
      ),
      title: t('home.features.tables.title'),
      description: t('home.features.tables.description'),
      learnMore: t('home.features.tables.learnMore'),
      accent: "cyan",
      details: {
        summary: t('home.features.tables.details.summary'),
        benefits: [
          t('home.features.tables.details.benefit1'),
          t('home.features.tables.details.benefit2'),
          t('home.features.tables.details.benefit3'),
          t('home.features.tables.details.benefit4'),
        ],
        apiLink: "/tools#table",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="fi fi-embed">
          {/* Embed frame with a play head */}
          <rect x="5" y="7" width="22" height="18" rx="4.5" fill="currentColor" fillOpacity="0.10" />
          <path d="M14 12.4 19.8 16 14 19.6 Z" fill="currentColor" strokeWidth="1.6" />
        </svg>
      ),
      title: t('home.features.embeds.title'),
      description: t('home.features.embeds.description'),
      learnMore: t('home.features.embeds.learnMore'),
      accent: "blue",
      details: {
        summary: t('home.features.embeds.details.summary'),
        benefits: [
          t('home.features.embeds.details.benefit1'),
          t('home.features.embeds.details.benefit2'),
          t('home.features.embeds.details.benefit3'),
          t('home.features.embeds.details.benefit4'),
        ],
        apiLink: "/tools#embed",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="fi fi-history">
          {/* Undo / redo — two looping arrows */}
          <path d="M22.5 13.2A8 8 0 0 0 8.5 10.4" />
          <path d="M8 6.4 8.2 11.4 13.2 11" />
          <path d="M9.5 18.8A8 8 0 0 0 23.5 21.6" opacity="0.55" />
          <path d="M24 25.6 23.8 20.6 18.8 21" opacity="0.55" />
        </svg>
      ),
      title: t('home.features.undoRedo.title'),
      description: t('home.features.undoRedo.description'),
      learnMore: t('home.features.undoRedo.learnMore'),
      accent: "yellow",
      details: {
        summary: t('home.features.undoRedo.details.summary'),
        benefits: [
          t('home.features.undoRedo.details.benefit1'),
          t('home.features.undoRedo.details.benefit2'),
          t('home.features.undoRedo.details.benefit3'),
          t('home.features.undoRedo.details.benefit4'),
        ],
        apiLink: "/docs#history-api",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="fi fi-globe">
          {/* Globe with meridian + parallels */}
          <circle cx="16" cy="16" r="9.5" fill="currentColor" fillOpacity="0.10" />
          <ellipse cx="16" cy="16" rx="4.3" ry="9.5" strokeWidth="1.7" />
          <path d="M7 12.5h18M7 19.5h18" strokeWidth="1.7" />
        </svg>
      ),
      title: t('home.features.languages.title'),
      description: t('home.features.languages.description'),
      learnMore: t('home.features.languages.learnMore'),
      accent: "mauve",
      details: {
        summary: t('home.features.languages.details.summary'),
        benefits: [
          t('home.features.languages.details.benefit1'),
          t('home.features.languages.details.benefit2'),
          t('home.features.languages.details.benefit3'),
          t('home.features.languages.details.benefit4'),
        ],
        codeExample: `new Blok({
  i18n: { locale: 'ar' } // Arabic with RTL
});`,
        apiLink: "/docs#i18n-api",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="fi fi-media">
          {/* Picture frame with a mountain + sun */}
          <rect x="4" y="6" width="24" height="20" rx="3.5" fill="currentColor" fillOpacity="0.1" />
          <circle cx="11" cy="13" r="2" fill="currentColor" stroke="none" />
          <path d="M5 22l6-5 4 3.2L21 14l6 5.5" />
        </svg>
      ),
      title: t('home.features.media.title'),
      description: t('home.features.media.description'),
      learnMore: t('home.features.media.learnMore'),
      accent: "media",
      details: {
        summary: t('home.features.media.details.summary'),
        benefits: [
          t('home.features.media.details.benefit1'),
          t('home.features.media.details.benefit2'),
          t('home.features.media.details.benefit3'),
          t('home.features.media.details.benefit4'),
        ],
        apiLink: "/tools#image",
      },
    },
  ], [t]);

  const primaryFeatures = FEATURES.filter((f) => f.tier === "primary");
  const secondaryFeatures = FEATURES.filter((f) => f.tier !== "primary");

  const handleFeatureClick = (feature: FeatureDetail) => {
    setSelectedFeature(feature);
  };

  const handleCloseModal = () => {
    setSelectedFeature(null);
  };

  // Track which pillar is centred in the scrollport so the right dot lights up.
  const handleCarouselScroll = () => {
    const el = carouselRef.current;
    if (!el) return;
    const cards = Array.from(el.children) as HTMLElement[];
    const viewportCenter = el.getBoundingClientRect().left + el.clientWidth / 2;
    let closest = 0;
    let minDistance = Infinity;
    cards.forEach((card, index) => {
      const rect = card.getBoundingClientRect();
      const distance = Math.abs(rect.left + rect.width / 2 - viewportCenter);
      if (distance < minDistance) {
        minDistance = distance;
        closest = index;
      }
    });
    setActiveIndex(closest);
  };

  const scrollToCard = (index: number) => {
    const card = carouselRef.current?.children[index] as HTMLElement | undefined;
    card?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };

  return (
    <section
      className="py-20 sm:py-28"
      id="features"
      aria-label={t('home.features.sectionLabel')}
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionReveal className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            <span className="block">{t('home.features.title1')}</span>
            <span className="block">{t('home.features.title2')}</span>
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            {t('home.features.description')}
          </p>
        </SectionReveal>

        {/* The bento stage. Below lg this is just a flow container: the three
            pillars are a swipeable carousel, the six capabilities a tidy grid.
            From lg up it becomes ONE asymmetric mosaic — both inner wrappers go
            `display: contents`, so all nine tiles drop straight into this grid
            and place themselves via their per-tile span classes. */}
        <div className="mt-14 lg:grid lg:grid-cols-4 lg:auto-rows-[11.5rem] lg:gap-4">
          {/* The three pillars that define Blok — the largest tiles in the mosaic.
              Mobile: a horizontal snap-scroll carousel that peeks both neighbours. */}
          <div
            ref={carouselRef}
            onScroll={handleCarouselScroll}
            className="-mx-6 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-px-[13vw] px-[13vw] pb-2 [-ms-overflow-style:none] [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:scroll-px-0 md:pb-0 lg:contents [&::-webkit-scrollbar]:hidden"
          >
            {primaryFeatures.map((feature, index) => (
              <PillarTile
                key={feature.accent}
                feature={feature}
                index={index}
                isCarousel={isCarousel}
                activeIndex={activeIndex}
                onOpen={handleFeatureClick}
              />
            ))}
          </div>

          {/* Carousel pagination — mobile only; the bento shows everything at lg+. */}
          <div
            className="mt-5 flex justify-center gap-2 md:hidden"
            role="group"
            aria-label={t('home.features.sectionLabel')}
          >
            {primaryFeatures.map((feature, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  key={feature.accent}
                  type="button"
                  onClick={() => scrollToCard(index)}
                  aria-current={isActive ? "true" : undefined}
                  aria-label={`Go to ${feature.title}`}
                  className={`h-2 rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    isActive ? "w-6 bg-primary" : "w-2 bg-foreground/15"
                  }`}
                />
              );
            })}
          </div>

          {/* Supporting capabilities. Compact title chips below lg; from lg up
              each unfolds into its own bento tile with a diorama. */}
          <motion.div
            className="mt-10 grid grid-cols-2 gap-3 sm:mt-6 sm:gap-4 md:grid-cols-3 lg:contents"
            variants={gridVariants}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-60px" }}
          >
            {secondaryFeatures.map((feature) => (
              <CapabilityTile
                key={feature.accent}
                feature={feature}
                onOpen={handleFeatureClick}
              />
            ))}
          </motion.div>
        </div>
      </div>

      <FeatureModal feature={selectedFeature} onClose={handleCloseModal} />
    </section>
  );
};

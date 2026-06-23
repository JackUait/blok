import { useEffect, useMemo, useRef, useState } from "react";
import {
  motion,
  useReducedMotion,
  useSpring,
  type Variants,
} from "framer-motion";
import { SectionReveal } from "../common/SectionReveal";
import { FeatureModal, type FeatureDetail } from "./FeatureModal";
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
          lit ? "" : "border-border/50 bg-card text-muted-foreground"
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

const BlocksViz: React.FC = () => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const litRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  // Drive the border reveal off the whole tile, not just the grid — so the chips
  // light the moment the tile's glow blob reaches them, even while the cursor is
  // still over the title. (Scoping the listener to the grid made borders wait for
  // the mouse to physically arrive, decoupling them from the blob.)
  useEffect(() => {
    if (reduce) return;
    const wrap = wrapRef.current;
    const tile = wrap?.closest(".bento-tile");
    if (!wrap || !tile) return;

    const apply = (clientX: number | null, clientY: number | null) => {
      const lit = litRef.current;
      if (!lit) return;
      if (clientX === null || clientY === null) {
        lit.style.opacity = "0";
        return;
      }
      const r = wrap.getBoundingClientRect();
      const mask = `radial-gradient(${CHIP_GLOW_RADIUS}px circle at ${clientX - r.left}px ${clientY - r.top}px, #000 0%, transparent 62%)`;
      lit.style.opacity = "1";
      lit.style.maskImage = mask;
      lit.style.webkitMaskImage = mask;
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
  // rounded bar chart — a custom "Poll" block someone added themselves
  {
    label: "Poll",
    mine: true,
    glyph: (
      <>
        <path d="M4 20.25h16" />
        <rect x="5.5" y="11.5" width="3.6" height="6.5" rx="1.3" fill="currentColor" fillOpacity="0.2" stroke="none" />
        <rect x="5.5" y="11.5" width="3.6" height="6.5" rx="1.3" />
        <rect x="10.2" y="6.5" width="3.6" height="11.5" rx="1.3" fill="currentColor" fillOpacity="0.2" stroke="none" />
        <rect x="10.2" y="6.5" width="3.6" height="11.5" rx="1.3" />
        <rect x="14.9" y="9" width="3.6" height="9" rx="1.3" fill="currentColor" fillOpacity="0.2" stroke="none" />
        <rect x="14.9" y="9" width="3.6" height="9" rx="1.3" />
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
    const onLeave = () => apply(null, null);

    tile.addEventListener("pointermove", onMove);
    tile.addEventListener("pointerleave", onLeave);
    return () => {
      tile.removeEventListener("pointermove", onMove);
      tile.removeEventListener("pointerleave", onLeave);
    };
  }, [reduce]);

  return (
  <div aria-hidden="true" className="relative h-full min-h-[150px] w-full">
    {/* Floating block-picker dropdown — wider than the tile's viz column and
        anchored top-left so it bleeds over the right + bottom borders. */}
    <div ref={cardRef} className="absolute left-0 top-[-6px] w-[122%] overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[0_24px_55px_-14px_rgba(0,0,0,0.25)]">
      {/* brand border revealed where the glow blob touches the picker's edge */}
      <span
        ref={edgeRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-30 rounded-2xl border-[1.5px] border-brand-from opacity-0 transition-opacity duration-200"
      />
      {/* picker search header */}
      <div className="flex items-center gap-2 border-b border-border/50 px-3.5 py-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/70">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span className="flex items-center text-[11.5px] font-medium tracking-tight text-muted-foreground">
          Add a block
          <span className="bento-caret ml-0.5 inline-block h-3 w-px bg-primary" />
        </span>
      </div>

      <div className="flex flex-col gap-1 px-2 pt-2 pb-6">
        {PAGE_BLOCKS.map((block) => (
          <div
            key={block.label}
            style={block.mine ? { borderColor: "var(--brand-from)" } : undefined}
            className={`flex items-center gap-2.5 rounded-xl border px-3 py-1.5 ${
              block.mine ? "bg-primary/[0.06]" : "border-transparent"
            }`}
          >
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-[10px] ${
                block.mine
                  ? "bg-linear-to-br from-brand-from to-brand-to text-white shadow-[0_4px_12px_-2px_rgba(233,78,122,0.5)] ring-1 ring-inset ring-white/25"
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
              <span className="ml-auto rounded-full bg-linear-to-r from-brand-from to-brand-to px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                yours
              </span>
            )}
          </div>
        ))}

        {/* The invitation: gray at rest, its brand colour revealed only where the
            glow blob masks over it (lit duplicate stacked above the gray base). */}
        <div className="relative">
          <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-border px-3 py-1.5 text-muted-foreground">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[10px] border border-dashed border-border">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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

// The slash toolbox: a search row with a live caret + fuzzy-matched results.
const SLASH_ROWS = [
  { label: "Heading", k: "H1", active: true },
  { label: "Table", k: "/tb", active: false },
  { label: "Code", k: "```", active: false },
];

const SlashViz: React.FC = () => (
  <div aria-hidden="true" className="w-full overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
    <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
      <span className="flex size-5 items-center justify-center rounded-md bg-linear-to-br from-brand-from to-brand-to font-mono text-[11px] font-bold text-white">/</span>
      <span className="font-mono text-[11px] text-muted-foreground">head</span>
      <span className="bento-caret h-3.5 w-px bg-primary" />
    </div>
    <div className="flex flex-col p-1">
      {SLASH_ROWS.map((row) => (
        <div
          key={row.label}
          className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-[11px] transition-colors ${
            row.active
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground group-hover:bg-secondary"
          }`}
        >
          <span className="font-medium">{row.label}</span>
          <span className="font-mono text-[9px] opacity-70">{row.k}</span>
        </div>
      ))}
    </div>
  </div>
);

// A three-lane kanban where every card is itself a block — the cards breathe.
const KANBAN = [
  { n: 2, h: [13, 9] },
  { n: 1, h: [16] },
  { n: 2, h: [11, 14] },
];

const DatabasesViz: React.FC = () => (
  <div aria-hidden="true" className="flex w-full gap-2">
    {KANBAN.map((col, ci) => (
      <div key={ci} className="flex flex-1 flex-col gap-1.5 rounded-xl bg-secondary p-1.5">
        <span className="mx-1 mt-0.5 h-1.5 w-6 rounded-full bg-linear-to-r from-brand-from to-brand-to opacity-70" />
        {col.h.map((h, ri) => (
          <div
            key={ri}
            className="bento-breathe rounded-lg border border-border/50 bg-card"
            style={{ height: `${h}px`, animationDelay: `${(ci * 2 + ri) * 0.35}s` }}
          />
        ))}
      </div>
    ))}
  </div>
);

// A grid with a heading row, a merged cell and a brand-tinted cell that pulses.
const TablesViz: React.FC = () => (
  <div aria-hidden="true" className="grid w-full grid-cols-4 grid-rows-3 gap-[3px] overflow-hidden rounded-xl border border-border/60 bg-border/60 p-[3px]">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={`h${i}`} className="h-6 rounded-[5px] bg-secondary" />
    ))}
    <div className="col-span-2 rounded-[5px] bg-card transition-colors duration-300 group-hover:bg-primary/10" />
    <div className="rounded-[5px] bg-card" />
    <div className="rounded-[5px] bg-card" />
    <div className="rounded-[5px] bg-card" />
    <div className="bento-cell rounded-[5px] bg-linear-to-br from-brand-from to-brand-to" />
    <div className="rounded-[5px] bg-card" />
    <div className="rounded-[5px] bg-card" />
  </div>
);

// Two link-preview cards: a live embed favicon + an OpenGraph bookmark, with a
// loading sheen sweeping across the skeleton rows.
const EMBEDS = [
  { tag: "▶", host: "youtube.com", w: "w-3/4" },
  { tag: "✦", host: "figma.com", w: "w-2/3" },
];

const EmbedsViz: React.FC = () => (
  <div aria-hidden="true" className="flex w-full flex-col gap-2">
    {EMBEDS.map((e) => (
      <div
        key={e.host}
        className="bento-sheen relative flex items-center gap-2.5 overflow-hidden rounded-xl border border-border/60 bg-card p-2 transition-transform duration-300 group-hover:translate-x-0.5"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-brand-from via-brand-via to-brand-to text-[13px] text-white">
          {e.tag}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={`h-1.5 rounded-full bg-foreground/15 ${e.w}`} />
          <span className="font-mono text-[9px] text-muted-foreground">{e.host}</span>
        </div>
      </div>
    ))}
  </div>
);

// A history track — three nodes, a playhead that walks between them and lights
// each step, with the ⌘Z shortcut hovering above.
const UndoViz: React.FC = () => (
  <div aria-hidden="true" className="flex w-full flex-col items-center gap-3.5 py-1">
    <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 font-mono text-[10px] text-muted-foreground shadow-sm">
      <span>⌘Z</span>
      <span className="text-foreground/20">·</span>
      <span>⌘⇧Z</span>
    </div>
    <div className="relative h-3 w-full">
      <span className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-border" />
      {[8, 50, 92].map((p) => (
        <span
          key={p}
          className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/20"
          style={{ left: `${p}%` }}
        />
      ))}
      <span className="bento-undo-head absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-linear-to-br from-brand-from to-brand-to shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_15%,transparent)]" />
    </div>
  </div>
);

// The headline number — a shimmering gradient 68 — orbited by a few locale
// chips, one of them right-to-left.
const LOCALES = [
  { label: "EN", rtl: false },
  { label: "RU", rtl: false },
  { label: "日本語", rtl: false },
  { label: "العربية", rtl: true },
];

const LanguagesViz: React.FC = () => (
  <div aria-hidden="true" className="flex w-full flex-col gap-2.5">
    <div className="flex items-baseline gap-1.5">
      <span className="text-brand-gradient bento-shimmer text-4xl font-extrabold leading-none tracking-tight">68</span>
      <span className="text-[11px] font-medium text-muted-foreground">locales</span>
    </div>
    <div className="flex flex-wrap gap-1.5">
      {LOCALES.map((loc, i) => (
        <span
          key={loc.label}
          dir={loc.rtl ? "rtl" : "ltr"}
          className="rounded-full border border-border/60 bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors duration-300 group-hover:border-primary/30 group-hover:text-primary"
          style={{ transitionDelay: `${i * 30}ms` }}
        >
          {loc.label}
        </span>
      ))}
    </div>
  </div>
);

// Maps a feature's unique accent key → its bento span (lg only) + its diorama.
const TILE: Record<string, { span: string; viz: React.FC }> = {
  coral: { span: "lg:col-span-2 lg:row-span-2", viz: CleanJsonViz },
  green: { span: "lg:col-span-2", viz: BlocksViz },
  orange: { span: "lg:col-span-2", viz: ExtensibleViz },
  pink: { span: "lg:col-span-1", viz: SlashViz },
  purple: { span: "lg:col-span-1", viz: DatabasesViz },
  cyan: { span: "lg:col-span-2", viz: TablesViz },
  blue: { span: "lg:col-span-2", viz: EmbedsViz },
  yellow: { span: "lg:col-span-1", viz: UndoViz },
  mauve: { span: "lg:col-span-1", viz: LanguagesViz },
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

// A supporting capability — a compact title chip below lg, unfolding into its
// own diorama tile in the bento.
const CapabilityTile: React.FC<TileProps> = ({ feature, onOpen }) => {
  const Viz = TILE[feature.accent].viz;
  const tilt = useTilt();

  return (
    <motion.button
      type="button"
      variants={cardVariants}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      transition={hoverSpring}
      style={tilt.style}
      {...tilt.handlers}
      className={`bento-tile group relative flex min-h-[60px] cursor-pointer flex-col justify-center gap-3 overflow-hidden rounded-2xl border border-black/[0.04] bg-secondary p-4 text-left transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:border-white/[0.08] lg:justify-start lg:p-5 ${TILE[feature.accent].span}`}
      onClick={() => onOpen(feature)}
      aria-label={feature.learnMore}
    >
      <span className="bento-spot" aria-hidden="true" />
      <div className="relative z-10 flex w-full items-center gap-3.5">
        <div className="feature-blob flex size-10 shrink-0 items-center justify-center bg-primary/10 text-primary transition-[background-color,color,transform] duration-300 group-hover:scale-110 group-hover:bg-linear-to-br group-hover:from-brand-from group-hover:via-brand-via group-hover:to-brand-to group-hover:text-white">
          {feature.icon}
        </div>
        <h3 className="flex-1 text-balance text-[1.05rem] font-semibold leading-snug tracking-tight">
          {feature.title}
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
      <div className="relative z-10 hidden w-full flex-1 items-center pt-1 lg:flex">
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
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="fi fi-json">
          {/* JSON braces */}
          <path d="M12 8L8 16l4 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M20 8l4 8-4 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
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
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="fi fi-blocks">
          {/* Stacked blocks — the block library */}
          <rect x="6" y="6" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
          <rect x="16" y="10" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
          <rect x="8" y="18" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
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
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="fi fi-ext">
          {/* Dashed frame + plus — bring your own block */}
          <rect x="6" y="6" width="20" height="20" rx="4" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
          <path d="M16 11v10M11 16h10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
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
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="fi fi-slash">
          {/* Menu box with slash */}
          <rect x="6" y="8" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
          <path d="M18 12L14 20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
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
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="fi fi-kanban">
          {/* Kanban columns */}
          <rect x="5" y="6" width="6" height="20" rx="1.5" stroke="currentColor" strokeWidth="2" />
          <rect x="13" y="6" width="6" height="13" rx="1.5" stroke="currentColor" strokeWidth="2" />
          <rect x="21" y="6" width="6" height="16" rx="1.5" stroke="currentColor" strokeWidth="2" />
        </svg>
      ),
      title: t('home.features.databases.title'),
      description: t('home.features.databases.description'),
      learnMore: t('home.features.databases.learnMore'),
      accent: "purple",
      details: {
        summary: t('home.features.databases.details.summary'),
        benefits: [
          t('home.features.databases.details.benefit1'),
          t('home.features.databases.details.benefit2'),
          t('home.features.databases.details.benefit3'),
          t('home.features.databases.details.benefit4'),
        ],
        apiLink: "/tools#database",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="fi fi-table">
          {/* Table grid */}
          <rect x="5" y="7" width="22" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M5 13h22M5 19h22M13 7v18M20 7v18" stroke="currentColor" strokeWidth="1.5" />
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
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="fi fi-embed">
          {/* Embed frame with play */}
          <rect x="5" y="7" width="22" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
          <path d="M14 12.5l5.5 3.5-5.5 3.5z" fill="currentColor" />
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
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="fi fi-history">
          {/* Undo / redo arrows */}
          <path d="M10 16a6 6 0 0 1 6-6h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M16 7l3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M22 16a6 6 0 0 1-6 6h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
          <path d="M16 25l-3-3 3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
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
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="fi fi-globe">
          {/* Globe */}
          <circle cx="16" cy="16" r="9" stroke="currentColor" strokeWidth="2" />
          <ellipse cx="16" cy="16" rx="4" ry="9" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 12h16M8 20h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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

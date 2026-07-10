import { useEffect, useState } from "react";
import { useI18n } from "../../contexts/I18nContext";
import { Typo } from "../common/Typo";
import { cn } from "@/lib/utils";
import {
  segmentViewsAt,
  totalTicks,
  type RewriteSegment,
  type SegmentView,
} from "./rewrite-script";

/** The rewrites the codemod performs on this file, in playback order. */
const SEGMENTS: RewriteSegment[] = [
  { from: "EditorJS from '@editorjs/editorjs'", to: "{ Blok } from '@jackuait/blok'" },
  { from: "Header from '@editorjs/header'", to: "{ Header } from '@jackuait/blok/tools'" },
  { from: "EditorJS", to: "Blok" },
];

type LinePart = { fixed: string } | { segment: number };

/** A real, minimal Editor.js setup file. The untouched lines are the point:
 *  holder, tools and data stay exactly as they were. */
const LINES: LinePart[][] = [
  [{ fixed: "import " }, { segment: 0 }, { fixed: ";" }],
  [{ fixed: "import " }, { segment: 1 }, { fixed: ";" }],
  [],
  [{ fixed: "const editor = new " }, { segment: 2 }, { fixed: "({" }],
  [{ fixed: "  holder: 'editor'," }],
  [{ fixed: "  tools: { header: Header }," }],
  [{ fixed: "});" }],
];

const TOTAL_TICKS = totalTicks(SEGMENTS);
const TICK_MS = 40;
const HOLD_DONE_MS = 3400;
const FADE_MS = 240;

/** Animate only when a real browser affirms motion is welcome; jsdom's mock
 *  and prefers-reduced-motion users both fall back to the finished file. */
const shouldAnimate = (): boolean =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: no-preference)").matches;

/** Drives the playback loop: type through the rewrite, hold the finished
 *  file, fade, start over. Static environments pin the final tick. */
const useRewritePlayback = (): { views: SegmentView[]; fading: boolean } => {
  const [animating] = useState(shouldAnimate);
  const [tick, setTick] = useState(animating ? 0 : TOTAL_TICKS);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (!animating || fading) {
      return;
    }

    if (tick >= TOTAL_TICKS) {
      const hold = window.setTimeout(() => setFading(true), HOLD_DONE_MS);
      return () => window.clearTimeout(hold);
    }

    const interval = window.setInterval(() => setTick((prev) => prev + 1), TICK_MS);
    return () => window.clearInterval(interval);
  }, [animating, fading, tick >= TOTAL_TICKS]);

  useEffect(() => {
    if (!fading) {
      return;
    }

    const restart = window.setTimeout(() => {
      setTick(0);
      setFading(false);
    }, FADE_MS);
    return () => window.clearTimeout(restart);
  }, [fading]);

  return { views: segmentViewsAt(SEGMENTS, tick), fading };
};

const SEGMENT_CLASS: Record<SegmentView["phase"], string> = {
  pending: "",
  deleting: "text-destructive/60",
  typing: "font-medium text-primary",
  done: "font-medium text-primary",
};

interface RewritePreviewProps {
  className?: string;
}

/**
 * Hero visual: the codemod caught mid-flight. A small, real Editor.js setup
 * file gets rewritten in place — old identifiers deleted character by
 * character, Blok ones typed in behind a caret, rewritten code left glowing
 * brand-color while the config lines never move. Loops like the home hero.
 */
export const RewritePreview: React.FC<RewritePreviewProps> = ({ className }) => {
  const { t } = useI18n();
  const { views, fading } = useRewritePlayback();

  return (
    <div className={cn("relative", className)} data-blok-testid="hero-rewrite-preview">
      {/* Soft brand glow — the same atmosphere the home hero uses. */}
      <div aria-hidden className="absolute -inset-x-10 -top-12 -bottom-8 -z-10">
        <div className="absolute top-0 right-0 size-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-0 left-6 size-52 rounded-full bg-chart-3/10 blur-3xl" />
      </div>

      <div className="hero-float overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {/* Editor chrome: an open file tab. */}
        <div className="flex items-end gap-3 border-b border-border bg-secondary/50 pr-4">
          <span className="-mb-px border-b-2 border-foreground px-4 pb-2 pt-2.5 font-mono text-xs text-foreground">
            editor.ts
          </span>
        </div>

        {/* The file. aria-hidden: it's hero art, and the character-by-character
            mutation would be noise to a screen reader. */}
        <div
          aria-hidden
          className={cn(
            "px-4 py-4 font-mono text-xs leading-6 text-foreground/90 transition-opacity duration-200",
            fading && "opacity-0",
          )}
        >
          {LINES.map((parts, lineIndex) => (
            <div key={lineIndex} className="flex">
              <span className="w-6 shrink-0 select-none pr-4 text-right text-muted-foreground/40">
                {lineIndex + 1}
              </span>
              <span className="min-w-0 whitespace-pre-wrap break-all">
                {parts.map((part, partIndex) => {
                  if ("fixed" in part) {
                    return <span key={partIndex}>{part.fixed}</span>;
                  }
                  const view = views[part.segment];
                  return (
                    <span key={partIndex} className={SEGMENT_CLASS[view.phase]}>
                      {view.text}
                      {view.caret && <span className="rw-caret" />}
                    </span>
                  );
                })}
                {parts.length === 0 && " "}
              </span>
            </div>
          ))}
        </div>

        <a
          href="#changes"
          className="group flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
        >
          <Typo>{t('migration.sectionChangesTitle')}</Typo>
          <svg className="shrink-0 transition-transform group-hover:translate-x-0.5" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </a>
      </div>
    </div>
  );
};

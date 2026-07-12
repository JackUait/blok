import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** The comic marks the field can be made of. */
export type HalftoneShape = "dot" | "ring" | "plus" | "diamond" | "triangle";

/**
 * An interactive comic-style halftone field, drawn on a canvas so the marks can
 * react to the pointer. A spread-out grid of marks fills the host; the cursor
 * acts as an invisible, shape-shifting blob that shoves nearby marks outward, and
 * each one eases back to its home position once the cursor moves on. The marks
 * are purely decorative (`aria-hidden`) and never intercept pointer events, so
 * the controls underneath stay clickable.
 *
 * Pass `shapes` to choose the glyphs — a plain dot field (the default) or a mix
 * of comic marks (`["ring", "plus", "diamond"]`) scattered deterministically
 * across the grid. Tuning lives in the constants below. Colour is read from the
 * canvas's own computed `color`, so set it via the `className`
 * (e.g. `text-foreground/[0.08]`) and it follows light/dark automatically.
 * Honours `prefers-reduced-motion` by painting one static frame and skipping the
 * animation loop.
 */
export const HalftoneDots: React.FC<{
  className?: string;
  shapes?: HalftoneShape[];
}> = ({ className, shapes = ["dot"] }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Stable string key so the effect rebuilds only when the shape set truly
  // changes, not on every render's fresh array identity.
  const shapeKey = shapes.join(",");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    // jsdom and ancient engines have no 2D context — bail without animating.
    if (!ctx) return;

    const shapeList = shapeKey.split(",") as HalftoneShape[];

    // --- tuning -------------------------------------------------------------
    const SPACING = 26; // gap between marks — larger reads as "more spread out"
    const DOT_R = 1.6; // base mark radius in CSS px
    const STROKE = 1.1; // line weight for the open marks (ring, plus)
    const REPEL = 120; // base radius of the cursor's influence blob
    const PUSH = 64; // how far the strongest-pushed mark travels
    const EASE = 0.18; // how quickly a mark chases its target (0–1)
    // ------------------------------------------------------------------------

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    interface Dot {
      hx: number;
      hy: number;
      x: number;
      y: number;
      shape: HalftoneShape;
    }

    let dots: Dot[] = [];
    let width = 0;
    let height = 0;
    let color = "rgba(0,0,0,0.08)";
    let raf = 0;
    let t = 0;
    const pointer = { x: -9999, y: -9999, active: false };

    const refreshColor = (): void => {
      color = getComputedStyle(canvas).color;
    };

    const build = (): void => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      if (width === 0 || height === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = STROKE;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      refreshColor();

      dots = [];
      let rowIndex = 0;
      for (let y = SPACING / 2; y < height + SPACING; y += SPACING) {
        // Stagger alternate rows by half a cell for the diagonal Ben-Day look.
        const offset = (rowIndex % 2) * (SPACING / 2);
        let colIndex = 0;
        for (let x = SPACING / 2 + offset; x < width + SPACING; x += SPACING) {
          // Scatter the shapes with a cheap integer hash of the grid coords so
          // the mix looks random but stays stable across rebuilds/resizes.
          const hash =
            (Math.imul(colIndex + 1, 73856093) ^
              Math.imul(rowIndex + 1, 19349663)) >>>
            0;
          const shape = shapeList[hash % shapeList.length];
          dots.push({ hx: x, hy: y, x, y, shape });
          colIndex += 1;
        }
        rowIndex += 1;
      }
    };

    // Draw one comic mark centred at (x, y). Filled shapes use the current
    // fillStyle; open shapes (ring, plus) stroke with strokeStyle.
    const drawMark = (shape: HalftoneShape, x: number, y: number): void => {
      switch (shape) {
        case "ring": {
          ctx.beginPath();
          ctx.arc(x, y, DOT_R + 1, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case "plus": {
          const a = DOT_R + 1.3;
          ctx.beginPath();
          ctx.moveTo(x - a, y);
          ctx.lineTo(x + a, y);
          ctx.moveTo(x, y - a);
          ctx.lineTo(x, y + a);
          ctx.stroke();
          break;
        }
        case "diamond": {
          const a = DOT_R + 1.1;
          ctx.beginPath();
          ctx.moveTo(x, y - a);
          ctx.lineTo(x + a, y);
          ctx.lineTo(x, y + a);
          ctx.lineTo(x - a, y);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case "triangle": {
          const a = DOT_R + 1.5;
          ctx.beginPath();
          ctx.moveTo(x, y - a);
          ctx.lineTo(x + a * 0.92, y + a * 0.7);
          ctx.lineTo(x - a * 0.92, y + a * 0.7);
          ctx.closePath();
          ctx.fill();
          break;
        }
        default: {
          ctx.beginPath();
          ctx.arc(x, y, DOT_R, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const paint = (): void => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      for (const d of dots) {
        drawMark(d.shape, d.x, d.y);
      }
    };

    let running = false;

    const tick = (): void => {
      if (!running) return;
      t += 0.016;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      ctx.strokeStyle = color;

      for (const d of dots) {
        let targetX = d.hx;
        let targetY = d.hy;

        if (pointer.active) {
          const dx = d.hx - pointer.x;
          const dy = d.hy - pointer.y;
          const dist = Math.hypot(dx, dy) || 0.0001;
          const angle = Math.atan2(dy, dx);
          // A wobbling, slowly-turning blob instead of a clean circle, so the
          // "invisible cursor shape" keeps morphing as it moves.
          const radius =
            REPEL *
            (1 +
              0.32 * Math.sin(angle * 3 + t * 1.6) +
              0.12 * Math.sin(angle * 5 - t * 1.1));
          if (dist < radius) {
            const falloff = 1 - dist / radius;
            const strength = falloff * falloff * PUSH;
            targetX = d.hx + (dx / dist) * strength;
            targetY = d.hy + (dy / dist) * strength;
          }
        }

        // Ease toward the target; when the target is home, this is the spring-back.
        d.x += (targetX - d.x) * EASE;
        d.y += (targetY - d.y) * EASE;

        drawMark(d.shape, d.x, d.y);
      }

      raf = requestAnimationFrame(tick);
    };

    const onPointerMove = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      pointer.x = x;
      pointer.y = y;
      pointer.active =
        x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
    };

    build();

    if (reduceMotion) {
      paint();
      return () => {};
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true });

    const resizeObserver = new ResizeObserver(() => build());
    resizeObserver.observe(canvas);

    // Re-read the dot colour when the theme (light/dark) flips.
    const themeObserver = new MutationObserver(refreshColor);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // Only animate while the field is actually on screen — no idle rAF churn
    // while the reader is elsewhere on the page.
    const start = (): void => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(tick);
    };
    const stop = (): void => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const visibilityObserver = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        start();
      } else {
        stop();
      }
    });
    visibilityObserver.observe(canvas);

    return () => {
      stop();
      window.removeEventListener("pointermove", onPointerMove);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      visibilityObserver.disconnect();
    };
  }, [shapeKey]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}
    />
  );
};

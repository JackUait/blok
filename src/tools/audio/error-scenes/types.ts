/**
 * The audio error card's picture is one physical object that breaks and can be
 * touched. Each object is a scene; the stage owns the canvas, the clock and the
 * pointer, and drives one scene through this contract.
 */

/** The pointer, in CSS pixels from the canvas's top-left corner. */
export interface ScenePointer {
  x: number;
  y: number;
  /** Speed in CSS pixels per second. The stage fades it between frames. */
  vx: number;
  vy: number;
  /** Over the canvas, or still held down after leaving it. */
  inside: boolean;
  down: boolean;
}

/** The part of the card the object may use. The words sit outside it. */
export interface SceneZone {
  x: number;
  y: number;
  width: number;
  /** Y of the zone's bottom edge. Objects that fall land on it. */
  floor: number;
}

export interface SceneLayout {
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  zone: SceneZone;
  /** Backing-store pixels per CSS pixel. */
  scale: number;
}

/** Plain CSS colour strings: the canvas reads them as they are. */
export interface SceneColors {
  /** The card's main ink: black on a light theme, off-white on a dark one. */
  ink: string;
  /** The card's own background. */
  card: string;
  /** Quiet ink for small labels. */
  muted: string;
}

export interface ErrorScene {
  /** The stage captures the pointer on press and stops touch scrolling over the canvas. */
  readonly drag?: boolean;
  /** The stage draws the canvas through its goo filter, and calls paintOverlay on a clean canvas above it. */
  readonly goo?: boolean;
  /** New canvas size. The stage always calls reset() right after. */
  layout(layout: SceneLayout): void;
  /** Back to the moment before the break. The break then plays through step(). */
  reset(): void;
  /**
   * Advance by dt seconds.
   * @returns false once the scene is at rest and needs no more frames
   */
  step(dt: number, pointer: ScenePointer): boolean;
  /** Draw the current state. The context is cleared and scaled to CSS pixels. */
  paint(ctx: CanvasRenderingContext2D, colors: SceneColors): void;
  paintOverlay?(ctx: CanvasRenderingContext2D, colors: SceneColors): void;
  press?(pointer: ScenePointer): void;
  release?(): void;
}

/** @param random - 0..1 source; tests pass a fixed one */
export type SceneFactory = (random?: () => number) => ErrorScene;

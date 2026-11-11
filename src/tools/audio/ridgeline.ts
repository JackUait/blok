/**
 * The ridgeline: the track drawn as a landscape. Each cached peak bucket is one
 * ridge. The bucket under the playhead is the front ridge, the buckets after it
 * stand behind, so the track rolls toward the listener as it plays. All pure.
 */
import type { Beat } from './ripples';

/** Ridges between the front of the landscape and its horizon. */
export const RIDGE_ROWS = 18;
/** Points along one ridge. */
export const RIDGE_POINTS = 72;

/** Bumps that give a ridge its outline. */
const BUMPS = 5;
/** Share of a ridge's height that does not depend on its bumps. */
const BASE_SHARE = 0.12;
/** Height a full-strength beat adds to the middle of its ridge. */
const BEAT_LIFT = 0.35;
const BEAT_WIDTH = 0.1;

/** Where the horizon sits, as a share of the canvas height. */
const HORIZON = 0.36;
/** Gap under the front ridge, so its stroke is not cut by the canvas edge. */
const FLOOR_GAP = 6;
/** How far each side of the horizon row is pulled in, as a share of the width. */
const HORIZON_INSET = 0.14;
/** Tallest ridge, as a share of the canvas height. */
const RIDGE_HEIGHT = 0.44;
/** Height of a horizon ridge relative to a front one. */
const FAR_SCALE = 0.4;
/** Ink of the horizon row; the front row is full ink. */
const FAR_INK = 0.22;
const LINE_WIDTH = 1.2;
/** How much a playing track sways its front ridges, and how hard a beat hits them. */
const SWAY = 0.16;
const KICK_LIFT = 0.3;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Stable 0..1 noise for a bucket, so a ridge keeps its outline between frames. */
const hash = (bucket: number, salt: number): number => {
  const x = Math.sin(bucket * 127.1 + salt * 311.7) * 43758.5453;

  return x - Math.floor(x);
};

const smoothstep = (from: number, to: number, x: number): number => {
  const t = clamp01((x - from) / (to - from));

  return t * t * (3 - 2 * t);
};

/** 0 at both ends, 1 across the middle: ridges rise out of flat ground. */
const ground = (k: number): number => smoothstep(0.06, 0.34, k) * smoothstep(0.06, 0.34, 1 - k);

const bell = (x: number, center: number, width: number): number =>
  Math.exp(-((x - center) * (x - center)) / (2 * width * width));

/**
 * Heights (0..1) along the ridge of one bucket. Both ends touch the ground.
 * @param peak - the bucket's loudness, 0..1
 * @param bucket - its index; picks the outline
 * @param beat - 0..1 strength of a beat on this bucket
 */
export function ridgeProfile(peak: number, bucket: number, beat = 0): number[] {
  return Array.from({ length: RIDGE_POINTS }, (_, i) => {
    const k = i / (RIDGE_POINTS - 1);
    const bumps = Array.from({ length: BUMPS }, (__, m) =>
      (0.35 + 0.65 * hash(bucket, m + 13)) * bell(k, 0.24 + 0.52 * hash(bucket, m), 0.025 + 0.045 * hash(bucket, m + 7))
    ).reduce((sum, v) => sum + v, 0);
    // Soft ceiling: overlapping bumps round off instead of clipping into a plateau.
    const outline = BASE_SHARE + (1 - BASE_SHARE) * (1 - Math.exp(-1.4 * bumps));

    return clamp01(ground(k) * (peak * outline + beat * BEAT_LIFT * bell(k, 0.5, BEAT_WIDTH)));
  });
}

export interface RidgeRow {
  bucket: number;
  /** 0 at the front, 1 at the horizon; just below 0 while the front row leaves. */
  depth: number;
  /** 0..1: the horizon row fades in and the front row fades out. */
  alpha: number;
}

/**
 * The rows on screen for a playhead position, horizon first.
 * @param playhead - fractional bucket index under the playhead
 */
export function ridgeRows(playhead: number): RidgeRow[] {
  const front = Math.floor(playhead);

  return Array.from({ length: RIDGE_ROWS + 1 }, (_, i) => {
    const bucket = front + RIDGE_ROWS - i;
    const depth = (bucket - playhead) / RIDGE_ROWS;

    return { bucket, depth, alpha: clamp01(Math.min(1 + depth * RIDGE_ROWS, (1 - depth) * RIDGE_ROWS)) };
  });
}

export interface PaintRidgesOptions {
  width: number;
  height: number;
  peaks: number[];
  beats: Beat[];
  /** Fractional bucket index under the playhead. */
  playhead: number;
  /** Line colour. */
  ink: string;
  /** Card colour; each ridge is filled with it to hide the rows behind. */
  fill: string;
  /** 0..1 live boost: 1 while playing, 0 at rest. */
  energy: number;
  /** 0..1 punch of the latest beat. */
  kick: number;
  timeSeconds: number;
}

/** Paint one frame of the landscape onto a cleared canvas. */
export function paintRidges(ctx: CanvasRenderingContext2D, opts: PaintRidgesOptions): void {
  const { width, height, peaks, beats, playhead, ink, fill, energy, kick, timeSeconds } = opts;
  const context = ctx;
  const beatAt = new Map(beats.map((b) => [b.index, b.strength]));

  context.lineJoin = 'round';
  context.lineWidth = LINE_WIDTH;

  ridgeRows(playhead).forEach(({ bucket, depth, alpha }) => {
    if (alpha <= 0) return;
    const near = Math.min(1, 1 - depth);
    const y = height * HORIZON + near * (height * (1 - HORIZON) - FLOOR_GAP);
    const inset = (1 - near) * width * HORIZON_INSET;
    const reach = height * RIDGE_HEIGHT * (FAR_SCALE + (1 - FAR_SCALE) * near);
    // The live boost belongs to the front of the landscape and fades with depth.
    const front = near * near * near;
    const live = 1 + energy * front * (SWAY * Math.sin(timeSeconds * 6.3 + bucket * 1.7) + KICK_LIFT * kick);
    const profile = ridgeProfile(peaks[bucket] ?? 0, bucket, beatAt.get(bucket) ?? 0);

    context.beginPath();
    context.moveTo(inset, y);
    profile.forEach((v, i) => {
      context.lineTo(inset + ((width - 2 * inset) * i) / (RIDGE_POINTS - 1), y - Math.min(1, v * live) * reach);
    });
    context.lineTo(width - inset, y);
    context.globalAlpha = 1;
    context.fillStyle = fill;
    context.fill();
    context.globalAlpha = (FAR_INK + (1 - FAR_INK) * near * near) * alpha;
    context.strokeStyle = ink;
    context.stroke();
  });
  context.globalAlpha = 1;
}

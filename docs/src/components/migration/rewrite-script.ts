/**
 * Pure tick-based engine for the hero's live-rewrite animation. Each rewrite
 * segment plays in order: a pause (the caret "reading" the old code), then one
 * character deleted per tick, then the replacement typed one character per
 * tick. Pure functions of (segments, tick) so the whole timeline is unit-
 * testable; RewritePreview drives the tick from an interval.
 */

export interface RewriteSegment {
  /** The EditorJS-era code this segment starts as. */
  from: string;
  /** The Blok code the codemod rewrites it to. */
  to: string;
}

export type SegmentPhase = 'pending' | 'deleting' | 'typing' | 'done';

export interface SegmentView {
  /** Text currently displayed for this segment. */
  text: string;
  phase: SegmentPhase;
  /** Whether the caret sits at the end of this segment's text right now. */
  caret: boolean;
}

/** Beat before each segment starts rewriting, in ticks. */
export const PAUSE_TICKS = 12;

const segmentCost = (segment: RewriteSegment): number =>
  PAUSE_TICKS + segment.from.length + segment.to.length;

/** Ticks until every segment is fully rewritten. */
export const totalTicks = (segments: RewriteSegment[]): number =>
  segments.reduce((sum, segment) => sum + segmentCost(segment), 0);

const viewAt = (segment: RewriteSegment, localTick: number): SegmentView => {
  if (localTick < PAUSE_TICKS) {
    return { text: segment.from, phase: 'pending', caret: true };
  }

  const deleted = localTick - PAUSE_TICKS + 1;
  if (deleted <= segment.from.length) {
    return {
      text: segment.from.slice(0, segment.from.length - deleted),
      phase: 'deleting',
      caret: true,
    };
  }

  const typed = deleted - segment.from.length;
  if (typed <= segment.to.length) {
    return { text: segment.to.slice(0, typed), phase: 'typing', caret: true };
  }

  return { text: segment.to, phase: 'done', caret: false };
};

/** Display state of every segment at the given tick. */
export const segmentViewsAt = (
  segments: RewriteSegment[],
  tick: number,
): SegmentView[] => {
  const views: SegmentView[] = [];
  let start = 0;
  let caretTaken = false;

  for (const segment of segments) {
    const localTick = tick - start;
    start += segmentCost(segment);

    if (localTick < 0) {
      views.push({ text: segment.from, phase: 'pending', caret: false });
      continue;
    }

    const view = viewAt(segment, localTick);
    // Only the earliest unfinished segment holds the caret.
    if (view.caret && caretTaken) {
      view.caret = false;
    }
    caretTaken ||= view.phase !== 'done';
    views.push(view);
  }

  return views;
};

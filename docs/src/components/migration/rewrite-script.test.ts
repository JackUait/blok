import { describe, it, expect } from 'vitest';
import {
  PAUSE_TICKS,
  segmentViewsAt,
  totalTicks,
  type RewriteSegment,
} from './rewrite-script';

const SEGMENTS: RewriteSegment[] = [
  { from: 'abc', to: 'XY' },
  { from: 'de', to: 'Z' },
];

// Schedule per segment: PAUSE_TICKS pending, then one char deleted per tick,
// then one char typed per tick. Segments run strictly in order.
const SEG0_DELETE_START = PAUSE_TICKS;
const SEG0_TYPE_START = SEG0_DELETE_START + 3;
const SEG0_END = SEG0_TYPE_START + 2;

describe('totalTicks', () => {
  it('should sum pause, delete and type costs across segments', () => {
    expect(totalTicks(SEGMENTS)).toBe(PAUSE_TICKS + 3 + 2 + PAUSE_TICKS + 2 + 1);
  });
});

describe('segmentViewsAt', () => {
  it('should show all segments untouched and pending at tick 0', () => {
    const [first, second] = segmentViewsAt(SEGMENTS, 0);

    expect(first).toEqual({ text: 'abc', phase: 'pending', caret: true });
    expect(second).toEqual({ text: 'de', phase: 'pending', caret: false });
  });

  it('should delete one character per tick once the pause elapses', () => {
    const [first] = segmentViewsAt(SEGMENTS, SEG0_DELETE_START);
    expect(first).toEqual({ text: 'ab', phase: 'deleting', caret: true });

    const [emptied] = segmentViewsAt(SEGMENTS, SEG0_DELETE_START + 2);
    expect(emptied).toEqual({ text: '', phase: 'deleting', caret: true });
  });

  it('should type the replacement one character per tick after deleting', () => {
    const [first] = segmentViewsAt(SEGMENTS, SEG0_TYPE_START);
    expect(first).toEqual({ text: 'X', phase: 'typing', caret: true });

    const [typed] = segmentViewsAt(SEGMENTS, SEG0_TYPE_START + 1);
    expect(typed).toEqual({ text: 'XY', phase: 'typing', caret: true });
  });

  it('should hand the caret to the next segment once a segment completes', () => {
    const [first, second] = segmentViewsAt(SEGMENTS, SEG0_END);

    expect(first).toEqual({ text: 'XY', phase: 'done', caret: false });
    expect(second).toEqual({ text: 'de', phase: 'pending', caret: true });
  });

  it('should show every segment rewritten at or beyond totalTicks', () => {
    const views = segmentViewsAt(SEGMENTS, totalTicks(SEGMENTS));

    expect(views).toEqual([
      { text: 'XY', phase: 'done', caret: false },
      { text: 'Z', phase: 'done', caret: false },
    ]);
  });
});

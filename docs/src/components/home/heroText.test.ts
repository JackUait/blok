import { describe, it, expect } from 'vitest';
import { splitWords, gradientSlice, toggleMark, introOffset } from './heroText';

describe('splitWords', () => {
  it('splits on plain spaces and records each word offset', () => {
    expect(splitWords('block-based editors')).toEqual([
      { text: 'block-based', offset: 0 },
      { text: 'editors', offset: 12 },
    ]);
  });

  it('keeps non-breaking spaces inside a word so Typo bindings survive', () => {
    expect(splitWords('Try it out')).toEqual([
      { text: 'Try', offset: 0 },
      { text: 'it out', offset: 4 },
    ]);
  });
});

describe('gradientSlice', () => {
  it('gives a lone word the whole gradient', () => {
    expect(gradientSlice(0, 7, 7)).toEqual({ size: '100% 100%', position: '0% 0' });
  });

  it('places each word on its share of one line-wide gradient', () => {
    // "block-based editors": 19 chars. "editors" is the last 7.
    expect(gradientSlice(0, 11, 19)).toEqual({ size: `${(19 / 11) * 100}% 100%`, position: '0% 0' });
    expect(gradientSlice(12, 7, 19)).toEqual({ size: `${(19 / 7) * 100}% 100%`, position: '100% 0' });
  });
});

describe('toggleMark', () => {
  it('adds the mark when any selected word lacks it', () => {
    expect(toggleMark({ w1: ['bold'] }, ['w1', 'w2'], 'bold')).toEqual({ w1: ['bold'], w2: ['bold'] });
  });

  it('removes the mark when every selected word has it', () => {
    expect(toggleMark({ w1: ['bold', 'italic'], w2: ['bold'] }, ['w1', 'w2'], 'bold')).toEqual({
      w1: ['italic'],
      w2: [],
    });
  });

  it('leaves unselected words alone', () => {
    expect(toggleMark({ w3: ['mark'] }, ['w1'], 'italic')).toEqual({ w3: ['mark'], w1: ['italic'] });
  });
});

describe('introOffset', () => {
  it('is deterministic per index, so the prerendered HTML matches hydration', () => {
    expect(introOffset(3)).toEqual(introOffset(3));
  });

  it('scatters neighbouring words differently', () => {
    expect(introOffset(0)).not.toEqual(introOffset(1));
  });
});

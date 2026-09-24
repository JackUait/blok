import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { paintFindHighlights, clearFindHighlights } from '../../../../../src/components/modules/find/find-highlight';

class FakeHighlight extends Set<Range> {
  public priority = 0;
  constructor(...ranges: Range[]) {
    super(ranges);
  }
}

const registry = new Map<string, FakeHighlight>();

const rangeOver = (text: string): Range => {
  const node = document.createTextNode(text);
  const range = document.createRange();

  document.body.appendChild(node);
  range.selectNodeContents(node);

  return range;
};

describe('find highlights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registry.clear();
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', { highlights: registry });
  });

  afterEach(() => {
    clearFindHighlights('a');
    clearFindHighlights('b');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('paints the active match apart from the others, above them', () => {
    const [one, two] = [rangeOver('one'), rangeOver('two')];

    paintFindHighlights('a', [one, two], two);

    expect([...registry.get('blok-find-match') ?? []]).toEqual([one]);
    expect([...registry.get('blok-find-match-active') ?? []]).toEqual([two]);
    expect(registry.get('blok-find-match-active')?.priority).toBeGreaterThan(registry.get('blok-find-match')?.priority ?? 0);
  });

  it('keeps each editor\'s paint when another editor paints or clears', () => {
    const [one, two] = [rangeOver('one'), rangeOver('two')];

    paintFindHighlights('a', [one], null);
    paintFindHighlights('b', [two], null);

    expect(registry.get('blok-find-match')?.size).toBe(2);

    clearFindHighlights('b');

    expect([...registry.get('blok-find-match') ?? []]).toEqual([one]);
  });

  it('removes the registry entries once nobody paints', () => {
    paintFindHighlights('a', [rangeOver('one')], null);
    clearFindHighlights('a');

    expect(registry.has('blok-find-match')).toBe(false);
    expect(registry.has('blok-find-match-active')).toBe(false);
  });

  it('does nothing on an engine without the Highlight API', () => {
    vi.stubGlobal('CSS', {});

    expect(() => paintFindHighlights('a', [rangeOver('one')], null)).not.toThrow();
  });
});

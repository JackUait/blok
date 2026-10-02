export type HeroMark = 'bold' | 'italic' | 'mark';

export type HeroMarks = Record<string, HeroMark[]>;

export interface HeroWord {
  text: string;
  offset: number;
}

/** Split on U+0020 only, so Typo's non-breaking spaces stay inside their word. */
export const splitWords = (text: string): HeroWord[] => {
  const words: HeroWord[] = [];
  let offset = 0;

  for (const part of text.split(' ')) {
    if (part) words.push({ text: part, offset });
    offset += part.length + 1;
  }

  return words;
};

/**
 * Each word paints its own gradient (a transformed word cannot share its line's
 * background-clip:text), so it shows only its slice of one line-wide gradient.
 * Character counts stand in for widths: the server has no layout, and the
 * prerendered HTML must already carry the final look.
 */
export const gradientSlice = (offset: number, length: number, total: number): { size: string; position: string } => {
  if (length >= total) return { size: '100% 100%', position: '0% 0' };

  return {
    size: `${(total / length) * 100}% 100%`,
    position: `${(offset / (total - length)) * 100}% 0`,
  };
};

export const toggleMark = (marks: HeroMarks, ids: string[], mark: HeroMark): HeroMarks => {
  const allHave = ids.every((id) => marks[id]?.includes(mark));
  const next: HeroMarks = { ...marks };

  for (const id of ids) {
    const current = marks[id] ?? [];
    next[id] = allHave ? current.filter((m) => m !== mark) : current.includes(mark) ? current : [...current, mark];
  }

  return next;
};

/** Where a word's block flies in from. Derived from its index, never random: it is rendered on the server. */
export const introOffset = (index: number): { x: number; y: number; rotate: number } => ({
  x: (((index * 37) % 7) - 3) * 9,
  y: 26 + (index % 3) * 12,
  rotate: (((index * 53) % 5) - 2) * 3,
});

/**
 * Where the caret is in the code, as a chain of enclosing block headers,
 * outer first: `['fibonacci()', 'if (memo.has(n))']`. Blocks are read from
 * indentation, so it works the same for every language without a parser.
 * Runs on every caret line change, so it stays one linear pass over the lines.
 */
const MAX_LABEL = 32;
const FUNCTION_NAME = /^(?:(?:export|pub|async|static|private|public|protected)\s+)*(?:function\*?|def|fn|func)\s+([\w$]+)/;
const CLOSER = /^\s*[}\])]/;
const HEADER_TAIL = /\s*(?:=>\s*)?[{:(]\s*$/;

interface Outline {
  lines: string[];
  indent: number[];
  blank: boolean[];
  /** Index of the next non-blank line after each line, or -1. */
  below: number[];
  /** Index of the previous non-blank line before each line, or -1. */
  above: number[];
}

const outlineOf = (text: string): Outline => {
  const lines = text.split('\n');
  const blank = lines.map(line => line.trim() === '');
  const indent = lines.map(line => line.length - line.trimStart().length);
  const below = lines.reduceRight<number[]>((acc, _, i) => {
    acc.push(i + 1 < lines.length && !blank[i + 1] ? i + 1 : (acc[acc.length - 1] ?? -1));

    return acc;
  }, []).reverse();
  const above = lines.reduce<number[]>((acc, _, i) => {
    acc.push(i > 0 && !blank[i - 1] ? i - 1 : (acc[i - 1] ?? -1));

    return acc;
  }, []);

  return { lines, indent, blank, below, above };
};

const isHeader = (o: Outline, i: number): boolean => !o.blank[i] && o.below[i] !== -1 && o.indent[o.below[i]] > o.indent[i];

const labelOf = (line: string): string => {
  const text = line.trim();
  const fn = FUNCTION_NAME.exec(text);
  const label = fn ? `${fn[1]}()` : text.replace(HEADER_TAIL, '');

  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
};

const chainOf = (o: Outline, k: number): number[] => {
  const header = isHeader(o, k);
  // A closing brace sits at its header's indent, so a header at that indent still encloses it.
  const start = o.indent[k] + (!header && CLOSER.test(o.lines[k]) ? 1 : 0);
  const outer = o.lines.slice(0, k).reduceRight<{ chain: number[]; limit: number }>((acc, _, i) => {
    const encloses = acc.limit > 0 && o.indent[i] < acc.limit && isHeader(o, i);

    return encloses ? { chain: [i, ...acc.chain], limit: o.indent[i] } : acc;
  }, { chain: [], limit: start });

  return header ? [...outer.chain, k] : outer.chain;
};

export const codeBreadcrumb = (text: string, lineIndex: number): string[] => {
  const o = outlineOf(text);

  if (lineIndex < 0 || lineIndex >= o.lines.length) {
    return [];
  }

  if (!o.blank[lineIndex]) {
    return chainOf(o, lineIndex).map(i => labelOf(o.lines[i]));
  }

  // A blank line belongs to the blocks both neighbours share.
  const up = o.above[lineIndex];
  const down = o.below[lineIndex];

  if (up === -1 || down === -1) {
    return [];
  }

  const upper = chainOf(o, up);
  const lower = chainOf(o, down);
  const split = upper.findIndex((line, depth) => lower[depth] !== line);
  const shared = split === -1 ? upper : upper.slice(0, split);

  return shared.map(i => labelOf(o.lines[i]));
};

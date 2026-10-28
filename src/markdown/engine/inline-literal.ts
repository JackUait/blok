import type { Link, PhrasingContent, Text } from '../../../types/data-formats/markdown-tree';
import { isAsciiAlpha, isAsciiAlphanumeric, isAsciiControl, isSpaceOrLineEnding, isUnicodePunctuation, isUnicodeWhitespace } from './text';

/**
 * GFM autolink literals (`www.x.com`, `https://x.com`, `a@b.co`). Blok's old
 * parser found them twice: a tokenizer while scanning (which sees emphasis
 * and brackets around it) and a regex pass over the finished text nodes
 * (which catches what the tokenizer refused, such as `x_www.a.com`). Both
 * are kept, so the trees stay the same.
 */

/** Punctuation that may end a URL without being part of it. */
const TRAIL = new Set(['!', '"', '\'', ')', '*', ',', '.', ':', ';', '?', '_', '~']);

/** `&name;` inside a trail. */
const TRAIL_REFERENCE = /&[A-Za-z]+;/y;

/** Punctuation the path checks for a trail before taking it. */
const PATH_PUNCTUATION = new Set([...TRAIL, '&', '<', ']']);

const isWhitespace = (char: string | undefined): boolean => isSpaceOrLineEnding(char) || (char !== undefined && isUnicodeWhitespace(char));

/** Characters allowed in a literal email's local part. */
export const isEmailAtext = (char: string | undefined): boolean => char === '+' || char === '-' || char === '.' || char === '_' || isAsciiAlphanumeric(char);

/** What may come right before `www.`. */
export const canPrecedeWww = (char: string | undefined): boolean =>
  char === undefined || char === '(' || char === '*' || char === '_' || char === '[' || char === ']' || char === '~' || isSpaceOrLineEnding(char);

/**
 * The tokenizer half. One per parse: it remembers trail answers, which
 * keeps `www.a.....(many dots)b` linear.
 */
export class LiteralScanner {
  private readonly trails = new Map<number, boolean>();

  /** @param src - source text */
  constructor(private readonly src: string) {}

  /**
   * End of a `www.` literal at `pos`, or -1. The caller checks the
   * character before.
   * @param pos - index of the first `w`
   */
  public www(pos: number): number {
    const src = this.src;
    const prefix = /^[Ww]{3}\.$/.test(src.slice(pos, pos + 4));

    if (!prefix || pos + 4 >= src.length) {
      return -1;
    }

    const domain = this.domain(pos);

    return domain === -1 ? -1 : this.path(domain);
  }

  /**
   * End of an `http://` or `https://` literal at `pos`, or -1.
   * @param pos - index of the `h`
   */
  public protocol(pos: number): number {
    const src = this.src;
    const scheme = /^[A-Za-z]{1,5}/.exec(src.slice(pos, pos + 5));
    const name = scheme === null ? '' : scheme[0].toLowerCase();
    const after = pos + name.length;

    if ((name !== 'http' && name !== 'https') || src.slice(after, after + 3) !== '://') {
      return -1;
    }

    const first = src[after + 3];

    if (first === undefined || isAsciiControl(first) || isWhitespace(first) || isUnicodePunctuation(first)) {
      return -1;
    }

    const domain = this.domain(after + 3);

    return domain === -1 ? -1 : this.path(domain);
  }

  /**
   * End of a literal email at `pos`, or -1.
   * @param pos - index of the first local-part character
   */
  public email(pos: number): number {
    const src = this.src;
    const cursor = { at: pos, dot: false, data: false };

    while (isEmailAtext(src[cursor.at])) {
      cursor.at++;
    }

    if (src[cursor.at] !== '@') {
      return -1;
    }

    cursor.at++;

    for (;;) {
      const char = src[cursor.at];

      if (char === '.' && isAsciiAlphanumeric(src[cursor.at + 1])) {
        cursor.dot = true;
      } else if (char === '-' || char === '_' || isAsciiAlphanumeric(char)) {
        cursor.data = true;
      } else {
        break;
      }

      cursor.at++;
    }

    return cursor.data && cursor.dot && isAsciiAlpha(src[cursor.at - 1]) ? cursor.at : -1;
  }

  /**
   * End of the domain at `pos`, or -1 when it is empty or has `_` in one of
   * its last two segments.
   * @param pos - first domain character
   */
  private domain(pos: number): number {
    const src = this.src;
    const state = { at: pos, seen: false, underscoreLast: false, underscoreBeforeLast: false };

    for (;;) {
      const char = src[state.at];

      if ((char === '.' || char === '_') && !this.trail(state.at)) {
        state.underscoreBeforeLast = char === '_' ? state.underscoreBeforeLast : state.underscoreLast;
        state.underscoreLast = char === '_' || (state.underscoreLast && char !== '.');
        state.at++;
        continue;
      }

      if (char === undefined || char === '.' || char === '_' || isWhitespace(char) || (char !== '-' && isUnicodePunctuation(char))) {
        break;
      }

      state.seen = true;
      state.at++;
    }

    return state.underscoreLast || state.underscoreBeforeLast || !state.seen ? -1 : state.at;
  }

  /**
   * End of the path at `pos`: parens balance, trailing punctuation stays out.
   * @param pos - first character after the domain
   */
  private path(pos: number): number {
    const src = this.src;
    const state = { at: pos, open: 0, close: 0 };

    for (;;) {
      const char = src[state.at];

      if (char === undefined || isWhitespace(char)) {
        return state.at;
      }

      if (char === '(') {
        state.open++;
      } else if (char === ')' && state.close < state.open) {
        state.close++;
      } else if (PATH_PUNCTUATION.has(char) && this.trail(state.at)) {
        return state.at;
      } else if (char === ')') {
        state.close++;
      }

      state.at++;
    }
  }

  /**
   * Whether the punctuation from `pos` on is a trail: it ends the input, a
   * whitespace, a `<`, or a `]` before a bracket or paren.
   * @param pos - first punctuation character
   */
  private trail(pos: number): boolean {
    const known = this.trails.get(pos);

    if (known !== undefined) {
      return known;
    }

    const visited: number[] = [];
    const result = this.walkTrail(pos, visited);

    for (const at of visited) {
      this.trails.set(at, result);
    }

    return result;
  }

  /**
   * The trail walk itself. Every position it passes in the top state ends
   * up with the same answer, recorded in `visited`.
   * @param pos - first character
   * @param visited - top-state positions passed
   */
  private walkTrail(pos: number, visited: number[]): boolean {
    const cursor = { at: pos };

    for (;;) {
      const known = this.trails.get(cursor.at);

      if (known !== undefined) {
        return known;
      }

      visited.push(cursor.at);

      const next = this.trailStep(cursor.at);

      if (typeof next === 'boolean') {
        return next;
      }

      cursor.at = next;
    }
  }

  /**
   * One step of the trail walk: the next top-state position, or the answer.
   * @param at - current position
   */
  private trailStep(at: number): number | boolean {
    const src = this.src;
    const char = src[at];

    if (char === undefined || char === '<' || isWhitespace(char)) {
      return true;
    }

    if (TRAIL.has(char)) {
      return at + 1;
    }

    if (char === '&') {
      TRAIL_REFERENCE.lastIndex = at;

      return TRAIL_REFERENCE.exec(src) === null ? false : TRAIL_REFERENCE.lastIndex;
    }

    if (char !== ']') {
      return false;
    }

    const next = src[at + 1];

    return next === undefined || next === '(' || next === '[' || isWhitespace(next) ? true : at + 1;
  }
}

/* The text-node half: applied to the finished tree, outside links. */

const URL_START = /https?:\/\/|www(?=\.)/gi;

const isDomainChar = (char: string | undefined): boolean => char !== undefined && /^[-.\w]$/.test(char);

/** Trailing characters a domain or email local part never ends with. */
const SPLIT_TRAIL = /[!"&'),.:;<>?\]}]+$/;

const count = (value: string, char: string): number => value.split(char).length - 1;

/**
 * Whether a segment disqualifies a domain as one of its last two: not empty,
 * and holding an underscore or no alphanumeric.
 * @param part - a domain segment
 */
const isBadSegment = (part: string): boolean => part !== '' && (part.includes('_') || !/[\dA-Za-z]/.test(part));

/**
 * Cut trailing punctuation off a URL, giving back closing parens that
 * balance an opening one inside it.
 * @param url - domain and path
 */
const splitUrl = (url: string): [string, string] => {
  const trail = SPLIT_TRAIL.exec(url);

  if (trail === null) {
    return [url, ''];
  }

  const state = { url: url.slice(0, trail.index), trail: trail[0], closing: 0 };
  const opening = count(state.url, '(');

  state.closing = count(state.url, ')');

  for (;;) {
    const paren = state.trail.indexOf(')');

    if (paren === -1 || opening <= state.closing) {
      return [state.url, state.trail];
    }

    state.url += state.trail.slice(0, paren + 1);
    state.trail = state.trail.slice(paren + 1);
    state.closing++;
  }
};

const text = (value: string): Text => ({ type: 'text', value });

const link = (url: string, value: string): Link => ({ type: 'link', title: null, url, children: [text(value)] });

interface Match {
  start: number;
  end: number;
  nodes: PhrasingContent[];
}

/**
 * Whether the character before `index` lets a literal start: input start,
 * whitespace or punctuation (one UTF-16 unit).
 * @param value - text node value
 * @param index - match start
 */
const startsAfterBoundary = (value: string, index: number): boolean =>
  index === 0 || isUnicodeWhitespace(value[index - 1]) || isUnicodePunctuation(value[index - 1]);

/**
 * The domain run that `from` sits in, with its last two segments judged
 * once, so many rejected starts in one long run stay linear.
 */
class DomainRuns {
  private run = { start: -1, end: -1, lastDot: -1, previousDot: -1, lastBad: false, previousBad: false };

  /** @param value - text node value */
  constructor(private readonly value: string) {}

  /**
   * End of the domain run at `from`.
   * @param from - first domain character
   */
  public end(from: number): number {
    return this.at(from).end;
  }

  /**
   * Whether the domain from `from` to its run end has two or more segments
   * and acceptable last two.
   * @param from - first domain character
   */
  public isCorrect(from: number): boolean {
    const run = this.at(from);

    if (run.lastDot < from) {
      return false;
    }

    const previous = run.previousDot >= from ? run.previousBad : isBadSegment(this.value.slice(from, run.lastDot));

    return !run.lastBad && !previous;
  }

  /**
   * The cached run, recomputed when `from` is outside it.
   * @param from - a domain character
   */
  private at(from: number): DomainRuns['run'] {
    if (from >= this.run.start && from < this.run.end) {
      return this.run;
    }

    const value = this.value;
    const cursor = { end: from };

    while (isDomainChar(value[cursor.end])) {
      cursor.end++;
    }

    const lastDot = value.lastIndexOf('.', cursor.end - 1);
    const previousDot = lastDot <= from ? -1 : value.lastIndexOf('.', lastDot - 1);

    this.run = {
      start: from,
      end: cursor.end,
      lastDot: lastDot < from ? -1 : lastDot,
      previousDot: previousDot < from ? -1 : previousDot,
      lastBad: isBadSegment(value.slice(lastDot + 1, cursor.end)),
      previousBad: isBadSegment(value.slice(previousDot + 1, Math.max(lastDot, previousDot + 1))),
    };

    return this.run;
  }
}

/**
 * The URL match at a `URL_START` hit, or null when it is not one.
 * @param value - text node value
 * @param start - index of the hit
 * @param protocol - the matched `http://`, `https://` or `www`
 * @param runs - domain run cache
 */
const urlAt = (value: string, start: number, protocol: string, runs: DomainRuns): Match | null => {
  const www = /^w/i.test(protocol);
  const domainStart = start + protocol.length;

  if (!startsAfterBoundary(value, start) || !isDomainChar(value[domainStart])) {
    return null;
  }

  const domainEnd = runs.end(domainStart);

  if (!runs.isCorrect(www ? start : domainStart)) {
    return null;
  }

  const gap = value.slice(domainEnd).search(/[\t\n\r ]/);
  const end = gap === -1 ? value.length : domainEnd + gap;
  const [url, trail] = splitUrl(value.slice(www ? start : domainStart, end));

  if (url === '') {
    return null;
  }

  const nodes: PhrasingContent[] = [www ? link(`http://${url}`, url) : link(protocol + url, protocol + url)];

  if (trail !== '') {
    nodes.push(text(trail));
  }

  return { start, end, nodes };
};

/**
 * Every URL match in a text value. A rejected hit retries one character on.
 * @param value - text node value
 */
const urlMatches = (value: string): Match[] => {
  const found: Match[] = [];
  const pattern = new RegExp(URL_START.source, 'gi');
  const runs = new DomainRuns(value);

  for (const hit = { at: pattern.exec(value) }; hit.at !== null; hit.at = pattern.exec(value)) {
    const match = urlAt(value, hit.at.index, hit.at[0], runs);

    pattern.lastIndex = match === null ? hit.at.index + 1 : match.end;

    if (match !== null) {
      found.push(match);
    }
  }

  return found;
};

const EMAIL_LOCAL = /^[-.\w+]$/;

const EMAIL_DOMAIN = /[-\w]+(?:\.[-\w]+)+/y;

/** What may sit right before an email's local part. */
const EMAIL_BOUNDARY = /[\s\p{P}\p{S}]$/u;

/**
 * The email match for the `@` at `at`, starting no earlier than `from`.
 * The leftmost start after whitespace or punctuation wins; one right after
 * `/` is skipped, so the next start in the local part is tried.
 * @param value - text node value
 * @param at - index of the `@`
 * @param from - earliest start
 */
const emailAt = (value: string, at: number, from: number): Match | null => {
  EMAIL_DOMAIN.lastIndex = at + 1;

  const domain = EMAIL_DOMAIN.exec(value);

  if (domain === null || /[-\d_]$/.test(domain[0])) {
    return null;
  }

  const cursor = { start: at };

  while (cursor.start > from && EMAIL_LOCAL.test(value[cursor.start - 1])) {
    cursor.start--;
  }

  for (; cursor.start < at; cursor.start++) {
    const lookbehind = cursor.start === 0 || EMAIL_BOUNDARY.test(value.slice(Math.max(0, cursor.start - 2), cursor.start));

    if (lookbehind && startsAfterBoundary(value, cursor.start) && value[cursor.start - 1] !== '/') {
      const end = EMAIL_DOMAIN.lastIndex;
      const address = value.slice(cursor.start, end);

      return { start: cursor.start, end, nodes: [link(`mailto:${address}`, address)] };
    }
  }

  return null;
};

/**
 * Every email match in a text value.
 * @param value - text node value
 */
const emailMatches = (value: string): Match[] => {
  const found: Match[] = [];
  const state = { from: 0, at: value.indexOf('@') };

  while (state.at !== -1) {
    const match = emailAt(value, state.at, state.from);

    if (match !== null) {
      found.push(match);
      state.from = match.end;
    }

    state.at = value.indexOf('@', Math.max(state.at + 1, state.from));
  }

  return found;
};

/**
 * The text around the matches, and the links. New text nodes are not
 * merged with their neighbours.
 * @param value - a text node's value
 * @param matches - its matches, in order
 */
const splitText = (value: string, matches: Match[]): PhrasingContent[] => {
  const out: PhrasingContent[] = [];
  const cursor = { at: 0 };

  for (const match of matches) {
    if (match.start > cursor.at) {
      out.push(text(value.slice(cursor.at, match.start)));
    }

    out.push(...match.nodes);
    cursor.at = match.end;
  }

  if (cursor.at < value.length) {
    out.push(text(value.slice(cursor.at)));
  }

  return out;
};

/**
 * A children array with each matching text node replaced, or null when
 * nothing matched.
 * @param children - a children array
 * @param find - the matcher
 */
const replaceIn = (children: PhrasingContent[], find: (value: string) => Match[]): PhrasingContent[] | null => {
  const out: PhrasingContent[] = [];
  const state = { changed: false };

  for (const child of children) {
    const matches = child.type === 'text' ? find(child.value) : [];

    if (child.type === 'text' && matches.length > 0) {
      state.changed = true;
      splitText(child.value, matches).forEach((node) => out.push(node));
    } else {
      out.push(child);
    }
  }

  return state.changed ? out : null;
};

interface Parent {
  children: PhrasingContent[];
}

const isParent = (node: PhrasingContent): node is PhrasingContent & Parent =>
  'children' in node && node.type !== 'link' && node.type !== 'linkReference';

/**
 * Every node with children outside links, the root first.
 * @param root - the leaf
 */
const phrasingParents = (root: Parent): Parent[] => {
  const parents: Parent[] = [root];

  for (const cursor = { at: 0 }; cursor.at < parents.length; cursor.at++) {
    parents[cursor.at].children.filter(isParent).forEach((child) => parents.push(child));
  }

  return parents;
};

/**
 * The text-node pass: URLs first over the whole leaf, then emails.
 * @param children - a leaf's children
 */
export const linkLiteralsInText = (children: PhrasingContent[]): PhrasingContent[] => {
  const root: Parent = { children };

  for (const find of [urlMatches, emailMatches]) {
    for (const parent of phrasingParents(root)) {
      parent.children = replaceIn(parent.children, find) ?? parent.children;
    }
  }

  return root.children;
};

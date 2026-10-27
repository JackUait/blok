/**
 * Blok's syntax highlighter: a TypeScript port of Prism 1.30.0's core.
 *
 * The matching algorithm is a line-by-line port. Prism's grammars rely on its
 * exact quirks (greedy rematching, lookbehind slicing, `rest` merging,
 * `insertBefore` rewriting references), and the upstream test cases pin them.
 * What is left out on purpose: globals, auto-highlighting of the page, the
 * web worker, plugins, and every hook Blok's grammars do not use.
 *
 * Prism is MIT-licensed; its notice ships in NOTICE.
 */

export interface GrammarToken {
  pattern: RegExp;
  lookbehind?: boolean;
  greedy?: boolean;
  alias?: string | string[];
  inside?: Grammar | null;
}

export type GrammarValue = RegExp | GrammarToken | Array<RegExp | GrammarToken>;

/** `rest` is the one key whose value is a grammar, not a pattern. */
export interface Grammar {
  [token: string]: GrammarValue | Grammar | undefined;
  rest?: Grammar;
}

export type TokenStream = Array<string | Token>;

export class Token {
  public type: string;
  public content: string | TokenStream;
  public alias: string | string[] | undefined;
  public length: number;

  constructor(type: string, content: string | TokenStream, alias?: string | string[], matchedStr = '') {
    this.type = type;
    this.content = content;
    this.alias = alias;
    this.length = matchedStr.length;
  }
}

export interface TokenizeEnv {
  code: string;
  grammar: Grammar | undefined;
  language: string;
  tokens: TokenStream;
  /** markup-templating stashes the template code it cut out here. */
  tokenStack?: string[];
}

export interface WrapEnv {
  type: string;
  content: string;
  tag: string;
  classes: string[];
  attributes: Record<string, string>;
  language: string;
}

interface HookEnvs {
  'before-tokenize': TokenizeEnv;
  'after-tokenize': TokenizeEnv;
  wrap: WrapEnv;
}

type HookName = keyof HookEnvs;
type Hook<N extends HookName> = (env: HookEnvs[N]) => void;

export interface Highlighter {
  /** Grammars by name. No prototype, so names like `constructor` are never found by accident. */
  languages: Record<string, Grammar>;
  extend(id: string, redef: Grammar): Grammar;
  insertBefore(inside: string, before: string, insert: Grammar, root?: Record<string, Grammar>): Grammar;
  tokenize(text: string, grammar: Grammar): TokenStream;
  /** Runs the tokenize hooks around `tokenize`, as `highlight` does, and returns the tokens. */
  tokenizeWithHooks(text: string, grammar: Grammar, language: string): TokenStream;
  highlight(text: string, grammar: Grammar, language: string): string;
  hooks: {
    add<N extends HookName>(name: N, callback: Hook<N>): void;
  };
}

interface ListNode {
  value: string | Token | null;
  prev: ListNode | null;
  next: ListNode | null;
}

interface LinkedList {
  head: ListNode;
  tail: ListNode;
  length: number;
}

interface Rematch {
  cause: string;
  reach: number;
}

const hasOwn = (o: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** Prism's `util.type`: only plain objects and arrays are walked, never RegExps. */
const kindOf = (o: unknown): string => Object.prototype.toString.call(o).slice(8, -1);

const isGrammarToken = (value: RegExp | GrammarToken): value is GrammarToken => !(value instanceof RegExp);

/**
 * The token object stored under `name` (or at `index` of its array). Grammars
 * patch each other through these, the way Prism writes `a.tag.inside.x = …`.
 */
export const tokenOf = (grammar: Grammar | null | undefined, name: string, index?: number): GrammarToken => {
  const entry = grammar?.[name];
  const value = Array.isArray(entry) && index !== undefined ? entry[index] : entry;

  if (!value || value instanceof RegExp || Array.isArray(value) || !(value.pattern instanceof RegExp)) {
    throw new Error(`Grammar has no token object "${name}"`);
  }

  return value as GrammarToken;
};

/** The inside grammar of the token object under `name`. */
export const insideOf = (grammar: Grammar | null | undefined, name: string, index?: number): Grammar => {
  const inside = tokenOf(grammar, name, index).inside;

  if (!inside) {
    throw new Error(`Grammar token "${name}" has no inside grammar`);
  }

  return inside;
};

const encode = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/ /g, ' ');

/** Deep copy that keeps shared and circular references shared, like Prism's `util.clone`. */
const deepClone = <T>(o: T, visited: Map<unknown, unknown> = new Map()): T => {
  const kind = kindOf(o);

  if (kind !== 'Object' && kind !== 'Array') {
    return o;
  }

  const seen = visited.get(o);

  if (seen !== undefined) {
    return seen as T;
  }

  if (Array.isArray(o)) {
    const copy: unknown[] = [];

    visited.set(o, copy);
    o.forEach((item, i) => {
      copy[i] = deepClone(item, visited);
    });

    return copy as T;
  }

  const copy: Record<string, unknown> = {};
  const source = o as Record<string, unknown>;

  visited.set(o, copy);
  for (const key in source) {
    if (hasOwn(source, key)) {
      copy[key] = deepClone(source[key], visited);
    }
  }

  return copy as T;
};

/** Walks every object and array reachable from `o`, once each, like Prism's `languages.DFS`. */
const walk = (
  o: Record<string, unknown>,
  callback: (parent: Record<string, unknown>, key: string, value: unknown) => void,
  visited: Set<unknown> = new Set()
): void => {
  for (const key in o) {
    if (!hasOwn(o, key)) {
      continue;
    }

    callback(o, key, o[key]);

    const property = o[key];
    const kind = kindOf(property);

    if ((kind === 'Object' || kind === 'Array') && !visited.has(property)) {
      visited.add(property);
      walk(property as Record<string, unknown>, callback, visited);
    }
  }
};

const createList = (): LinkedList => {
  const head: ListNode = { value: null, prev: null, next: null };
  const tail: ListNode = { value: null, prev: head, next: null };

  head.next = tail;

  return { head, tail, length: 0 };
};

const addAfter = (list: LinkedList, node: ListNode, value: string | Token): ListNode => {
  const next = node.next as ListNode;
  const newNode: ListNode = { value, prev: node, next };

  // eslint-disable-next-line no-param-reassign -- linked list splice
  node.next = newNode;
  next.prev = newNode;
  // eslint-disable-next-line no-param-reassign -- linked list bookkeeping
  list.length++;

  return newNode;
};

const removeRange = (list: LinkedList, node: ListNode, count: number): void => {
  // eslint-disable-next-line no-restricted-syntax -- walks the list
  let next = node.next as ListNode;
  // eslint-disable-next-line no-restricted-syntax -- counts what was removed
  let i = 0;

  for (; i < count && next !== list.tail; i++) {
    next = next.next as ListNode;
  }

  // eslint-disable-next-line no-param-reassign -- linked list splice
  node.next = next;
  next.prev = node;
  // eslint-disable-next-line no-param-reassign -- linked list bookkeeping
  list.length -= i;
};

const toArray = (list: LinkedList): TokenStream => {
  const array: TokenStream = [];

  // eslint-disable-next-line no-restricted-syntax -- walks the list
  for (let node = list.head.next as ListNode; node !== list.tail; node = node.next as ListNode) {
    array.push(node.value as string | Token);
  }

  return array;
};

const valueLength = (node: ListNode): number => (node.value as string | Token).length;

const matchPattern = (pattern: RegExp, pos: number, text: string, lookbehind: boolean): RegExpExecArray | null => {
  // eslint-disable-next-line no-param-reassign -- exec reads lastIndex
  pattern.lastIndex = pos;

  const match = pattern.exec(text);

  if (match && lookbehind && match[1]) {
    const lookbehindLength = match[1].length;

    match.index += lookbehindLength;
    match[0] = match[0].slice(lookbehindLength);
  }

  return match;
};

interface Cursor {
  node: ListNode;
  pos: number;
}

/** One grammar pattern being run over the token list. */
interface PatternRun {
  text: string;
  list: LinkedList;
  grammar: Grammar;
  token: string;
  /** Index of the pattern in the token's list; part of the rematch cause. */
  index: number;
  pattern: RegExp;
  inside: Grammar | null | undefined;
  lookbehind: boolean;
  greedy: boolean;
  alias: string | string[] | undefined;
}

type Step = { kind: 'next'; cursor: Cursor } | { kind: 'break' } | { kind: 'stop' };

type GreedySpan =
  | { kind: 'break' }
  | { kind: 'skip'; cursor: Cursor }
  | { kind: 'span'; cursor: Cursor; str: string; match: RegExpExecArray; removeCount: number };

/**
 * Prism's `tokenize`. The functions below are its `matchGrammar`, split up
 * only to keep nesting shallow: every loop, branch and cursor move is Prism's.
 */
const tokenize = (text: string, grammar: Grammar): TokenStream => {
  const rest = grammar.rest;

  if (rest) {
    for (const token in rest) {
      // eslint-disable-next-line no-param-reassign -- Prism merges rest into the grammar once
      grammar[token] = rest[token];
    }

    // eslint-disable-next-line no-param-reassign -- see above
    delete grammar.rest;
  }

  const tokenList = createList();

  addAfter(tokenList, tokenList.head, text);
  matchGrammar(text, tokenList, grammar, tokenList.head, 0);

  return toArray(tokenList);
};

/** A greedy pattern matches against the whole text, then finds the list nodes its match covers. */
const greedySpan = (run: PatternRun, start: Cursor): GreedySpan => {
  const match = matchPattern(run.pattern, start.pos, run.text, run.lookbehind);

  if (!match || match.index >= run.text.length) {
    return { kind: 'break' };
  }

  const from = match.index;
  const to = match.index + match[0].length;
  // eslint-disable-next-line no-restricted-syntax -- walks forward to the node holding `from`
  let node = start.node;
  // eslint-disable-next-line no-restricted-syntax -- running position
  let p = start.pos + valueLength(node);

  while (from >= p) {
    node = node.next as ListNode;
    p += valueLength(node);
  }
  p -= valueLength(node);

  const cursor: Cursor = { node, pos: p };

  if (node.value instanceof Token) {
    return { kind: 'skip', cursor };
  }

  // eslint-disable-next-line no-restricted-syntax -- counts the nodes the match covers
  let removeCount = 1;

  // eslint-disable-next-line no-restricted-syntax -- walks the nodes the match covers
  for (let k = node; k !== run.list.tail && (p < to || typeof k.value === 'string'); k = k.next as ListNode) {
    removeCount++;
    p += valueLength(k);
  }
  removeCount--;

  match.index -= cursor.pos;

  return { kind: 'span', cursor, str: run.text.slice(cursor.pos, p), match, removeCount };
};

/** Replaces the matched text with a token and rematches what a greedy match swallowed. */
const wrapMatch = (
  run: PatternRun,
  at: Cursor,
  str: string,
  match: RegExpExecArray,
  removeCount: number,
  rematch: Rematch | undefined
): Cursor => {
  const from = match.index;
  const matchStr = match[0];
  const before = str.slice(0, from);
  const after = str.slice(from + matchStr.length);
  const reach = at.pos + str.length;

  if (rematch && reach > rematch.reach) {
    // eslint-disable-next-line no-param-reassign -- rematch reach is shared up the recursion
    rematch.reach = reach;
  }

  // eslint-disable-next-line no-restricted-syntax -- moves past `before`
  let removeFrom = at.node.prev as ListNode;
  const pos = before ? at.pos + before.length : at.pos;

  if (before) {
    removeFrom = addAfter(run.list, removeFrom, before);
  }

  removeRange(run.list, removeFrom, removeCount);

  const wrapped = new Token(run.token, run.inside ? tokenize(matchStr, run.inside) : matchStr, run.alias, matchStr);
  const node = addAfter(run.list, removeFrom, wrapped);

  if (after) {
    addAfter(run.list, node, after);
  }

  if (removeCount > 1) {
    const nestedRematch: Rematch = { cause: `${run.token},${run.index}`, reach };

    matchGrammar(run.text, run.list, run.grammar, node.prev as ListNode, pos, nestedRematch);

    if (rematch && nestedRematch.reach > rematch.reach) {
      // eslint-disable-next-line no-param-reassign -- rematch reach is shared up the recursion
      rematch.reach = nestedRematch.reach;
    }
  }

  return { node, pos };
};

/** One pass of the list loop body. `next` continues with the returned cursor. */
const matchAt = (run: PatternRun, cursor: Cursor, rematch: Rematch | undefined): Step => {
  if (rematch && cursor.pos >= rematch.reach) {
    return { kind: 'break' };
  }

  const value = cursor.node.value as string | Token;

  if (run.list.length > run.text.length) {
    // Something went terribly wrong; Prism bails out instead of looping forever.
    return { kind: 'stop' };
  }

  if (value instanceof Token) {
    return { kind: 'next', cursor };
  }

  if (!run.greedy) {
    const match = matchPattern(run.pattern, 0, value, run.lookbehind);

    return { kind: 'next', cursor: match ? wrapMatch(run, cursor, value, match, 1, rematch) : cursor };
  }

  const span = greedySpan(run, cursor);

  if (span.kind !== 'span') {
    return span.kind === 'break' ? span : { kind: 'next', cursor: span.cursor };
  }

  return { kind: 'next', cursor: wrapMatch(run, span.cursor, span.str, span.match, span.removeCount, rematch) };
};

/** Runs one pattern over the list. Returns false when the whole grammar must stop. */
const runPattern = (run: PatternRun, startNode: ListNode, startPos: number, rematch: Rematch | undefined): boolean => {
  // eslint-disable-next-line no-restricted-syntax -- the list cursor
  let cursor: Cursor = { node: startNode.next as ListNode, pos: startPos };

  while (cursor.node !== run.list.tail) {
    const step = matchAt(run, cursor, rematch);

    if (step.kind !== 'next') {
      return step.kind === 'break';
    }

    cursor = { node: step.cursor.node.next as ListNode, pos: step.cursor.pos + valueLength(step.cursor.node) };
  }

  return true;
};

const toPatternRun = (
  text: string,
  list: LinkedList,
  grammar: Grammar,
  token: string,
  index: number,
  patternObj: RegExp | GrammarToken
): PatternRun => {
  const tokenObj = isGrammarToken(patternObj) ? patternObj : undefined;
  const greedy = Boolean(tokenObj?.greedy);

  if (tokenObj && greedy && !tokenObj.pattern.global) {
    // Written back so the next run reuses the global copy.
    tokenObj.pattern = RegExp(tokenObj.pattern.source, `${tokenObj.pattern.flags.replace(/[^imsuy]/g, '')}g`);
  }

  return {
    text,
    list,
    grammar,
    token,
    index,
    pattern: tokenObj ? tokenObj.pattern : (patternObj as RegExp),
    inside: tokenObj?.inside,
    lookbehind: Boolean(tokenObj?.lookbehind),
    greedy,
    alias: tokenObj?.alias,
  };
};

/** Returns false when the whole grammar must stop. */
const matchToken = (
  text: string,
  list: LinkedList,
  grammar: Grammar,
  token: string,
  startNode: ListNode,
  startPos: number,
  rematch: Rematch | undefined
): boolean => {
  const entry = grammar[token] as GrammarValue;
  const patterns = Array.isArray(entry) ? entry : [entry];

  return patterns.every((patternObj, j) => {
    if (rematch && rematch.cause === `${token},${j}`) {
      return false;
    }

    return runPattern(toPatternRun(text, list, grammar, token, j, patternObj), startNode, startPos, rematch);
  });
};

const matchGrammar = (
  text: string,
  tokenList: LinkedList,
  grammar: Grammar,
  startNode: ListNode,
  startPos: number,
  rematch?: Rematch
): void => {
  for (const token in grammar) {
    if (!hasOwn(grammar, token) || !grammar[token]) {
      continue;
    }

    if (!matchToken(text, tokenList, grammar, token, startNode, startPos, rematch)) {
      return;
    }
  }
};

/**
 * Creates an isolated highlighter. Grammars register on its `languages` and
 * hooks run only on this instance.
 */
export const createHighlighter = (): Highlighter => {
  const languages: Record<string, Grammar> = Object.create(null) as Record<string, Grammar>;
  const hookLists: { [N in HookName]: Array<Hook<N>> } = {
    'before-tokenize': [],
    'after-tokenize': [],
    wrap: [],
  };

  const runHooks = <N extends HookName>(name: N, env: HookEnvs[N]): void => {
    for (const callback of hookLists[name] as Array<Hook<N>>) {
      callback(env);
    }
  };

  const runTokenize = (env: TokenizeEnv): TokenizeEnv => {
    runHooks('before-tokenize', env);

    if (!env.grammar) {
      throw new Error(`The language "${env.language}" has no grammar.`);
    }

    // eslint-disable-next-line no-param-reassign -- hooks share this env object
    env.tokens = tokenize(env.code, env.grammar);
    runHooks('after-tokenize', env);

    return env;
  };

  const stringify = (o: string | Token | TokenStream, language: string): string => {
    if (typeof o === 'string') {
      return encode(o);
    }

    if (Array.isArray(o)) {
      return o.map((item) => stringify(item, language)).join('');
    }

    const env: WrapEnv = {
      type: o.type,
      content: stringify(o.content, language),
      tag: 'span',
      classes: ['token', o.type],
      attributes: {},
      language,
    };

    if (o.alias) {
      env.classes.push(...(Array.isArray(o.alias) ? o.alias : [o.alias]));
    }

    runHooks('wrap', env);

    const attributes = Object.keys(env.attributes)
      .map((name) => ` ${name}="${(env.attributes[name] || '').replace(/"/g, '&quot;')}"`)
      .join('');

    return `<${env.tag} class="${env.classes.join(' ')}"${attributes}>${env.content}</${env.tag}>`;
  };

  return {
    languages,

    extend(id, redef) {
      const lang = deepClone(languages[id]);

      for (const key in redef) {
        lang[key] = redef[key];
      }

      return lang;
    },

    insertBefore(inside, before, insert, root = languages) {
      const grammar = root[inside];
      const ret: Grammar = {};

      for (const token in grammar) {
        if (!hasOwn(grammar, token)) {
          continue;
        }

        if (token === before) {
          Object.assign(ret, insert);
        }

        if (!hasOwn(insert, token)) {
          ret[token] = grammar[token];
        }
      }

      const old = root[inside];

      // eslint-disable-next-line no-param-reassign -- Prism replaces the grammar in place
      root[inside] = ret;

      walk(languages, (parent, key, value) => {
        if (value === old && key !== inside) {
          // eslint-disable-next-line no-param-reassign -- repoint references to the replaced grammar
          parent[key] = ret;
        }
      });

      return ret;
    },

    tokenize,

    tokenizeWithHooks(text, grammar, language) {
      return runTokenize({ code: text, grammar, language, tokens: [] }).tokens;
    },

    highlight(text, grammar, language) {
      const env = runTokenize({ code: text, grammar, language, tokens: [] });

      return stringify(env.tokens, env.language);
    },

    hooks: {
      add(name, callback) {
        (hookLists[name] as Array<typeof callback>).push(callback);
      },
    },
  };
};

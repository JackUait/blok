/**
 * When parse5 8.0.1 throws on lone surrogates, decided without parse5.
 *
 * parse5's preprocessor pairs ANY surrogate with a following low surrogate, so
 * two low surrogates in a row read as a code point of 0x110000 or more, and
 * `String.fromCodePoint` throws when the tokenizer appends or emits it. Pairs
 * are formed left to right over the whole input. The only states that read a
 * character without appending it are the DOCTYPE states after the name, so the
 * input throws unless every such code point lands inside a DOCTYPE token there.
 *
 * Whether `<!DOCTYPE` opens a DOCTYPE depends on the tokenizer state, which the
 * tree builder switches (RAWTEXT for `<style>`, foreign content for CDATA, the
 * select and frameset modes that ignore `<style>`). So the slow path below runs
 * the tokenizer states exactly and a small model of the tree builder.
 */
import { getTagID, NS, SPECIAL_ELEMENTS } from '../html/tags';
import { PACKED_ENTITIES } from '../markdown/engine/entities';

/** How Blok calls parse5: `parseFragment(html)`, `parseFragment(<div>, html)`, `parse(html)`. */
export type Parse5Entry = 'fragment' | 'div' | 'document';

type State =
  | 'data' | 'rcdata' | 'rawtext' | 'script' | 'plaintext'
  | 'tagOpen' | 'endTagOpen' | 'tagName'
  | 'textLt' | 'textEndTagOpen' | 'textEndTagName'
  | 'scriptLt' | 'scriptEndTagOpen' | 'scriptEndTagName' | 'escapeStart' | 'escapeStartDash'
  | 'escaped' | 'escapedDash' | 'escapedDashDash' | 'escapedLt' | 'escapedEndTagOpen' | 'escapedEndTagName'
  | 'doubleEscapeStart' | 'doubleEscaped' | 'doubleEscapedDash' | 'doubleEscapedDashDash' | 'doubleEscapedLt' | 'doubleEscapeEnd'
  | 'beforeAttrName' | 'attrName' | 'afterAttrName' | 'beforeAttrValue'
  | 'attrValueDq' | 'attrValueSq' | 'attrValueUnquoted' | 'afterAttrValue' | 'selfClosing'
  | 'bogusComment' | 'markupDeclaration' | 'commentStart' | 'commentStartDash' | 'comment'
  | 'commentLt' | 'commentLtBang' | 'commentLtBangDash' | 'commentLtBangDashDash'
  | 'commentEndDash' | 'commentEnd' | 'commentEndBang'
  | 'beforeDoctypeName' | 'doctypeName' | 'afterDoctypeName'
  | 'afterPublicKeyword' | 'beforePublicId' | 'publicIdDq' | 'publicIdSq' | 'afterPublicId' | 'betweenIds'
  | 'afterSystemKeyword' | 'beforeSystemId' | 'systemIdDq' | 'systemIdSq' | 'afterSystemId' | 'bogusDoctype'
  | 'cdata' | 'cdataBracket' | 'cdataEnd';

type Mode = 'head' | 'body' | 'select' | 'selectInTable' | 'frameset' | 'afterFrameset' | 'templateColumns';

interface OpenElement {
  name: string;
  ns: NS;
  /** svg foreignObject/desc/title, or MathML annotation-xml with an HTML encoding. */
  htmlPoint: boolean;
  /** MathML mi, mo, mn, ms, mtext. */
  mathPoint: boolean;
  /** A template still in the "in template" insertion mode: its first start tag picks the mode. */
  fresh?: boolean;
  /** A template whose first start tag was `<col>`: it ignores everything but col and template. */
  columns?: boolean;
  /** A template whose first start tag was a table part (that tag): its content runs the table modes. */
  table?: string;
}

interface Tag {
  name: string;
  end: boolean;
  selfClosing: boolean;
  attrs: Map<string, string>;
  attrName: string;
  attrValue: string;
  /** False for a repeated attribute name: parse5 drops it. */
  attrKept: boolean;
}

interface Machine {
  html: string;
  /** Index of the next code unit to read. */
  pos: number;
  /** Index of the last code unit read: where parse5's look-ahead starts. */
  last: number;
  state: State;
  /** The text state a rawtext/rcdata `<` came from. */
  textState: State;
  tag: Tag;
  lastStartTag: string;
  stack: OpenElement[];
  context: OpenElement | null;
  mode: Mode;
  framesetOk: boolean;
  document: boolean;
}

type Handler = (cp: number) => void;

const CR = 0x0d;
const LF = 0x0a;
const LT = 0x3c;
const GT = 0x3e;
const SLASH = 0x2f;
const BANG = 0x21;
const DASH = 0x2d;
const EQ = 0x3d;
const DQ = 0x22;
const SQ = 0x27;
const QM = 0x3f;
const RSQB = 0x5d;
const NUL = 0;
const FIRST_INVALID = 0x110000;

/** The next state for `cp`, from a table of the characters a state reacts to. */
const byCode = (cp: number, next: Partial<Record<number, State>>, otherwise: State): State => next[cp] ?? otherwise;

/** Extra scope barriers: `</li>` stops at a list, `</p>` at a button. */
const SCOPE_EXTRAS: Partial<Record<string, string[]>> = { li: ['ol', 'ul'], p: ['button'] };

/** The table mode a template's first table tag puts its content in. */
const TEMPLATE_TABLE_LEVEL: Partial<Record<string, string>> = { tr: 'tbody', td: 'tr', th: 'tr' };

const isSpace = (cp: number): boolean => cp === 0x20 || cp === LF || cp === 0x09 || cp === 0x0c;
const isAlpha = (cp: number): boolean => (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
const lower = (cp: number): string => String.fromCharCode(cp >= 0x41 && cp <= 0x5a ? cp + 0x20 : cp);
const isLow = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;
const isSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdfff;

const HTML_ELEMENT = (name: string): OpenElement => ({ name, ns: NS.HTML, htmlPoint: false, mathPoint: false });

const VOID = new Set([
  'area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr', 'image', 'img', 'input', 'keygen',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const RCDATA_TAGS = new Set(['title', 'textarea']);

const RAWTEXT_TAGS = new Set(['style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);

const HEAD_TAGS = new Set(['base', 'basefont', 'bgsound', 'link', 'meta', 'head', 'html']);

const FRAMESET_KILLERS = new Set([
  'pre', 'listing', 'li', 'dd', 'dt', 'button', 'applet', 'marquee', 'object', 'table', 'area', 'br', 'embed', 'img',
  'keygen', 'wbr', 'image', 'hr', 'textarea', 'xmp', 'iframe', 'select',
]);

const TABLE_TAGS = new Set(['caption', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'td', 'th']);

const TABLE_ONLY = new Set(['caption', 'col', 'colgroup', 'frame', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr']);

/** End tags in body that pop to their element only when it is in scope. */
const SCOPED_END = new Set([
  'address', 'article', 'aside', 'blockquote', 'button', 'center', 'details', 'dialog', 'dir', 'div', 'dl',
  'fieldset', 'figcaption', 'figure', 'footer', 'header', 'hgroup', 'listing', 'main', 'menu', 'nav', 'ol', 'pre',
  'search', 'section', 'summary', 'ul', 'applet', 'marquee', 'object', 'dd', 'dt',
]);

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const SCOPE_BARRIERS: Record<NS, ReadonlySet<string>> = {
  [NS.HTML]: new Set(['applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object', 'template']),
  [NS.MATHML]: new Set(['mi', 'mo', 'mn', 'ms', 'mtext', 'annotation-xml']),
  [NS.SVG]: new Set(['foreignobject', 'desc', 'title']),
  [NS.XLINK]: new Set(),
  [NS.XML]: new Set(),
  [NS.XMLNS]: new Set(),
};

const EXITS_FOREIGN = new Set([
  'b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'embed', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'head', 'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta', 'nobr', 'ol', 'p', 'pre', 'ruby', 's',
  'small', 'span', 'strong', 'strike', 'sub', 'sup', 'table', 'tt', 'u', 'ul', 'var',
]);

const MATH_TEXT_POINTS = new Set(['mi', 'mo', 'mn', 'ms', 'mtext']);

const SVG_HTML_POINTS = new Set(['foreignobject', 'desc', 'title']);

const isPoint = (element: OpenElement): boolean => element.htmlPoint || element.mathPoint;

/** Foreign names are kept lowercase, so the foreign special elements are matched by name. */
const isSpecial = (element: OpenElement): boolean => (element.ns === NS.HTML
  ? SPECIAL_ELEMENTS[NS.HTML].has(getTagID(element.name))
  : SCOPE_BARRIERS[element.ns].has(element.name));

/** `Array#findLastIndex`, which the es2022 lib does not have. */
const lastIndexWhere = <T>(list: readonly T[], test: (item: T, index: number) => boolean): number =>
  list.map(test).lastIndexOf(true);

/** Start tags that switch the tokenizer, in every mode that runs the in-head or in-body rules for them. */
const textStateOf = (name: string): State | undefined => {
  if (RCDATA_TAGS.has(name)) {
    return 'rcdata';
  }
  if (RAWTEXT_TAGS.has(name)) {
    return 'rawtext';
  }

  return name === 'script' ? 'script' : undefined;
};

/** Start tags a template in the "in template" mode reads with in-head rules, staying in that mode. */
const TEMPLATE_HEAD_TAGS = new Set(['base', 'basefont', 'bgsound', 'link', 'meta', 'noframes', 'script', 'style', 'template', 'title']);

const TABLE_PART_ENDS = ['tbody', 'tfoot', 'thead'];

/** Which open table part a table start tag closes before it is inserted. */
const CLOSED_BY: Record<string, ReadonlySet<string>> = {
  td: new Set(['caption', 'col', 'colgroup', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr']),
  th: new Set(['caption', 'col', 'colgroup', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr']),
  tr: new Set(['caption', 'col', 'colgroup', 'tbody', 'tfoot', 'thead', 'tr']),
  tbody: new Set(['caption', 'col', 'colgroup', 'tbody', 'tfoot', 'thead']),
  thead: new Set(['caption', 'col', 'colgroup', 'tbody', 'tfoot', 'thead']),
  tfoot: new Set(['caption', 'col', 'colgroup', 'tbody', 'tfoot', 'thead']),
  caption: new Set(['caption', 'col', 'colgroup', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr']),
};

const FORMATTING = new Set(['a', 'b', 'big', 'code', 'em', 'font', 'i', 'nobr', 's', 'small', 'strike', 'strong', 'tt', 'u']);

const emptyTag = (end: boolean): Tag => ({ name: '', end, selfClosing: false, attrs: new Map(), attrName: '', attrValue: '', attrKept: false });

const NAMED = { table: null as Map<string, string> | null };

const namedEntity = (name: string): string | undefined => {
  NAMED.table ??= new Map(PACKED_ENTITIES.split('~').map((entry) => {
    const space = entry.indexOf(' ');

    return [entry.slice(0, space), entry.slice(space + 1)];
  }));

  return NAMED.table.get(name);
};

const fromNumber = (code: number): string =>
  (code > 0 && code < 0xd800) || (code > 0xdfff && code < FIRST_INVALID) ? String.fromCodePoint(code) : '\uFFFD';

/**
 * Character references in an attribute value, as far as the two values the tree
 * builder compares need: `encoding` and `type` are matched against ASCII words,
 * which only numeric and semicolon-terminated named references can spell.
 * @param value - raw attribute value
 */
const decodeAttribute = (value: string): string => (value.includes('&')
  ? value.replace(/&#[xX]([0-9a-fA-F]+);?|&#(\d+);?|&([A-Za-z][A-Za-z0-9]*);/g, (match, hex?: string, dec?: string, name?: string) => {
    if (name !== undefined) {
      return namedEntity(name) ?? match;
    }

    return fromNumber(hex === undefined ? Number(dec) : Number.parseInt(hex, 16));
  })
  : value);

/** A surrogate and the low surrogate after it: matched left to right, these are parse5's pairs. */
const PAIR = /[\uD800-\uDFFF][\uDC00-\uDFFF]/g;

/** Index of the first pair parse5 reads as two low surrogates, or -1. */
const firstInvalidPair = (html: string): number => {
  for (const match of html.matchAll(PAIR)) {
    if (isLow(match[0].charCodeAt(0))) {
      return match.index;
    }
  }

  return -1;
};

const machineFor = (html: string, entry: Parse5Entry): Machine => ({
  html,
  pos: 0,
  last: -1,
  state: 'data',
  textState: 'data',
  tag: emptyTag(false),
  lastStartTag: '',
  stack: [HTML_ELEMENT('html')],
  context: entry === 'document' ? null : { ...HTML_ELEMENT(entry === 'div' ? 'div' : 'template'), fresh: entry === 'fragment' },
  mode: entry === 'document' ? 'head' : 'body',
  framesetOk: true,
  document: entry === 'document',
});

/**
 * The tokenizer and tree-builder model for one input. Its state lives in this
 * closure, so the handlers can mutate it.
 * @param html - markup
 * @param entry - which parse5 entry point reads it
 */
const tokenizerFor = (html: string, entry: Parse5Entry): (() => boolean) => {
  const m = machineFor(html, entry);

  /** parse5's `startsWith(pattern, false)`: ASCII case-insensitive, from the last code unit read. */
  const lookingAt = (pattern: string): boolean =>
    m.last + pattern.length <= m.html.length &&
    Array.from(pattern).every((char, index) => (m.html.charCodeAt(m.last + index) | 0x20) === char.charCodeAt(0));

  /** parse5's `peek`: a raw code unit, CR read as LF. */
  const peek = (offset: number): number => {
    const unit = m.html.charCodeAt(m.last + offset);

    return unit === CR ? LF : unit;
  };

  /** One code point the way parse5's preprocessor yields it. */
  const advance = (): number => {
    const unit = m.html.charCodeAt(m.pos);
    const next = m.html.charCodeAt(m.pos + 1);

    if (unit === CR) {
      m.last = m.pos;
      m.pos += next === LF ? 2 : 1;

      return LF;
    }
    if (isSurrogate(unit) && isLow(next)) {
      m.last = m.pos + 1;
      m.pos += 2;

      return (unit - 0xd800) * 1024 + 0x2400 + next;
    }
    m.last = m.pos;
    m.pos += 1;

    return unit;
  };

  const HTML_ENCODINGS = new Set(['text/html', 'application/xhtml+xml']);

  /** The DOCTYPE states that read a character without appending it anywhere. */
  const SKIPS_CHARACTER = new Set<State>([
    'afterDoctypeName', 'afterPublicKeyword', 'beforePublicId', 'afterPublicId', 'betweenIds',
    'afterSystemKeyword', 'beforeSystemId', 'afterSystemId', 'bogusDoctype',
  ]);

  const top = (): OpenElement => m.stack[m.stack.length - 1];

  const adjustedCurrent = (): OpenElement => (m.stack.length === 1 && m.context !== null ? m.context : top());

  const hasTemplate = (): boolean => m.stack.some((element) => element.ns === NS.HTML && element.name === 'template');

  const foreignElement = (tag: Tag, ns: NS): OpenElement => {
    const encoding = tag.attrs.get('encoding');

    return {
      name: tag.name,
      ns,
      htmlPoint: ns === NS.SVG
        ? SVG_HTML_POINTS.has(tag.name)
        : tag.name === 'annotation-xml' && encoding !== undefined && HTML_ENCODINGS.has(encoding.toLowerCase()),
      mathPoint: ns === NS.MATHML && MATH_TEXT_POINTS.has(tag.name),
    };
  };

  const popUntil = (name: string): void => {
    const index = m.stack.map((element) => element.ns === NS.HTML && element.name === name).lastIndexOf(true);

    if (index > 0) {
      m.stack.length = index;
    }
  };

  /** The open select and whether a table holds it, below any template. */
  const selectMode = (): Mode => {
    const below = m.stack.slice(0, m.stack.map((element) => element.name === 'select' && element.ns === NS.HTML).lastIndexOf(true));
    const lastTemplate = below.map((element) => element.name === 'template' && element.ns === NS.HTML).lastIndexOf(true);
    const template = lastTemplate === -1 ? m.context : below[lastTemplate];
    const inTable = template?.table !== undefined || below.slice(lastTemplate + 1).some((element) => element.ns === NS.HTML && TABLE_TAGS.has(element.name));

    return inTable ? 'selectInTable' : 'select';
  };

  const resetMode = (): void => {
    // parse5 resets by tag id alone, so an svg <select> counts too.
    const found = [...m.stack].reverse().find((element) => ['select', 'template', 'frameset'].includes(element.name))
      ?? (m.context?.name === 'template' ? m.context : undefined);

    if (found?.columns === true) {
      m.mode = 'templateColumns';

      return;
    }

    if (found?.name === 'select') {
      m.mode = selectMode();

      return;
    }
    if (found?.name === 'frameset') {
      m.mode = 'frameset';

      return;
    }
    m.mode = m.document && !m.stack.some((element) => element.name === 'body' && element.ns === NS.HTML) && found === undefined ? 'head' : 'body';
  };

  const startText = (name: string, state: State): void => {
    m.stack.push(HTML_ELEMENT(name));
    m.state = state;
  };

  const enterBody = (): void => {
    m.stack.push(HTML_ELEMENT('body'));
    m.mode = 'body';
  };

  /** The parts of the tree builder's start-tag rules that can change the tokenizer state later on. */
  const htmlStartTag = (tag: Tag): void => {
    START_RULES[m.mode](tag);
  };

  const bodyStartTag = (tag: Tag): void => {
    const current = adjustedCurrent();
    const fresh = current.fresh === true;

    if (fresh && !TEMPLATE_HEAD_TAGS.has(tag.name)) {
      current.fresh = false;
    }
    if (fresh && tag.name === 'col') {
      current.columns = true;
      m.mode = 'templateColumns';

      return;
    }
    if (fresh && TABLE_ONLY.has(tag.name) && tag.name !== 'frame') {
      current.table = tag.name;
    }
    bodyRules(tag, fresh);
  };

  const bodyRules = (tag: Tag, fresh: boolean): void => {
    const text = textStateOf(tag.name);

    if (FRAMESET_KILLERS.has(tag.name) || (tag.name === 'input' && tag.attrs.get('type')?.toLowerCase() !== 'hidden')) {
      m.framesetOk = false;
    }
    if (text !== undefined || tag.name === 'plaintext') {
      startText(tag.name, text ?? 'plaintext');

      return;
    }
    if (tag.name === 'svg' || tag.name === 'math') {
      m.stack.push(foreignElement(tag, tag.name === 'svg' ? NS.SVG : NS.MATHML));
      if (tag.selfClosing) {
        m.stack.pop();
      }

      return;
    }
    if (TABLE_ONLY.has(tag.name) && !fresh && !openTable()) {
      return;
    }
    if (top().ns === NS.HTML && top().name === 'colgroup' && tag.name !== 'col' && tag.name !== 'template') {
      m.stack.pop();
    }
    if (TABLE_ONLY.has(tag.name)) {
      closeTableParts(tag.name);
      impliedTableParents(tag.name);
    }
    BODY_TAG_RULES[tag.name]?.(tag);
    if (!VOID.has(tag.name) && !(tag.name in BODY_TAG_RULES)) {
      m.stack.push(HTML_ELEMENT(tag.name));
    }
  };

  const BODY_TAG_RULES: Record<string, (tag: Tag) => void> = {
    html: () => undefined,
    head: () => undefined,
    body: () => {
      m.framesetOk = m.framesetOk && hasTemplate();
    },
    frameset: () => {
      if (m.document && m.framesetOk && m.stack[1]?.name === 'body' && !hasTemplate()) {
        m.stack.length = 1;
        m.stack.push(HTML_ELEMENT('frameset'));
        m.mode = 'frameset';
      }
    },
    select: () => {
      m.stack.push(HTML_ELEMENT('select'));
      m.mode = selectMode();
    },
    template: () => {
      pushTemplate();
      m.framesetOk = false;
    },
  };

  const pushTemplate = (): void => {
    m.stack.push({ ...HTML_ELEMENT('template'), fresh: true });
    m.mode = 'body';
  };

  const START_RULES: Record<Mode, (tag: Tag) => void> = {
    head: (tag) => {
      const text = textStateOf(tag.name);

      if (HEAD_TAGS.has(tag.name)) {
        return;
      }
      if (text !== undefined && tag.name !== 'textarea' && tag.name !== 'xmp' && tag.name !== 'iframe' && tag.name !== 'noembed') {
        startText(tag.name, text);

        return;
      }
      if (tag.name === 'template') {
        BODY_TAG_RULES.template(tag);

        return;
      }
      if (tag.name === 'frameset') {
        m.stack.push(HTML_ELEMENT('frameset'));
        m.mode = 'frameset';

        return;
      }
      enterBody();
      if (tag.name === 'body') {
        m.framesetOk = false;

        return;
      }
      bodyStartTag(tag);
    },
    body: bodyStartTag,
    select: (tag) => selectStartTag(tag),
    selectInTable: (tag) => {
      if (TABLE_TAGS.has(tag.name)) {
        popUntil('select');
        resetMode();
        processStartTag(tag);

        return;
      }
      selectStartTag(tag);
    },
    frameset: (tag) => {
      if (tag.name === 'frameset') {
        m.stack.push(HTML_ELEMENT('frameset'));
      }
      if (tag.name === 'noframes') {
        startText(tag.name, 'rawtext');
      }
    },
    templateColumns: (tag) => {
      if (tag.name === 'template') {
        pushTemplate();
      }
    },
    afterFrameset: (tag) => {
      if (tag.name === 'noframes') {
        startText(tag.name, 'rawtext');
      }
    },
  };

  const hasSelectInScope = (): boolean => {
    const index = [...m.stack].reverse().findIndex((element) => element.ns !== NS.HTML || !['option', 'optgroup'].includes(element.name));

    return index !== -1 && m.stack[m.stack.length - 1 - index].name === 'select';
  };

  const selectStartTag = (tag: Tag): void => {
    if (['input', 'keygen', 'textarea', 'select'].includes(tag.name)) {
      if (!hasSelectInScope()) {
        return;
      }
      popUntil('select');
      resetMode();
      if (tag.name !== 'select') {
        processStartTag(tag);
      }

      return;
    }
    if (tag.name === 'option' || tag.name === 'optgroup' || tag.name === 'hr') {
      ['option', 'optgroup'].slice(0, tag.name === 'option' ? 1 : 2).forEach((name) => {
        if (top().ns === NS.HTML && top().name === name) {
          m.stack.pop();
        }
      });
    }
    if (tag.name === 'option' || tag.name === 'optgroup') {
      m.stack.push(HTML_ELEMENT(tag.name));
    }
    if (tag.name === 'script') {
      startText(tag.name, 'script');
    }
    if (tag.name === 'template') {
      pushTemplate();
    }
  };

  const foreignRulesApply = (tag: Tag): boolean => {
    const current = adjustedCurrent();

    if (current.ns === NS.HTML || (tag.name === 'svg' && current.ns === NS.MATHML && current.name === 'annotation-xml')) {
      return false;
    }

    return !isPoint(current) || ((tag.name === 'mglyph' || tag.name === 'malignmark') && current.mathPoint && !current.htmlPoint);
  };

  const processStartTag = (tag: Tag): void => {
    if (!foreignRulesApply(tag)) {
      htmlStartTag(tag);

      return;
    }
    const exits = EXITS_FOREIGN.has(tag.name) || (tag.name === 'font' && ['color', 'face', 'size'].some((name) => tag.attrs.has(name)));

    if (!exits) {
      m.stack.push(foreignElement(tag, adjustedCurrent().ns));
      if (tag.selfClosing) {
        m.stack.pop();
      }

      return;
    }
    popToHtmlOrPoint();
    htmlStartTag(tag);
  };

  const popToHtmlOrPoint = (): void => {
    const index = m.stack.map((element) => element.ns === NS.HTML || isPoint(element)).lastIndexOf(true);

    m.stack.length = Math.max(index + 1, 1);
  };

  /** `any other end tag` in body: pops to a matching element unless a special one is in the way. */
  const genericEndTag = (name: string): void => {
    const index = lastIndexWhere(m.stack, (element) => element.name === name || isSpecial(element));

    if (index > 0 && m.stack[index].name === name) {
      m.stack.length = index;
    }
  };

  /** Index of the element the end tag closes when it is in the right scope, else -1. */
  const inScope = (matches: (element: OpenElement) => boolean, extra: readonly string[]): number => {
    const index = lastIndexWhere(m.stack, (element) => matches(element)
      || SCOPE_BARRIERS[element.ns].has(element.name)
      || (element.ns === NS.HTML && extra.includes(element.name)));

    return index !== -1 && matches(m.stack[index]) ? index : -1;
  };

  const scopedEndTag = (name: string): void => {
    const headings = HEADINGS.has(name);
    const matches = (element: OpenElement): boolean => element.ns === NS.HTML && (headings ? HEADINGS.has(element.name) : element.name === name);
    const extra = SCOPE_EXTRAS[name] ?? [];
    const index = inScope(matches, extra);

    if (index > 0) {
      m.stack.length = index;
    }
  };

  /** Whether a table is open above the last template: table rules take its end tags. */
  const openTable = (): boolean => {
    const lastTemplate = lastIndexWhere(m.stack, (element) => element.ns === NS.HTML && element.name === 'template');
    const template = lastTemplate === -1 ? m.context : m.stack[lastTemplate];

    return template?.table !== undefined || m.stack.slice(lastTemplate + 1).some((element) => element.ns === NS.HTML && element.name === 'table');
  };

  /** Index of the nearest `name` in table scope, or -1. */
  const inTableScope = (names: readonly string[]): number => {
    const index = lastIndexWhere(m.stack, (element) => element.ns === NS.HTML && (names.includes(element.name) || ['html', 'table', 'template'].includes(element.name)));

    return index > 0 && names.includes(m.stack[index].name) ? index : -1;
  };

  const popTo = (index: number): void => {
    if (index > 0) {
      m.stack.length = index;
    }
  };

  /** How deep in a table the insertion point is: what a template's first table tag, or the nearest open part, says. */
  const tableLevel = (): string => {
    const part = lastIndexWhere(m.stack, (element) => element.ns === NS.HTML && ['tr', 'table', 'template', ...TABLE_PART_ENDS].includes(element.name));
    const element = part > 0 ? m.stack[part] : m.context;
    const first = element?.name === 'template' ? element.table : undefined;

    if (first !== undefined) {
      return TEMPLATE_TABLE_LEVEL[first] ?? 'table';
    }

    if (element === null || element.name === 'table' || element.name === 'template') {
      return 'table';
    }

    return element.name === 'tr' ? 'tr' : 'tbody';
  };

  /** A row or cell started straight in a table gets the tbody and tr the table modes insert for it. */
  const impliedTableParents = (name: string): void => {
    const level = tableLevel();
    const cell = name === 'td' || name === 'th';

    if ((name === 'tr' || cell) && level === 'table') {
      m.stack.push(HTML_ELEMENT('tbody'));
    }
    if (cell && level !== 'tr') {
      m.stack.push(HTML_ELEMENT('tr'));
    }
  };

  /** A table start tag closes the cell, row, body or caption it cannot nest in, innermost first. */
  const closeTableParts = (name: string): void => {
    const part = lastIndexWhere(m.stack, (element) => element.ns === NS.HTML && ['td', 'th', 'tr', 'caption', 'table', 'template', ...TABLE_PART_ENDS].includes(element.name));

    if (part <= 0 || !CLOSED_BY[m.stack[part].name]?.has(name)) {
      return;
    }
    m.stack.length = part;
    closeTableParts(name);
  };

  /**
   * The table end tags, as the caption, cell, row and table-body modes run them:
   * an end tag for an outer part closes the inner ones first.
   */
  const tableEndTag = (name: string): void => {
    const part = lastIndexWhere(m.stack, (element) => element.ns === NS.HTML && ['td', 'th', 'tr', 'caption', 'table', 'template', ...TABLE_PART_ENDS].includes(element.name));
    const mode = part > 0 ? m.stack[part].name : 'table';

    if (mode === 'caption' && (name === 'caption' || name === 'table')) {
      popTo(inTableScope(['caption']));
      popTo(name === 'table' ? inTableScope(['table']) : -1);

      return;
    }
    if ((mode === 'td' || mode === 'th') && !['td', 'th'].includes(name) && inTableScope([name]) === -1) {
      return;
    }
    popTo(['td', 'th'].includes(name) || name === 'caption' ? inTableScope([name]) : inTableScope(['td', 'th']));
    if (name === 'tr' || name === 'table' || TABLE_PART_ENDS.includes(name)) {
      rowEndTag(name);
    }
  };

  const rowEndTag = (name: string): void => {
    const row = inTableScope(['tr']);
    const closesRow = name === 'tr' || name === 'table' ? row !== -1 : row !== -1 || inTableScope([name]) !== -1;

    if (closesRow && row !== -1) {
      popTo(row);
    }
    if (name === 'tr' || (row !== -1 && !closesRow)) {
      return;
    }
    const body = inTableScope(TABLE_PART_ENDS);

    if (TABLE_PART_ENDS.includes(name)) {
      popTo(inTableScope([name]));

      return;
    }
    popTo(body);
    popTo(inTableScope(['table']));
  };

  /**
   * The adoption agency, for the stack only: with no special element above the
   * formatting element it pops to it; otherwise its outer loop ends up popping
   * everything above the topmost special element, keeping the special and
   * formatting elements in between.
   */
  const adoptionAgency = (name: string): void => {
    const index = inScope((element) => element.ns === NS.HTML && element.name === name, []);

    if (index <= 0) {
      return;
    }
    const above = m.stack.slice(index + 1);
    const lastSpecial = lastIndexWhere(above, isSpecial);

    m.stack.length = index;
    m.stack.push(...above.slice(0, lastSpecial + 1).filter((element) => isSpecial(element) || (element.ns === NS.HTML && FORMATTING.has(element.name))));
  };

  const END_TAG_RULES: Record<string, (name: string) => void> = {
    ...Object.fromEntries([...FORMATTING].map((name) => [name, adoptionAgency])),
    form: () => {
      const index = inScope((element) => element.ns === NS.HTML && element.name === 'form', []);

      if (index > 0) {
        m.stack.splice(index, 1);
      }
    },
  };

  const htmlEndTag = (name: string): void => {
    if (name === 'template' && hasTemplate()) {
      popUntil('template');
      resetMode();

      return;
    }
    END_RULES[m.mode](name);
  };

  const END_RULES: Record<Mode, (name: string) => void> = {
    head: (name) => {
      if (['body', 'html', 'br'].includes(name)) {
        enterBody();
        m.framesetOk = m.framesetOk && name !== 'br';
      }
    },
    body: (name) => {
      if (name === 'br') {
        m.framesetOk = false;
      }
      if (name === 'body' || name === 'html' || name === 'br') {
        return;
      }
      if (SCOPED_END.has(name) || HEADINGS.has(name) || name === 'li' || name === 'p') {
        scopedEndTag(name);

        return;
      }
      if (TABLE_TAGS.has(name) && openTable()) {
        tableEndTag(name);

        return;
      }
      END_TAG_RULES[name]?.(name);
      if (!(name in END_TAG_RULES)) {
        genericEndTag(name);
      }
    },
    select: (name) => selectEndTag(name),
    selectInTable: (name) => {
      if (TABLE_TAGS.has(name) && m.stack.some((element) => element.ns === NS.HTML && element.name === name)) {
        popUntil('select');
        resetMode();
        htmlEndTag(name);

        return;
      }
      selectEndTag(name);
    },
    frameset: (name) => {
      if (name !== 'frameset' || m.stack.length === 1) {
        return;
      }
      m.stack.pop();
      if (m.document && top().name !== 'frameset') {
        m.mode = 'afterFrameset';
      }
    },
    afterFrameset: () => undefined,
    templateColumns: () => undefined,
  };

  const selectEndTag = (name: string): void => {
    if (name === 'select' && hasSelectInScope()) {
      popUntil('select');
      resetMode();

      return;
    }
    if ((name === 'option' || name === 'optgroup') && top().name === name) {
      m.stack.pop();
    }
  };

  const processEndTag = (name: string): void => {
    if (adjustedCurrent().ns === NS.HTML) {
      htmlEndTag(name);

      return;
    }
    if (name === 'p' || name === 'br') {
      popToHtmlOrPoint();
      htmlEndTag(name);

      return;
    }
    const index = lastIndexWhere(m.stack, (element, at) => at > 0 && (element.ns === NS.HTML || element.name === name));

    if (index > 0 && m.stack[index].ns === NS.HTML) {
      htmlEndTag(name);

      return;
    }
    if (index > 0) {
      m.stack.length = index;
    }
  };

  const emitTag = (): void => {
    const tag = m.tag;

    m.state = 'data';
    if (tag.end) {
      processEndTag(tag.name);

      return;
    }
    m.lastStartTag = tag.name;
    processStartTag(tag);
  };

  /** A text element's end tag: the only token that leaves RCDATA, RAWTEXT or script data. */
  const emitTextEnd = (): void => {
    m.stack.pop();
    m.state = 'data';
  };

  const emitCharacter = (cp: number): void => {
    if (isSpace(cp) || cp === NUL) {
      return;
    }
    if (m.mode === 'head') {
      enterBody();
    }
    m.framesetOk = false;
  };

  const newTag = (end: boolean): void => {
    m.tag = emptyTag(end);
  };

  const startAttribute = (name: string): void => {
    m.tag.attrName = name;
    m.tag.attrValue = '';
  };

  const leaveAttrName = (): void => {
    m.tag.attrKept = !m.tag.attrs.has(m.tag.attrName);
    if (m.tag.attrKept) {
      m.tag.attrs.set(m.tag.attrName, '');
    }
  };

  const leaveAttrValue = (): void => {
    if (m.tag.attrKept) {
      m.tag.attrs.set(m.tag.attrName, decodeAttribute(m.tag.attrValue));
    }
  };

  const reconsume = (state: State, cp: number): void => {
    m.state = state;
    HANDLERS[state](cp);
  };

  /** parse5's handleSpecialEndTag: `</` + the open text element's name, then a space, `/` or `>`. */
  const textEndTag = (fallback: State, cp: number): void => {
    const name = m.lastStartTag;
    const after = peek(name.length);

    if (name === '' || !lookingAt(name) || !(isSpace(after) || after === SLASH || after === GT)) {
      reconsume(fallback, cp);

      return;
    }
    m.pos = m.last + name.length + 1;
    m.last = m.pos - 1;
    if (after === GT) {
      emitTextEnd();

      return;
    }
    // The attributes and slash of a text element's end tag change nothing.
    m.stack.pop();
    newTag(true);
    m.state = after === SLASH ? 'selfClosing' : 'beforeAttrName';
  };

  const doubleEscape = (cp: number, matched: State, otherwise: State): void => {
    const after = peek(6);

    if (lookingAt('script') && (isSpace(after) || after === SLASH || after === GT)) {
      m.pos = m.last + 7;
      m.last = m.pos - 1;
      m.state = matched;

      return;
    }
    reconsume(otherwise, cp);
  };

  const markupDeclaration = (cp: number): void => {
    if (m.html.startsWith('--', m.last)) {
      m.pos = m.last + 2;
      m.last = m.pos - 1;
      m.state = 'commentStart';

      return;
    }
    if (lookingAt('doctype')) {
      m.pos = m.last + 7;
      m.last = m.pos - 1;
      m.state = 'beforeDoctypeName';

      return;
    }
    if (m.html.startsWith('[CDATA[', m.last)) {
      const current = adjustedCurrent();

      m.pos = m.last + 7;
      m.last = m.pos - 1;
      m.state = current.ns !== NS.HTML && !isPoint(current) ? 'cdata' : 'bogusComment';

      return;
    }
    reconsume('bogusComment', cp);
  };

  const afterDoctypeName = (cp: number): void => {
    if (isSpace(cp)) {
      return;
    }
    if (cp === GT) {
      m.state = 'data';

      return;
    }
    const keyword = ['public', 'system'].find((word) => lookingAt(word));

    if (keyword === undefined) {
      m.state = 'bogusDoctype';

      return;
    }
    m.pos = m.last + 6;
    m.last = m.pos - 1;
    m.state = keyword === 'public' ? 'afterPublicKeyword' : 'afterSystemKeyword';
  };

  /** A DOCTYPE state that waits for an identifier: anything unexpected makes the DOCTYPE bogus. */
  const doctypeGap = (onSpace: State | null, dq: State, sq: State): Handler => (cp) => {
    if (isSpace(cp)) {
      m.state = onSpace ?? m.state;

      return;
    }
    const quoted = cp === DQ ? dq : sq;

    m.state = byCode(cp, { [GT]: 'data', [DQ]: quoted, [SQ]: quoted }, 'bogusDoctype');
  };

  const doctypeId = (quote: number, after: State): Handler => (cp) => {
    if (cp === quote) {
      m.state = after;
    }
    if (cp === GT) {
      m.state = 'data';
    }
  };

  const text = (lt: State): Handler => (cp) => {
    if (cp === LT) {
      m.textState = m.state;
      m.state = lt;
    }
  };

  const HANDLERS: Record<State, Handler> = {
    data: (cp) => {
      if (cp === LT) {
        m.state = 'tagOpen';

        return;
      }
      emitCharacter(cp);
    },
    rcdata: text('textLt'),
    rawtext: text('textLt'),
    script: (cp) => {
      m.state = cp === LT ? 'scriptLt' : 'script';
    },
    plaintext: () => undefined,
    tagOpen: (cp) => {
      if (cp === BANG) {
        m.state = 'markupDeclaration';
      } else if (cp === SLASH) {
        m.state = 'endTagOpen';
      } else if (isAlpha(cp)) {
        newTag(false);
        reconsume('tagName', cp);
      } else if (cp === QM) {
        reconsume('bogusComment', cp);
      } else {
        emitCharacter(LT);
        reconsume('data', cp);
      }
    },
    endTagOpen: (cp) => {
      if (isAlpha(cp)) {
        newTag(true);
        reconsume('tagName', cp);
      } else {
        m.state = cp === GT ? 'data' : 'bogusComment';
      }
    },
    tagName: (cp) => {
      if (isSpace(cp)) {
        m.state = 'beforeAttrName';
      } else if (cp === SLASH) {
        m.state = 'selfClosing';
      } else if (cp === GT) {
        emitTag();
      } else {
        m.tag.name += lower(cp);
      }
    },
    textLt: (cp) => {
      if (cp === SLASH) {
        m.state = 'textEndTagOpen';

        return;
      }
      reconsume(m.textState, cp);
    },
    textEndTagOpen: (cp) => (isAlpha(cp) ? textEndTag(m.textState, cp) : reconsume(m.textState, cp)),
    textEndTagName: (cp) => reconsume(m.textState, cp),
    scriptLt: (cp) => {
      if (cp === SLASH) {
        m.state = 'scriptEndTagOpen';
      } else if (cp === BANG) {
        m.state = 'escapeStart';
      } else {
        reconsume('script', cp);
      }
    },
    scriptEndTagOpen: (cp) => (isAlpha(cp) ? textEndTag('script', cp) : reconsume('script', cp)),
    scriptEndTagName: (cp) => reconsume('script', cp),
    escapeStart: (cp) => (cp === DASH ? (m.state = 'escapeStartDash', undefined) : reconsume('script', cp)),
    escapeStartDash: (cp) => (cp === DASH ? (m.state = 'escapedDashDash', undefined) : reconsume('script', cp)),
    escaped: (cp) => {
      m.state = byCode(cp, { [DASH]: 'escapedDash', [LT]: 'escapedLt' }, 'escaped');
    },
    escapedDash: (cp) => {
      m.state = byCode(cp, { [DASH]: 'escapedDashDash', [LT]: 'escapedLt' }, 'escaped');
    },
    escapedDashDash: (cp) => {
      m.state = byCode(cp, { [DASH]: 'escapedDashDash', [LT]: 'escapedLt', [GT]: 'script' }, 'escaped');
    },
    escapedLt: (cp) => {
      if (cp === SLASH) {
        m.state = 'escapedEndTagOpen';
      } else if (isAlpha(cp)) {
        reconsume('doubleEscapeStart', cp);
      } else {
        reconsume('escaped', cp);
      }
    },
    escapedEndTagOpen: (cp) => (isAlpha(cp) ? textEndTag('escaped', cp) : reconsume('escaped', cp)),
    escapedEndTagName: (cp) => reconsume('escaped', cp),
    doubleEscapeStart: (cp) => doubleEscape(cp, 'doubleEscaped', 'escaped'),
    doubleEscaped: (cp) => {
      m.state = byCode(cp, { [DASH]: 'doubleEscapedDash', [LT]: 'doubleEscapedLt' }, 'doubleEscaped');
    },
    doubleEscapedDash: (cp) => {
      m.state = byCode(cp, { [DASH]: 'doubleEscapedDashDash', [LT]: 'doubleEscapedLt' }, 'doubleEscaped');
    },
    doubleEscapedDashDash: (cp) => {
      m.state = byCode(cp, { [DASH]: 'doubleEscapedDashDash', [LT]: 'doubleEscapedLt', [GT]: 'script' }, 'doubleEscaped');
    },
    doubleEscapedLt: (cp) => (cp === SLASH ? (m.state = 'doubleEscapeEnd', undefined) : reconsume('doubleEscaped', cp)),
    doubleEscapeEnd: (cp) => doubleEscape(cp, 'escaped', 'doubleEscaped'),
    beforeAttrName: (cp) => {
      if (isSpace(cp)) {
        return;
      }
      if (cp === SLASH || cp === GT) {
        reconsume('afterAttrName', cp);

        return;
      }
      startAttribute(cp === EQ ? '=' : '');
      m.state = 'attrName';
      if (cp !== EQ) {
        HANDLERS.attrName(cp);
      }
    },
    attrName: (cp) => {
      if (isSpace(cp) || cp === SLASH || cp === GT) {
        leaveAttrName();
        reconsume('afterAttrName', cp);
      } else if (cp === EQ) {
        leaveAttrName();
        m.state = 'beforeAttrValue';
      } else {
        m.tag.attrName += lower(cp);
      }
    },
    afterAttrName: (cp) => {
      if (isSpace(cp)) {
        return;
      }
      if (cp === SLASH || cp === EQ || cp === GT) {
        m.state = cp === SLASH ? 'selfClosing' : 'beforeAttrValue';
        if (cp === GT) {
          emitTag();
        }

        return;
      }
      startAttribute('');
      reconsume('attrName', cp);
    },
    beforeAttrValue: (cp) => {
      if (isSpace(cp)) {
        return;
      }
      if (cp === DQ || cp === SQ) {
        m.state = cp === DQ ? 'attrValueDq' : 'attrValueSq';

        return;
      }
      if (cp === GT) {
        emitTag();

        return;
      }
      reconsume('attrValueUnquoted', cp);
    },
    attrValueDq: (cp) => quotedValue(cp, DQ),
    attrValueSq: (cp) => quotedValue(cp, SQ),
    attrValueUnquoted: (cp) => {
      if (isSpace(cp) || cp === GT) {
        leaveAttrValue();
        m.state = 'beforeAttrName';
        if (cp === GT) {
          emitTag();
        }

        return;
      }
      m.tag.attrValue += String.fromCharCode(cp < 0x10000 ? cp : 0xfffd);
    },
    afterAttrValue: (cp) => {
      if (isSpace(cp)) {
        m.state = 'beforeAttrName';
      } else if (cp === SLASH) {
        m.state = 'selfClosing';
      } else if (cp === GT) {
        emitTag();
      } else {
        reconsume('beforeAttrName', cp);
      }
    },
    selfClosing: (cp) => {
      if (cp !== GT) {
        reconsume('beforeAttrName', cp);

        return;
      }
      m.tag.selfClosing = true;
      emitTag();
    },
    bogusComment: (cp) => {
      m.state = cp === GT ? 'data' : 'bogusComment';
    },
    markupDeclaration,
    commentStart: (cp) => {
      if (cp === DASH || cp === GT) {
        m.state = cp === DASH ? 'commentStartDash' : 'data';

        return;
      }
      reconsume('comment', cp);
    },
    commentStartDash: (cp) => {
      if (cp === DASH || cp === GT) {
        m.state = cp === DASH ? 'commentEnd' : 'data';

        return;
      }
      reconsume('comment', cp);
    },
    comment: (cp) => {
      m.state = byCode(cp, { [LT]: 'commentLt', [DASH]: 'commentEndDash' }, 'comment');
    },
    commentLt: (cp) => {
      if (cp === BANG || cp === LT) {
        m.state = cp === BANG ? 'commentLtBang' : 'commentLt';

        return;
      }
      reconsume('comment', cp);
    },
    commentLtBang: (cp) => (cp === DASH ? (m.state = 'commentLtBangDash', undefined) : reconsume('comment', cp)),
    commentLtBangDash: (cp) => (cp === DASH ? (m.state = 'commentLtBangDashDash', undefined) : reconsume('commentEndDash', cp)),
    commentLtBangDashDash: (cp) => reconsume('commentEnd', cp),
    commentEndDash: (cp) => (cp === DASH ? (m.state = 'commentEnd', undefined) : reconsume('comment', cp)),
    commentEnd: (cp) => {
      if (cp === GT || cp === BANG || cp === DASH) {
        m.state = byCode(cp, { [GT]: 'data', [BANG]: 'commentEndBang' }, 'commentEnd');

        return;
      }
      reconsume('comment', cp);
    },
    commentEndBang: (cp) => {
      if (cp === DASH || cp === GT) {
        m.state = cp === DASH ? 'commentEndDash' : 'data';

        return;
      }
      reconsume('comment', cp);
    },
    beforeDoctypeName: (cp) => {
      if (!isSpace(cp)) {
        m.state = cp === GT ? 'data' : 'doctypeName';
      }
    },
    doctypeName: (cp) => {
      m.state = isSpace(cp) ? 'afterDoctypeName' : byCode(cp, { [GT]: 'data' }, 'doctypeName');
    },
    afterDoctypeName,
    afterPublicKeyword: doctypeGap('beforePublicId', 'publicIdDq', 'publicIdSq'),
    beforePublicId: doctypeGap(null, 'publicIdDq', 'publicIdSq'),
    publicIdDq: doctypeId(DQ, 'afterPublicId'),
    publicIdSq: doctypeId(SQ, 'afterPublicId'),
    afterPublicId: doctypeGap('betweenIds', 'systemIdDq', 'systemIdSq'),
    betweenIds: doctypeGap(null, 'systemIdDq', 'systemIdSq'),
    afterSystemKeyword: doctypeGap('beforeSystemId', 'systemIdDq', 'systemIdSq'),
    beforeSystemId: doctypeGap(null, 'systemIdDq', 'systemIdSq'),
    systemIdDq: doctypeId(DQ, 'afterSystemId'),
    systemIdSq: doctypeId(SQ, 'afterSystemId'),
    afterSystemId: (cp) => {
      if (!isSpace(cp)) {
        m.state = cp === GT ? 'data' : 'bogusDoctype';
      }
    },
    bogusDoctype: (cp) => {
      m.state = cp === GT ? 'data' : 'bogusDoctype';
    },
    cdata: (cp) => {
      if (cp === RSQB) {
        m.state = 'cdataBracket';

        return;
      }
      emitCharacter(cp);
    },
    cdataBracket: (cp) => (cp === RSQB ? (m.state = 'cdataEnd', undefined) : reconsume('cdata', cp)),
    cdataEnd: (cp) => {
      if (cp === GT || cp === RSQB) {
        m.state = cp === GT ? 'data' : 'cdataEnd';

        return;
      }
      reconsume('cdata', cp);
    },
  };

  const quotedValue = (cp: number, quote: number): void => {
    if (cp === quote) {
      leaveAttrValue();
      m.state = 'afterAttrValue';

      return;
    }
    m.tag.attrValue += String.fromCharCode(cp < 0x10000 ? cp : 0xfffd);
  };

  /** Runs the tokenizer until it appends or emits a code point of 0x110000 or more. */
  const rejectsFrom = (): boolean => {
    while (m.pos < m.html.length) {
      const cp = advance();

      if (cp >= FIRST_INVALID && !SKIPS_CHARACTER.has(m.state)) {
        return true;
      }
      HANDLERS[m.state](cp);
    }

    return false;
  };

  return rejectsFrom;
};

const DOCTYPE_OPEN = /<!doctype/i;

/**
 * Whether parse5 8.0.1 throws a RangeError on this input. Exact when no pair of
 * low surrogates comes after a `<!DOCTYPE`; past one, a few tree-builder corners
 * still differ (pinned as expected failures in surrogate-rejection.test.ts).
 * @param html - markup
 * @param entry - which parse5 entry point reads it
 */
export const parse5RejectsSurrogates = (html: string, entry: Parse5Entry = 'fragment'): boolean => {
  const first = firstInvalidPair(html);

  if (first === -1) {
    return false;
  }
  if (!DOCTYPE_OPEN.test(html.slice(0, first))) {
    return true;
  }

  return tokenizerFor(html, entry)();
};

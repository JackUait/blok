import type { Css, ParaProps, ThemeFonts } from './props';
import { mergeCss, mergePara, parseParaProps, parseRunProps } from './props';
import { attr, find, kid, kids, val } from './xml';

/** Deepest basedOn chain we follow; real documents stay far below it. */
const MAX_CHAIN = 32;

/** One table-style condition (`w:tblStylePr`), e.g. `firstRow`. */
export interface TableCondition {
  pPr: Element | null;
  rPr: Element | null;
  tcPr: Element | null;
  trPr: Element | null;
  tblPr: Element | null;
}

/** One style of a table-style chain, raw, for the table renderer to resolve. */
export interface TableStyleNode extends TableCondition {
  conditions: Map<string, TableCondition>;
}

interface StyleDef {
  id: string;
  type: string;
  basedOn: string | null;
  el: Element;
}

/** Theme fonts from `theme1.xml`. */
export function parseThemeFonts(doc: Document | null): ThemeFonts {
  if (doc === null) {
    return { major: null, minor: null };
  }
  const typeface = (name: string): string | null => attr(kid(find(doc.documentElement, name), 'latin'), 'typeface') || null;

  return { major: typeface('majorFont'), minor: typeface('minorFont') };
}

/** Resolved styles of `styles.xml`. */
export class StyleSheet {
  private readonly defs = new Map<string, StyleDef>();
  private readonly defaultParagraph: string | null;
  private readonly defaultTable: string | null;
  readonly defaultPara: ParaProps;
  readonly defaultRun: Css;

  constructor(doc: Document | null, readonly theme: ThemeFonts) {
    const root = doc?.documentElement ?? null;
    const defaults = kid(root, 'docDefaults');
    this.defaultPara = parseParaProps(kid(kid(defaults, 'pPrDefault'), 'pPr'));
    this.defaultRun = parseRunProps(kid(kid(defaults, 'rPrDefault'), 'rPr'), theme);

    const styles = root === null ? [] : kids(root, 'style');
    for (const el of styles) {
      const id = attr(el, 'styleId');
      const type = attr(el, 'type') ?? 'paragraph';
      if (id !== null) {
        this.defs.set(`${type}:${id}`, { id, type, basedOn: val(el, 'basedOn'), el });
      }
    }
    this.defaultParagraph = defaultStyleId(styles, 'paragraph');
    this.defaultTable = defaultStyleId(styles, 'table');
  }

  /** A style and its basedOn ancestors, root first. Cycles stop the walk. */
  private chain(type: string, id: string | null | undefined): StyleDef[] {
    const out: StyleDef[] = [];
    const seen = new Set<string>();
    const walk = (current: string | null): void => {
      if (current === null || seen.has(current) || out.length >= MAX_CHAIN) {
        return;
      }
      seen.add(current);
      const def = this.defs.get(`${type}:${current}`);
      if (def !== undefined) {
        out.unshift(def);
        walk(def.basedOn);
      }
    };
    walk(id ?? null);

    return out;
  }

  /** A paragraph style's paragraph and run layers (the default style when id is absent). */
  paragraph(id: string | null | undefined): { para: ParaProps; run: Css } {
    const named = id === null || id === undefined ? [] : this.chain('paragraph', id);
    // An unknown style id falls back to the default style, as Word does.
    const chain = named.length > 0 ? named : this.chain('paragraph', this.defaultParagraph);

    return {
      para: mergePara(...chain.map((def) => parseParaProps(kid(def.el, 'pPr')))),
      run: mergeCss(...chain.map((def) => parseRunProps(kid(def.el, 'rPr'), this.theme))),
    };
  }

  /** A character style's run layer. */
  character(id: string | null | undefined): Css {
    return mergeCss(...this.chain('character', id).map((def) => parseRunProps(kid(def.el, 'rPr'), this.theme)));
  }

  /** A table style chain, root first, raw for the table renderer (the default style when id is absent). */
  table(id: string | null | undefined): TableStyleNode[] {
    return this.chain('table', id ?? this.defaultTable).map((def) => {
      const conditions = new Map<string, TableCondition>();
      for (const cond of kids(def.el, 'tblStylePr')) {
        const type = attr(cond, 'type');
        if (type !== null) {
          conditions.set(type, conditionOf(cond));
        }
      }

      return { ...conditionOf(def.el), conditions };
    });
  }

  /** The numId a numbering (or paragraph) style carries, for `w:numStyleLink`. */
  numIdOf(styleId: string): string | null {
    for (const type of ['numbering', 'paragraph']) {
      const numId = mergePara(...this.chain(type, styleId).map((def) => parseParaProps(kid(def.el, 'pPr')))).numId;
      if (numId !== undefined) {
        return numId;
      }
    }

    return null;
  }
}

/** The first style of a type marked `w:default="1"`. */
function defaultStyleId(styles: Element[], type: string): string | null {
  const found = styles.find((el) => attr(el, 'styleId') !== null
    && (attr(el, 'type') ?? 'paragraph') === type
    && attr(el, 'default') === '1');

  return found === undefined ? null : attr(found, 'styleId');
}

function conditionOf(el: Element): TableCondition {
  return {
    pPr: kid(el, 'pPr'),
    rPr: kid(el, 'rPr'),
    tcPr: kid(el, 'tcPr'),
    trPr: kid(el, 'trPr'),
    tblPr: kid(el, 'tblPr'),
  };
}

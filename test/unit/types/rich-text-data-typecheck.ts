/**
 * Type-level tests for the saved vs tool-facing data of the rich-text tools.
 * Run with: tsc --noEmit --strict test/unit/types/rich-text-data-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile.
 *
 * `XData` is what the host saves (`text` is segments). `XToolData` is what the
 * tool class reads and writes (`text` is HTML).
 */

import { Paragraph, Header, List, Toggle, Quote, isBlockType } from '../../../types/tools-entry';
import type {
  ParagraphData,
  ParagraphToolData,
  HeaderData,
  HeaderToolData,
  ListData,
  ListToolData,
  ToggleData,
  ToggleToolData,
  QuoteData,
  QuoteToolData,
} from '../../../types/tools-entry';
import type { RichText } from '../../../types';
import type { OutputBlockData } from '../../../types/data-formats/output-data';

const _p: ParagraphData['text'] = [{ text: 'a' }];
const _h: HeaderData['text'] = [{ text: 'a', marks: { bold: true } }];
const _l: ListData['text'] = [{ text: 'a' }];
const _t: ToggleData['text'] = [{ embed: { page: { id: 'p1' } } }];
const _q: QuoteData['text'] = [{ text: 'a' }];

// @ts-expect-error - saved text is segments, not HTML
const _pBad: ParagraphData['text'] = '<b>a</b>';
// @ts-expect-error - saved text is segments, not HTML
const _hBad: HeaderData['text'] = 'a';
// @ts-expect-error - saved text is segments, not HTML
const _lBad: ListData['text'] = 'a';
// @ts-expect-error - saved text is segments, not HTML
const _tBad: ToggleData['text'] = 'a';
// @ts-expect-error - saved text is segments, not HTML
const _qBad: QuoteData['text'] = 'a';

const _pt: ParagraphToolData['text'] = '<b>a</b>';
const _ht: HeaderToolData['text'] = 'a';
const _lt: ListToolData['text'] = 'a';
const _tt: ToggleToolData['text'] = 'a';
const _qt: QuoteToolData['text'] = 'a';

// @ts-expect-error - tools hold HTML, not segments
const _ptBad: ParagraphToolData['text'] = [{ text: 'a' }];
// @ts-expect-error - tools hold HTML, not segments
const _qtBad: QuoteToolData['text'] = [{ text: 'a' }];

// The other fields keep their types on both sides.
const _level: HeaderData['level'] = 1;
// @ts-expect-error - level is a number
const _levelBad: HeaderData['level'] = 'x';
// @ts-expect-error - level is a number
const _toolLevelBad: HeaderToolData['level'] = 'x';
const _style: ListData['style'] = 'checklist';
// @ts-expect-error - not a list style
const _styleBad: ListToolData['style'] = 'nope';
// @ts-expect-error - not a quote size
const _sizeBad: QuoteData['size'] = 'huge';

// The block-type guard hands the host segments.
declare const block: OutputBlockData;

if (isBlockType(block, 'paragraph')) {
  const _text: RichText = block.data.text;
}

// Tool classes keep HTML in their signatures.
class _SubParagraph extends Paragraph {
  public save(el: HTMLDivElement): ParagraphToolData {
    const data = super.save(el);
    const _html: string = data.text;

    return data;
  }
}

class _SubHeader extends Header {
  public merge(data: HeaderToolData): void {
    super.merge(data);
  }
}

class _SubList extends List {
  public validate(data: ListToolData): boolean {
    return super.validate(data);
  }
}

class _SubToggle extends Toggle {
  public save(): ToggleToolData {
    return super.save();
  }
}

class _SubQuote extends Quote {
  public save(el: HTMLQuoteElement): QuoteToolData {
    return super.save(el);
  }
}

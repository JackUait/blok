import type { BlockTuneDescription, InlineToolDescription } from '../../../types/tools/tool-description';
import { RICH_TEXT_MARKS } from './rich-text';

const flag = { const: true };

const mark = (name: string, summary: string) => (): InlineToolDescription => ({
  summary,
  effect: { mark: name, value: flag },
});

export const BUILT_IN_INLINE_DESCRIPTIONS: Readonly<Record<string, () => InlineToolDescription>> = {
  bold: mark('bold', 'Bold text. Write it as the "bold" mark on a segment.'),
  italic: mark('italic', 'Italic text. The "italic" mark.'),
  underline: mark('underline', 'Underlined text. The "underline" mark.'),
  strikethrough: mark('strikethrough', 'Struck-through text. The "strikethrough" mark.'),
  inlineCode: mark('code', 'Inline code. The "code" mark.'),
  marker: () => ({
    summary: 'Text colour, background colour or a plain highlight. Colours are a preset name or any CSS colour.',
    effect: { marks: ['color', 'background', 'highlight'], value: { type: ['string', 'boolean'] } },
  }),
  link: () => ({
    summary: 'A link. The "link" mark with href.',
    effect: { mark: 'link', value: RICH_TEXT_MARKS.properties.link },
  }),
  equation: () => ({
    summary: 'An inline LaTeX equation. An embed segment, not a mark.',
    effect: {
      embed: 'equation',
      value: {
        type: 'object',
        required: ['expression'],
        properties: { expression: { type: 'string' } },
      },
    },
  }),
  supSub: () => ({
    summary: 'Superscript or subscript. The "sup" or "sub" mark, never both.',
    effect: { marks: ['sup', 'sub'], value: flag },
  }),
  clearFormat: () => ({
    summary: 'Removes bold, italic, underline, strikethrough, inline code and marker formatting. Keeps links, superscript and subscript.',
    effect: { clears: 'marks' },
  }),
  convertTo: () => ({
    summary: 'Turns the block into another type; use block.convert.',
    effect: { marks: [], value: flag },
  }),
};

export const BUILT_IN_TUNE_DESCRIPTIONS: Readonly<Record<string, () => BlockTuneDescription>> = {
  delete: () => ({ summary: 'Deletes the block. Use block.delete.', data: null }),
  copyLink: () => ({
    summary: "Copies the block's link target. Changes nothing in the document.",
    data: null,
  }),
};

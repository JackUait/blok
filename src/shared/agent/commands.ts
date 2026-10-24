import type { CoreCommandName } from '../../../types/agent';
import { EMBED_SEGMENT, RICH_TEXT_MARKS, TEXT_SEGMENT } from '../tool-descriptions/rich-text';
import type { JsonSchema } from './types';

export interface CoreCommandSpec {
  argsSchema: JsonSchema;
  resultSchema?: JsonSchema;
  readOnly: boolean;
  runtime: 'any' | 'editor';
  summary: string;
  guidance?: string;
}

const id: JsonSchema = { type: 'string', minLength: 1, description: 'A block id, or "$" plus the ref of a block an earlier command created.' };
const position: JsonSchema = {
  description: "'start' | 'end' | { before: id } | { after: id }",
  oneOf: [
    { enum: ['start', 'end'] },
    { type: 'object', properties: { before: id }, required: ['before'], additionalProperties: false },
    { type: 'object', properties: { after: id }, required: ['after'], additionalProperties: false },
  ],
};
const parentId: JsonSchema = { oneOf: [id, { type: 'null' }] };
const richOrString: JsonSchema = {
  description: 'Plain text (HTML tags stay literal), or rich-text segments. Never Markdown.',
  oneOf: [
    { type: 'string' },
    // The open branch keeps the planner the one judge of a segment: it treats false marks as not set.
    { type: 'array', items: { anyOf: [TEXT_SEGMENT, EMBED_SEGMENT, { type: 'object' }] } },
  ],
};
const range: JsonSchema = {
  oneOf: [
    { const: 'all' },
    {
      type: 'object',
      properties: { start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 }, expectText: { type: 'string' } },
      required: ['start', 'end'], additionalProperties: false,
    },
    {
      type: 'object', properties: { find: { type: 'string', minLength: 1 }, occurrence: { type: 'integer', minimum: 1 } },
      required: ['find'], additionalProperties: false,
    },
  ],
};
const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema =>
  ({ type: 'object', properties, required, additionalProperties: false });
const insertProperties: Record<string, JsonSchema> = {
  type: { type: 'string', minLength: 1 }, data: { type: 'object' }, tunes: { type: 'object' },
  id: { type: 'string', minLength: 1 }, children: { type: 'array', items: { $ref: '#/$defs/insertSpec' } },
};
// Child specs only: a child id (a column's) is what later commands name as parentId. Kept off the top level to save mixed-schema room.
const insertSpec = obj({ ...insertProperties, id: { ...insertProperties.id, description: 'Later commands use this id as is, no "$".' } }, ['type']);
const write = (summary: string, argsSchema: JsonSchema, guidance?: string): CoreCommandSpec =>
  ({ argsSchema, readOnly: false, runtime: 'any', summary, ...(guidance === undefined ? {} : { guidance }) });
const read = (summary: string, argsSchema: JsonSchema): CoreCommandSpec =>
  ({ argsSchema, readOnly: true, runtime: 'any', summary });

export const COMMANDS: Record<CoreCommandName, CoreCommandSpec> = {
  'doc.read': read('Read the document as an outline, a subtree, or chosen blocks in full.', obj({
    rootId: parentId, depth: { type: 'integer', minimum: 0 }, ids: { type: 'array', items: id }, detail: { enum: ['outline', 'full'] },
    limit: { type: 'integer', minimum: 1, maximum: 1000 }, cursor: { type: 'string' }, textLimit: { type: 'integer', minimum: 0 },
  })),
  'doc.find': read('Find blocks by text or type.', obj({
    text: { type: 'string', minLength: 1 }, type: { type: 'string' }, rootId: id, limit: { type: 'integer', minimum: 1 },
  })),
  'doc.setTitle': write("Set this document's title. '' clears it.", obj({ title: { type: 'string' } }, ['title'])),
  'doc.setIcon': write("Set this document's icon. null clears it.", obj({ icon: {
    oneOf: [
      { type: 'null' },
      obj({ type: { const: 'emoji' }, value: { type: 'string' } }, ['type', 'value']),
      obj({ type: { const: 'image' }, url: { type: 'string' } }, ['type', 'url']),
    ],
  } }, ['icon'])),
  'block.insert': write('Insert a block, with optional children.', {
    ...insertSpec,
    properties: {
      ...insertProperties,
      data: { type: 'object', description: 'Rich-text fields take what text.replace "with" takes.' },
      parentId, position, demote: { type: 'boolean' },
    },
    $defs: { insertSpec },
  }, 'Rich-text fields take segments or plain text, never Markdown. Use markdown.insert for Markdown.'),
  'block.update': write('Merge data or tunes into a block. A key set to null is removed.', obj({
    id, data: { type: 'object' }, tunes: { type: 'object' },
  }, ['id'])),
  'block.delete': write('Delete a block. Children move up unless the tool deletes them.', obj({ id }, ['id'])),
  'block.move': write('Move a block and its subtree.', obj({ id, parentId, position }, ['id', 'position'])),
  'block.convert': write('Turn a block into another type. Its text carries over; data sets only the new type\'s other fields. '
    + 'A style or level, such as a heading 2, is a variant: pass the tool as type and the variant\'s data, '
    + 'e.g. { "type": "header", "data": { "level": 2 } }. describe({ tool }) lists each tool\'s variants.', obj({
    id, type: { type: 'string', minLength: 1 }, data: { type: 'object' },
  }, ['id', 'type'])),
  'block.duplicate': write('Deep-copy a block with new ids.', obj({ id, position }, ['id'])),
  'text.insert': write('Insert text into a rich-text field.', obj({
    id, field: { type: 'string' }, at: { oneOf: [{ type: 'integer', minimum: 0 }, obj({ after: { type: 'string', minLength: 1 } }, ['after'])] },
    text: richOrString, marks: RICH_TEXT_MARKS,
  }, ['id', 'at', 'text'])),
  'text.delete': write('Delete a range of text.', obj({ id, field: { type: 'string' }, range }, ['id', 'range'])),
  'text.replace': write('Replace a range, or the whole field.', obj({ id, field: { type: 'string' }, range, with: richOrString }, ['id', 'with'])),
  'text.format': write('Set or clear marks on a range.', obj({
    id, field: { type: 'string' }, range, set: RICH_TEXT_MARKS,
    unset: { type: 'array', items: { type: 'string' }, description: 'Mark names to clear. "*" clears every mark first; set then applies.' },
  }, ['id', 'range'])),
  'markdown.insert': write('Convert Markdown into blocks and insert them. Additive.', obj({
    markdown: { type: 'string', description: 'Gives bold, italic, strikethrough, inline code and links. '
      + 'Markdown has no syntax for underline, sup, sub, highlight or colours, and their HTML stays literal: set them with text.format. '
      + "Call describe({ command: 'markdown.insert' }) for the rest." },
    parentId, position,
  }, ['markdown']), 'Inline Markdown gives bold (** or __), italic (* or _), strikethrough (~~ or ~), inline code and links. '
    + '~x~ is strikethrough, not subscript. ==, ^ and inline HTML such as <u>, <sup>, <sub>, <mark> and <span> stay literal text. '
    + '$x$ is an inline equation in a heading, table cell, quote (not an alert) or the first paragraph of a list item. '
    + 'When it sits directly in any other paragraph, it becomes its own LaTeX code block. '
    + '$$x$$ follows the same rule as $x$. A fenced $$ block is always a LaTeX code block. '
    + 'Markdown cannot write the marks "underline", "sup", "sub", "highlight", "color" or "background": insert the text, then set them with text.format. '
    + 'For an equation inside a paragraph, use block.insert, text.insert or text.replace with the segment { "embed": { "equation": { "expression": "x" } } }.'),
  'markdown.export': read('Export the document or a subtree as Markdown.', obj({ rootId: id })),
  'history.undo': write("Undo this session's last step. Never the user's.", obj({})),
  'history.redo': write("Redo this session's last undone step.", obj({})),
};

import type { CoreCommandName } from '../../../types/agent';
import type { JsonSchema } from './types';

export interface CoreCommandSpec {
  argsSchema: JsonSchema;
  resultSchema?: JsonSchema;
  readOnly: boolean;
  runtime: 'any' | 'editor';
  summary: string;
  guidance?: string;
}

const id: JsonSchema = { type: 'string', minLength: 1, description: 'A block id, or "$ref" of a block an earlier command created.' };
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
  description: 'Plain text, or rich-text segments. Never Markdown.',
  oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'object' } }],
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
const insertSpec = obj(insertProperties, ['type']);
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
    properties: { ...insertProperties, parentId, position, demote: { type: 'boolean' } },
    $defs: { insertSpec },
  }, 'Rich-text fields take segments or plain text, never Markdown. Use markdown.insert for Markdown.'),
  'block.update': write('Merge data or tunes into a block. A key set to null is removed.', obj({
    id, data: { type: 'object' }, tunes: { type: 'object' },
  }, ['id'])),
  'block.delete': write('Delete a block. Children move up unless the tool deletes them.', obj({ id }, ['id'])),
  'block.move': write('Move a block and its subtree.', obj({ id, parentId, position }, ['id', 'position'])),
  'block.convert': write("Turn a block into another type through both tools' conversionConfig.", obj({
    id, type: { type: 'string', minLength: 1 }, data: { type: 'object' },
  }, ['id', 'type'])),
  'block.duplicate': write('Deep-copy a block with new ids.', obj({ id, position }, ['id'])),
  'text.insert': write('Insert text into a rich-text field.', obj({
    id, field: { type: 'string' }, at: { oneOf: [{ type: 'integer', minimum: 0 }, obj({ after: { type: 'string', minLength: 1 } }, ['after'])] },
    text: richOrString, marks: { type: 'object' },
  }, ['id', 'at', 'text'])),
  'text.delete': write('Delete a range of text.', obj({ id, field: { type: 'string' }, range }, ['id', 'range'])),
  'text.replace': write('Replace a range, or the whole field.', obj({ id, field: { type: 'string' }, range, with: richOrString }, ['id', 'with'])),
  'text.format': write('Set or clear marks on a range.', obj({
    id, field: { type: 'string' }, range, set: { type: 'object' }, unset: { type: 'array', items: { type: 'string' } },
  }, ['id', 'range'])),
  'markdown.insert': write('Convert Markdown into blocks and insert them. Additive.', obj({
    markdown: { type: 'string' }, parentId, position,
  }, ['markdown'])),
  'markdown.export': read('Export the document or a subtree as Markdown.', obj({ rootId: id })),
  'history.undo': write("Undo this session's last step. Never the user's.", obj({})),
  'history.redo': write("Redo this session's last undone step.", obj({})),
};

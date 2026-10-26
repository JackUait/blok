import type { CoreCommandName } from '../../../types/agent';
import type { HostService } from '../../../types/tools/tool-description';
import { EMBED_SEGMENT, RICH_TEXT_MARKS, TEXT_SEGMENT } from '../tool-descriptions/rich-text';
import type { JsonSchema } from './types';

export interface CoreCommandSpec {
  argsSchema: JsonSchema;
  resultSchema?: JsonSchema;
  readOnly: boolean;
  runtime: 'any' | 'editor';
  summary: string;
  guidance?: string;
  /** A missing service makes the command unavailable. */
  requires?: HostService[];
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
// The find bar's options; without matchCase, case, accents and space runs fold.
const FIND_OPTIONS: Record<string, JsonSchema> = { matchCase: { type: 'boolean' }, wholeWord: { type: 'boolean' } };
const offsets: JsonSchema = {
  type: 'object',
  properties: { start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 }, expectText: { type: 'string' } },
  required: ['start', 'end'], additionalProperties: false,
};
const range: JsonSchema = {
  oneOf: [
    { const: 'all' },
    offsets,
    {
      type: 'object',
      properties: {
        find: { type: 'string', minLength: 1 }, occurrence: { type: 'integer', minimum: 1 }, ...FIND_OPTIONS,
        all: { type: 'boolean' },
      },
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
const versionRead = (summary: string, argsSchema: JsonSchema, guidance: string): CoreCommandSpec =>
  ({ ...read(summary, argsSchema), guidance, requires: ['versionHistory'] });
const READ_ARGS: Record<string, JsonSchema> = {
  rootId: parentId, depth: { type: 'integer', minimum: 0 }, ids: { type: 'array', items: id }, detail: { enum: ['outline', 'full'] },
  limit: { type: 'integer', minimum: 1, maximum: 1000 }, cursor: { type: 'string' }, textLimit: { type: 'integer', minimum: 0 },
};
const version: JsonSchema = { type: 'string', minLength: 1, description: 'A version from history.versions.' };
const from: JsonSchema = { ...version, description: 'The older version, from history.versions.' };

export const COMMANDS: Record<CoreCommandName, CoreCommandSpec> = {
  'doc.read': read('Read the document as an outline, a subtree, or chosen blocks in full.', obj(READ_ARGS)),
  'doc.find': read('Find text as the find bar does: every hit with its field and offsets, and a count. Or list blocks by type.', obj({
    text: { type: 'string', minLength: 1 }, ...FIND_OPTIONS, type: { type: 'string' }, rootId: id, limit: { type: 'integer', minimum: 1 },
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
  'block.update': write('Merge data or tunes into a block. A key set to null is cleared: removed, or set to its empty or off value (rich text [], code lineNumbers false, callout emoji "") where the tool would otherwise refill a default. A required field with no such value (a heading level, a list style) cannot be cleared.', obj({
    id, data: { type: 'object' }, tunes: { type: 'object' },
  }, ['id'])),
  'block.delete': write('Delete a block. Children move up unless the tool deletes them.', obj({ id }, ['id'])),
  'block.move': write('Move a block and its subtree.', obj({ id, parentId, position }, ['id', 'position'])),
  'block.convert': write('Turn a block into another type. Its text carries over, and its block colour onto a text block that has one; data sets only the new type\'s other fields. '
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
  'text.replace': write('Replace a range, or the whole field. Plain text takes the marks where a found or offset range starts.', obj({
    id, field: { type: 'string' }, range, with: richOrString,
  }, ['id', 'with']), 'A find range matches as the find bar and doc.find do: case, accents and runs of spaces fold, unless matchCase. '
    + 'wholeWord skips a hit inside a longer word. { find, all: true } replaces every hit in the field in one pass. '
    + 'Plain text inside a link stays in that link. Segments keep only their own marks.'),
  'text.format': write('Set or clear marks on a range.', obj({
    id, field: { type: 'string' }, range, set: RICH_TEXT_MARKS,
    unset: { type: 'array', items: { type: 'string' }, description: 'To remove a mark, list it here. "*" clears all, "tag:*" custom marks; set then applies.' },
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
  'html.insert': {
    ...write("Paste HTML as blocks: the blocks a person's paste of it gives in the editor. Additive.", obj({
      html: { type: 'string', minLength: 1, description: 'HTML, as a clipboard carries it. Scripts, event handlers and unsafe URLs are removed, as in a paste.' },
      parentId, position,
    }, ['html']), 'Runs the editor paste pipeline: the same cleanup of Google Docs, Notion, Word and Excel markup, the same sanitizer, '
      + 'and the same tag-to-block rules, including each tool\'s own paste tags. A table cell keeps its lists. An image keeps its src: '
      + 'nothing is uploaded. HTML that a paste turns into nothing (plain text, or only a script) is refused. '
      + 'Only in the editor: elsewhere it is unavailable, so use markdown.insert or block.insert.'),
    runtime: 'editor',
  },
  'markdown.export': read('Export the document or a subtree as Markdown.', obj({ rootId: id })),
  'history.undo': write("Undo this session's last step. Never the user's or a peer's. A page.rename or page.setIcon step wrote another document and cannot be undone. CONFLICT: someone else changed what the step wrote; re-read and write the fix by hand.", obj({})),
  'history.redo': write("Redo this session's last undone step. CONFLICT as for history.undo.", obj({})),
  'history.versions': versionRead('List the saved versions of this document, newest first, with who edited and when.', obj({
    group: { enum: [1, 15, 60], description: 'Minutes per version.' },
  }), 'The first version is what the document is now.'),
  'history.read': versionRead('Read one saved version, in the shape doc.read gives.', obj({ version, ...READ_ARGS }, ['version']),
    'Block ids are the ids the version had. Never pass the result as expectRevision.'),
  'history.changes': versionRead('What changed between two versions: added, removed, changed and moved blocks.', obj({
    from, to: { ...version, description: 'Omit it to compare with the document as it is now.' },
  }, ['from']), "To see one version's own edits, pass the version listed after it as from and the version as to."),
  'history.restore': {
    ...write('Restore a saved version, as the version history\'s Restore does: the document becomes that version, title and icon too.', obj({ version }, ['version']),
      'Only when the user asks for it. Sub-pages keep their own history. No other version is deleted. history.undo cannot undo a restore: '
      + 'to go back, restore the result\'s previous version. A version that removes, unlocks or reshapes a database a person locked asks '
      + 'the person first; a no, or no way to ask, fails with APPROVAL_REQUIRED. Read the document again before your next write.'),
    requires: ['versionHistory'],
  },
};

/**
 * JSON Schema (draft 2020-12) for Blok's SAVED document format — what
 * `Saver.save()` writes and what a consumer stores.
 *
 * PURITY CONTRACT (see the banner in ./blocks-to-html.ts): this module imports
 * only the pure description modules under src/shared/tool-descriptions/.
 *
 * Consumers use it to constrain LLM structured output, so `type` stays an open
 * string and the per-type `data` shapes are attached with `allOf`/`if`
 * branches: a block whose `type` is a custom tool passes with an unconstrained
 * `data`, while `oneOf` would have rejected it.
 *
 * Kept honest by `test/unit/view/document-schema.test.ts`, which compares every
 * `$defs` entry against what that tool's real `save()` emits, in both
 * directions.
 */

import { describeAudio } from '../shared/tool-descriptions/audio';
import { describeBookmark } from '../shared/tool-descriptions/bookmark';
import { describeCallout } from '../shared/tool-descriptions/callout';
import { describeCode } from '../shared/tool-descriptions/code';
import { describeColumnList } from '../shared/tool-descriptions/column-list';
import { describeColumn } from '../shared/tool-descriptions/column';
import { describeDatabase } from '../shared/tool-descriptions/database';
import { describeDatabaseRow } from '../shared/tool-descriptions/database-row';
import { describeDivider } from '../shared/tool-descriptions/divider';
import { describeEmbed } from '../shared/tool-descriptions/embed';
import { describeFile } from '../shared/tool-descriptions/file';
import { describeHeader } from '../shared/tool-descriptions/header';
import { describeImage } from '../shared/tool-descriptions/image';
import { describeList } from '../shared/tool-descriptions/list';
import { describePage, PAGE_ICON_SCHEMA } from '../shared/tool-descriptions/page';
import { describePageLink } from '../shared/tool-descriptions/page-link';
import { describeParagraph } from '../shared/tool-descriptions/paragraph';
import { describeQuote } from '../shared/tool-descriptions/quote';
import { describeSpacer } from '../shared/tool-descriptions/spacer';
import { describeTab } from '../shared/tool-descriptions/tab';
import { describeTable } from '../shared/tool-descriptions/table';
import { describeTableOfContents } from '../shared/tool-descriptions/table-of-contents';
import { describeTabs } from '../shared/tool-descriptions/tabs';
import { describeToggle } from '../shared/tool-descriptions/toggle';
import { describeVideo } from '../shared/tool-descriptions/video';

export const blokDocumentSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://blokeditor.com/schemas/document.schema.json',
  title: 'Blok document',
  description:
    'A saved Blok document: a flat array of blocks. Nesting is expressed by references — a child carries `parent`, its container carries `content` — never by nesting blocks inside each other.',
  type: 'object',
  required: ['blocks'],
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      description: 'The document id. Blok writes it on the first save and keeps it.',
    },
    time: {
      type: 'integer',
      description: 'Unix epoch milliseconds when the document was saved.',
    },
    version: {
      type: 'string',
      description: 'Version of Blok that produced the document.',
    },
    title: {
      type: 'string',
      minLength: 1,
      description: 'The page title. Absent when empty.',
    },
    icon: PAGE_ICON_SCHEMA,
    blocks: {
      type: 'array',
      description: 'Every block in the document, in reading order.',
      items: {
        type: 'object',
        required: ['type', 'data'],
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            description: 'Unique block id. Generated on load when absent.',
          },
          type: {
            type: 'string',
            description: 'Registered tool name. Built-in names are covered by $defs; custom tools are allowed.',
          },
          data: {
            type: 'object',
            description: 'Tool-specific payload. See the $defs entry matching `type`.',
          },
          tunes: {
            type: 'object',
            description: 'Per-tune payloads, keyed by tune name. Unknown tunes are preserved as-is.',
            additionalProperties: true,
          },
          parent: {
            type: 'string',
            description: 'Id of the containing block. Absent for a root-level block.',
          },
          content: {
            type: 'array',
            description: 'Ids of this block\'s children, in order. Absent when it has none.',
            items: { type: 'string' },
          },
          lastEditedAt: {
            type: 'integer',
            description: 'Unix epoch milliseconds of the last edit to this block.',
          },
          lastEditedBy: {
            type: 'string',
            description: 'Identifier of the user who last edited this block.',
          },
        },
        allOf: [
          { if: { required: ['type'], properties: { type: { const: 'paragraph' } } }, then: { properties: { data: { $ref: '#/$defs/paragraph' } } } },
          { if: { required: ['type'], properties: { type: { const: 'header' } } }, then: { properties: { data: { $ref: '#/$defs/header' } } } },
          { if: { required: ['type'], properties: { type: { const: 'list' } } }, then: { properties: { data: { $ref: '#/$defs/list' } } } },
          { if: { required: ['type'], properties: { type: { const: 'table' } } }, then: { properties: { data: { $ref: '#/$defs/table' } } } },
          { if: { required: ['type'], properties: { type: { const: 'toggle' } } }, then: { properties: { data: { $ref: '#/$defs/toggle' } } } },
          { if: { required: ['type'], properties: { type: { const: 'callout' } } }, then: { properties: { data: { $ref: '#/$defs/callout' } } } },
          { if: { required: ['type'], properties: { type: { const: 'database' } } }, then: { properties: { data: { $ref: '#/$defs/database' } } } },
          { if: { required: ['type'], properties: { type: { const: 'database-row' } } }, then: { properties: { data: { $ref: '#/$defs/database-row' } } } },
          { if: { required: ['type'], properties: { type: { const: 'divider' } } }, then: { properties: { data: { $ref: '#/$defs/divider' } } } },
          { if: { required: ['type'], properties: { type: { const: 'spacer' } } }, then: { properties: { data: { $ref: '#/$defs/spacer' } } } },
          { if: { required: ['type'], properties: { type: { const: 'table_of_contents' } } }, then: { properties: { data: { $ref: '#/$defs/table_of_contents' } } } },
          { if: { required: ['type'], properties: { type: { const: 'quote' } } }, then: { properties: { data: { $ref: '#/$defs/quote' } } } },
          { if: { required: ['type'], properties: { type: { const: 'code' } } }, then: { properties: { data: { $ref: '#/$defs/code' } } } },
          { if: { required: ['type'], properties: { type: { const: 'image' } } }, then: { properties: { data: { $ref: '#/$defs/image' } } } },
          { if: { required: ['type'], properties: { type: { const: 'file' } } }, then: { properties: { data: { $ref: '#/$defs/file' } } } },
          { if: { required: ['type'], properties: { type: { const: 'audio' } } }, then: { properties: { data: { $ref: '#/$defs/audio' } } } },
          { if: { required: ['type'], properties: { type: { const: 'video' } } }, then: { properties: { data: { $ref: '#/$defs/video' } } } },
          { if: { required: ['type'], properties: { type: { const: 'column_list' } } }, then: { properties: { data: { $ref: '#/$defs/column_list' } } } },
          { if: { required: ['type'], properties: { type: { const: 'column' } } }, then: { properties: { data: { $ref: '#/$defs/column' } } } },
          { if: { required: ['type'], properties: { type: { const: 'tabs' } } }, then: { properties: { data: { $ref: '#/$defs/tabs' } } } },
          { if: { required: ['type'], properties: { type: { const: 'tab' } } }, then: { properties: { data: { $ref: '#/$defs/tab' } } } },
          { if: { required: ['type'], properties: { type: { const: 'embed' } } }, then: { properties: { data: { $ref: '#/$defs/embed' } } } },
          { if: { required: ['type'], properties: { type: { const: 'bookmark' } } }, then: { properties: { data: { $ref: '#/$defs/bookmark' } } } },
          { if: { required: ['type'], properties: { type: { const: 'page' } } }, then: { properties: { data: { $ref: '#/$defs/page' } } } },
          { if: { required: ['type'], properties: { type: { const: 'page-link' } } }, then: { properties: { data: { $ref: '#/$defs/page-link' } } } },
        ],
      },
    },
  },

  $defs: {
    paragraph: describeParagraph().data,

    header: describeHeader().data,

    list: describeList().data,

    table: describeTable().data,

    toggle: describeToggle().data,

    callout: describeCallout().data,

    database: describeDatabase().data,

    'database-row': describeDatabaseRow().data,

    divider: describeDivider().data,

    spacer: describeSpacer().data,

    table_of_contents: describeTableOfContents().data,

    quote: describeQuote().data,

    code: describeCode().data,

    image: describeImage().data,

    file: describeFile().data,

    audio: describeAudio().data,

    video: describeVideo().data,

    column_list: describeColumnList().data,

    column: describeColumn().data,

    tabs: describeTabs().data,

    tab: describeTab().data,

    embed: describeEmbed().data,

    bookmark: describeBookmark().data,

    page: describePage().data,

    'page-link': describePageLink().data,
  },
} as const;

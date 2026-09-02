/**
 * JSON Schema (draft 2020-12) for Blok's SAVED document format — what
 * `Saver.save()` writes and what a consumer stores.
 *
 * PURITY CONTRACT (see the banner in ./blocks-to-html.ts): this module is a
 * plain object literal with no imports at all.
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

/** Horizontal placement, shared by the media and embed tools. */
const ALIGNMENT = ['left', 'center', 'right'] as const;

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
    time: {
      type: 'integer',
      description: 'Unix epoch milliseconds when the document was saved.',
    },
    version: {
      type: 'string',
      description: 'Version of Blok that produced the document.',
    },
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
          { if: { required: ['type'], properties: { type: { const: 'quote' } } }, then: { properties: { data: { $ref: '#/$defs/quote' } } } },
          { if: { required: ['type'], properties: { type: { const: 'code' } } }, then: { properties: { data: { $ref: '#/$defs/code' } } } },
          { if: { required: ['type'], properties: { type: { const: 'image' } } }, then: { properties: { data: { $ref: '#/$defs/image' } } } },
          { if: { required: ['type'], properties: { type: { const: 'file' } } }, then: { properties: { data: { $ref: '#/$defs/file' } } } },
          { if: { required: ['type'], properties: { type: { const: 'audio' } } }, then: { properties: { data: { $ref: '#/$defs/audio' } } } },
          { if: { required: ['type'], properties: { type: { const: 'video' } } }, then: { properties: { data: { $ref: '#/$defs/video' } } } },
          { if: { required: ['type'], properties: { type: { const: 'column_list' } } }, then: { properties: { data: { $ref: '#/$defs/column_list' } } } },
          { if: { required: ['type'], properties: { type: { const: 'column' } } }, then: { properties: { data: { $ref: '#/$defs/column' } } } },
          { if: { required: ['type'], properties: { type: { const: 'embed' } } }, then: { properties: { data: { $ref: '#/$defs/embed' } } } },
          { if: { required: ['type'], properties: { type: { const: 'bookmark' } } }, then: { properties: { data: { $ref: '#/$defs/bookmark' } } } },
        ],
      },
    },
  },

  $defs: {
    paragraph: {
      type: 'object',
      description: 'A line of rich text.',
      required: ['text'],
      additionalProperties: false,
      properties: {
        text: { type: 'string', description: 'Inline HTML: <b>, <i>, <u>, <s>, <a>, <code>, <mark>, <sup>, <sub>, <br>.' },
        textColor: { type: 'string', description: 'Text color preset name, e.g. "red".' },
        backgroundColor: { type: 'string', description: 'Background color preset name.' },
      },
    },

    header: {
      type: 'object',
      description: 'A heading. Toggle headings own the blocks that reference them as `parent`.',
      required: ['text', 'level'],
      additionalProperties: false,
      properties: {
        text: { type: 'string', description: 'Inline HTML of the heading.' },
        level: { type: 'integer', minimum: 1, maximum: 6 },
        isToggleable: { type: 'boolean', description: 'Heading collapses/expands its children.' },
        isOpen: { type: 'boolean', description: 'Expanded state of a toggle heading.' },
        textColor: { type: 'string' },
        backgroundColor: { type: 'string' },
        anchor: { type: 'string', description: 'Anchor id rendered as the heading element\'s `id`.' },
      },
    },

    list: {
      type: 'object',
      description: 'One list item. A list is a run of sibling `list` blocks, not a single block.',
      required: ['text', 'style'],
      additionalProperties: false,
      properties: {
        text: { type: 'string', description: 'Inline HTML of the item.' },
        style: { type: 'string', enum: ['unordered', 'ordered', 'checklist'] },
        checked: { type: 'boolean', description: 'Checklist state. Only emitted for style "checklist".' },
        start: { type: 'integer', description: 'Starting number of an ordered run. Omitted when 1.' },
        depth: { type: 'integer', minimum: 1, description: 'Nesting level. Omitted at root.' },
      },
    },

    table: {
      type: 'object',
      description: 'A grid whose cells reference child blocks by id; the referenced blocks are siblings in `blocks` carrying `parent` = the table id.',
      required: ['withHeadings', 'withHeadingColumn', 'content'],
      additionalProperties: false,
      properties: {
        withHeadings: { type: 'boolean', description: 'First row is a heading row.' },
        withHeadingColumn: { type: 'boolean', description: 'First column is a heading column.' },
        stretched: { type: 'boolean', description: 'Table spans the full editor width.' },
        content: {
          type: 'array',
          description: 'Rows of cells.',
          items: {
            type: 'array',
            items: {
              anyOf: [
                { type: 'string', description: 'Legacy plain-text cell, still accepted on load.' },
                {
                  type: 'object',
                  required: ['blocks'],
                  additionalProperties: false,
                  properties: {
                    blocks: { type: 'array', items: { type: 'string' }, description: 'Ids of the blocks rendered in this cell, in order.' },
                    text: { type: 'string', description: 'Inline HTML mirror of the cell, kept for import/export paths.' },
                    color: { type: 'string', description: 'Cell background color preset name.' },
                    textColor: { type: 'string' },
                    placement: {
                      type: 'string',
                      enum: [
                        'top-left', 'top-center', 'top-right',
                        'middle-left', 'middle-center', 'middle-right',
                        'bottom-left', 'bottom-center', 'bottom-right',
                      ],
                    },
                    colspan: { type: 'integer', minimum: 1, description: 'Only set on a merge origin.' },
                    rowspan: { type: 'integer', minimum: 1, description: 'Only set on a merge origin.' },
                    mergedInto: {
                      type: 'array',
                      description: '[row, col] of the merge origin covering this cell.',
                      items: { type: 'integer' },
                      minItems: 2,
                      maxItems: 2,
                    },
                  },
                },
              ],
            },
          },
        },
        colWidths: { type: 'array', items: { type: 'number' }, description: 'Column widths in pixels. Omit for equal widths.' },
        initialColWidth: { type: 'number', description: 'Per-column width in pixels captured at creation.' },
        textSize: { type: 'string', enum: ['compact', 'comfortable'], description: 'Omitted means "compact".' },
      },
    },

    toggle: {
      type: 'object',
      description: 'A collapsible summary line. Its body blocks reference it as `parent`.',
      required: ['text'],
      additionalProperties: false,
      properties: {
        text: { type: 'string', description: 'Inline HTML of the summary.' },
        isOpen: { type: 'boolean' },
      },
    },

    callout: {
      type: 'object',
      description: 'A highlighted panel. Its body blocks reference it as `parent`; the panel itself holds no text.',
      required: ['emoji'],
      additionalProperties: false,
      properties: {
        emoji: { type: 'string', description: 'Leading emoji. Empty string hides it.' },
        textColor: { type: ['string', 'null'], description: 'Preset name, or null to inherit.' },
        backgroundColor: { type: ['string', 'null'], description: 'Preset name, or null for none.' },
      },
    },

    database: {
      type: 'object',
      description: 'Schema and view configuration only — rows are child `database-row` blocks.',
      required: ['schema', 'views', 'activeViewId'],
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        activeViewId: { type: 'string', description: 'Id of the view shown by default.' },
        schema: {
          type: 'array',
          description: 'Column definitions. Exactly one must have type "title".',
          items: {
            type: 'object',
            required: ['id', 'name', 'type', 'position'],
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              type: {
                type: 'string',
                enum: ['title', 'text', 'number', 'select', 'multiSelect', 'date', 'checkbox', 'url', 'richText'],
              },
              position: { type: 'string', description: 'Fractional-index sort key.' },
              config: {
                type: 'object',
                description: 'Type-specific options; select/multiSelect carry their choices here.',
                required: ['options'],
                additionalProperties: false,
                properties: {
                  options: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['id', 'label', 'position'],
                      additionalProperties: false,
                      properties: {
                        id: { type: 'string' },
                        label: { type: 'string' },
                        color: { type: 'string' },
                        position: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        views: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['id', 'name', 'type', 'position', 'sorts', 'filters', 'visibleProperties'],
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              type: { type: 'string', enum: ['board', 'table', 'gallery', 'list'] },
              position: { type: 'string' },
              groupBy: { type: 'string', description: 'Property id. Required for a board view.' },
              sorts: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['propertyId', 'direction'],
                  additionalProperties: false,
                  properties: {
                    propertyId: { type: 'string' },
                    direction: { type: 'string', enum: ['asc', 'desc'] },
                  },
                },
              },
              filters: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['propertyId', 'operator', 'value'],
                  additionalProperties: false,
                  properties: {
                    propertyId: { type: 'string' },
                    operator: { type: 'string' },
                    value: { description: 'Any property value; shape follows the property type.' },
                  },
                },
              },
              visibleProperties: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },

    'database-row': {
      type: 'object',
      description: 'One row of a database block. Rich page content lives in this block\'s children, not here.',
      required: ['properties', 'position'],
      additionalProperties: false,
      properties: {
        properties: {
          type: 'object',
          description: 'Column values keyed by property id. Values follow the parent database\'s schema, so the shape is open.',
          additionalProperties: true,
        },
        position: { type: 'string', description: 'Fractional-index sort key.' },
      },
    },

    divider: {
      type: 'object',
      description: 'A horizontal rule. Carries no data.',
      additionalProperties: false,
    },

    spacer: {
      type: 'object',
      description: 'Vertical whitespace.',
      additionalProperties: false,
      properties: {
        height: { type: 'number', minimum: 38, maximum: 600, description: 'Gap in pixels. Defaults to 38; out-of-range values are clamped on load.' },
      },
    },

    quote: {
      type: 'object',
      required: ['text'],
      additionalProperties: false,
      properties: {
        text: { type: 'string', description: 'Inline HTML of the quote.' },
        size: { type: 'string', enum: ['default', 'large'] },
      },
    },

    code: {
      type: 'object',
      description: 'A code block. `code` is raw text, never HTML.',
      required: ['code', 'language'],
      additionalProperties: false,
      properties: {
        code: { type: 'string' },
        language: { type: 'string', description: 'Language identifier, e.g. "javascript", "plain text".' },
        lineNumbers: { type: 'boolean' },
      },
    },

    image: {
      type: 'object',
      required: ['url'],
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'http(s) or blob: source.' },
        caption: { type: 'string', description: 'Plain text.' },
        captionVisible: { type: 'boolean' },
        alt: { type: 'string' },
        fileName: { type: 'string' },
        width: { type: 'number', minimum: 10, maximum: 100, description: 'Percent of the container.' },
        alignment: { type: 'string', enum: ALIGNMENT },
        size: { type: 'string', enum: ['sm', 'md', 'lg', 'full'], description: 'Preset; overrides `width` when present.' },
        frame: { type: 'string', enum: ['none', 'border', 'shadow'] },
        rounded: { type: 'boolean' },
        // Fractional for an SVG whose viewBox is (see dimensions-from-svg.ts).
        naturalWidth: { type: 'number', description: 'Intrinsic pixel width, cached after first load.' },
        naturalHeight: { type: 'number' },
        crop: {
          type: 'object',
          description: 'Non-destructive crop, in percent of the intrinsic image. Omitted for an uncropped rectangle.',
          required: ['x', 'y', 'w', 'h'],
          additionalProperties: false,
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            w: { type: 'number' },
            h: { type: 'number' },
            shape: { type: 'string', enum: ['rect', 'circle', 'ellipse'] },
          },
        },
      },
    },

    file: {
      type: 'object',
      description: 'A downloadable file card.',
      required: ['url'],
      additionalProperties: false,
      properties: {
        url: { type: 'string' },
        fileName: { type: 'string' },
        size: { type: 'integer', description: 'Bytes.' },
        mimeType: { type: 'string' },
        caption: { type: 'string' },
        captionVisible: { type: 'boolean' },
      },
    },

    audio: {
      type: 'object',
      required: ['url'],
      additionalProperties: false,
      properties: {
        url: { type: 'string' },
        caption: { type: 'string' },
        captionVisible: { type: 'boolean' },
        title: { type: 'string' },
        artist: { type: 'string' },
        coverUrl: { type: 'string' },
        loop: { type: 'boolean' },
        width: { type: 'number', minimum: 10, maximum: 100 },
        alignment: { type: 'string', enum: ALIGNMENT },
        fileName: { type: 'string' },
        mimeType: { type: 'string' },
        duration: { type: 'number', description: 'Seconds.' },
        peaks: { type: 'array', items: { type: 'number' }, description: 'Precomputed waveform samples.' },
      },
    },

    video: {
      type: 'object',
      required: ['url'],
      additionalProperties: false,
      properties: {
        url: { type: 'string' },
        caption: { type: 'string' },
        captionVisible: { type: 'boolean' },
        width: { type: 'number', minimum: 10, maximum: 100 },
        alignment: { type: 'string', enum: ALIGNMENT },
        autoplay: { type: 'boolean' },
        loop: { type: 'boolean' },
        hideControls: { type: 'boolean' },
        fileName: { type: 'string' },
        mimeType: { type: 'string' },
        aspectRatio: { type: 'string', description: 'Intrinsic ratio, e.g. "16 / 9".' },
      },
    },

    column_list: {
      type: 'object',
      description: 'A row of columns. Carries no data — the columns are its `content` children.',
      additionalProperties: false,
    },

    column: {
      type: 'object',
      description: 'One column of a column_list. Its content is its `content` children.',
      additionalProperties: false,
      properties: {
        widthRatio: { type: 'number', exclusiveMinimum: 0, description: 'Width relative to sibling columns. Omitted for an even split.' },
      },
    },

    embed: {
      type: 'object',
      description: 'A live third-party embed. Only registry-matched provider URLs are embedded.',
      required: ['service', 'source', 'embed'],
      additionalProperties: false,
      properties: {
        service: { type: 'string', description: 'Registry key, e.g. "youtube".' },
        source: { type: 'string', description: 'The original pasted URL.' },
        embed: { type: 'string', description: 'Provider-sanctioned embed URL. Must be https.' },
        kind: { type: 'string', enum: ['iframe', 'script'] },
        width: { type: 'number' },
        height: { type: 'number' },
        widthPercent: { type: 'number', minimum: 10, maximum: 100 },
        alignment: { type: 'string', enum: ALIGNMENT },
        caption: { type: 'string' },
        captionVisible: { type: 'boolean' },
      },
    },

    bookmark: {
      type: 'object',
      description: 'A static link preview card built from OpenGraph metadata.',
      required: ['url'],
      additionalProperties: false,
      properties: {
        url: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        image: { type: 'string', description: 'Preview image URL.' },
        favicon: { type: 'string' },
        domain: { type: 'string' },
      },
    },
  },
} as const;

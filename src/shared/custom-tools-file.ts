import type { BlokCustomToolsFile, BlokSchema, SanitizerConfig, ToolRegistrySnapshot } from '../../types';
import { INLINE_TEXT_SANITIZE } from './inline-text-sanitize';
import { INLINE_TOOL_ORDER } from './inline-tool-order';
import { validateAgainst } from './schema/validate';
import { composeToolSanitize } from './tool-actions/runtime';
import type { ToolRuntimeRegistry } from './tool-actions/runtime';
import { BUILT_IN_BLOCK_SANITIZE } from './tool-descriptions/sanitize/blocks';
import { BUILT_IN_INLINE_SANITIZE } from './tool-descriptions/sanitize/inline';

const STRING_SCHEMA: BlokSchema = { type: 'string' };
const BOOLEAN_SCHEMA: BlokSchema = { type: 'boolean' };
const OBJECT_SCHEMA: BlokSchema = { type: 'object' };
const STRING_LIST_SCHEMA: BlokSchema = { type: 'array', items: STRING_SCHEMA };
const SERVICE_LIST_SCHEMA: BlokSchema = {
  type: 'array',
  items: { enum: ['uploader', 'linkMetadata', 'pageBackend', 'host'] },
};

const FILE_SCHEMA: BlokSchema = {
  type: 'object',
  required: ['formatVersion', 'blocks'],
  properties: {
    formatVersion: { const: 1 },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'description', 'statics'],
        properties: {
          name: { type: 'string', minLength: 1 },
          description: {
            type: 'object',
            required: ['summary', 'data'],
            properties: {
              summary: STRING_SCHEMA,
              guidance: STRING_SCHEMA,
              data: OBJECT_SCHEMA,
              defaultData: OBJECT_SCHEMA,
              examples: { type: 'array', items: OBJECT_SCHEMA },
              summaryFields: STRING_LIST_SCHEMA,
              fillMissing: STRING_LIST_SCHEMA,
              inputFields: STRING_LIST_SCHEMA,
              viewState: STRING_LIST_SCHEMA,
              guardedFields: { type: 'object', additionalProperties: STRING_SCHEMA },
              actions: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'summary', 'args', 'target'],
                  properties: {
                    name: { type: 'string', pattern: '^[a-z][a-zA-Z0-9]*$' },
                    summary: STRING_SCHEMA,
                    guidance: STRING_SCHEMA,
                    args: OBJECT_SCHEMA,
                    result: OBJECT_SCHEMA,
                    target: { enum: ['block', 'create'] },
                    runtime: { enum: ['any', 'editor'] },
                    effects: { const: 'host' },
                    preconditions: STRING_LIST_SCHEMA,
                    requires: SERVICE_LIST_SCHEMA,
                    uses: SERVICE_LIST_SCHEMA,
                    mirrors: STRING_LIST_SCHEMA,
                  },
                },
              },
            },
          },
          statics: {
            type: 'object',
            required: [
              'toolbox', 'richTextFields', 'acceptsChildren', 'ownsChildren', 'isLayout',
              'deletesChildren', 'selfPlacesChildren', 'restrictedInTableCell',
              'conversion', 'convertible', 'hasPrepareInsert',
            ],
            properties: {
              toolbox: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'title'],
                  properties: {
                    name: STRING_SCHEMA,
                    title: STRING_SCHEMA,
                    data: OBJECT_SCHEMA,
                    previewCaption: STRING_SCHEMA,
                  },
                },
              },
              richTextFields: STRING_LIST_SCHEMA,
              acceptsChildren: BOOLEAN_SCHEMA,
              childTools: {
                type: 'object',
                properties: { allow: STRING_LIST_SCHEMA, deny: STRING_LIST_SCHEMA },
              },
              ownsChildren: BOOLEAN_SCHEMA,
              isLayout: BOOLEAN_SCHEMA,
              isAnnotation: BOOLEAN_SCHEMA,
              deletesChildren: BOOLEAN_SCHEMA,
              selfPlacesChildren: BOOLEAN_SCHEMA,
              restrictedInTableCell: BOOLEAN_SCHEMA,
              conversion: {
                type: 'object',
                properties: { import: STRING_SCHEMA, export: STRING_SCHEMA },
              },
              convertible: {
                type: 'object',
                required: ['import', 'export'],
                properties: { import: BOOLEAN_SCHEMA, export: BOOLEAN_SCHEMA },
              },
              assetKind: STRING_SCHEMA,
              hasPrepareInsert: BOOLEAN_SCHEMA,
            },
          },
          sanitize: {
            type: 'object',
            additionalProperties: {
              type: ['boolean', 'object'],
              additionalProperties: {
                type: ['boolean', 'object'],
                additionalProperties: { type: ['boolean', 'string'] },
              },
            },
          },
        },
      },
    },
    inlineTools: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'sanitize'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]*$' },
          title: STRING_SCHEMA,
          sanitize: {
            type: 'object',
            additionalProperties: false,
            patternProperties: {
              '^[a-z][a-z0-9-]*$': {
                oneOf: [{ const: true }, { type: 'object', additionalProperties: { type: ['boolean', 'string'] } }],
              },
            },
          },
        },
      },
    },
  },
};

// Tags whose content is code or a document, never a run of text.
const REFUSED_INLINE_TAGS = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'template', 'noscript', 'base', 'link', 'meta']);
const ATTRIBUTE_NAME = /^[a-z_:][a-z0-9_.:-]*$/i;
// Event handlers run script; srcdoc is a whole document.
const isRefusedAttribute = (name: string): boolean => /^on/i.test(name) || name.toLowerCase() === 'srcdoc' || !ATTRIBUTE_NAME.test(name);

/** Rules a JSON schema cannot say: the tags and attribute names a host inline tool may not allow. */
const inlineToolProblems = (value: unknown): Array<{ path: string; message: string }> => {
  const tools = typeof value === 'object' && value !== null && 'inlineTools' in value && Array.isArray(value.inlineTools) ? value.inlineTools : [];

  return tools.flatMap((tool: unknown, index: number) => {
    const sanitize: unknown = typeof tool === 'object' && tool !== null && 'sanitize' in tool ? tool.sanitize : undefined;

    return Object.entries(typeof sanitize === 'object' && sanitize !== null ? sanitize : {}).flatMap(([tag, rule]: [string, unknown]) => [
      ...(REFUSED_INLINE_TAGS.has(tag) ? [{ path: `/inlineTools/${index}/sanitize/${tag}`, message: 'is a tag an inline tool may not allow' }] : []),
      ...Object.keys(typeof rule === 'object' && rule !== null ? rule : {})
        .filter(isRefusedAttribute)
        .map(attribute => ({ path: `/inlineTools/${index}/sanitize/${tag}/${attribute}`, message: 'is an attribute an inline tool may not allow' })),
    ]);
  });
};

const assertCustomToolsFile: (value: unknown) => asserts value is BlokCustomToolsFile = (value) => {
  const problems = [
    ...validateAgainst(FILE_SCHEMA, value),
    ...inlineToolProblems(value),
  ];

  if (problems.length > 0) {
    throw new TypeError(
      `Not a Blok custom tools file: ${problems.map(problem => `${problem.path || '/'} ${problem.message}`).join('; ')}`
    );
  }
};

export const readCustomToolsFile = (value: unknown): BlokCustomToolsFile => {
  assertCustomToolsFile(value);

  return value;
};

const customInline = (file: BlokCustomToolsFile): NonNullable<BlokCustomToolsFile['inlineTools']> => file.inlineTools ?? [];

export const snapshotWithCustomTools = (
  base: ToolRegistrySnapshot,
  file?: BlokCustomToolsFile
): ToolRegistrySnapshot => {
  if (file === undefined) {
    return base;
  }

  const customNames = new Set(file.blocks.map(block => block.name));
  const inline = customInline(file);
  const inlineNames = new Set(inline.map(tool => tool.name));
  const inlineTools: ToolRegistrySnapshot['inlineTools'] = [
    ...base.inlineTools.filter(tool => !inlineNames.has(tool.name)),
    ...inline.map(tool => {
      const tags = Object.keys(tool.sanitize);
      const [onlyTag] = tags;

      return {
        name: tool.name,
        title: tool.title ?? tool.name,
        description: null,
        sanitizeTags: tags,
        ...(tags.length === 1 && onlyTag !== undefined ? { sanitizeRule: tool.sanitize[onlyTag] } : {}),
      };
    }),
  ];
  // Code lists no inline tools; every other built-in takes the host's ones too, as in the editor.
  const withInline = (names: string[]): string[] => (names.length === 0
    ? names
    : [...names.filter(name => !inlineNames.has(name)), ...inline.map(tool => tool.name)]);

  return {
    ...base,
    blocks: [
      ...base.blocks.filter(block => !customNames.has(block.name)).map(block => ({ ...block, inlineTools: withInline(block.inlineTools) })),
      ...file.blocks.map(block => ({
        name: block.name,
        title: block.statics.toolbox[0]?.title ?? block.name,
        description: block.description,
        statics: block.statics,
        insertable: true,
        inlineTools: inlineTools.map(tool => tool.name),
        tunes: [],
        handlers: [],
      })),
    ],
    inlineTools,
  };
};

export const runtimesWithCustomTools = (
  base: ToolRuntimeRegistry,
  file?: BlokCustomToolsFile
): ToolRuntimeRegistry => {
  if (file === undefined) {
    return base;
  }

  // Built-ins first, then the host's tools: the editor composes them in registration order.
  const hostInline: SanitizerConfig[] = customInline(file).map(tool => ({ ...tool.sanitize }));
  const inline = [...Object.values(BUILT_IN_INLINE_SANITIZE).map(factory => factory()), ...hostInline];
  const merged = new Map(base);

  const builtInInline = INLINE_TOOL_ORDER.flatMap(name => {
    const factory = BUILT_IN_INLINE_SANITIZE[name];

    return factory === undefined ? [] : [factory()];
  });
  // Code opts out of inline tools, as in BUILT_IN_TOOL_RUNTIMES.
  const takesHostInline = Object.entries(BUILT_IN_BLOCK_SANITIZE).filter(([name]) => hostInline.length > 0 && name !== 'code');

  for (const [name, own] of takesHostInline) {
    const runtime = merged.get(name);

    if (runtime !== undefined) {
      merged.set(name, { ...runtime, sanitize: composeToolSanitize(own(), [...builtInInline, ...hostInline]) });
    }
  }

  for (const block of file.blocks) {
    const own: SanitizerConfig = {};

    // The composer accepts field maps; its input type only covers tag maps.
    Object.assign(own, block.sanitize ?? Object.fromEntries(
      block.statics.richTextFields.map((field): [string, SanitizerConfig] => [field, { ...INLINE_TEXT_SANITIZE }])
    ));
    merged.set(block.name, {
      name: block.name,
      sanitize: composeToolSanitize(own, inline),
      actions: {},
    });
  }

  return merged;
};

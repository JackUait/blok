import type { BlokCustomToolsFile, BlokSchema, SanitizerConfig, ToolRegistrySnapshot } from '../../types';
import { INLINE_TEXT_SANITIZE } from './inline-text-sanitize';
import { validateAgainst } from './schema/validate';
import { composeToolSanitize } from './tool-actions/runtime';
import type { ToolRuntimeRegistry } from './tool-actions/runtime';
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
  },
};

const assertCustomToolsFile: (value: unknown) => asserts value is BlokCustomToolsFile = (value) => {
  const problems = validateAgainst(FILE_SCHEMA, value);

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

export const snapshotWithCustomTools = (
  base: ToolRegistrySnapshot,
  file?: BlokCustomToolsFile
): ToolRegistrySnapshot => {
  if (file === undefined) {
    return base;
  }

  const customNames = new Set(file.blocks.map(block => block.name));

  return {
    ...base,
    blocks: [
      ...base.blocks.filter(block => !customNames.has(block.name)),
      ...file.blocks.map(block => ({
        name: block.name,
        title: block.statics.toolbox[0]?.title ?? block.name,
        description: block.description,
        statics: block.statics,
        insertable: true,
        inlineTools: base.inlineTools.map(tool => tool.name),
        tunes: [],
        handlers: [],
      })),
    ],
  };
};

export const runtimesWithCustomTools = (
  base: ToolRuntimeRegistry,
  file?: BlokCustomToolsFile
): ToolRuntimeRegistry => {
  if (file === undefined) {
    return base;
  }

  const inline = Object.values(BUILT_IN_INLINE_SANITIZE).map(factory => factory());
  const merged = new Map(base);

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

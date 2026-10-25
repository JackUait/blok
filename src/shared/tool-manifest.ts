import type {
  AgentContract,
  BlockToolDescription,
  BlockToolManifestEntry,
  BlockTuneDescription,
  BlokSchema,
  BlokToolManifest,
  CommandEntry,
  CustomInlineSanitizeRule,
  HostService,
  InlineToolDescription,
  InlineToolManifestEntry,
  ManifestAction,
  ManifestOverrides,
  SnapshotBlock,
  ToolActionDeclaration,
  ToolCommandName,
  ToolRegistrySnapshot,
  TuneManifestEntry,
} from '../../types';
import { deepEqual } from './deep-equal';
import { OPAQUE_TAGS } from './rich-text/html-to-segments';
import { ownEntry } from './own-entry';
import { validPattern } from './schema/validate';
import { RICH_TEXT_MARKS, RICH_TEXT_PRIMER, richText } from './tool-descriptions/rich-text';

export const RESERVED_NAMESPACES = ['doc', 'block', 'text', 'markdown', 'history'] as const;

export interface ManifestBuildOptions {
  onWarning?(message: string): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
};

export const canonicalHash = (value: unknown): string => {
  const text = canonicalJson(value);
  const hash = text.split('').reduce(
    (current, character) => Math.imul(current ^ character.charCodeAt(0), 0x01000193) >>> 0,
    0x811c9dc5
  );

  return hash.toString(16).padStart(8, '0');
};

export const structuralDataSchema = (richTextFields: string[]): BlokSchema => ({
  type: 'object',
  additionalProperties: true,
  properties: Object.fromEntries(richTextFields.map(field => [field, richText(`Rich-text field "${field}".`)])),
});

/** Whether a block's data schema takes this field. Toolbox seeds like column_list's columnCount are not data. */
const acceptsField = (schema: BlokSchema, key: string): boolean => {
  const patterns = isRecord(schema.patternProperties) ? Object.keys(schema.patternProperties) : [];

  return schema.additionalProperties !== false
    || (isRecord(schema.properties) && Object.hasOwn(schema.properties, key))
    || patterns.some(pattern => validPattern(pattern) && new RegExp(pattern, 'u').test(key));
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
};

const isJsonValue = (value: unknown, ancestors = new Set<Record<string, unknown> | unknown[]>()): boolean => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if ((!Array.isArray(value) && !isPlainRecord(value)) || ancestors.has(value) || Object.getOwnPropertySymbols(value).length > 0) {
    return false;
  }

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? Object.keys(value).length === value.length && value.every(item => isJsonValue(item, ancestors))
    : Object.getOwnPropertyNames(value).length === Object.keys(value).length
      && Object.values(value).every(item => isJsonValue(item, ancestors));

  ancestors.delete(value);

  return valid;
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');

const isAction = (value: unknown): value is ToolActionDeclaration =>
  isPlainRecord(value)
  && typeof value.name === 'string' && /^[a-z][a-zA-Z0-9]*$/.test(value.name)
  && typeof value.summary === 'string'
  && isPlainRecord(value.args)
  && (value.target === 'block' || value.target === 'create')
  && (value.guidance === undefined || typeof value.guidance === 'string')
  && (value.result === undefined || isPlainRecord(value.result))
  && (value.runtime === undefined || value.runtime === 'any' || value.runtime === 'editor')
  && (value.effects === undefined || value.effects === 'host')
  && ['preconditions', 'mirrors'].every(key => value[key] === undefined || isStringArray(value[key]))
  && ['requires', 'uses'].every(key => value[key] === undefined
    || (isStringArray(value[key]) && value[key].every(service => ['uploader', 'linkMetadata', 'pageBackend', 'host'].includes(service))));

const isBlockDescription = (value: unknown): value is BlockToolDescription =>
  isPlainRecord(value)
  && typeof value.summary === 'string'
  && isPlainRecord(value.data)
  && (value.guidance === undefined || typeof value.guidance === 'string')
  && (value.defaultData === undefined || isPlainRecord(value.defaultData))
  && (value.examples === undefined || (Array.isArray(value.examples) && value.examples.every(isPlainRecord)))
  && ['summaryFields', 'fillMissing', 'inputFields', 'findFields', 'viewState'].every(key => value[key] === undefined || isStringArray(value[key]))
  && (value.guardedFields === undefined || (isPlainRecord(value.guardedFields) && Object.values(value.guardedFields).every(command => typeof command === 'string')))
  && (value.actions === undefined || (Array.isArray(value.actions) && value.actions.every(isAction)));

const isInlineDescription = (value: unknown): value is InlineToolDescription => {
  if (!isPlainRecord(value) || typeof value.summary !== 'string' || !isPlainRecord(value.effect)) {
    return false;
  }

  const effect = value.effect;

  return effect.clears === 'marks'
    || (isPlainRecord(effect.value) && (typeof effect.mark === 'string' || typeof effect.embed === 'string' || isStringArray(effect.marks)));
};

const isTuneDescription = (value: unknown): value is BlockTuneDescription =>
  isPlainRecord(value) && typeof value.summary === 'string' && (value.data === null || isPlainRecord(value.data));

const acceptDescription = <T>(
  name: string,
  candidate: unknown,
  isDescription: (value: unknown) => value is T,
  warn: (message: string) => void
): T | null => {
  if (candidate === null || candidate === undefined) {
    return null;
  }

  try {
    const serialized: unknown = isDescription(candidate) && isJsonValue(candidate)
      ? JSON.parse(JSON.stringify(candidate))
      : undefined;

    if (isDescription(serialized) && deepEqual(serialized, candidate)) {
      return serialized;
    }
  } catch {
    // A third-party getter or JSON conversion can throw.
  }

  warn(`Tool "${name}": describe() did not return a JSON tool description; it is listed as structural.`);

  return null;
};

const isReserved = (name: string): boolean => RESERVED_NAMESPACES.some(reserved => reserved === name);

const actionsFor = (
  block: SnapshotBlock,
  description: BlockToolDescription | null,
  hiddenActions: ReadonlySet<string>
): ManifestAction[] => (description?.actions ?? [])
  .filter(action => !hiddenActions.has(action.name))
  .map(action => {
    const command: ToolCommandName = `${block.name}.${action.name}`;

    return {
      ...action,
      command,
      // Runner runtime and services belong to buildAgentContract.
      available: block.handlers.includes(action.name),
    };
  });

const blockEntry = (
  block: SnapshotBlock,
  visibleBlocks: SnapshotBlock[],
  overrides: ManifestOverrides,
  warn: (message: string) => void
): BlockToolManifestEntry => {
  const description = acceptDescription(block.name, block.description, isBlockDescription, warn);
  const override = ownEntry(overrides, block.name);
  const { statics } = block;
  const guidance = [description?.guidance, override?.guidance].filter((text): text is string => typeof text === 'string' && text !== '');
  const reserved = isReserved(block.name);
  const assetKind = statics.assetKind;
  const data = description?.data ?? structuralDataSchema(statics.richTextFields);

  return {
    name: block.name,
    title: block.title,
    summary: description?.summary ?? statics.toolbox[0]?.previewCaption ?? `Custom block ${block.name}`,
    ...(guidance.length > 0 ? { guidance: guidance.join('\n\n') } : {}),
    level: description === null ? 'structural' : 'described',
    // An annotation (a comment thread) is written by people in the editor, never inserted by an agent.
    insertable: block.insertable && statics.isAnnotation !== true,
    variants: statics.toolbox.map(entry => ({
      name: entry.name, title: entry.title,
      data: Object.fromEntries(Object.entries(entry.data ?? {}).filter(([key]) => acceptsField(data, key))),
    })),
    data,
    ...(description?.defaultData === undefined ? {} : { defaultData: description.defaultData }),
    ...(description?.examples === undefined ? {} : { examples: description.examples }),
    richTextFields: statics.richTextFields,
    viewState: description?.viewState ?? [],
    guardedFields: description?.guardedFields ?? {},
    children: {
      accepts: statics.acceptsChildren,
      ...(statics.childTools?.allow === undefined ? {} : { allow: statics.childTools.allow }),
      ...(statics.childTools?.deny === undefined ? {} : { deny: statics.childTools.deny }),
      ownedByTool: statics.ownsChildren,
      layout: statics.isLayout,
      deletedWithParent: statics.deletesChildren,
      ...(statics.isAnnotation === true ? { annotation: true } : {}),
    },
    selfPlacesChildren: statics.selfPlacesChildren,
    restrictedInTableCell: statics.restrictedInTableCell,
    ...(description?.summaryFields === undefined ? {} : { summaryFields: description.summaryFields }),
    ...(description?.fillMissing === undefined ? {} : { fillMissing: description.fillMissing }),
    ...(description?.inputFields === undefined ? {} : { inputFields: description.inputFields }),
    ...(description?.findFields === undefined ? {} : { findFields: description.findFields }),
    convertsTo: statics.convertible.export
      ? visibleBlocks
        .filter(other => other.name !== block.name && other.statics.convertible.import && other.statics.toolbox.length > 0)
        .map(other => other.name)
      : [],
    conversion: statics.conversion,
    ...(assetKind === 'image' || assetKind === 'video' || assetKind === 'audio' || assetKind === 'file' ? { assetKind } : {}),
    ...(statics.hasPrepareInsert
      ? { insertRequires: [block.name === 'page' && description !== null ? 'pageBackend' : 'host'] }
      : {}),
    inlineTools: block.inlineTools,
    tunes: block.tunes,
    actions: reserved ? [] : actionsFor(block, description, new Set(override?.hiddenActions ?? [])),
    ...(reserved ? { actionsWithheld: 'reserved-namespace' } : {}),
  };
};

/**
 * Tags the segment reader turns into built-in marks or opaque embeds (OPAQUE_TAGS), so a `tag:` mark
 * on them would not survive a save.
 */
const NOT_A_TAG_MARK = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'del', 'strike', 'code', 'sup', 'sub', 'a', 'mark', 'br', ...OPAQUE_TAGS]);

/**
 * A `tag:` mark's attributes: the ones the tool's rule names. Others stay allowed here, because a read
 * can return them and writing that text back must not fail; the sanitizer drops them.
 */
const tagMarkValue = (rule: CustomInlineSanitizeRule | undefined): BlokSchema => (isRecord(rule)
  ? {
    type: 'object',
    additionalProperties: { type: 'string' },
    properties: Object.fromEntries(Object.entries(rule).flatMap(([attribute, allowed]): Array<[string, BlokSchema]> => {
      if (allowed === false) {
        return [];
      }

      return [[attribute, typeof allowed === 'string' ? { const: allowed } : { type: 'string' }]];
    })),
  }
  : { type: 'object', additionalProperties: { type: 'string' } });

const inlineEntry = (tool: ToolRegistrySnapshot['inlineTools'][number], warn: (message: string) => void): InlineToolManifestEntry => {
  const base = { name: tool.name, title: tool.title, ...(tool.shortcut === undefined ? {} : { shortcut: tool.shortcut }) };
  const description = acceptDescription(tool.name, tool.description, isInlineDescription, warn);

  if (description !== null) {
    return { ...base, summary: description.summary, level: 'described', effect: description.effect };
  }

  const [tag] = tool.sanitizeTags;

  return tool.sanitizeTags.length === 1 && tag !== undefined && !NOT_A_TAG_MARK.has(tag)
    ? { ...base, summary: `Custom inline tool ${tool.name}.`, level: 'structural', effect: { mark: `tag:${tag}`, value: tagMarkValue(tool.sanitizeRule) } }
    : { ...base, summary: `Custom inline tool ${tool.name}. Leave its marks as they are.`, level: 'structural' };
};

const tuneEntry = (tune: ToolRegistrySnapshot['tunes'][number], warn: (message: string) => void): TuneManifestEntry => {
  const description = acceptDescription(tune.name, tune.description, isTuneDescription, warn);

  return description === null
    ? { name: tune.name, summary: `Custom tune ${tune.name}`, level: 'structural', data: { type: 'object', additionalProperties: true } }
    : { name: tune.name, summary: description.summary, level: 'described', data: description.data };
};

export const buildToolManifest = (
  snapshot: ToolRegistrySnapshot,
  overrides: ManifestOverrides = {},
  options: ManifestBuildOptions = {}
): BlokToolManifest => {
  const warn = options.onWarning ?? ((): void => undefined);
  const visible = (name: string): boolean => ownEntry(overrides, name)?.hidden !== true;
  const visibleBlocks = snapshot.blocks.filter(block => visible(block.name));
  const blocks = visibleBlocks.map(block => blockEntry(block, visibleBlocks, overrides, warn));
  const inlineTools = snapshot.inlineTools.filter(tool => visible(tool.name)).map(tool => inlineEntry(tool, warn));
  const tunes = snapshot.tunes.filter(tune => visible(tune.name)).map(tune => tuneEntry(tune, warn));
  const body = { blokVersion: snapshot.blokVersion, readOnly: snapshot.readOnly, defaultBlock: snapshot.defaultBlock, blocks, inlineTools, tunes };

  return {
    formatVersion: 1,
    ...body,
    revision: canonicalHash({ body, services: snapshot.services, overrides }),
  };
};

export type CoreCommandTable = Readonly<Record<string, {
  argsSchema: BlokSchema;
  resultSchema?: BlokSchema;
  readOnly: boolean;
  runtime: 'any' | 'editor';
  summary: string;
  guidance?: string;
}>>;

export interface ContractWhere {
  runtime: 'editor' | 'node' | 'jint' | 'node-live' | 'csharp-live';
  services: HostService[];
  /** Block types a headless host prepares itself, as blok-mcp creates a page's document. */
  prepares?: readonly string[];
}

export const BLOCK_POSITION_SCHEMA: BlokSchema = {
  description: 'Where the new block goes among its siblings. Default: the end.',
  oneOf: [
    { enum: ['start', 'end'] },
    { type: 'object', required: ['before'], additionalProperties: false, properties: { before: { type: 'string' } } },
    { type: 'object', required: ['after'], additionalProperties: false, properties: { after: { type: 'string' } } },
  ],
};

/**
 * Runtimes whose applier runs a tool's prepareInsert. Only the editor has the tool class; a headless
 * runtime inserts such a type only when its host prepares it (ContractWhere.prepares).
 * Keep in step with AgentApplier.prepareInsert (src/shared/agent/executor.ts).
 */
export const PREPARES_INSERT: Readonly<Record<ContractWhere['runtime'], boolean>> = {
  editor: true, node: false, jint: false, 'node-live': false, 'csharp-live': false,
};

const insertableHere = (
  block: BlockToolManifestEntry,
  where: ContractWhere
): Pick<BlockToolManifestEntry, 'insertable' | 'insertUnavailableReason'> => (
  block.insertable && (block.insertRequires?.length ?? 0) > 0
    && !PREPARES_INSERT[where.runtime] && where.prepares?.includes(block.name) !== true
    ? { insertable: false, insertUnavailableReason: 'runtime' }
    : { insertable: block.insertable }
);

// Jint calls and live rooms have no session-local undo history.
const UNDO_COMMANDS = new Set(['history.undo', 'history.redo']);
const UNDO_RUNNERS = new Set<ContractWhere['runtime']>(['editor', 'node']);

const isToolCommandName = (name: string): name is ToolCommandName => name.includes('.');

const withTarget = (action: ManifestAction): BlokSchema => {
  const properties = isRecord(action.args.properties) ? action.args.properties : {};

  if (action.target === 'block') {
    const required = isStringArray(action.args.required) ? action.args.required : [];

    return {
      ...action.args,
      properties: { ...properties, id: { type: 'string', description: 'Id of the block to act on.' } },
      required: ['id', ...required.filter(name => name !== 'id')],
    };
  }

  return {
    ...action.args,
    properties: {
      ...properties,
      parentId: { type: ['string', 'null'], description: 'Parent block id. Omit or null for the document root.' },
      position: BLOCK_POSITION_SCHEMA,
    },
  };
};

const toolAvailability = (
  action: ManifestAction,
  where: ContractWhere
): Pick<CommandEntry, 'available' | 'unavailableReason'> => {
  if (!action.available || (action.runtime === 'editor' && where.runtime !== 'editor')) {
    return { available: false, unavailableReason: 'runtime' };
  }

  if ((action.requires ?? []).some(service => !where.services.includes(service))) {
    return { available: false, unavailableReason: 'service' };
  }

  return { available: true };
};

/** `list {style: "unordered"|"checklist"}` for each of these tools that has variants. */
const variantData = (blocks: BlokToolManifest['blocks']): string[] => blocks.flatMap(block => {
  const values = new Map<string, Set<string>>();

  block.variants.forEach(variant => Object.entries(variant.data).forEach(([key, value]) => {
    values.set(key, (values.get(key) ?? new Set()).add(JSON.stringify(value)));
  }));

  return values.size === 0 ? [] : [`${block.name} {${[...values].map(([key, set]) => `${key}: ${[...set].join('|')}`).join(', ')}}`];
});

/** The tools a command can produce, named first, so a model does not take a tool (toggle) for a variant of another. */
const typeDescription = (blocks: BlokToolManifest['blocks']): string => {
  const variants = variantData(blocks);

  return `A block tool: ${blocks.map(block => block.name).join(', ')}.${variants.length === 0 ? '' : ` A variant sets these data fields; the tool's other required fields still go in data: ${variants.join(', ')}.`}`;
};

const withTypeDescription = (args: BlokSchema, blocks: BlokToolManifest['blocks']): BlokSchema => {
  const properties = isRecord(args.properties) ? args.properties : {};
  const type = properties.type;

  return blocks.length === 0 || !isRecord(type)
    ? args
    : { ...args, properties: { ...properties, type: { ...type, description: typeDescription(blocks) } } };
};

const typedArgs = (name: string, args: BlokSchema, manifest: BlokToolManifest): BlokSchema => {
  if (name === 'block.insert') {
    return withTypeDescription(args, manifest.blocks.filter(block => block.insertable));
  }
  if (name === 'block.convert') {
    const targets = new Set(manifest.blocks.flatMap(block => block.convertsTo));

    return withTypeDescription(args, manifest.blocks.filter(block => targets.has(block.name)));
  }

  return args;
};

/** The host's `tag:` marks, as properties of the marks schema. */
const customMarkProperties = (manifest: BlokToolManifest): Record<string, BlokSchema> => Object.fromEntries(
  manifest.inlineTools.flatMap((tool): Array<[string, BlokSchema]> => {
    const effect = tool.effect;

    if (effect === undefined || !('mark' in effect) || !effect.mark.startsWith('tag:')) {
      return [];
    }

    return [[effect.mark, { ...effect.value, description: `${tool.title || tool.name}: host tool "${tool.name}", kept only in blocks that enable it.` }]];
  })
);

/** Every rich-text marks schema in a command or block schema, with the host's marks named in it. */
const withCustomMarks = (value: unknown, marks: BlokSchema): unknown => {
  if (Array.isArray(value)) {
    return value.map(item => withCustomMarks(item, marks));
  }
  if (!isRecord(value)) {
    return value;
  }
  if (deepEqual(value, RICH_TEXT_MARKS)) {
    return marks;
  }

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withCustomMarks(item, marks)]));
};

const specializeMarks = (schema: BlokSchema, marks: BlokSchema | null): BlokSchema => {
  if (marks === null) {
    return schema;
  }
  const specialized = withCustomMarks(schema, marks);

  return isRecord(specialized) ? specialized : schema;
};

export const buildAgentContract = (
  given: BlokToolManifest,
  core: CoreCommandTable,
  where: ContractWhere,
  general = RICH_TEXT_PRIMER
): AgentContract => {
  const manifest = { ...given, blocks: given.blocks.map(block => ({ ...block, ...insertableHere(block, where) })) };
  const customMarks = customMarkProperties(manifest);
  const marks: BlokSchema | null = Object.keys(customMarks).length === 0
    ? null
    : { ...RICH_TEXT_MARKS, properties: { ...RICH_TEXT_MARKS.properties, ...customMarks } };
  const coreCommands = Object.entries(core).map<CommandEntry>(([name, command]) => {
    if (!isToolCommandName(name)) {
      throw new Error(`Core command names must contain a dot: ${name}.`);
    }

    const runtimeBlocked = (command.runtime === 'editor' && where.runtime !== 'editor')
      || (UNDO_COMMANDS.has(name) && !UNDO_RUNNERS.has(where.runtime));

    return {
      name,
      summary: command.summary,
      ...(command.guidance === undefined ? {} : { guidance: command.guidance }),
      args: specializeMarks(typedArgs(name, command.argsSchema, manifest), marks),
      ...(command.resultSchema === undefined ? {} : { result: command.resultSchema }),
      readOnly: command.readOnly,
      runtime: command.runtime,
      source: 'core',
      available: !runtimeBlocked,
      ...(runtimeBlocked ? { unavailableReason: 'runtime' } : {}),
    };
  });

  const tools = manifest.blocks.map(block => {
    const actions = block.actions.map(action => {
      const command: CommandEntry = {
        name: action.command,
        summary: action.summary,
        ...(action.guidance === undefined ? {} : { guidance: action.guidance }),
        args: specializeMarks(withTarget(action), marks),
        ...(action.result === undefined ? {} : { result: action.result }),
        readOnly: false,
        runtime: action.runtime ?? 'any',
        source: { tool: block.name, target: action.target },
        ...(action.requires === undefined ? {} : { requires: action.requires }),
        ...(action.effects === undefined ? {} : { effects: action.effects }),
        ...toolAvailability(action, where),
      };

      return { manifest: { ...action, available: command.available }, command };
    });

    return {
      manifest: { ...block, data: specializeMarks(block.data, marks), actions: actions.map(action => action.manifest) },
      commands: actions.map(action => action.command),
    };
  });

  const commandGuidance: Array<[string, string]> = [
    ...coreCommands.flatMap<[string, string]>(command => (
      command.guidance === undefined || command.guidance === '' ? [] : [[command.name, command.guidance]]
    )),
    ...manifest.blocks.flatMap(block => block.actions).flatMap<[string, string]>(action => {
      const lines = [action.guidance, ...(action.preconditions ?? []).map(line => `- ${line}`)]
        .filter((line): line is string => typeof line === 'string' && line !== '');

      return lines.length === 0 ? [] : [[action.command, lines.join('\n')]];
    }),
  ];

  return {
    formatVersion: 1,
    revision: canonicalHash({ manifest: manifest.revision, core, where, general }),
    commands: [...coreCommands, ...tools.flatMap(tool => tool.commands)]
      .sort((a, b) => {
        if (a.name === b.name) {
          return 0;
        }

        return a.name < b.name ? -1 : 1;
      }),
    manifest: { ...manifest, blocks: tools.map(tool => tool.manifest) },
    guidance: {
      general,
      commands: Object.fromEntries(commandGuidance),
      tools: Object.fromEntries(manifest.blocks.flatMap<[string, string]>(block => (
        block.guidance === undefined ? [] : [[block.name, block.guidance]]
      ))),
    },
  };
};

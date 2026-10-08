import type {
  AgentContract,
  BlockToolDescription,
  BlockToolManifestEntry,
  BlockTuneDescription,
  BlokSchema,
  BlokToolManifest,
  CommandEntry,
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
import { ownEntry } from './own-entry';
import { richText } from './tool-descriptions/rich-text';

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
  && ['summaryFields', 'inputFields', 'viewState'].every(key => value[key] === undefined || isStringArray(value[key]))
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
      // Runner services and read-only rules belong to buildAgentContract.
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

  return {
    name: block.name,
    title: block.title,
    summary: description?.summary ?? statics.toolbox[0]?.previewCaption ?? `Custom block ${block.name}`,
    ...(guidance.length > 0 ? { guidance: guidance.join('\n\n') } : {}),
    level: description === null ? 'structural' : 'described',
    insertable: block.insertable,
    variants: statics.toolbox.map(entry => ({ name: entry.name, title: entry.title, data: entry.data ?? {} })),
    data: description?.data ?? structuralDataSchema(statics.richTextFields),
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
    },
    selfPlacesChildren: statics.selfPlacesChildren,
    restrictedInTableCell: statics.restrictedInTableCell,
    ...(description?.summaryFields === undefined ? {} : { summaryFields: description.summaryFields }),
    ...(description?.inputFields === undefined ? {} : { inputFields: description.inputFields }),
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

const inlineEntry = (tool: ToolRegistrySnapshot['inlineTools'][number], warn: (message: string) => void): InlineToolManifestEntry => {
  const base = { name: tool.name, title: tool.title, ...(tool.shortcut === undefined ? {} : { shortcut: tool.shortcut }) };
  const description = acceptDescription(tool.name, tool.description, isInlineDescription, warn);

  if (description !== null) {
    return { ...base, summary: description.summary, level: 'described', effect: description.effect };
  }

  const [tag] = tool.sanitizeTags;

  return tool.sanitizeTags.length === 1 && tag !== undefined
    ? { ...base, summary: `Custom inline tool ${tool.name}.`, level: 'structural', effect: { mark: `tag:${tag}`, value: { type: 'object', additionalProperties: { type: 'string' } } } }
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
}

export const BLOCK_POSITION_SCHEMA: BlokSchema = {
  description: 'Where the new block goes among its siblings. Default: the end.',
  oneOf: [
    { enum: ['start', 'end'] },
    { type: 'object', required: ['before'], additionalProperties: false, properties: { before: { type: 'string' } } },
    { type: 'object', required: ['after'], additionalProperties: false, properties: { after: { type: 'string' } } },
  ],
};

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
  readOnly: boolean,
  where: ContractWhere
): Pick<CommandEntry, 'available' | 'unavailableReason'> => {
  if (readOnly) {
    return { available: false };
  }

  if (!action.available || (action.runtime === 'editor' && where.runtime !== 'editor')) {
    return { available: false, unavailableReason: 'runtime' };
  }

  if ((action.requires ?? []).some(service => !where.services.includes(service))) {
    return { available: false, unavailableReason: 'service' };
  }

  return { available: true };
};

export const buildAgentContract = (
  manifest: BlokToolManifest,
  core: CoreCommandTable,
  where: ContractWhere,
  general = ''
): AgentContract => {
  const coreCommands = Object.entries(core).map<CommandEntry>(([name, command]) => {
    if (!isToolCommandName(name)) {
      throw new Error(`Core command names must contain a dot: ${name}.`);
    }

    const readOnlyBlocked = manifest.readOnly && !command.readOnly;
    const runtimeBlocked = (command.runtime === 'editor' && where.runtime !== 'editor')
      || (UNDO_COMMANDS.has(name) && !UNDO_RUNNERS.has(where.runtime));

    return {
      name,
      summary: command.summary,
      ...(command.guidance === undefined ? {} : { guidance: command.guidance }),
      args: command.argsSchema,
      ...(command.resultSchema === undefined ? {} : { result: command.resultSchema }),
      readOnly: command.readOnly,
      runtime: command.runtime,
      source: 'core',
      available: !readOnlyBlocked && !runtimeBlocked,
      ...(runtimeBlocked && !readOnlyBlocked ? { unavailableReason: 'runtime' } : {}),
    };
  });

  const tools = manifest.blocks.map(block => {
    const actions = block.actions.map(action => {
      const command: CommandEntry = {
        name: action.command,
        summary: action.summary,
        ...(action.guidance === undefined ? {} : { guidance: action.guidance }),
        args: withTarget(action),
        ...(action.result === undefined ? {} : { result: action.result }),
        readOnly: false,
        runtime: action.runtime ?? 'any',
        source: { tool: block.name, target: action.target },
        ...(action.requires === undefined ? {} : { requires: action.requires }),
        ...(action.effects === undefined ? {} : { effects: action.effects }),
        ...toolAvailability(action, manifest.readOnly, where),
      };

      return { manifest: { ...action, available: command.available }, command };
    });

    return {
      manifest: { ...block, actions: actions.map(action => action.manifest) },
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

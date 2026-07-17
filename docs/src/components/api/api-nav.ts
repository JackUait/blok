// docs/src/components/api/api-nav.ts

export const SIDEBAR_GROUPS: ReadonlyArray<{ key: string; moduleIds: string[] }> = [
  { key: 'gettingStarted', moduleIds: ['quick-start', 'tutorial', 'concepts', 'custom-block-tool'] },
  { key: 'core', moduleIds: ['core', 'config', 'blocks-api', 'block-api', 'saver-api'] },
  { key: 'editing', moduleIds: ['caret-api', 'selection-api', 'styles-api', 'history-api'] },
  { key: 'interface', moduleIds: ['toolbar-api', 'inline-toolbar-api', 'ui-api', 'notifier-api', 'tooltip-api'] },
  { key: 'extending', moduleIds: ['tools-api', 'events-api', 'listeners-api', 'sanitizer-api', 'readonly-api', 'i18n-api'] },
  { key: 'dataTypes', moduleIds: ['output-data', 'block-data'] },
  { key: 'adapters', moduleIds: ['blok-editor', 'use-blocks'] },
];

export const MODULE_ORDER: string[] = SIDEBAR_GROUPS.flatMap((g) => g.moduleIds);

export const GROUP_TITLES_EN: Record<string, string> = {
  gettingStarted: 'Getting started',
  core: 'Core',
  editing: 'Editing',
  interface: 'Interface',
  extending: 'Extending & system',
  dataTypes: 'Data types',
  adapters: 'Framework adapters',
};

export const MODULE_LABELS_EN: Record<string, string> = {
  'quick-start': 'Quick Start',
  tutorial: 'Build your first editor',
  concepts: 'Everything is a block',
  'custom-block-tool': 'Create a custom block tool',
  core: 'Blok Class',
  config: 'Configuration',
  'blocks-api': 'Blocks',
  'block-api': 'BlockAPI',
  'caret-api': 'Caret',
  'selection-api': 'Selection',
  'styles-api': 'Styles',
  'history-api': 'History',
  'toolbar-api': 'Toolbar',
  'inline-toolbar-api': 'InlineToolbar',
  'ui-api': 'UI',
  'notifier-api': 'Notifier',
  'tooltip-api': 'Tooltip',
  'tools-api': 'Tools',
  'events-api': 'Events',
  'listeners-api': 'Listeners',
  'sanitizer-api': 'Sanitizer',
  'readonly-api': 'ReadOnly',
  'i18n-api': 'I18n',
  'saver-api': 'Saver',
  'output-data': 'OutputData',
  'block-data': 'BlockData',
  'blok-editor': 'BlokEditor component',
  'use-blocks': 'useBlocks',
};

/**
 * Map a legacy single-page hash (e.g. "config-holder", "caret-api-focus", "caret-api")
 * to its owning module + the in-page anchor to scroll to. Uses longest matching
 * section-id prefix so multi-word ids like "caret-api" win over "core".
 *
 * Uses MODULE_ORDER (the flat ordered list of all known section IDs) rather than
 * importing API_SECTIONS from api-data.ts, which avoids a circular-module
 * evaluation cycle (api-data.ts imports SIDEBAR_GROUPS etc. from this file).
 * The test asserts MODULE_ORDER and API_SECTIONS cover the same IDs, so the
 * resolver is complete.
 */
export const resolveLegacyHash = (hash: string): { moduleId: string; anchor?: string } | null => {
  if (MODULE_ORDER.includes(hash)) {
    return { moduleId: hash, anchor: undefined };
  }
  const owner = MODULE_ORDER
    .filter((id) => hash.startsWith(`${id}-`))
    .sort((a, b) => b.length - a.length)[0];
  if (owner) {
    return { moduleId: owner, anchor: hash };
  }
  return null;
};

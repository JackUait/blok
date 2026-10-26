import { INLINE_TOOL_ORDER } from '../inline-tool-order';
import { BUILT_IN_BLOCK_SANITIZE } from '../tool-descriptions/sanitize/blocks';
import { BUILT_IN_INLINE_SANITIZE } from '../tool-descriptions/sanitize/inline';
import { COLUMN_DEFAULT_CHILDREN, COLUMN_LIST_ACTION_HANDLERS, COLUMN_LIST_DEFAULT_CHILDREN } from './columns';
import { DATABASE_ACTION_HANDLERS, DATABASE_CHILD_COMMAND, rejectDatabaseWrite } from './database';
import { DATABASE_COMMENT_HANDLERS } from './database-comments';
import { IMAGE_ACTION_HANDLERS } from './image';
import {
  CALLOUT_CLEARED, CALLOUT_LOAD_DEFAULTS, CODE_CLEARED, LIST_CLEARED, normalizeCallout, normalizeCode, normalizeDatabase, normalizeList, normalizeQuote,
  QUOTE_CLEARED, SPACER_CLEARED,
} from './load-defaults';
import { LINK_ACTION_HANDLERS, normalizeEmbed, rejectBookmarkWrite, rejectEmbedWrite } from './link';
import { MEDIA_ACTION_HANDLERS, MEDIA_REJECT_WRITE } from './media';
import { PAGE_ACTION_HANDLERS } from './page';
import { buildToolRuntimes } from './runtime';
import { normalizeTable, TABLE_ACTION_HANDLERS } from './table';
import { TABS_ACTION_HANDLERS, TABS_DEFAULT_CHILDREN } from './tabs';

import type { RuntimeBlockInput, ToolRuntimeRegistry } from './runtime';

export const BUILT_IN_RUNTIME_PARTS: Readonly<Record<string, Pick<RuntimeBlockInput, 'normalize' | 'cleared' | 'rejectWrite' | 'defaultChildren' | 'actions' | 'conversion' | 'childCommand'>>> = {
  table: { normalize: (data) => normalizeTable(data), actions: TABLE_ACTION_HANDLERS },
  // conversion.base: LOCKSTEP with CalloutTool.conversionConfig.import, so a callout made by a turn-into starts uncoloured.
  callout: {
    normalize: normalizeCallout,
    cleared: CALLOUT_CLEARED,
    defaultChildren: [{ type: 'paragraph', data: { text: [] } }],
    conversion: { base: CALLOUT_LOAD_DEFAULTS },
  },
  // The header saves isToggleable only when true (normalizeData in src/tools/header/index.ts).
  header: { normalize: ({ isToggleable, ...data }) => (isToggleable === true ? { ...data, isToggleable } : data) },
  column_list: { defaultChildren: COLUMN_LIST_DEFAULT_CHILDREN, actions: COLUMN_LIST_ACTION_HANDLERS },
  column: { defaultChildren: COLUMN_DEFAULT_CHILDREN },
  page: { actions: PAGE_ACTION_HANDLERS },
  tabs: { defaultChildren: TABS_DEFAULT_CHILDREN, actions: TABS_ACTION_HANDLERS },
  image: { rejectWrite: MEDIA_REJECT_WRITE.image, actions: { ...MEDIA_ACTION_HANDLERS.image, ...IMAGE_ACTION_HANDLERS } },
  video: { rejectWrite: MEDIA_REJECT_WRITE.video, actions: MEDIA_ACTION_HANDLERS.video },
  audio: { rejectWrite: MEDIA_REJECT_WRITE.audio, actions: MEDIA_ACTION_HANDLERS.audio },
  file: { rejectWrite: MEDIA_REJECT_WRITE.file, actions: MEDIA_ACTION_HANDLERS.file },
  embed: { normalize: normalizeEmbed, rejectWrite: rejectEmbedWrite, actions: LINK_ACTION_HANDLERS.embed },
  bookmark: { rejectWrite: rejectBookmarkWrite, actions: LINK_ACTION_HANDLERS.bookmark },
  database: { normalize: normalizeDatabase, rejectWrite: rejectDatabaseWrite, actions: { ...DATABASE_ACTION_HANDLERS, ...DATABASE_COMMENT_HANDLERS }, childCommand: DATABASE_CHILD_COMMAND },
  code: { normalize: normalizeCode, cleared: CODE_CLEARED },
  quote: { normalize: normalizeQuote, cleared: QUOTE_CLEARED },
  spacer: { cleared: SPACER_CLEARED },
  // The list's conversionConfig is functions (they carry a to-do's checked state in the editor).
  // Its text field is `text` both ways, which is what those functions read and write.
  list: { normalize: normalizeList, cleared: LIST_CLEARED, conversion: { export: 'text', import: 'text' } },
};

// convertTo and the internal tunes contribute no rules. Code opts out in defaultBlockTools.
export const BUILT_IN_TOOL_RUNTIMES: ToolRuntimeRegistry = buildToolRuntimes(
  Object.entries(BUILT_IN_BLOCK_SANITIZE).map(([name, own]) => ({
    name,
    ownSanitize: own(),
    inlineSanitize: name === 'code' ? [] : INLINE_TOOL_ORDER.flatMap((inlineName) => {
      const factory = BUILT_IN_INLINE_SANITIZE[inlineName];

      return factory === undefined ? [] : [factory()];
    }),
    ...BUILT_IN_RUNTIME_PARTS[name],
  }))
);

export { cleanupEmptiedColumnList } from './columns';
export { buildToolRuntimes } from './runtime';
export type { ToolRuntime, ToolRuntimeRegistry, RuntimeBlockInput } from './runtime';

import { INLINE_TOOL_ORDER } from '../inline-tool-order';
import { BUILT_IN_BLOCK_SANITIZE } from '../tool-descriptions/sanitize/blocks';
import { BUILT_IN_INLINE_SANITIZE } from '../tool-descriptions/sanitize/inline';
import { COLUMN_DEFAULT_CHILDREN, COLUMN_LIST_ACTION_HANDLERS, COLUMN_LIST_DEFAULT_CHILDREN } from './columns';
import { DATABASE_ACTION_HANDLERS } from './database';
import { IMAGE_ACTION_HANDLERS } from './image';
import { LINK_ACTION_HANDLERS } from './link';
import { MEDIA_ACTION_HANDLERS } from './media';
import { PAGE_ACTION_HANDLERS } from './page';
import { buildToolRuntimes } from './runtime';
import { normalizeTable, TABLE_ACTION_HANDLERS } from './table';
import { TABS_ACTION_HANDLERS, TABS_DEFAULT_CHILDREN } from './tabs';

import type { RuntimeBlockInput, ToolRuntimeRegistry } from './runtime';

export const BUILT_IN_RUNTIME_PARTS: Readonly<Record<string, Pick<RuntimeBlockInput, 'normalize' | 'defaultChildren' | 'actions' | 'conversion'>>> = {
  table: { normalize: (data) => normalizeTable(data), actions: TABLE_ACTION_HANDLERS },
  callout: { defaultChildren: [{ type: 'paragraph', data: { text: [] } }] },
  column_list: { defaultChildren: COLUMN_LIST_DEFAULT_CHILDREN, actions: COLUMN_LIST_ACTION_HANDLERS },
  column: { defaultChildren: COLUMN_DEFAULT_CHILDREN },
  page: { actions: PAGE_ACTION_HANDLERS },
  tabs: { defaultChildren: TABS_DEFAULT_CHILDREN, actions: TABS_ACTION_HANDLERS },
  image: { actions: { ...MEDIA_ACTION_HANDLERS.image, ...IMAGE_ACTION_HANDLERS } },
  video: { actions: MEDIA_ACTION_HANDLERS.video },
  audio: { actions: MEDIA_ACTION_HANDLERS.audio },
  file: { actions: MEDIA_ACTION_HANDLERS.file },
  embed: { actions: LINK_ACTION_HANDLERS.embed },
  bookmark: { actions: LINK_ACTION_HANDLERS.bookmark },
  database: { actions: DATABASE_ACTION_HANDLERS },
  // The list's conversionConfig is functions (they carry a to-do's checked state in the editor).
  // Its text field is `text` both ways, which is what those functions read and write.
  list: { conversion: { export: 'text', import: 'text' } },
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

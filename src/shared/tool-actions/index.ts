import { INLINE_TOOL_ORDER } from '../inline-tool-order';
import { BUILT_IN_BLOCK_SANITIZE } from '../tool-descriptions/sanitize/blocks';
import { BUILT_IN_INLINE_SANITIZE } from '../tool-descriptions/sanitize/inline';
import { buildToolRuntimes } from './runtime';
import { normalizeTable } from './table';

import type { RuntimeBlockInput, ToolRuntimeRegistry } from './runtime';

export const BUILT_IN_RUNTIME_PARTS: Readonly<Record<string, Pick<RuntimeBlockInput, 'normalize' | 'defaultChildren' | 'actions'>>> = {
  table: { normalize: (data) => normalizeTable(data) },
  callout: { defaultChildren: [{ type: 'paragraph', data: { text: [] } }] },
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

export { buildToolRuntimes } from './runtime';
export type { ToolRuntime, ToolRuntimeRegistry, RuntimeBlockInput } from './runtime';

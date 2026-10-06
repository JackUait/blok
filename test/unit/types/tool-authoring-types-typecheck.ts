/**
 * Type-level tests for the custom-block-authoring surface.
 * Run with: tsc --noEmit --strict test/unit/types/tool-authoring-types-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile.
 *
 * A third party authoring a custom block tool implements the `BlockTool`
 * contract, whose `renderSettings()` may return a `MenuConfig` and whose
 * `moved(event)` hook receives a `MoveEvent`. Both names are referenced by the
 * contract, so authors must be able to import them from the package root to
 * annotate their own helpers and variables. These imports must resolve.
 */

import type { MenuConfig, MoveEvent, BlockTool } from '../../../types';

// MenuConfig must be importable and usable to type a renderSettings() result.
const _settings: MenuConfig = [
  {
    icon: '<svg></svg>',
    title: 'Toggle',
    onActivate: (): void => {},
  },
];

// MoveEvent must be importable and usable to type a moved() handler argument.
const _onMoved = (event: MoveEvent): void => {
  event.fromIndex;
  event.toIndex;
};

// The names must be exactly the types the BlockTool contract references, so a
// custom tool can annotate its own implementation with the imported names.
const _tool: Pick<BlockTool, 'renderSettings' | 'moved'> = {
  renderSettings(): MenuConfig {
    return _settings;
  },
  moved(event: MoveEvent): void {
    _onMoved(event);
  },
};

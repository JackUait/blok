import { adoptsSectionOnConvert, endsSection, isToggleHeadingData, releasesChildrenOnConvert, textLivesInFirstChild } from '../turn-into';

import type { PlanState } from './plan-state';
import type { SnapBlock } from './snapshot';
import type { PlannerTool } from './types';

/** The turn-into rules of src/shared/turn-into.ts, as plan edits. The editor's convert gets the result and only swaps the tool. */

// The runtime copy covers tools whose own conversionConfig is functions (list), which the manifest cannot carry.
const exportField = (tool: PlannerTool): string | undefined => tool.entry.conversion.export ?? tool.runtime.conversion?.export;
const importField = (tool: PlannerTool): string | undefined => tool.entry.conversion.import ?? tool.runtime.conversion?.import;

export interface ConvertShape {
  /** The block the text is read from: the block itself, or a callout's first line. */
  textFrom: { block: SnapBlock; tool: PlannerTool; field: string | undefined };
  /** The block the text goes to: the target, or the first line a callout seeds. */
  textTo: { tool: PlannerTool | undefined; field: string | undefined; seedType?: string };
  firstLineId?: string;
  /** Read before the swap: the draft block takes the target's type in place. */
  sourceIsToggle: boolean;
  released: string[];
  kept: string[];
}

export const convertShape = (
  state: PlanState,
  block: SnapBlock,
  source: PlannerTool,
  targetType: string,
  target: PlannerTool,
  overrides: Readonly<Record<string, unknown>>
): ConvertShape => {
  const firstChild = textLivesInFirstChild(block.type) && block.content[0] !== undefined ? state.draft.get(block.content[0]) : undefined;
  const lineTool = firstChild === undefined ? undefined : state.tool(firstChild.type);
  const lineField = lineTool === undefined ? undefined : exportField(lineTool);
  // Same gate as the editor's readFirstLine: a line with lines of its own gives no text.
  const firstLine = firstChild !== undefined && lineTool !== undefined && firstChild.content.length === 0 && typeof lineField === 'string'
    ? { block: firstChild, tool: lineTool, field: lineField }
    : undefined;
  const seedType = textLivesInFirstChild(targetType) ? state.ctx.defaultBlock : undefined;
  const seedTool = seedType === undefined ? undefined : state.tool(seedType);
  const rest = block.content.filter(id => id !== firstLine?.block.id);
  const releases = releasesChildrenOnConvert({ type: block.type, isToggleHeading: isToggleHeadingData(block.type, block.data) }, targetType, overrides);

  return {
    textFrom: firstLine ?? { block, tool: source, field: textLivesInFirstChild(block.type) ? undefined : exportField(source) },
    textTo: seedType === undefined
      ? { tool: target, field: importField(target) }
      : { tool: seedTool, field: seedTool === undefined ? undefined : importField(seedTool), seedType },
    ...(firstLine !== undefined && { firstLineId: firstLine.block.id }),
    sourceIsToggle: block.type === 'toggle' || isToggleHeadingData(block.type, block.data),
    released: releases ? rest : [],
    kept: releases ? [] : rest,
  };
};

/** A callout always has a way to give text (maybe none) and to take it (a seeded line). */
export const convertMissing = (block: SnapBlock, targetType: string, shape: ConvertShape): string[] => [
  !textLivesInFirstChild(block.type) && typeof shape.textFrom.field !== 'string' ? block.type : null,
  typeof shape.textTo.field !== 'string' ? targetType : null,
].filter((type): type is string => type !== null);

/** Before the swap: drop the hoisted first line, then move the released children after the block, in order. */
export const emitBeforeSwap = (state: PlanState, block: SnapBlock, shape: ConvertShape): void => {
  if (shape.firstLineId !== undefined) {
    state.emit({ op: 'remove', id: shape.firstLineId, withChildren: false });
  }
  shape.released.reduce((after, child) => {
    state.emit({ op: 'move', id: child, parentId: block.parent, afterId: after });

    return child;
  }, block.id);
};

const headingLevel = (state: PlanState, block: SnapBlock | undefined): number | null => {
  if (block?.type !== 'header') {
    return null;
  }

  const level = block.data.level ?? state.tool('header')?.entry.defaultData?.level;

  return typeof level === 'number' ? level : null;
};

/** After the swap: a new toggle heading adopts the section that follows it, and a callout gets its first line. */
export const emitAfterSwap = (
  state: PlanState,
  block: SnapBlock,
  shape: ConvertShape,
  targetType: string,
  overrides: Readonly<Record<string, unknown>>,
  seed: { type: string; data: Record<string, unknown> } | undefined
): void => {
  const level = headingLevel(state, state.draft.get(block.id));

  // A table cell is not a section: its siblings are the other cells' blocks.
  if (level !== null && state.draft.cellOf(block.id) === null && adoptsSectionOnConvert(shape.sourceIsToggle, targetType, overrides)) {
    const siblings = state.draft.childrenOf(block.parent);
    const following = siblings.slice(siblings.indexOf(block.id) + 1);
    const end = following.findIndex(id => endsSection(headingLevel(state, state.draft.get(id)), level));
    const adopted = end === -1 ? following : following.slice(0, end);

    adopted.reduce<string | null>((after, id) => {
      state.emit({ op: 'move', id, parentId: block.id, afterId: after });

      return id;
    }, state.draft.childrenOf(block.id).at(-1) ?? null);
  }

  if (seed !== undefined) {
    const id = state.newBlockId(undefined, '/type');
    const data = state.prepareData(seed.type, seed.data, '/data', id, { stored: Object.keys(seed.data) });

    state.emit({ op: 'insert', block: { id, type: seed.type, data, children: [] }, parentId: block.id, afterId: null });
  }
};

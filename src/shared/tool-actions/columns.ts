import type { InsertSpec } from '../../../types/agent';
import type { BlockPosition } from '../../../types/api/blocks';
import type { ToolActionContext, ToolActionImpl } from '../../../types/tools/tool-description';

const COLUMN = 'column';
const EMPTY_PARAGRAPH: InsertSpec = { type: 'paragraph', data: { text: [] } };

export const COLUMN_DEFAULT_CHILDREN: InsertSpec[] = [EMPTY_PARAGRAPH];
export const COLUMN_LIST_DEFAULT_CHILDREN: InsertSpec[] = [
  { type: COLUMN, data: {}, children: [EMPTY_PARAGRAPH] },
  { type: COLUMN, data: {}, children: [EMPTY_PARAGRAPH] },
];

type ReadBlock = NonNullable<ReturnType<ToolActionContext['read']>>;

const target = (ctx: ToolActionContext): NonNullable<ToolActionContext['block']> =>
  ctx.block ?? ctx.fail('INVALID_ARGS', 'Pass the id of a column_list block.');

const readFrom = (ctx: ToolActionContext, ids: string[]): ReadBlock[] => {
  const selected = new Set<string>();

  return ids.map(id => {
    if (selected.has(id)) {
      ctx.fail('INVALID_ARGS', `Block ${id} is listed more than once.`);
    }
    selected.add(id);

    return ctx.read(id) ?? ctx.fail('PRECONDITION_FAILED', `Block ${id} does not exist.`);
  });
};

const validateRatios = (ctx: ToolActionContext, count: number, ratios: number[] | undefined): void => {
  if (ratios === undefined) {
    return;
  }
  if (ratios.length !== count) {
    ctx.fail('PRECONDITION_FAILED', `Pass one ratio per column: this list has ${count} columns.`);
  }
  if (ratios.some(ratio => !Number.isFinite(ratio) || ratio <= 0)) {
    ctx.fail('INVALID_ARGS', 'Column ratios must be positive numbers.');
  }
};

const writeRatios = (ctx: ToolActionContext, columns: readonly string[], ratios: number[]): void => {
  columns.forEach((column, index) => ctx.update(column, { widthRatio: ratios[index] === 1 ? undefined : ratios[index] }));
};

export const cleanupEmptiedColumnList = (ctx: ToolActionContext, columnListId: string): boolean => {
  const list = ctx.read(columnListId);
  const survivor = list?.children[0];

  if (list === null || list.children.length !== 1 || survivor === undefined) {
    return false;
  }

  // Layout removal deletes children, so move survivors before either wrapper.
  for (const child of ctx.read(survivor)?.children ?? []) {
    ctx.move(child, { parentId: list.parentId, position: { before: columnListId } });
  }
  ctx.remove(survivor);
  ctx.remove(columnListId);

  return true;
};

interface CreateArgs {
  count?: number;
  from?: string[];
  widths?: number[];
  parentId?: string | null;
  position?: BlockPosition;
}

const create: ToolActionImpl<CreateArgs, undefined, { id: string; childIds: string[] }> = {
  run: (ctx, args) => {
    if ((args.count === undefined) === (args.from === undefined)) {
      ctx.fail('INVALID_ARGS', 'Pass either count (2 to 5) or from (two or more block ids).');
    }
    if (args.count !== undefined && (!Number.isInteger(args.count) || args.count < 2 || args.count > 5)) {
      ctx.fail('INVALID_ARGS', 'Pass a column count from 2 to 5.');
    }
    const blocks = readFrom(ctx, args.from ?? []);
    const selected = new Set(blocks.map(block => block.id));
    const roots = blocks.filter(block => {
      const seen = new Set<string>();
      const cursor = { parentId: block.parentId };

      while (cursor.parentId !== null && !seen.has(cursor.parentId)) {
        if (selected.has(cursor.parentId)) {
          return false;
        }
        seen.add(cursor.parentId);
        cursor.parentId = ctx.read(cursor.parentId)?.parentId ?? null;
      }

      return true;
    });
    const first = roots[0];

    if (args.from !== undefined && roots.length < 2) {
      ctx.fail('PRECONDITION_FAILED', 'Select at least two blocks without a selected ancestor.');
    }
    if (first !== undefined && roots.some(block => block.parentId !== first.parentId)) {
      ctx.fail('PRECONDITION_FAILED', 'Selected blocks must have the same parent.');
    }
    const count = args.count ?? roots.length;

    validateRatios(ctx, count, args.widths);
    const id = ctx.insert({
      type: ctx.tool,
      data: {},
      parentId: first === undefined ? args.parentId : first.parentId,
      position: first === undefined ? args.position : { before: first.id },
      children: [],
    });
    const childIds = first === undefined
      ? Array.from({ length: count }, () => ctx.insert({ type: COLUMN, data: {}, parentId: id, children: [EMPTY_PARAGRAPH] }))
      : roots.map(block => {
        const column = ctx.insert({ type: COLUMN, data: {}, parentId: id, children: [] });

        ctx.move(block.id, { parentId: column, position: 'end' });

        return column;
      });

    if (args.widths !== undefined) {
      writeRatios(ctx, childIds, args.widths);
    }

    return { id, childIds };
  },
};

const addColumn: ToolActionImpl<{ at: number; from?: string[] }, undefined, { id: string }> = {
  run: (ctx, args) => {
    const list = target(ctx);
    const blocks = readFrom(ctx, args.from ?? []);
    const before = list.children[args.at];
    const id = ctx.insert({
      type: COLUMN,
      data: {},
      parentId: list.id,
      position: before === undefined ? 'end' : { before },
      children: args.from === undefined ? [EMPTY_PARAGRAPH] : [],
    });

    blocks.forEach(block => ctx.move(block.id, { parentId: id, position: 'end' }));
    [...list.children, id].forEach(column => ctx.update(column, { widthRatio: undefined }));

    return { id };
  },
};

const removeColumn: ToolActionImpl<{ index: number }> = {
  run: (ctx, args) => {
    const list = target(ctx);
    const column = list.children[args.index]
      ?? ctx.fail('PRECONDITION_FAILED', `This list has ${list.children.length} columns; index starts at 0.`);

    ctx.remove(column, { withChildren: true });
    cleanupEmptiedColumnList(ctx, list.id);

    return undefined;
  },
};

const setWidths: ToolActionImpl<{ ratios: number[] }> = {
  run: (ctx, args) => {
    const list = target(ctx);

    validateRatios(ctx, list.children.length, args.ratios);
    writeRatios(ctx, list.children, args.ratios);

    return undefined;
  },
};

export const COLUMN_LIST_ACTION_HANDLERS: Readonly<Record<string, ToolActionImpl>> = {
  create,
  addColumn,
  removeColumn,
  setWidths,
};

import { FULL_RECT, isFullRect, widthForAspectChange } from '../image/crop-math';
import { coverCrop, flipHorizontal, geometryFields, orientedSize, readGeometry, rotateLeft } from '../image/geometry';
import { flipMarkup, MAX_MARKUP_ITEMS, readMarkup, turnMarkupLeft } from '../image/markup-model';

import type { ImageCrop, ImageCropShape, ImageData, ImageMarkup } from '../../../types/tools/image';
import type { ToolActionContext, ToolActionImpl } from '../../../types/tools/tool-description';
import type { Geometry } from '../image/geometry';
import type { Size } from '../image/types';

interface Target {
  id: string;
  data: Partial<ImageData>;
}

const target = (ctx: ToolActionContext): Target => {
  const block = ctx.block ?? ctx.fail('INVALID_ARGS', 'Pass the id of an image block.');

  return { id: block.id, data: block.data };
};

const naturalOf = (data: Partial<ImageData>): Size | null =>
  typeof data.naturalWidth === 'number' && typeof data.naturalHeight === 'number'
    ? { w: data.naturalWidth, h: data.naturalHeight }
    : null;

interface Framing {
  g: Geometry;
  crop: ImageCrop;
}

/**
 * Writes a new turn and crop the way the darkroom's applyCrop does: an explicit width is
 * rescaled so the rendered height stays put, and fields back at their default are removed
 * (geometryFields and the saved shape omit defaults).
 */
const framingPatch = (data: Partial<ImageData>, next: Framing): Record<string, unknown> => {
  const before = readGeometry(data);
  const crop = isFullRect(next.crop) && next.crop.shape === undefined ? undefined : next.crop;
  const n = naturalOf(data);
  const width = data.width === undefined
    ? {}
    : {
      width: n === null
        ? widthForAspectChange(data.width, data.crop, crop)
        : widthForAspectChange(data.width, data.crop, crop, orientedSize(n, before), orientedSize(n, next.g)),
    };

  return { rotation: undefined, flipX: undefined, straighten: undefined, ...geometryFields(next.g), crop, ...width };
};

const markupPatch = (data: Partial<ImageData>, map: (items: ImageMarkup[]) => ImageMarkup[]): Record<string, unknown> =>
  data.markup === undefined ? {} : { markup: map(readMarkup(data.markup)) };

interface CropArgs {
  rect: Omit<ImageCrop, 'shape'>;
  shape?: ImageCropShape;
}

const crop: ToolActionImpl<CropArgs> = {
  run: (ctx, args) => {
    const { id, data } = target(ctx);
    const rect = { x: args.rect.x, y: args.rect.y, w: args.rect.w, h: args.rect.h };

    ctx.update(id, framingPatch(data, {
      g: readGeometry(data),
      crop: args.shape === undefined ? rect : { ...rect, shape: args.shape },
    }));

    return undefined;
  },
};

const rotate: ToolActionImpl<{ turns: 1 | 2 | 3 }> = {
  run: (ctx, args) => {
    const { id, data } = target(ctx);
    // The UI only turns left; one clockwise turn is three left turns.
    const lefts = (4 - args.turns) % 4;
    const turned = Array.from({ length: lefts }).reduce<Framing>(
      state => rotateLeft(state.g, state.crop),
      { g: readGeometry(data), crop: data.crop ?? FULL_RECT }
    );
    const turnMarkup = (items: ImageMarkup[]): ImageMarkup[] =>
      Array.from({ length: lefts }).reduce<ImageMarkup[]>(list => turnMarkupLeft(list), items);

    ctx.update(id, { ...framingPatch(data, turned), ...markupPatch(data, turnMarkup) });

    return undefined;
  },
};

const flip: ToolActionImpl<Record<string, never>> = {
  run: (ctx) => {
    const { id, data } = target(ctx);

    ctx.update(id, {
      ...framingPatch(data, flipHorizontal(readGeometry(data), data.crop ?? FULL_RECT)),
      ...markupPatch(data, flipMarkup),
    });

    return undefined;
  },
};

const straighten: ToolActionImpl<{ degrees: number }> = {
  run: (ctx, args) => {
    const { id, data } = target(ctx);
    const natural = naturalOf(data)
      ?? ctx.fail('PRECONDITION_FAILED', 'Straighten needs naturalWidth and naturalHeight; they are filled once the image has loaded in an editor.');
    const g = readGeometry({ ...data, straighten: args.degrees });

    ctx.update(id, framingPatch(data, { g, crop: coverCrop(data.crop ?? FULL_RECT, orientedSize(natural, g), g.straighten) }));

    return undefined;
  },
};

const noMarkupItem = (ctx: ToolActionContext, markupId: string): never =>
  ctx.fail('PRECONDITION_FAILED', `This image has no markup item ${markupId}.`);

/** Normalizes the list the way the editor loads it; an item the editor would drop fails the action. */
const writeMarkup = (
  ctx: ToolActionContext,
  id: string,
  items: Array<Record<string, unknown>>,
  name: (index: number) => string = index => `Markup item ${index}`,
): void => {
  if (items.length > MAX_MARKUP_ITEMS) {
    ctx.fail('PRECONDITION_FAILED', `An image holds at most ${MAX_MARKUP_ITEMS} markup items.`);
  }
  const read = readMarkup(items);
  const kept = new Set(read.map(item => item.id));
  const dropped = items.findIndex(item => !kept.has(String(item.id)));

  if (dropped !== -1) {
    ctx.fail('INVALID_ARGS', `${name(dropped)} is not valid: check its type, color (#rrggbb), coordinates and size.`);
  }
  ctx.update(id, { markup: read.length === 0 ? undefined : read });
};

const addMarkup: ToolActionImpl<{ items: Array<Record<string, unknown>> }, undefined, { markupIds: string[] }> = {
  run: (ctx, args) => {
    const { id, data } = target(ctx);
    const existing = readMarkup(data.markup);
    const added = args.items.map(item => ({ ...item, id: ctx.newId() }));

    writeMarkup(ctx, id, [...existing, ...added], index => `Markup item ${index - existing.length}`);

    return { markupIds: added.map(item => item.id) };
  },
};

const updateMarkup: ToolActionImpl<{ markupId: string; patch: Record<string, unknown> }> = {
  run: (ctx, args) => {
    if ('id' in args.patch || 'type' in args.patch) {
      ctx.fail('INVALID_ARGS', 'id and type cannot change. Remove the item and add a new one instead.');
    }
    const { id, data } = target(ctx);
    const items = readMarkup(data.markup);

    if (!items.some(item => item.id === args.markupId)) {
      noMarkupItem(ctx, args.markupId);
    }
    writeMarkup(
      ctx, id,
      items.map(item => (item.id === args.markupId ? { ...item, ...args.patch } : { ...item })),
      () => `The patched item ${args.markupId}`,
    );

    return undefined;
  },
};

const removeMarkup: ToolActionImpl<{ markupIds?: string[]; all?: true }> = {
  run: (ctx, args) => {
    const { id, data } = target(ctx);
    const items = readMarkup(data.markup);
    const ids = new Set(args.all === true ? items.map(item => item.id) : args.markupIds ?? []);
    const unknown = [...ids].find(markupId => !items.some(item => item.id === markupId));

    if (unknown !== undefined) {
      noMarkupItem(ctx, unknown);
    }
    writeMarkup(ctx, id, items.filter(item => !ids.has(item.id)).map(item => ({ ...item })));

    return undefined;
  },
};

export const IMAGE_ACTION_HANDLERS = {
  crop, rotate, flip, straighten, addMarkup, updateMarkup, removeMarkup,
} as const;

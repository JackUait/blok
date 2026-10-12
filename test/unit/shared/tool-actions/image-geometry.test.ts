// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { IMAGE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/image';
import { describeImage } from '../../../../src/shared/tool-descriptions/image';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

import type { FakeCtx } from './fake-ctx';

const image = (data: Record<string, unknown>): FakeCtx => createFakeCtx(docOf([{ id: 'i', type: 'image', data: { url: 'u', ...data } }]), 'i');
const dataOf = (ctx: FakeCtx): Record<string, unknown> => {
  const data = ctx.read('i')?.data;

  if (typeof data !== 'object' || data === null) {
    throw new Error('Expected the image block.');
  }

  return { ...data };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('image geometry actions', () => {
  it('crop writes the rect and shape, and the full rect removes it', () => {
    const ctx = image({});

    IMAGE_ACTION_HANDLERS.crop.run(ctx, { rect: { x: 10, y: 10, w: 50, h: 50 }, shape: 'circle' }, undefined);
    expect(dataOf(ctx)).toMatchObject({ crop: { x: 10, y: 10, w: 50, h: 50, shape: 'circle' } });
    IMAGE_ACTION_HANDLERS.crop.run(ctx, { rect: { x: 0, y: 0, w: 100, h: 100 } }, undefined);
    expect(dataOf(ctx)).not.toHaveProperty('crop');
  });

  it('crop keeps the rendered height by rescaling an explicit width', () => {
    const ctx = image({ width: 40, naturalWidth: 800, naturalHeight: 400 });

    IMAGE_ACTION_HANDLERS.crop.run(ctx, { rect: { x: 0, y: 0, w: 50, h: 100 } }, undefined);

    expect(dataOf(ctx)).toMatchObject({ width: 20, crop: { x: 0, y: 0, w: 50, h: 100 } });
  });

  it('one clockwise turn is rotation 90 and turns the crop with it', () => {
    const ctx = image({ crop: { x: 0, y: 0, w: 50, h: 100 } });

    IMAGE_ACTION_HANDLERS.rotate.run(ctx, { turns: 1 }, undefined);

    expect(dataOf(ctx)).toMatchObject({ rotation: 90, crop: { x: 0, y: 0, w: 100, h: 50 } });
  });

  it('a quarter turn rescales an explicit width to the turned box, as the darkroom does', () => {
    const ctx = image({ width: 50, naturalWidth: 800, naturalHeight: 400 });

    IMAGE_ACTION_HANDLERS.rotate.run(ctx, { turns: 3 }, undefined);

    expect(dataOf(ctx)).toMatchObject({ rotation: 270, width: 12.5 });
  });

  it('four turns are back to no rotation field at all', () => {
    const ctx = image({});

    IMAGE_ACTION_HANDLERS.rotate.run(ctx, { turns: 2 }, undefined);
    expect(dataOf(ctx)).toMatchObject({ rotation: 180 });
    IMAGE_ACTION_HANDLERS.rotate.run(ctx, { turns: 2 }, undefined);

    expect(dataOf(ctx)).not.toHaveProperty('rotation');
    expect(dataOf(ctx)).not.toHaveProperty('crop');
  });

  it('flip mirrors and flips markup, and a second flip removes flipX', () => {
    const ctx = image({ markup: [{ id: 'm', type: 'text', color: '#ffffff', x: 0.2, y: 0.5, text: 'a', size: 0.1 }] });

    IMAGE_ACTION_HANDLERS.flip.run(ctx, {}, undefined);
    expect(dataOf(ctx)).toMatchObject({ flipX: true, markup: [{ id: 'm', x: 0.8 }] });
    IMAGE_ACTION_HANDLERS.flip.run(ctx, {}, undefined);
    expect(dataOf(ctx)).not.toHaveProperty('flipX');
    expect(dataOf(ctx)).toMatchObject({ markup: [{ x: 0.2 }] });
  });

  it('straighten needs the natural size, then turns and covers the crop', () => {
    expect(() => IMAGE_ACTION_HANDLERS.straighten.run(image({}), { degrees: 5 }, undefined)).toThrow(FakeFailure);
    const ctx = image({ naturalWidth: 800, naturalHeight: 600 });

    IMAGE_ACTION_HANDLERS.straighten.run(ctx, { degrees: 5 }, undefined);
    const crop = dataOf(ctx).crop as { w: number; h: number };

    expect(dataOf(ctx)).toMatchObject({ straighten: 5 });
    expect(crop.w).toBeLessThan(100);
    expect(crop.h).toBeLessThan(100);
    IMAGE_ACTION_HANDLERS.straighten.run(ctx, { degrees: 0 }, undefined);
    expect(dataOf(ctx)).not.toHaveProperty('straighten');
  });

  it('refuses without a target block', () => {
    expect(() => IMAGE_ACTION_HANDLERS.flip.run(createFakeCtx(docOf([]), undefined, 'image'), {}, undefined)).toThrow(FakeFailure);
  });
});

describe('image geometry declarations', () => {
  const actionOf = (name: string): Record<string, unknown> => describeImage().actions?.find(action => action.name === name)?.args ?? {};

  it.each([
    ['crop', { rect: { x: 0, y: 0, w: 50, h: 50 }, shape: 'ellipse' }, { rect: { x: 0, y: 0, w: 101, h: 50 } }],
    ['rotate', { turns: 3 }, { turns: 4 }],
    ['flip', {}, { turns: 1 }],
    ['straighten', { degrees: -45 }, { degrees: 46 }],
  ] as const)('%s validates its arguments and is wired', (name, good, bad) => {
    expect(validateAgainst(actionOf(name), good)).toEqual([]);
    expect(validateAgainst(actionOf(name), bad).length).toBeGreaterThan(0);
    expect(BUILT_IN_TOOL_RUNTIMES.get('image')?.actions[name]).toBe(IMAGE_ACTION_HANDLERS[name]);
    expect(BUILT_IN_TOOL_RUNTIMES.get('image')?.actions.setSource).toBeDefined();
  });
});

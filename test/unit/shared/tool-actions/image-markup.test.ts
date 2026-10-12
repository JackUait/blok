// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMANDS } from '../../../../src/shared/agent/commands';
import { buildBuiltInSnapshot } from '../../../../src/shared/built-in-snapshot';
import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { IMAGE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/image';
import { describeImage, IMAGE_DATA } from '../../../../src/shared/tool-descriptions/image';
import { buildAgentContract, buildToolManifest } from '../../../../src/shared/tool-manifest';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

import type { FakeCtx } from './fake-ctx';

const RECT = { type: 'rect', color: '#0a84ff', x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5, size: 0.012 };
const TEXT = { type: 'text', color: '#ffffff', x: 0.5, y: 0.5, text: 'Hi', size: 0.1 };

const runtimes = ['editor', 'node', 'jint'] as const;

type Item = Record<string, unknown> & { id: string };

const image = (data: Record<string, unknown> = {}): FakeCtx => createFakeCtx(docOf([{ id: 'i', type: 'image', data: { url: 'u', ...data } }]), 'i');
const markupOf = (ctx: FakeCtx): Item[] | undefined => (ctx.read('i')?.data as { markup?: Item[] }).markup;
const add = (ctx: FakeCtx, items: Array<Record<string, unknown>>): string[] =>
  IMAGE_ACTION_HANDLERS.addMarkup.run(ctx, { items }, undefined).markupIds;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('image markup actions', () => {
  it('adds items with minted ids after the existing ones, updates one, removes all', () => {
    const ctx = image({ markup: [{ id: 'old', ...TEXT }] });
    const markupIds = add(ctx, [RECT, TEXT]);

    expect(markupIds).toHaveLength(2);
    expect(markupOf(ctx)?.map(item => item.id)).toEqual(['old', ...markupIds]);
    expect(markupOf(ctx)?.[1]).toEqual({ id: markupIds[0], ...RECT });

    IMAGE_ACTION_HANDLERS.updateMarkup.run(ctx, { markupId: markupIds[0], patch: { color: '#ff3b30' } }, undefined);
    expect(markupOf(ctx)?.[1]).toMatchObject({ id: markupIds[0], color: '#ff3b30' });

    IMAGE_ACTION_HANDLERS.removeMarkup.run(ctx, { all: true }, undefined);
    expect(ctx.read('i')?.data).not.toHaveProperty('markup');
  });

  it('removes the named items only', () => {
    const ctx = image();
    const [first, second] = add(ctx, [RECT, TEXT]);

    IMAGE_ACTION_HANDLERS.removeMarkup.run(ctx, { markupIds: [first] }, undefined);

    expect(markupOf(ctx)?.map(item => item.id)).toEqual([second]);
  });

  it('refuses an item the editor would drop, naming its index, and writes nothing', () => {
    const ctx = image();

    expect(() => add(ctx, [RECT, { ...TEXT, color: 'red' }])).toThrow(/item 1/);
    expect(ctx.edits).toEqual([]);
  });

  it('refuses to change an item type or id, and an unknown id', () => {
    const ctx = image();
    const [markupId] = add(ctx, [RECT]);

    expect(() => IMAGE_ACTION_HANDLERS.updateMarkup.run(ctx, { markupId, patch: { type: 'text' } }, undefined)).toThrow(FakeFailure);
    expect(() => IMAGE_ACTION_HANDLERS.updateMarkup.run(ctx, { markupId: 'nope', patch: { color: '#000000' } }, undefined)).toThrow(/no markup item nope/);
    expect(() => IMAGE_ACTION_HANDLERS.removeMarkup.run(ctx, { markupIds: ['nope'] }, undefined)).toThrow(FakeFailure);
    expect(markupOf(ctx)).toHaveLength(1);
  });

  it('refuses a patch that makes the item invalid', () => {
    const ctx = image();
    const [markupId] = add(ctx, [RECT]);

    expect(() => IMAGE_ACTION_HANDLERS.updateMarkup.run(ctx, { markupId, patch: { size: -1 } }, undefined)).toThrow(FakeFailure);
  });
});

describe('image markup declarations', () => {
  const argsOf = (name: string): Record<string, unknown> => describeImage().actions?.find(action => action.name === name)?.args ?? {};

  it('addMarkup takes 1..500 items in the saved shape, without ids', () => {
    expect(validateAgainst(argsOf('addMarkup'), { items: [RECT, TEXT] })).toEqual([]);
    expect(validateAgainst(argsOf('addMarkup'), { items: [] }).length).toBeGreaterThan(0);
    expect(validateAgainst(argsOf('addMarkup'), { items: [{ ...RECT, id: 'x' }] }).length).toBeGreaterThan(0);
    expect(validateAgainst(argsOf('addMarkup'), { items: [{ ...RECT, color: 'red' }] }).length).toBeGreaterThan(0);
  });

  it('updateMarkup and removeMarkup validate their shapes', () => {
    expect(validateAgainst(argsOf('updateMarkup'), { markupId: 'm', patch: { color: '#000000' } })).toEqual([]);
    expect(validateAgainst(argsOf('updateMarkup'), { markupId: 'm' }).length).toBeGreaterThan(0);
    expect(validateAgainst(argsOf('removeMarkup'), { markupIds: ['m'] })).toEqual([]);
    expect(validateAgainst(argsOf('removeMarkup'), { all: true })).toEqual([]);
    expect(validateAgainst(argsOf('removeMarkup'), { all: false }).length).toBeGreaterThan(0);
    expect(validateAgainst(argsOf('removeMarkup'), { markupIds: [] }).length).toBeGreaterThan(0);
    expect(validateAgainst(argsOf('removeMarkup'), {}).length).toBeGreaterThan(0);
    expect(validateAgainst(argsOf('removeMarkup'), { markupIds: ['m'], all: true }).length).toBeGreaterThan(0);
  });

  it.each(runtimes)('publishes removeMarkup with the core-added block id for %s', runtime => {
    const contract = buildAgentContract(buildToolManifest(buildBuiltInSnapshot({ blokVersion: 'image-markup-test' })), COMMANDS, { runtime, services: [] });
    const command = contract.commands.find(candidate => candidate.name === 'image.removeMarkup');

    expect(validateAgainst(command?.args ?? {}, { id: 'i', all: true })).toEqual([]);
    expect(validateAgainst(command?.args ?? {}, { id: 'i', markupIds: ['m'] })).toEqual([]);
    expect(validateAgainst(command?.args ?? {}, { all: true }).length).toBeGreaterThan(0);
  });

  it('leaves the saved markup schema untouched and wires the handlers', () => {
    expect(IMAGE_DATA.properties.markup.items.anyOf.every(branch => 'id' in branch.properties)).toBe(true);
    for (const name of ['addMarkup', 'updateMarkup', 'removeMarkup'] as const) {
      expect(BUILT_IN_TOOL_RUNTIMES.get('image')?.actions[name]).toBe(IMAGE_ACTION_HANDLERS[name]);
    }
  });
});

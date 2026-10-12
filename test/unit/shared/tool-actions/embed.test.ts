// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { LINK_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/link';
import { describeEmbed } from '../../../../src/shared/tool-descriptions/embed';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('embed.setUrl', () => {
  it('fills service, embed, kind and the frame size from the provider registry', () => {
    const ctx = createFakeCtx(docOf([{ id: 'e', type: 'embed', data: { service: '', source: '', embed: '', caption: 'kept' } }]), 'e');

    LINK_ACTION_HANDLERS.embed.setUrl.run(ctx, { url: URL }, undefined);

    expect(ctx.read('e')?.data).toMatchObject({ service: 'youtube', source: URL, kind: 'iframe', caption: 'kept' });
    expect(ctx.read('e')?.data).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
    expect((ctx.read('e')?.data as { embed: string }).embed).toMatch(/^https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ/);
  });

  it('refuses a URL no provider knows and writes nothing', () => {
    const ctx = createFakeCtx(docOf([{ id: 'e', type: 'embed', data: {} }]), 'e');

    expect(() => LINK_ACTION_HANDLERS.embed.setUrl.run(ctx, { url: 'https://example.com/x' }, undefined)).toThrow(FakeFailure);
    expect(ctx.edits).toEqual([]);
  });

  it('is declared on embed, http(s) only, and wired', () => {
    const action = describeEmbed().actions?.find(candidate => candidate.name === 'setUrl');

    expect(action).toMatchObject({ target: 'block' });
    expect(validateAgainst(action?.args ?? {}, { url: URL })).toEqual([]);
    expect(validateAgainst(action?.args ?? {}, { url: 'javascript:alert(1)' }).length).toBeGreaterThan(0);
    expect(BUILT_IN_TOOL_RUNTIMES.get('embed')?.actions.setUrl).toBe(LINK_ACTION_HANDLERS.embed.setUrl);
  });
});

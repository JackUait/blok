// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { LINK_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/link';
import { describeBookmark } from '../../../../src/shared/tool-descriptions/bookmark';
import { createFakeCtx, docOf } from './fake-ctx';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bookmark.create', () => {
  it('fetches metadata in prepare and inserts the card at the given place', async () => {
    const fetch = vi.fn().mockResolvedValue({ url: 'https://a.b/final', title: 'A', image: 'https://a.b/i.png', extra: 1, domain: 7 });
    const action = LINK_ACTION_HANDLERS.bookmark.create;
    const prepared = await action.prepare?.({ services: { linkMetadata: { fetch } } }, { url: 'https://a.b' });
    const ctx = createFakeCtx(docOf([{ id: 'p', type: 'paragraph', data: { text: [] } }]), undefined, 'bookmark');
    const result = action.run(ctx, { url: 'https://a.b', position: 'start' }, prepared);

    expect(fetch).toHaveBeenCalledWith('https://a.b');
    expect(result.childIds).toEqual([]);
    expect(ctx.read(result.id)).toMatchObject({ type: 'bookmark', parentId: null, data: { url: 'https://a.b', title: 'A', image: 'https://a.b/i.png' } });
    expect(ctx.read(result.id)?.data).not.toHaveProperty('extra');
    expect(ctx.read(result.id)?.data).not.toHaveProperty('domain');
    expect([...ctx.doc.keys()][0]).toBe(result.id);
  });

  it('keeps just the URL when the fetch fails', async () => {
    const action = LINK_ACTION_HANDLERS.bookmark.create;
    const prepared = await action.prepare?.({ services: { linkMetadata: { fetch: vi.fn().mockRejectedValue(new Error('x')) } } }, { url: 'https://a.b' });

    expect(prepared).toEqual({ url: 'https://a.b' });
  });

  it('inserts a block of the host registry key', () => {
    const ctx = createFakeCtx(docOf([]), undefined, 'card');
    const { id } = LINK_ACTION_HANDLERS.bookmark.create.run(ctx, { url: 'https://a.b' }, undefined);

    expect(ctx.read(id)).toMatchObject({ type: 'card', data: { url: 'https://a.b' } });
  });

  it('is declared as a create action that uses link metadata when present, and wired', () => {
    const action = describeBookmark().actions?.find(candidate => candidate.name === 'create');

    expect(action).toMatchObject({ target: 'create', uses: ['linkMetadata'] });
    expect(action).not.toHaveProperty('requires');
    expect(validateAgainst(action?.args ?? {}, { url: 'https://a.b' })).toEqual([]);
    expect(validateAgainst(action?.args ?? {}, { url: 'ftp://a.b' }).length).toBeGreaterThan(0);
    expect(BUILT_IN_TOOL_RUNTIMES.get('bookmark')?.actions.create).toBe(LINK_ACTION_HANDLERS.bookmark.create);
  });
});

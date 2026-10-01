import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resyncPortalDirections, syncPortalDirection } from '../../../../src/components/utils/portal-direction';

const mount = (direction: 'ltr' | 'rtl'): { editor: HTMLElement; source: HTMLElement; portal: HTMLElement } => {
  const editor = document.createElement('div');
  const source = document.createElement('button');
  const portal = document.createElement('div');

  editor.style.direction = direction;
  editor.appendChild(source);
  document.body.append(editor, portal);

  return { editor, source, portal };
};

describe('syncPortalDirection', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('takes the editor direction, not the direction of the block holding the anchor', () => {
    const editor = document.createElement('div');
    const block = document.createElement('div');
    const anchor = document.createElement('button');
    const portal = document.createElement('div');

    editor.setAttribute('data-blok-editor', '');
    editor.style.direction = 'rtl';
    // An English block in an RTL editor carries its own LTR direction.
    block.dir = 'ltr';
    block.style.direction = 'ltr';
    block.appendChild(anchor);
    editor.appendChild(block);
    document.body.append(editor, portal);

    syncPortalDirection(portal, { source: anchor });

    expect(portal.getAttribute('dir')).toBe('rtl');
  });
});

describe('resyncPortalDirections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('re-reads the direction of every open portal owned by the editor', () => {
    const { editor, source, portal } = mount('ltr');

    syncPortalDirection(portal, { source });
    editor.style.direction = 'rtl';
    resyncPortalDirections(editor);

    expect(portal.getAttribute('dir')).toBe('rtl');
    expect(portal.style.getPropertyValue('direction')).toBe('rtl');
  });

  it('lets an open portal re-place itself after its direction is re-read', () => {
    const { editor, source, portal } = mount('ltr');
    const seen: Array<string | null> = [];

    syncPortalDirection(portal, { source, onResync: () => seen.push(portal.getAttribute('dir')) });
    editor.style.direction = 'rtl';
    resyncPortalDirections(editor);

    expect(seen).toEqual(['rtl']);
  });

  it('does not call back a portal of another editor', () => {
    const first = mount('ltr');
    const second = mount('ltr');
    const onResync = vi.fn();

    syncPortalDirection(second.portal, { source: second.source, onResync });
    first.editor.style.direction = 'rtl';
    resyncPortalDirections(first.editor);

    expect(onResync).not.toHaveBeenCalled();
  });

  it('leaves portals of another editor alone', () => {
    const first = mount('ltr');
    const second = mount('ltr');

    syncPortalDirection(second.portal, { source: second.source });
    first.editor.style.direction = 'rtl';
    second.editor.style.direction = 'rtl';
    resyncPortalDirections(first.editor);

    expect(second.portal.getAttribute('dir')).toBe('ltr');
  });

  it('skips a closed portal and one with an explicit direction', () => {
    const { editor, source, portal } = mount('ltr');
    const explicit = document.createElement('div');

    document.body.appendChild(explicit);
    syncPortalDirection(portal, { source });
    syncPortalDirection(explicit, { source, direction: 'ltr' });
    portal.remove();
    editor.style.direction = 'rtl';
    resyncPortalDirections(editor);

    expect(portal.getAttribute('dir')).toBe('ltr');
    expect(explicit.getAttribute('dir')).toBe('ltr');
  });
});

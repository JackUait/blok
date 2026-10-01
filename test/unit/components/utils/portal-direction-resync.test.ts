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

import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setHolder } from '../../../packages/vue/src/holder-map';
import { BlokContent } from '../../../packages/vue/src/BlokContent';
import type { Blok } from '@/types';

/** A plain object stands in for a Blok instance (only used as a WeakMap key). */
const asEditor = (obj: Record<string, unknown>): Blok => obj as unknown as Blok;

describe('BlokContent', () => {
  let mockEditor: Record<string, unknown>;
  let mockHolder: HTMLDivElement;

  beforeEach(() => {
    mockEditor = {};
    mockHolder = document.createElement('div');
    mockHolder.textContent = 'editor-content';
  });

  it('renders an empty div when editor is null', () => {
    const wrapper = mount(BlokContent, { props: { editor: null } });

    expect(wrapper.element.tagName).toBe('DIV');
    expect(wrapper.element.childElementCount).toBe(0);
  });

  it('forwards fallthrough attributes (data-blok-testid) onto the container div', () => {
    const wrapper = mount(BlokContent, {
      props: { editor: null },
      attrs: { 'data-blok-testid': 'content' },
    });

    expect(wrapper.element.getAttribute('data-blok-testid')).toBe('content');
  });

  it('adopts the editor holder into the container when editor is provided', () => {
    setHolder(mockEditor, mockHolder);

    const wrapper = mount(BlokContent, { props: { editor: asEditor(mockEditor) } });

    expect(wrapper.element.contains(mockHolder)).toBe(true);
    expect(wrapper.element.textContent).toBe('editor-content');
  });

  it('removes the holder from the container on unmount', () => {
    setHolder(mockEditor, mockHolder);

    const wrapper = mount(BlokContent, { props: { editor: asEditor(mockEditor) } });

    expect(wrapper.element.contains(mockHolder)).toBe(true);

    wrapper.unmount();

    expect(mockHolder.parentElement).toBeNull();
  });

  it('swaps holders when the editor prop changes to a different instance', async () => {
    setHolder(mockEditor, mockHolder);

    const wrapper = mount(BlokContent, { props: { editor: asEditor(mockEditor) } });

    expect(wrapper.element.contains(mockHolder)).toBe(true);

    const mockEditorB: Record<string, unknown> = {};
    const mockHolderB = document.createElement('div');

    mockHolderB.textContent = 'editor-b-content';
    setHolder(mockEditorB, mockHolderB);

    await wrapper.setProps({ editor: asEditor(mockEditorB) });

    expect(mockHolder.parentElement).toBeNull();
    expect(wrapper.element.contains(mockHolder)).toBe(false);
    expect(wrapper.element.contains(mockHolderB)).toBe(true);
    expect(wrapper.element.textContent).toBe('editor-b-content');
  });

  it('removes the holder when the editor prop changes to null', async () => {
    setHolder(mockEditor, mockHolder);

    const wrapper = mount(BlokContent, { props: { editor: asEditor(mockEditor) } });

    expect(wrapper.element.contains(mockHolder)).toBe(true);

    await wrapper.setProps({ editor: null });

    expect(mockHolder.parentElement).toBeNull();
  });

  it('renders an empty container without throwing when editor has no registered holder', () => {
    const editorWithoutHolder: Record<string, unknown> = {};

    const wrapper = mount(BlokContent, { props: { editor: asEditor(editorWithoutHolder) } });

    expect(wrapper.element.tagName).toBe('DIV');
    expect(wrapper.element.childElementCount).toBe(0);
  });
});

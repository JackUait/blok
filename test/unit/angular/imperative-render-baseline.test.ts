import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OutputData } from '@/types';

vi.mock('@bloklabs/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../packages/angular/src/blok-editor.component';

/**
 * A one-paragraph document.
 * @param text - paragraph text
 * @returns the document
 */
function doc(text: string): OutputData {
  return { time: 0, version: '0', blocks: [{ id: '1', type: 'paragraph', data: { text } }] };
}

/**
 * Mounts the component with seeded `[data]` and resolves its editor.
 * @param data - seed document
 * @returns the mounted fixture
 */
async function mountWithData(data: OutputData): Promise<ComponentFixture<BlokEditorComponent>> {
  const fixture = TestBed.createComponent(BlokEditorComponent);

  fixture.componentRef.setInput('data', data);
  fixture.detectChanges();
  await fixture.whenStable();
  blokRegistry.last.resolveReady();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();

  return fixture;
}

describe('BlokEditorComponent imperative render vs the controlled baseline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a controlled revert after an imperative render() moved the editor past it', async () => {
    const fixture = await mountWithData(doc('a'));
    const editor = blokRegistry.last;

    await fixture.componentInstance.render(doc('b'));
    await fixture.whenStable();
    expect(editor.render).toHaveBeenCalledTimes(1);

    // The host reverts `[data]` to the seed the editor no longer holds.
    const revert = doc('a');

    fixture.componentRef.setInput('data', revert);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(editor.render).toHaveBeenCalledTimes(2);
    expect(editor.render).toHaveBeenLastCalledWith(revert);
  });

  it('does not re-render a controlled value whose only delta is edit metadata', async () => {
    const fixture = await mountWithData({
      time: 1,
      version: '1',
      blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' }, lastEditedAt: 1700000000000 }],
    });
    const editor = blokRegistry.last;

    fixture.componentRef.setInput('data', { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(editor.render).not.toHaveBeenCalled();
  });
});

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OutputData } from '@/types';

vi.mock('@bloklabs/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../packages/angular/src/blok-editor.component';

function doc(text: string): OutputData {
  return { time: 0, version: '0', blocks: [{ id: '1', type: 'paragraph', data: { text } }] };
}

async function mountWithData(
  data: OutputData
): Promise<ComponentFixture<BlokEditorComponent>> {
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

describe('BlokEditorComponent reactive data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('seeds data at construction and does not re-render on mount', async () => {
    const data = doc('hello');
    const fixture = await mountWithData(data);

    // Seeded into the constructor config, not via render().
    expect(blokRegistry.last.config.data).toEqual(data);
    expect(blokRegistry.last.render).not.toHaveBeenCalled();
    void fixture;
  });

  it('does not render when data changes to structurally equal content', async () => {
    const fixture = await mountWithData(doc('hello'));
    const editor = blokRegistry.last;

    // New object reference, identical content.
    fixture.componentRef.setInput('data', doc('hello'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(editor.render).not.toHaveBeenCalled();
  });

  it('renders when data content changes', async () => {
    const fixture = await mountWithData(doc('hello'));
    const editor = blokRegistry.last;

    const next = doc('world');
    fixture.componentRef.setInput('data', next);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(editor.render).toHaveBeenCalledTimes(1);
    expect(editor.render).toHaveBeenCalledWith(next);
  });

  it('renders successive distinct changes in order', async () => {
    const fixture = await mountWithData(doc('a'));
    const editor = blokRegistry.last;

    fixture.componentRef.setInput('data', doc('b'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentRef.setInput('data', doc('c'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(editor.render).toHaveBeenCalledTimes(2);
    expect(editor.render.mock.calls[0][0]).toEqual(doc('b'));
    expect(editor.render.mock.calls[1][0]).toEqual(doc('c'));
  });
});

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OutputData } from '@/types';

vi.mock('@bloklabs/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../packages/angular/src/blok-editor.component';

function doc(text: string): OutputData {
  return { time: 0, version: '0', blocks: [{ id: '1', type: 'paragraph', data: { text } }] };
}

async function settle(fixture: ComponentFixture<BlokEditorComponent>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
}

/** Constructs the editor with `data`, without resolving `isReady`. */
async function construct(data: OutputData): Promise<ComponentFixture<BlokEditorComponent>> {
  const fixture = TestBed.createComponent(BlokEditorComponent);

  fixture.componentRef.setInput('data', data);
  await settle(fixture);

  return fixture;
}

describe('BlokEditorComponent data around the editor lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders data that changed after construction but before the editor was ready', async () => {
    const fixture = await construct(doc('seed'));
    const editor = blokRegistry.last;

    expect(editor.config.data).toEqual(doc('seed'));

    fixture.componentRef.setInput('data', doc('loaded'));
    await settle(fixture);
    editor.resolveReady();
    await settle(fixture);

    expect(editor.render).toHaveBeenCalledTimes(1);
    expect(editor.render).toHaveBeenCalledWith(doc('loaded'));
  });

  it('does not render when the data still equals what the editor was built with', async () => {
    const fixture = await construct(doc('seed'));
    const editor = blokRegistry.last;

    fixture.componentRef.setInput('data', doc('seed'));
    await settle(fixture);
    editor.resolveReady();
    await settle(fixture);

    expect(editor.render).not.toHaveBeenCalled();
  });
});

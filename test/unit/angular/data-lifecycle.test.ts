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

  it('destroys an editor whose boot failed', async () => {
    const fixture = await construct(doc('seed'));
    const editor = blokRegistry.last;

    editor.rejectReady(new Error('boot failed'));
    await settle(fixture);

    expect(editor.destroy).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.instance()).toBeNull();
  });

  it('does not run a queued render on an editor destroyed while an earlier render was in flight', async () => {
    const fixture = await construct(doc('seed'));
    const editor = blokRegistry.last;

    editor.resolveReady();
    await settle(fixture);

    const finishFirst: Array<() => void> = [];

    editor.render.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishFirst.push(resolve);
    }));

    fixture.componentRef.setInput('data', doc('first'));
    await settle(fixture);
    fixture.componentRef.setInput('data', doc('second'));
    fixture.detectChanges();

    expect(editor.render).toHaveBeenCalledTimes(1);

    fixture.destroy();
    finishFirst.forEach((resolve) => resolve());
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(editor.destroy).toHaveBeenCalled();
    expect(editor.render).toHaveBeenCalledTimes(1);
  });
});

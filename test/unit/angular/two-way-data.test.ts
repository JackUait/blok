import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OutputData } from '@/types';

vi.mock('@jackuait/blok', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../src/angular/blok-editor.component';

function doc(text: string): OutputData {
  return { time: 0, version: '0', blocks: [{ id: '1', type: 'paragraph', data: { text } }] };
}

type CoreOnSave = (data: OutputData) => void;

@Component({
  standalone: true,
  imports: [BlokEditorComponent],
  template: `<blok-editor [(data)]="data"></blok-editor>`,
})
class TwoWayHost {
  data: OutputData = doc('init');
}

@Component({
  standalone: true,
  imports: [BlokEditorComponent],
  template: `<blok-editor [data]="data"></blok-editor>`,
})
class OneWayHost {
  data: OutputData = doc('init');
}

async function mountReady<T>(type: { new (): T }): Promise<ComponentFixture<T>> {
  const fixture = TestBed.createComponent(type);

  fixture.detectChanges();
  await fixture.whenStable();
  blokRegistry.last.resolveReady();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();

  return fixture;
}

describe('BlokEditorComponent two-way data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wires core onSave only when dataChange is observed', async () => {
    await mountReady(TwoWayHost);

    expect(typeof blokRegistry.last.config.onSave).toBe('function');
  });

  it('does not wire core onSave for a one-way [data] binding', async () => {
    await mountReady(OneWayHost);

    expect(blokRegistry.last.config.onSave).toBeUndefined();
  });

  it('propagates editor saves back through [(data)]', async () => {
    const fixture = await mountReady(TwoWayHost);
    const onSave = blokRegistry.last.config.onSave as CoreOnSave;

    onSave(doc('edited'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.data).toEqual(doc('edited'));
  });

  it('does not re-render when the saved data is echoed back (caret-stable)', async () => {
    const fixture = await mountReady(TwoWayHost);
    const editor = blokRegistry.last;
    const onSave = editor.config.onSave as CoreOnSave;

    onSave(doc('edited'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(editor.render).not.toHaveBeenCalled();
  });
});

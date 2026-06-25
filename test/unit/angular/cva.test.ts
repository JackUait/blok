import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OutputData } from '@/types';

vi.mock('@jackuait/blok', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../src/angular/blok-editor.component';

function doc(text: string): OutputData {
  return { time: 0, version: '0', blocks: [{ id: '1', type: 'paragraph', data: { text } }] };
}

@Component({
  standalone: true,
  imports: [BlokEditorComponent, ReactiveFormsModule],
  template: `<blok-editor [formControl]="ctrl"></blok-editor>`,
})
class FormHost {
  ctrl = new FormControl<OutputData | null>(doc('init'));
}

async function mountReady(): Promise<ComponentFixture<FormHost>> {
  const fixture = TestBed.createComponent(FormHost);

  fixture.detectChanges();
  await fixture.whenStable();
  blokRegistry.last.resolveReady();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();

  return fixture;
}

describe('BlokEditorComponent ControlValueAccessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wires core onSave when used as a form control', async () => {
    await mountReady();

    expect(typeof blokRegistry.last.config.onSave).toBe('function');
  });

  it('propagates editor saves to the form control value', async () => {
    const fixture = await mountReady();
    const onSave = blokRegistry.last.config.onSave as (data: OutputData) => void;

    onSave(doc('edited'));
    await fixture.whenStable();

    expect(fixture.componentInstance.ctrl.value).toEqual(doc('edited'));
  });

  it('renders external form value changes (writeValue)', async () => {
    const fixture = await mountReady();
    const editor = blokRegistry.last;

    fixture.componentInstance.ctrl.setValue(doc('external'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(editor.render).toHaveBeenCalledWith(doc('external'));
  });

  it('maps form disabled state to editor readOnly', async () => {
    const fixture = await mountReady();
    const editor = blokRegistry.last;

    fixture.componentInstance.ctrl.disable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(editor.readOnly.set).toHaveBeenLastCalledWith(true);
  });
});

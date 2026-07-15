import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@blok/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../packages/angular/src/blok-editor.component';

async function mountAndReady(
  inputs: Record<string, unknown> = {}
): Promise<ComponentFixture<BlokEditorComponent>> {
  const fixture = TestBed.createComponent(BlokEditorComponent);

  for (const [key, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(key, value);
  }

  fixture.detectChanges();
  await fixture.whenStable();
  blokRegistry.last.resolveReady();
  await fixture.whenStable();
  fixture.detectChanges();

  return fixture;
}

describe('BlokEditorComponent reactive inputs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('syncs readOnly changes to editor.readOnly.set', async () => {
    const fixture = await mountAndReady({ readOnly: false });
    const editor = blokRegistry.last;

    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();

    expect(editor.readOnly.set).toHaveBeenLastCalledWith(true);
  });

  it('coerces undefined readOnly to false', async () => {
    const fixture = await mountAndReady({ readOnly: undefined });
    const editor = blokRegistry.last;

    expect(editor.readOnly.set).toHaveBeenLastCalledWith(false);
  });

  it('does not call theme/width/placeholder setters while their inputs are undefined', async () => {
    const fixture = await mountAndReady();
    const editor = blokRegistry.last;

    expect(editor.theme.set).not.toHaveBeenCalled();
    expect(editor.width.set).not.toHaveBeenCalled();
    expect(editor.placeholder.set).not.toHaveBeenCalled();
    void fixture;
  });

  it('syncs theme/width/placeholder when defined', async () => {
    const fixture = await mountAndReady({ theme: 'dark', width: 'full', placeholder: 'Type…' });
    const editor = blokRegistry.last;

    expect(editor.theme.set).toHaveBeenCalledWith('dark');
    expect(editor.width.set).toHaveBeenCalledWith('full');
    expect(editor.placeholder.set).toHaveBeenCalledWith('Type…');
    void fixture;
  });

  it('focuses the editor when autofocus is truthy', async () => {
    const fixture = await mountAndReady({ autofocus: true });
    const editor = blokRegistry.last;

    expect(editor.focus).toHaveBeenCalled();
    void fixture;
  });

  it('re-applies reactive props once the instance appears (input set before ready)', async () => {
    const fixture = TestBed.createComponent(BlokEditorComponent);

    fixture.componentRef.setInput('readOnly', true);
    fixture.componentRef.setInput('theme', 'dark');
    fixture.detectChanges();
    await fixture.whenStable();

    const editor = blokRegistry.last;

    // Not ready yet → no reactive sync has run.
    expect(editor.theme.set).not.toHaveBeenCalled();

    blokRegistry.last.resolveReady();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(editor.readOnly.set).toHaveBeenLastCalledWith(true);
    expect(editor.theme.set).toHaveBeenCalledWith('dark');
  });
});

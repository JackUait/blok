/**
 * Reactive `i18n` in the Angular adapter — parity with React/Vue.
 *
 * `config.i18n` was consumed once at boot, so a host with a language switcher
 * had to recreate the editor (losing caret, focus and undo stack) to relabel
 * the UI. The `i18n` input drives the runtime `editor.i18n.update` API.
 */
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@bloklabs/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

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

describe('BlokEditorComponent reactive i18n', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('seeds the mount-time locale at construction instead of re-applying it', async () => {
    await mountAndReady({ i18n: { locale: 'ru' } });

    expect(blokRegistry.last.config.i18n).toEqual({ locale: 'ru' });
    expect(blokRegistry.last.i18n.update).not.toHaveBeenCalled();
  });

  it('pushes a locale change through editor.i18n.update', async () => {
    const fixture = await mountAndReady({ i18n: { locale: 'en' } });
    const editor = blokRegistry.last;

    fixture.componentRef.setInput('i18n', { locale: 'ru' });
    fixture.detectChanges();

    expect(editor.i18n.update).toHaveBeenLastCalledWith({ locale: 'ru' });
  });

  it('pushes changed host messages', async () => {
    const fixture = await mountAndReady({ i18n: { locale: 'en' } });
    const editor = blokRegistry.last;

    fixture.componentRef.setInput('i18n', { locale: 'en', messages: { 'a11y.insertBlock': 'Add' } });
    fixture.detectChanges();

    expect(editor.i18n.update).toHaveBeenLastCalledWith({
      locale: 'en',
      messages: { 'a11y.insertBlock': 'Add' },
    });
  });

  it('does not re-push an identical config', async () => {
    const fixture = await mountAndReady({ i18n: { locale: 'ru' } });
    const editor = blokRegistry.last;

    fixture.componentRef.setInput('i18n', { locale: 'ru' });
    fixture.detectChanges();

    expect(editor.i18n.update).not.toHaveBeenCalled();
  });

  it('does not touch i18n while the input is undefined', async () => {
    await mountAndReady();

    expect(blokRegistry.last.i18n.update).not.toHaveBeenCalled();
  });
});

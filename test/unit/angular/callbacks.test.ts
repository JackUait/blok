import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, OutputBlockData, ResolvedTheme } from '@/types';

vi.mock('@jackuait/blok', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../src/angular/blok-editor.component';

@Component({
  standalone: true,
  imports: [BlokEditorComponent],
  template: `<blok-editor
    (change)="changes.push($event)"
    (afterRender)="afters.push($event)"
    (themeChange)="themeChanges.push($event)"
    [onBeforeRender]="beforeRender"
    [onBeforePaste]="beforePaste"
  ></blok-editor>`,
})
class WiredHost {
  changes: unknown[] = [];
  afters: unknown[] = [];
  themeChanges: ResolvedTheme[] = [];
  beforeRender = (blocks: OutputBlockData[]): OutputBlockData[] => [
    ...blocks,
    { id: 'injected', type: 'paragraph', data: {} },
  ];
  beforePaste = (html: string): string => html.toUpperCase();
}

@Component({
  standalone: true,
  imports: [BlokEditorComponent],
  template: `<blok-editor></blok-editor>`,
})
class BareHost {}

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

describe('BlokEditorComponent opt-in callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits the change output from core onChange when observed', async () => {
    const fixture = await mountReady(WiredHost);
    const api = {} as API;
    const event = { type: 'block-added' } as never;

    (blokRegistry.last.config.onChange as (a: API, e: unknown) => void)(api, event);
    await fixture.whenStable();

    expect(fixture.componentInstance.changes).toEqual([{ api, event }]);
  });

  it('emits the afterRender output from core onAfterRender when observed', async () => {
    const fixture = await mountReady(WiredHost);
    const api = {} as API;

    (blokRegistry.last.config.onAfterRender as (a: API) => void)(api);
    await fixture.whenStable();

    expect(fixture.componentInstance.afters).toEqual([api]);
  });

  it('emits the themeChange output from core onThemeChange when observed', async () => {
    const fixture = await mountReady(WiredHost);

    (blokRegistry.last.config.onThemeChange as (t: ResolvedTheme) => void)('dark');
    await fixture.whenStable();

    expect(fixture.componentInstance.themeChanges).toEqual(['dark']);
  });

  it('threads the onBeforeRender transform return value into core config', async () => {
    await mountReady(WiredHost);
    const transform = blokRegistry.last.config.onBeforeRender as (
      b: OutputBlockData[]
    ) => OutputBlockData[];

    const result = transform([{ id: '1', type: 'paragraph', data: {} }]);

    expect(result).toHaveLength(2);
    expect(result[1].id).toBe('injected');
  });

  it('threads the onBeforePaste transform return value into core config', async () => {
    await mountReady(WiredHost);
    const transform = blokRegistry.last.config.onBeforePaste as (h: string) => string | null;

    expect(transform('<b>hi</b>')).toBe('<B>HI</B>');
  });

  it('does not wire callbacks the consumer did not provide', async () => {
    await mountReady(BareHost);
    const config = blokRegistry.last.config;

    expect(config.onChange).toBeUndefined();
    expect(config.onAfterRender).toBeUndefined();
    expect(config.onThemeChange).toBeUndefined();
    expect(config.onBeforeRender).toBeUndefined();
    expect(config.onBeforePaste).toBeUndefined();
  });
});

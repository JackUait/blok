import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, OutputBlockData, ResolvedTheme } from '@/types';

vi.mock('@bloklabs/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../packages/angular/src/blok-editor.component';

@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  imports: [BlokEditorComponent],
  template: `<blok-editor
    (change)="changes.push($event)"
    (afterRender)="afters.push($event)"
    (themeChange)="themeChanges.push($event)"
    [onBeforeRender]="beforeRender"
    [onBeforePaste]="beforePaste"
    [onError]="error"
  ></blok-editor>`,
})
class WiredHost {
  changes: unknown[] = [];
  afters: unknown[] = [];
  themeChanges: ResolvedTheme[] = [];
  errors: Error[] = [];
  beforeRender = (blocks: OutputBlockData[]): OutputBlockData[] => [
    ...blocks,
    { id: 'injected', type: 'paragraph', data: {} },
  ];
  beforePaste = (html: string): string => html.toUpperCase();
  error = (err: Error): void => {
    this.errors.push(err);
  };
}

@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  imports: [BlokEditorComponent],
  template: `<blok-editor></blok-editor>`,
})
class BareHost {}

@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  imports: [BlokEditorComponent],
  // onEnter/onSubmit are routed through the `config` escape hatch (no dedicated
  // @Input), matching how onEnter is exposed on this adapter.
  template: `<blok-editor [config]="{ onSubmit: submit }"></blok-editor>`,
})
class SubmitHost {
  submitted: unknown[] = [];
  submit = (data: unknown): void => {
    this.submitted.push(data);
  };
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

  it('threads the onError callback into core config', async () => {
    const fixture = await mountReady(WiredHost);
    const report = blokRegistry.last.config.onError as (
      error: Error,
      context: { source: string }
    ) => void;
    const error = new Error('boom');

    report(error, { source: 'save' });

    expect(fixture.componentInstance.errors).toEqual([error]);
  });

  it('does not wire callbacks the consumer did not provide', async () => {
    await mountReady(BareHost);
    const config = blokRegistry.last.config;

    expect(config.onChange).toBeUndefined();
    expect(config.onAfterRender).toBeUndefined();
    expect(config.onThemeChange).toBeUndefined();
    expect(config.onBeforeRender).toBeUndefined();
    expect(config.onBeforePaste).toBeUndefined();
    expect(config.onError).toBeUndefined();
    expect(config.onSubmit).toBeUndefined();
  });

  it('threads onSubmit into core config via the config escape hatch', async () => {
    const fixture = await mountReady(SubmitHost);
    const onSubmit = blokRegistry.last.config.onSubmit as (data: unknown, api: API) => void;

    expect(typeof onSubmit).toBe('function');

    const data = { blocks: [] };

    onSubmit(data, {} as API);

    expect(fixture.componentInstance.submitted).toEqual([data]);
  });
});

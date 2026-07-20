import { ChangeDetectionStrategy, Component, ViewChild } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OutputData } from '@/types';

vi.mock('@bloklabs/core', async () => ({ Blok: (await import('./_mock-blok')).MockBlok }));

import { blokRegistry } from './_mock-blok';
import { BlokEditorComponent } from '../../../packages/angular/src/blok-editor.component';

@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  imports: [BlokEditorComponent],
  template: `<blok-editor #ed="blok"></blok-editor>`,
})
class FacadeHost {
  @ViewChild(BlokEditorComponent) editor!: BlokEditorComponent;
  @ViewChild('ed') exported!: BlokEditorComponent;
}

async function mountReady(): Promise<ComponentFixture<FacadeHost>> {
  const fixture = TestBed.createComponent(FacadeHost);

  fixture.detectChanges();
  await fixture.whenStable();
  blokRegistry.last.resolveReady();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();

  return fixture;
}

describe('BlokEditorComponent instance exposure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blokRegistry.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes the live instance via @ViewChild and exportAs ("blok")', async () => {
    const fixture = await mountReady();
    const host = fixture.componentInstance;

    expect(host.editor.instance()).not.toBeNull();
    // exportAs ref points at the same component instance.
    expect(host.exported).toBe(host.editor);
    expect(host.exported.instance()).toBe(host.editor.instance());
  });

  it('delegates focus()/save$()/render() to the live instance', async () => {
    const fixture = await mountReady();
    const editor = blokRegistry.last;
    const data: OutputData = { time: 0, version: '0', blocks: [] };

    fixture.componentInstance.editor.focus(true);
    void fixture.componentInstance.editor.save$();
    void fixture.componentInstance.editor.render(data);

    expect(editor.focus).toHaveBeenCalledWith(true);
    expect(editor.save).toHaveBeenCalled();
    expect(editor.render).toHaveBeenCalledWith(data);
  });

  it('facade methods are no-ops before the instance is ready', async () => {
    const fixture = TestBed.createComponent(FacadeHost);

    fixture.detectChanges();
    await fixture.whenStable();

    // Not ready yet — calling the facade must not throw.
    expect(() => fixture.componentInstance.editor.focus()).not.toThrow();
    expect(fixture.componentInstance.editor.save$()).toBeUndefined();
  });
});

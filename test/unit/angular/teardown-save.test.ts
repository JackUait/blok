/**
 * Core sends one last save on destroy for an edit still in its batch window.
 * That save settles after Angular has torn down the template listeners, so
 * these tests boot the REAL core and check the host still receives it.
 */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Blok, OutputData } from '@/types';
import { BlokEditorComponent } from '../../../packages/angular/src/blok-editor.component';
import { Paragraph } from '../../../src/tools/paragraph';
import { Table } from '../../../src/tools/table/index';

const TOOLS = { paragraph: { class: Paragraph }, table: { class: Table } };

const DOC: OutputData = {
  blocks: [
    { id: 'p1', type: 'paragraph', data: { text: 'x' } },
    {
      id: 'tbl',
      type: 'table',
      data: { withHeadings: false, content: [[{ blocks: ['c00'] }, { blocks: ['c01'] }]] },
    },
    { id: 'c00', type: 'paragraph', data: { text: 'a' }, parent: 'tbl' },
    { id: 'c01', type: 'paragraph', data: { text: 'b' }, parent: 'tbl' },
  ],
};

@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  imports: [BlokEditorComponent],
  template: `@if (shown) {
    <blok-editor
      [tools]="tools"
      [(data)]="data"
      (save)="saves.push($event)"
      (ready)="editor = $event"
    ></blok-editor>
  }`,
})
class Host {
  shown = true;
  tools = TOOLS;
  data: OutputData = DOC;
  saves: OutputData[] = [];
  editor: Blok | null = null;
}

@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  imports: [BlokEditorComponent, ReactiveFormsModule],
  template: `@if (shown) {
    <blok-editor [tools]="tools" [formControl]="control" (ready)="editor = $event"></blok-editor>
  }`,
})
class FormControlHost {
  shown = true;
  tools = TOOLS;
  control = new FormControl<OutputData>(DOC, { nonNullable: true });
  editor: Blok | null = null;
}

@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  imports: [BlokEditorComponent, FormsModule],
  template: `@if (shown) {
    <blok-editor [tools]="tools" [(ngModel)]="model" (ready)="editor = $event"></blok-editor>
  }`,
})
class NgModelHost {
  shown = true;
  tools = TOOLS;
  model: OutputData = DOC;
  editor: Blok | null = null;
}

const textOf = (doc: OutputData | undefined, id: string): unknown =>
  (doc?.blocks.find((b) => b.id === id)?.data as { text?: string } | undefined)?.text;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const typeInto = (root: Element, blockId: string, text: string): void => {
  const editable = root.querySelector<HTMLElement>(`[data-blok-id="${blockId}"] [data-blok-tool="paragraph"]`);

  if (editable === null) {
    throw new Error(`no editable for ${blockId}`);
  }
  editable.textContent = text;
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text.slice(-1) }));
};

const mountReady = async <T extends { editor: Blok | null } = Host>(
  type: new () => T = Host as unknown as new () => T
): Promise<ComponentFixture<T>> => {
  const fixture = TestBed.createComponent(type);

  document.body.appendChild(fixture.nativeElement as HTMLElement);
  fixture.autoDetectChanges();

  const start = Date.now();

  while (fixture.componentInstance.editor === null) {
    if (Date.now() - start > 5000) {
      throw new Error('editor never became ready');
    }
    await wait(20);
  }
  // past the boot batch window
  await wait(500);

  return fixture;
};

describe('BlokEditorComponent final save on destroy (real core)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delivers an edit made inside the batch window to (save) and [(data)] after the editor is removed', async () => {
    const fixture = await mountReady();
    const host = fixture.componentInstance;
    const root = fixture.nativeElement as HTMLElement;

    host.saves = [];
    typeInto(root, 'p1', 'x-last');
    typeInto(root, 'c01', 'b-last');
    // let the MutationObserver record it, but stay inside the 400ms window
    await wait(50);
    host.shown = false;
    fixture.detectChanges();
    await wait(1000);

    const last = host.saves.at(-1);

    expect([textOf(last, 'p1'), textOf(last, 'c01')]).toStrictEqual(['x-last', 'b-last']);
    expect([textOf(host.data, 'p1'), textOf(host.data, 'c01')]).toStrictEqual(['x-last', 'b-last']);
    fixture.destroy();
  });

  it('delivers the final save when the whole host fixture is destroyed', async () => {
    const fixture = await mountReady();
    const host = fixture.componentInstance;
    const root = fixture.nativeElement as HTMLElement;

    host.saves = [];
    typeInto(root, 'c00', 'a-last');
    await wait(50);
    fixture.destroy();
    await wait(1000);

    expect(textOf(host.saves.at(-1), 'c00')).toBe('a-last');
  });

  it('delivers the final save to a [formControl] after the editor is removed', async () => {
    const fixture = await mountReady(FormControlHost);
    const host = fixture.componentInstance;

    typeInto(fixture.nativeElement as HTMLElement, 'c01', 'b-form');
    await wait(50);
    host.shown = false;
    fixture.detectChanges();
    await wait(1000);

    expect(textOf(host.control.value, 'c01')).toBe('b-form');
    fixture.destroy();
  });

  // Known gap: NgModel writes the host model through its own ngModelChange
  // emitter, whose template listener is gone by then. The adapter can't reach it.
  it.fails('delivers the final save to [(ngModel)] after the editor is removed', async () => {
    const fixture = await mountReady(NgModelHost);
    const host = fixture.componentInstance;

    typeInto(fixture.nativeElement as HTMLElement, 'c01', 'b-model');
    await wait(50);
    host.shown = false;
    fixture.detectChanges();
    await wait(1000);

    expect(textOf(host.model, 'c01')).toBe('b-model');
    fixture.destroy();
  });

  it('control: an edit whose batch window closed before removal reaches (save)', async () => {
    const fixture = await mountReady();
    const host = fixture.componentInstance;
    const root = fixture.nativeElement as HTMLElement;

    host.saves = [];
    typeInto(root, 'c01', 'b-settled');
    await wait(900);
    host.shown = false;
    fixture.detectChanges();
    await wait(200);

    expect(textOf(host.saves.at(-1), 'c01')).toBe('b-settled');
    fixture.destroy();
  });
});

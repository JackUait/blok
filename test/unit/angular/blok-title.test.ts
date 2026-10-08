import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Blok } from '@/types';
import { BlokEditorComponent } from '../../../packages/angular/src/blok-editor.component';
import { BlokTitleComponent } from '../../../packages/angular/src/blok-title.component';
import RawBlok from '../../../src/blok';
import { Paragraph } from '../../../src/tools/paragraph';

const TOOLS = { paragraph: { class: Paragraph } };
const HEADER = '[data-blok-page-header]';

/** The documented wiring: `[editor]="ed.instance()"`. */
@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  standalone: true,
  imports: [BlokEditorComponent, BlokTitleComponent],
  template: `@if (showTitle) {
      <blok-title data-testid="title-host" class="page-title" id="title" [editor]="ed.instance()"><span>child</span></blok-title>
    }
    <blok-editor
      #ed="blok"
      data-testid="editor-host"
      [tools]="tools"
      [config]="config"
      [recreateKey]="key"
      (ready)="editor = $event"
    ></blok-editor>`,
})
class Host {
  showTitle = true;
  tools = TOOLS;
  config = { pageTitle: true };
  key = 'a';
  editor: Blok | null = null;
}

@Component({
  standalone: true,
  imports: [BlokTitleComponent],
  template: `<blok-title data-testid="title-host" [editor]="null"></blok-title>`,
})
class NullHost {}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const until = async (check: () => boolean, label: string): Promise<void> => {
  const start = Date.now();

  while (!check()) {
    if (Date.now() - start > 5000) {
      throw new Error(`timed out: ${label}`);
    }
    await wait(20);
  }
};

const fixtures: Array<ComponentFixture<unknown>> = [];

const titleHost = (): HTMLElement => {
  const host = document.querySelector<HTMLElement>('[data-testid="title-host"]');

  if (host === null) {
    throw new Error('no title host');
  }

  return host;
};

const mountHost = async (): Promise<ComponentFixture<Host>> => {
  const fixture = TestBed.createComponent(Host);

  fixtures.push(fixture);
  document.body.appendChild(fixture.nativeElement as HTMLElement);
  fixture.autoDetectChanges();
  await until(() => titleHost().querySelector(HEADER) !== null, 'header in title host');

  return fixture;
};

describe('BlokTitleComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    fixtures.splice(0).forEach((fixture) => fixture.destroy());
    vi.restoreAllMocks();
  });

  it('renders an empty host for a null editor', () => {
    const fixture = TestBed.createComponent(NullHost);

    fixtures.push(fixture);
    document.body.appendChild(fixture.nativeElement as HTMLElement);
    fixture.detectChanges();

    expect(titleHost().childNodes).toHaveLength(0);
  });

  it('puts the header inside its host once the editor is ready', async () => {
    await mountHost();

    expect(titleHost().querySelectorAll(HEADER)).toHaveLength(1);
    expect(document.querySelectorAll(HEADER)).toHaveLength(1);
  });

  it('puts the header back above the first block when it is destroyed while the editor lives', async () => {
    const fixture = await mountHost();
    const host = fixture.componentInstance;

    host.showTitle = false;
    fixture.detectChanges();

    const header = document.querySelector(HEADER);
    const editorWrapper = document.querySelector('[data-testid="editor-host"] [data-blok-editor]');

    expect(host.editor).not.toBeNull();
    expect(header?.parentElement).toBe(editorWrapper);
    expect(header?.nextElementSibling).toBe(editorWrapper?.querySelector('[data-blok-redactor]'));
  });

  it('takes the new editor header when the editor is recreated', async () => {
    const fixture = await mountHost();
    const oldHeader = titleHost().querySelector(HEADER);

    fixture.componentInstance.key = 'b';
    fixture.detectChanges();
    await until(() => {
      const current = titleHost().querySelector(HEADER);

      return current !== null && current !== oldHeader;
    }, 'new header in title host');

    expect(titleHost().querySelectorAll(HEADER)).toHaveLength(1);
    expect(document.querySelectorAll(HEADER)).toHaveLength(1);
  });

  it('gives the title back to an editor the adapter did not create', async () => {
    const holder = document.createElement('div');

    document.body.appendChild(holder);
    // The src class gets its module APIs by a prototype swap at boot; the published type lists them.
    const editor = new RawBlok({ holder, tools: TOOLS, pageTitle: true }) as unknown as Blok;

    await editor.isReady;
    const fixture = TestBed.createComponent(BlokTitleComponent);

    document.body.appendChild(fixture.nativeElement as HTMLElement);
    fixture.componentRef.setInput('editor', editor);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector(HEADER)).not.toBeNull();
    fixture.destroy();

    const header = holder.querySelector(HEADER);
    const editorWrapper = holder.querySelector('[data-blok-editor]');

    expect(header?.parentElement).toBe(editorWrapper);
    expect(header?.nextElementSibling).toBe(editorWrapper?.querySelector('[data-blok-redactor]'));
    editor.destroy();
  });

  it('keeps host attributes and renders no projected content', async () => {
    await mountHost();

    expect(titleHost().className).toBe('page-title');
    expect(titleHost().id).toBe('title');
    expect(titleHost().textContent).not.toContain('child');
  });
});

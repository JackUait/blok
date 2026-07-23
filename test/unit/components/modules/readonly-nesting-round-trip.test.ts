/**
 * Read-only toggling falls back to a save/clear/render reload whenever any
 * registered tool cannot switch in place. That reload is an internal
 * round-trip, so it must read the editor's own model — not the host-facing
 * dialect, whose legacy collapse can only express list nesting as nested
 * `items[]` and therefore drops every item nested by the flat `data.depth`
 * carrier.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { ListItem } from '../../../../src/tools/list';
import { Paragraph } from '../../../../src/tools/paragraph';

/**
 * Supports read-only but cannot switch in place — no `setReadOnly` on the
 * prototype — which is what pushes the module onto the reload path.
 */
class ReloadForcingTool {
  private text: string;

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public constructor({ data }: { data: { text?: string } }) {
    this.text = data.text ?? '';
  }

  public render(): HTMLElement {
    const element = document.createElement('div');

    element.textContent = this.text;

    return element;
  }

  public save(): { text: string } {
    return { text: this.text };
  }
}

/**
 * The published `Blok` class declaration lists the config-shaped surface only;
 * the module APIs reach the instance through the prototype swap at boot.
 * @param editor - editor instance under test
 */
const runtime = (editor: Blok): EditorRuntime => editor as unknown as EditorRuntime;

interface EditorRuntime {
  readOnly: { toggle: (state: boolean) => Promise<boolean> };
  blocks: { insert: (type?: string, data?: Record<string, unknown>) => unknown };
  history: { canUndo: () => boolean };
}

const markers = (): Array<string | undefined> =>
  [...document.querySelectorAll('[data-blok-tool="list"]')]
    .map(item => item.querySelector('[data-list-marker]')?.textContent ?? undefined);

describe('read-only reload', () => {
  let holder: HTMLDivElement | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder?.remove();
    holder = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps list nesting when toggling read-only in the legacy dialect', async () => {
    const editor = new Blok({
      holder,
      minHeight: 50,
      dataModel: 'legacy',
      tools: { list: ListItem, reloadForcing: ReloadForcingTool },
      data: {
        blocks: [
          { type: 'reloadForcing', data: { text: 'forces the reload path' } },
          { type: 'list', data: { style: 'unordered', text: 'root' } },
          { type: 'list', data: { style: 'unordered', text: 'nested', depth: 1 } },
        ],
      },
    });

    await editor.isReady;

    expect(markers()).toEqual(['•', '◦']);

    await runtime(editor).readOnly.toggle(true);

    expect(markers()).toEqual(['•', '◦']);
  });

  /**
   * The reload reloaded the document — clear + render straight into Yjs — and
   * `fromJSON` clears the undo history with it, so looking at a document in
   * read-only mode silently cost the user every undo step. Nothing about the
   * blocks changes across the toggle, so the document is left alone and only
   * the view is rebuilt.
   */
  it('keeps the undo history across a read-only toggle', async () => {
    const editor = new Blok({
      holder,
      minHeight: 50,
      tools: { paragraph: Paragraph, reloadForcing: ReloadForcingTool },
      data: {
        blocks: [{ type: 'reloadForcing', data: { text: 'forces the reload path' } }],
      },
    });

    await editor.isReady;

    runtime(editor).blocks.insert('paragraph', { text: 'undoable' });

    expect(runtime(editor).history.canUndo()).toBe(true);

    await runtime(editor).readOnly.toggle(true);

    expect(runtime(editor).history.canUndo()).toBe(true);
  });
});

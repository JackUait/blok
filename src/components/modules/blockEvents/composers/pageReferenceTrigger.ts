import { PAGE_REFERENCE_ATTR, PAGE_REFERENCE_FALLBACK } from '../../../../shared/page-reference';
import { PagePicker } from '../../../../tools/page/page-picker';
import type { PageConfig, PageSearchResult } from '../../../../tools/page/types';
import type { Block } from '../../../block';
import { Dom } from '../../../dom';
import { getCaretOffset } from '../../../utils/caret';
import { isInsideKeyboardOwner } from '../utils/keyboard';
import { isTextLikeBlock } from '../utils/text-like-block';
import { BlockEventComposer } from './__base';

interface ActiveQuery {
  block: Block;
  input: HTMLElement;
  start: number;
  end: number;
  text: string;
}

const findQuery = (text: string): { start: number; query: string; text: string } | null => {
  const match = /(?:^|[\s([{])(@|\[\[)([^\n@\[\]]*)$/.exec(text);

  if (match === null) {
    return null;
  }

  const trigger = `${match[1]}${match[2]}`;

  return { start: text.length - trigger.length, query: match[2], text: trigger };
};

const textPosition = (input: HTMLElement, offset: number): { node: Text; offset: number } | null => {
  const walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT);
  const state = { consumed: 0, node: walker.nextNode() };

  while (state.node !== null) {
    const length = state.node.textContent?.length ?? 0;

    if (state.consumed + length >= offset) {
      return { node: state.node as Text, offset: offset - state.consumed };
    }
    state.consumed += length;
    state.node = walker.nextNode();
  }

  return null;
};

export class PageReferenceTrigger extends BlockEventComposer {
  private picker: PagePicker | null = null;
  private active: ActiveQuery | null = null;
  private searchToken = 0;
  private resultGeneration = 0;
  private resultUnsubscribers: Array<() => void> = [];

  public get opened(): boolean {
    return this.picker?.opened ?? false;
  }

  public async handleInput(event: InputEvent): Promise<boolean> {
    const block = this.Blok.BlockManager.currentBlock;
    const input = block?.currentInput;
    const page = this.pageConfig;

    if (event.isComposing || this.Blok.ReadOnly.isEnabled || page?.search === undefined ||
      block === undefined || input === undefined || !isTextLikeBlock(block.tool) ||
      Dom.isNativeInput(event.target) || isInsideKeyboardOwner(event.target) ||
      !(event.target instanceof Node) || !input.contains(event.target)) {
      this.close();

      return false;
    }

    const selection = window.getSelection();

    if (selection === null || !selection.isCollapsed || selection.rangeCount === 0 ||
      !input.contains(selection.getRangeAt(0).startContainer)) {
      this.close();

      return false;
    }

    const caretNode = selection.getRangeAt(0).startContainer;
    const caretElement = caretNode instanceof Element ? caretNode : caretNode.parentElement;
    const enclosingMark = caretElement?.closest('a,code');

    if (enclosingMark !== null && enclosingMark !== undefined && input.contains(enclosingMark)) {
      this.close();

      return false;
    }

    const end = getCaretOffset(input);
    const before = (input.textContent ?? '').slice(0, end);
    const query = findQuery(before);

    if (query === null) {
      this.close();

      return false;
    }

    const active = this.active;

    if (!this.opened || active === null || active.input !== input || active.start !== query.start) {
      this.close();
      this.picker = new PagePicker(this.Blok.I18n.t('toolNames.page'), this.Blok.I18n.t('tools.page.unresolved'));
      this.picker.open(query.query, input, (pageId) => {
        void this.commit(pageId);
      });
    }

    this.active = { block, input, start: query.start, end, text: query.text };
    const token = ++this.searchToken;

    try {
      const results = await page.search(query.query);
      const candidates = results.filter((hit) => typeof hit.pageId === 'string' &&
        hit.pageId.trim() !== '' && hit.access !== 'none');
      const visible: readonly PageSearchResult[] = page.resolve === undefined
        ? candidates
        : (await Promise.all(candidates.map(async (hit) => {
          try {
            const info = await page.resolve?.(hit.pageId);

            return info !== null && info !== undefined && info.access !== 'none'
              ? { ...hit, title: info.title }
              : null;
          } catch {
            return null;
          }
        }))).filter((hit): hit is NonNullable<typeof hit> => hit !== null);

      if (token !== this.searchToken || !this.opened) {
        return false;
      }
      if (results.length > 0 && visible.length === 0) {
        this.close();

        return false;
      }
      this.clearResultSubscriptions();
      this.picker?.setResults(visible);

      return this.subscribeToResults(page, visible);
    } catch {
      if (token === this.searchToken) {
        this.close();
      }

      return false;
    }
  }

  public handleKeydown(event: KeyboardEvent): boolean {
    if (!this.opened) {
      return false;
    }

    const handled = this.picker?.handleKeydown(event) ?? false;

    if (!this.opened && event.key !== 'Enter') {
      this.close();
    }

    return handled;
  }

  public close(): void {
    ++this.searchToken;
    this.clearResultSubscriptions();
    this.picker?.close();
    this.picker = null;
    this.active = null;
  }

  public destroy(): void {
    this.close();
  }

  private subscribeToResults(page: PageConfig, results: readonly PageSearchResult[]): boolean {
    const generation = this.resultGeneration;

    for (const hit of results) {
      const unsubscribe = page.subscribe?.(hit.pageId, () => {
        if (generation === this.resultGeneration) {
          this.close();
        }
      });

      if (typeof unsubscribe === 'function' && generation === this.resultGeneration) {
        this.resultUnsubscribers.push(unsubscribe);
      }
      if (typeof unsubscribe === 'function' && generation !== this.resultGeneration) {
        unsubscribe();
      }
      if (generation !== this.resultGeneration) {
        return false;
      }
    }

    return true;
  }

  private clearResultSubscriptions(): void {
    ++this.resultGeneration;
    this.resultUnsubscribers.forEach((unsubscribe) => unsubscribe());
    this.resultUnsubscribers = [];
  }

  private get pageConfig(): PageConfig | undefined {
    return this.Blok.Tools.blockTools.get('page')?.settings;
  }

  private async commit(pageId: string): Promise<void> {
    const active = this.active;
    const token = this.searchToken;
    const page = this.pageConfig;

    if (active === null || page === undefined) {
      return;
    }

    try {
      const info = await page.resolve?.(pageId);

      if (page.resolve !== undefined && (info === null || info === undefined || info.access === 'none')) {
        this.close();

        return;
      }
    } catch {
      this.close();

      return;
    }

    if (token !== this.searchToken || this.active !== active) {
      return;
    }

    const { input, block, start, end, text } = active;
    const selection = window.getSelection();
    const caret = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;

    if (selection === null || caret === null || !caret.collapsed || !input.contains(caret.startContainer) ||
      getCaretOffset(input) !== end || (input.textContent ?? '').slice(start, end) !== text) {
      this.close();

      return;
    }

    const from = textPosition(input, start);
    const to = textPosition(input, end);

    if (from === null || to === null) {
      this.close();

      return;
    }

    this.Blok.YjsManager.startSubStep();
    const range = document.createRange();

    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    range.deleteContents();

    const anchor = document.createElement('a');

    anchor.setAttribute(PAGE_REFERENCE_ATTR, pageId);
    anchor.textContent = PAGE_REFERENCE_FALLBACK;
    range.insertNode(anchor);

    const after = document.createRange();

    after.setStartAfter(anchor);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
    block.dispatchChange();
    this.Blok.YjsManager.stopCapturing();
    this.close();
  }
}

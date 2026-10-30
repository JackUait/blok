import { PAGE_REFERENCE_ATTR, PAGE_REFERENCE_FALLBACK } from '../../../../shared/page-reference';
import { PagePicker, type PagePickerNewPage } from '../../../../tools/page/page-picker';
import { createdId } from '../../../../tools/page/page-values';
import { searchVisiblePages } from '../../../../tools/page/search-pages';
import type { PageConfig, PageSearchResult } from '../../../../tools/page/types';
import type { Block } from '../../../block';
import { Dom } from '../../../dom';
import { getCaretOffset } from '../../../utils/caret';
import { generateBlockId } from '../../../utils/id-generator';
import { isInsideKeyboardOwner } from '../utils/keyboard';
import { isTextLikeBlock } from '../utils/text-like-block';
import { BlockEventComposer } from './__base';
import { paintMentionQuery } from './mention-query-highlight';

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
  /** The "@query" whose parent step is showing: its search field holds the focus. */
  private parentStep: ActiveQuery | null = null;

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
      const picker = new PagePicker(
        this.Blok.I18n.t('toolNames.page'),
        this.Blok.I18n.t('tools.page.unresolved'),
        this.Blok.I18n.t('tools.page.draft'),
        this.Blok.I18n.t('popover.nothingFound'),
        (key, vars) => this.Blok.I18n.t(key, vars)
      );

      this.picker = picker;
      picker.open(query.query, input, (pageId) => {
        void this.commit(pageId);
      }, {
        newPage: this.newPageActions(page),
        onClose: () => this.handlePickerClosed(picker),
      });
    }

    this.active = { block, input, start: query.start, end, text: query.text };
    this.paintQuery(this.active);
    const token = ++this.searchToken;

    this.picker?.startSearch(query.query);
    try {
      const visible = await searchVisiblePages(page, query.query);

      if (token !== this.searchToken || !this.opened) {
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
    const picker = this.picker;

    ++this.searchToken;
    this.clearResultSubscriptions();
    this.picker = null;
    this.active = null;
    this.parentStep = null;
    paintMentionQuery(this, null);
    picker?.close();
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

    this.insertMention(active, pageId);
  }

  /**
   * The picker closed itself (Escape, Tab, a press outside). A close this
   * trigger started has already dropped the picker, so it is ignored here.
   */
  private handlePickerClosed(picker: PagePicker): void {
    if (this.picker !== picker) {
      return;
    }
    const step = this.parentStep;

    this.close();
    if (step !== null) {
      this.restoreCaret(step);
    }
  }

  /** The New page items, only for a host that opted in and can create pages. */
  private newPageActions(page: PageConfig): PagePickerNewPage | undefined {
    if (page.createFromMention !== true || page.create === undefined) {
      return undefined;
    }

    return {
      onSubPage: (query) => this.createAndMention(query),
      onPageIn: (query) => this.chooseParentFor(query),
    };
  }

  private chooseParentFor(title: string): void {
    const active = this.active;
    const page = this.pageConfig;
    const picker = this.picker;

    if (active === null || page === undefined || picker === null) {
      return;
    }

    const token = { value: 0 };

    // The field takes focus; leaving the step puts the caret back after "@query".
    picker.chooseParent({
      placeholder: this.Blok.I18n.t('tools.page.search'),
      onQuery: (query) => {
        const mine = ++token.value;

        void searchVisiblePages(page, query).catch((): [] => []).then((results) => {
          if (mine === token.value && this.picker === picker) {
            picker.setResults(results);
          }
        });
      },
      onChoose: (parentId) => {
        this.restoreCaret(active);

        return this.createAndMention(title, parentId);
      },
    });
    this.parentStep = active;
  }

  /**
   * Creates a page titled `title` and mentions it in place of "@query".
   * If the "@query" text or the caret moved while `create` ran, the page
   * stays created but no mention is inserted: guessing a new spot could
   * drop a link into text the user is writing.
   */
  private async createAndMention(title: string, parentId?: string): Promise<void> {
    const active = this.active;
    const page = this.pageConfig;

    if (active === null || page?.create === undefined || !this.isIntact(active)) {
      this.close();

      return;
    }

    const minted = generateBlockId();
    const init = parentId === undefined ? { pageId: minted, title } : { pageId: minted, title, parentId };

    try {
      const pageId = createdId(await page.create(init)) ?? minted;

      if (this.active === active && this.isIntact(active)) {
        this.insertMention(active, pageId);
      }
    } catch {
      // A failed create inserts nothing; the host reports the error.
    }
    if (this.active === active) {
      this.close();
    }
  }

  /** The caret sits right after "@query" and the text is unchanged. */
  private isIntact({ input, start, end, text }: ActiveQuery): boolean {
    const selection = window.getSelection();
    const caret = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;

    return caret !== null && caret !== undefined && caret.collapsed && input.contains(caret.startContainer) &&
      getCaretOffset(input) === end && (input.textContent ?? '').slice(start, end) === text;
  }

  private restoreCaret({ input, end }: ActiveQuery): void {
    const at = textPosition(input, end);
    const selection = window.getSelection();

    if (at === null || selection === null) {
      return;
    }
    input.focus();
    const range = document.createRange();

    range.setStart(at.node, at.offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  private paintQuery({ input, start, end }: ActiveQuery): void {
    const from = textPosition(input, start);
    const to = textPosition(input, end);

    if (from === null || to === null) {
      paintMentionQuery(this, null);

      return;
    }
    const range = document.createRange();

    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    paintMentionQuery(this, range);
  }

  /** Replaces "@query" with an inline page reference and closes the menu. */
  private insertMention(active: ActiveQuery, pageId: string): void {
    const { input, block, start, end } = active;
    const selection = window.getSelection();

    if (selection === null || !this.isIntact(active)) {
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

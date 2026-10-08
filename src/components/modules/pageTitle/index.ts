import { Module } from '../../__module';
import { DATA_ATTR } from '../../constants/data-attributes';
import { I18nChanged } from '../../events';
import { logLabeled } from '../../utils';
import type { EditorWidth } from '../../../../types/api/width';
import type { TitleChange } from '../../../../types/api/title';
import type { PageIcon } from '../../../../types/tools/page';
import { normalizeTitleConfig, type ResolvedTitleConfig } from '../../utils/title-config';
import { setCaretAtXPosition } from '../../utils/caret';
import { buildHeader, findHolder, holderProblem, type HeaderNodes } from './header-dom';
import { bindTitleKeyboard } from './title-keyboard';
import { createIconControl } from './icon-control';

// main.css keys the gutter and the content-align margins on these. A header in
// an outside holder has no wrapper ancestor, so it carries its own copy.
const WRAPPER_LAYOUT_ATTRIBUTES = [
  DATA_ATTR.contentAlign,
  DATA_ATTR.toolbarPosition,
  DATA_ATTR.toolbarHidden,
  DATA_ATTR.controlsHidden,
  DATA_ATTR.rtl,
];

/** The caret's character offset in the title, or null when the caret is elsewhere. */
const caretOffsetIn = (title: HTMLElement): number | null => {
  const selection = window.getSelection();
  const node = selection?.anchorNode ?? null;

  if (selection === null || node === null || !title.contains(node)) {
    return null;
  }
  const before = document.createRange();

  before.setStart(title, 0);
  before.setEnd(node, selection.anchorOffset);

  return before.toString().length;
};

export class PageTitle extends Module {
  private resolved: ResolvedTitleConfig | null = null;
  private dom: HeaderNodes | null = null;
  private stopPageListener: (() => void) | null = null;
  private unbindKeyboard: (() => void) | null = null;
  private readOnly = false;
  private iconControl: { redraw(): void; destroy(): void } | null = null;

  public get isEnabled(): boolean {
    return this.dom !== null;
  }

  public get titleElement(): HTMLElement | null {
    return this.dom?.title ?? null;
  }

  public get headerElement(): HTMLElement | null {
    return this.dom?.header ?? null;
  }

  public prepare(): void {
    this.resolved = normalizeTitleConfig(this.config.pageTitle);
    if (this.resolved === null) {
      return;
    }
    const { I18n, UI, YjsManager, ReadOnly } = this.Blok;

    const dom = buildHeader({
      placeholder: this.resolved.placeholder ?? I18n.t('title.placeholder'),
      ariaLabel: I18n.t('title.ariaLabel'),
    });
    const instance = UI.nodes.wrapper.getAttribute(DATA_ATTR.instance);

    // UI's font-token rule is scoped by this id.
    if (instance !== null) {
      dom.header.setAttribute(DATA_ATTR.instance, instance);
    }
    // Set only once placed: isEnabled reads it, and a detached title must never take a Backspace join.
    this.placeInitially(dom.header, this.resolved.holder);
    this.dom = dom;
    this.renderText();
    this.syncWidth(UI.getWidthMode());
    this.syncDirection();
    this.toggleReadOnly(ReadOnly.isEnabled);
    if (this.resolved.icon) {
      this.iconControl = createIconControl(this.dom.iconRow, {
        getIcon: () => this.getIcon(),
        setIcon: (icon) => this.setIcon(icon, 'user'),
        isReadOnly: () => this.readOnly,
        labels: () => ({ add: I18n.t('title.addIcon'), change: I18n.t('title.changeIcon') }),
        picker: () => ({ i18n: this.Blok.API.methods.i18n, locale: I18n.getLocale() }),
      });
    }
    this.dom.title.addEventListener('input', this.onInput);
    this.dom.title.addEventListener('focusin', this.onFocusIn);
    this.unbindKeyboard = bindTitleKeyboard(this.dom.title, {
      isReadOnly: () => this.readOnly,
      // The title write and the insert land in the same task, so they join one undo step.
      split: (html) => {
        this.Blok.API.methods.blocks.insert(undefined, { text: html }, {}, 0, false);
        this.Blok.API.methods.caret.setToFirstBlock('start');
      },
      toFirstBlock: (x) => this.caretToFirstBlock(x),
      undo: () => this.Blok.API.methods.history.undo(),
      redo: () => this.Blok.API.methods.history.redo(),
      // A plain Event, not InputEvent: paste and Enter are their own undo steps.
      commit: () => this.dom?.title.dispatchEvent(new Event('input')),
    });
    this.stopPageListener = YjsManager.onPageChange((key, source) => this.onPageChange(key, source));
    this.eventsDispatcher.on(I18nChanged, this.relabel);
  }

  public getText(): string {
    return this.Blok.YjsManager.getPageFields().title ?? '';
  }

  public setText(text: string, source: 'api'): void {
    if (!this.writeField('title', text)) {
      return;
    }
    this.renderText();
    this.notifyTitle({ source });
  }

  public getIcon(): PageIcon | null {
    return this.Blok.YjsManager.getPageFields().icon ?? null;
  }

  public setIcon(icon: PageIcon | null, source: 'user' | 'api'): void {
    if (!this.writeField('icon', icon)) {
      return;
    }
    this.iconControl?.redraw();
    this.resolved?.onIconChange?.(this.getIcon(), { source });
  }

  /** Redraw from the document after a load. Fires no callbacks. */
  public refresh(): void {
    this.renderText();
    this.iconControl?.redraw();
  }

  public focus(position: 'start' | 'end' = 'end'): void {
    const title = this.dom?.title;

    if (title === undefined) {
      return;
    }
    title.focus();
    // On the text node: renderText reads the anchor offset as a character offset.
    const text = title.firstChild;

    if (text === null) {
      window.getSelection()?.setPosition(title, 0);
    } else {
      window.getSelection()?.setPosition(text, position === 'start' ? 0 : (text.textContent ?? '').length);
    }
  }

  public focusAtX(x: number | null): void {
    const title = this.dom?.title;

    if (title === undefined) {
      return;
    }
    title.focus();
    if (x === null) {
      this.focus('end');

      return;
    }
    setCaretAtXPosition(title, x, false);
  }

  /** Written before focus moves, so the undo step's caret-before stays in the block. */
  public appendAndFocus(text: string): void {
    const title = this.dom?.title;

    if (title === undefined) {
      return;
    }
    const join = (title.textContent ?? '').length;

    title.append(text);
    title.normalize();
    title.dispatchEvent(new Event('input'));
    title.focus();
    window.getSelection()?.setPosition(title.firstChild ?? title, title.firstChild === null ? 0 : join);
  }

  public mount(holder: HTMLElement | string): void {
    const target = findHolder(holder);

    if (target === null) {
      throw new Error(`blok.title.mount: ${holderProblem(typeof holder === 'string' ? holder : '')}`);
    }
    if (this.dom !== null) {
      target.appendChild(this.dom.header);
    }
  }

  public syncWidth(mode: EditorWidth): void {
    if (mode === 'full') {
      this.dom?.header.setAttribute(DATA_ATTR.width, 'full');
    } else {
      this.dom?.header.removeAttribute(DATA_ATTR.width);
    }
  }

  public syncDirection(): void {
    this.dom?.header.setAttribute('dir', this.isRtl ? 'rtl' : 'ltr');
    this.syncLayoutAttributes();
  }

  /** Call after any of WRAPPER_LAYOUT_ATTRIBUTES changes on the wrapper. */
  public syncLayoutAttributes(): void {
    const header = this.dom?.header;

    if (header === undefined) {
      return;
    }
    const { wrapper } = this.Blok.UI.nodes;

    for (const name of WRAPPER_LAYOUT_ATTRIBUTES) {
      const value = wrapper.getAttribute(name);

      if (value === null) {
        header.removeAttribute(name);
      } else {
        header.setAttribute(name, value);
      }
    }
  }

  // ReadOnly calls this during its own prepare, before ours: dom may still be null.
  public toggleReadOnly(state: boolean): void {
    this.readOnly = state;
    if (this.dom !== null) {
      this.dom.title.setAttribute('contenteditable', state ? 'false' : 'true');
    }
    this.iconControl?.redraw();
  }

  public destroy(): void {
    this.stopPageListener?.();
    this.unbindKeyboard?.();
    this.unbindKeyboard = null;
    this.iconControl?.destroy();
    this.iconControl = null;
    this.dom?.title.removeEventListener('focusin', this.onFocusIn);
    this.eventsDispatcher.off(I18nChanged, this.relabel);
    this.dom?.header.remove();
    this.dom = null;
  }

  private placeInitially(header: HTMLElement, holder: HTMLElement | string | null): void {
    const target = holder === null ? null : findHolder(holder);

    if (typeof holder === 'string' && target === null) {
      logLabeled(`title.holder: ${holderProblem(holder)}; the title is drawn above the first block`, 'error');
    }
    if (target !== null) {
      target.appendChild(header);

      return;
    }
    const { wrapper, redactor } = this.Blok.UI.nodes;

    wrapper.insertBefore(header, redactor);
  }

  private readonly onInput = (event: Event): void => {
    const title = this.dom?.title;

    if (title === undefined) {
      return;
    }
    const text = (title.textContent ?? '').replace(/\n/g, ' ');

    // A stray <br> hides the :empty placeholder.
    if (text === '') {
      title.replaceChildren();
    } else if (title.childNodes.length !== 1 || !(title.firstChild instanceof Text)) {
      this.flattenToText(title, text);
    }
    if (!this.writeField('title', text, { typing: event instanceof InputEvent })) {
      return;
    }
    this.renderText();
    this.notifyTitle({ source: 'user' });
  };

  /**
   * Writes one page field and marks the document unsaved.
   * @returns false when the value was already there: setPageField then writes nothing
   */
  private writeField(key: 'title' | 'icon', value: string | PageIcon | null, options?: { typing: boolean }): boolean {
    const { YjsManager, ModificationsObserver } = this.Blok;
    const before = JSON.stringify(YjsManager.getPageFields()[key] ?? null);

    YjsManager.setPageField(key, value, options);
    if (JSON.stringify(YjsManager.getPageFields()[key] ?? null) === before) {
      return false;
    }
    ModificationsObserver.markPageEdited();

    return true;
  }

  /** Drops elements a native format key or a drop put in. Keeps the caret offset, clamped. */
  private flattenToText(title: HTMLElement, text: string): void {
    const caret = caretOffsetIn(title);

    title.replaceChildren(text);
    if (caret !== null && title.firstChild !== null) {
      window.getSelection()?.setPosition(title.firstChild, Math.min(caret, text.length));
    }
  }

  private caretToFirstBlock(x: number | null): void {
    const { API, BlockManager } = this.Blok;

    API.methods.caret.setToFirstBlock('start');
    const first = BlockManager.getBlockByIndex(0);

    if (first !== undefined && x !== null) {
      this.Blok.Caret.setToBlockAtXPosition(first, x, true);
    }
  }

  // A selected block or a stale current block would take Backspace, Enter and inline-tool shortcuts.
  private readonly onFocusIn = (): void => {
    this.Blok.BlockSelection.clearSelection();
    this.Blok.BlockManager.unsetCurrentBlock();
  };

  private onPageChange(key: 'title' | 'icon', source: 'undo' | 'redo' | 'remote'): void {
    // A peer saved its own write; another tab's write is marked by TabSync.
    if (source !== 'remote') {
      this.Blok.ModificationsObserver.markPageEdited();
    }
    if (key === 'title') {
      this.renderText();
      this.notifyTitle({ source });
    }
    if (key === 'icon') {
      this.iconControl?.redraw();
      this.resolved?.onIconChange?.(this.getIcon(), { source });
    }
    if (source !== 'remote') {
      this.focus('end');
    }
  }

  /** Keeps the caret offset, clamped. Writes no empty text node: the placeholder needs :empty. */
  private renderText(): void {
    const title = this.dom?.title;

    if (title === undefined) {
      return;
    }
    const text = this.getText();

    if ((title.textContent ?? '') === text) {
      return;
    }
    const caret = caretOffsetIn(title);

    title.replaceChildren(...(text === '' ? [] : [text]));
    if (caret !== null && title.firstChild !== null) {
      window.getSelection()?.setPosition(title.firstChild, Math.min(caret, text.length));
    }
  }

  private notifyTitle(change: TitleChange): void {
    this.resolved?.onChange?.(this.getText(), change);
  }

  private readonly relabel = (): void => {
    if (this.dom === null || this.resolved === null) {
      return;
    }
    const { I18n } = this.Blok;

    this.dom.title.setAttribute('data-placeholder', this.resolved.placeholder ?? I18n.t('title.placeholder'));
    this.dom.title.setAttribute('aria-label', I18n.t('title.ariaLabel'));
    this.iconControl?.redraw();
  };
}

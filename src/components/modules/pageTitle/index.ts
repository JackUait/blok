import { Module } from '../../__module';
import { DATA_ATTR } from '../../constants/data-attributes';
import { I18nChanged } from '../../events';
import { logLabeled } from '../../utils';
import type { EditorWidth } from '../../../../types/api/width';
import type { TitleChange } from '../../../../types/api/title';
import type { PageIcon } from '../../../../types/tools/page';
import { normalizeTitleConfig, type ResolvedTitleConfig } from '../../utils/title-config';
import { setCaretAtXPosition } from '../../utils/caret';
import { buildHeader, type HeaderNodes } from './header-dom';
import { bindTitleKeyboard } from './title-keyboard';

export class PageTitle extends Module {
  private resolved: ResolvedTitleConfig | null = null;
  private dom: HeaderNodes | null = null;
  private stopPageListener: (() => void) | null = null;
  private unbindKeyboard: (() => void) | null = null;
  private readOnly = false;

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

    this.dom = buildHeader({
      placeholder: this.resolved.placeholder ?? I18n.t('title.placeholder'),
      ariaLabel: I18n.t('title.ariaLabel'),
    });
    const instance = UI.nodes.wrapper.getAttribute(DATA_ATTR.instance);

    // UI's font-token rule is scoped by this id.
    if (instance !== null) {
      this.dom.header.setAttribute(DATA_ATTR.instance, instance);
    }
    this.placeInitially(this.resolved.holder);
    this.renderText();
    this.syncWidth(UI.getWidthMode());
    this.syncDirection();
    this.toggleReadOnly(ReadOnly.isEnabled);
    this.dom.title.addEventListener('input', this.onInput);
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
    this.Blok.YjsManager.setPageField('title', text);
    this.renderText();
    this.notifyTitle({ source });
  }

  public getIcon(): PageIcon | null {
    return this.Blok.YjsManager.getPageFields().icon ?? null;
  }

  public setIcon(icon: PageIcon | null, _source: 'user' | 'api'): void {
    this.Blok.YjsManager.setPageField('icon', icon);
  }

  /** Redraw from the document after a load. Fires no callbacks. */
  public refresh(): void {
    this.renderText();
  }

  public focus(position: 'start' | 'end' = 'end'): void {
    const title = this.dom?.title;

    if (title === undefined) {
      return;
    }
    title.focus();
    window.getSelection()?.setPosition(title, position === 'start' ? 0 : title.childNodes.length);
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
    const target = typeof holder === 'string' ? document.querySelector<HTMLElement>(holder) : holder;

    if (target === null) {
      throw new Error(`blok.title.mount: no element matches "${typeof holder === 'string' ? holder : ''}"`);
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
  }

  // ReadOnly calls this during its own prepare, before ours: dom may still be null.
  public toggleReadOnly(state: boolean): void {
    this.readOnly = state;
    if (this.dom !== null) {
      this.dom.title.setAttribute('contenteditable', state ? 'false' : 'true');
    }
  }

  public destroy(): void {
    this.stopPageListener?.();
    this.unbindKeyboard?.();
    this.unbindKeyboard = null;
    this.eventsDispatcher.off(I18nChanged, this.relabel);
    this.dom?.header.remove();
    this.dom = null;
  }

  private placeInitially(holder: HTMLElement | string | null): void {
    if (this.dom === null) {
      return;
    }
    const target = typeof holder === 'string' ? document.querySelector<HTMLElement>(holder) : holder;

    if (typeof holder === 'string' && target === null) {
      logLabeled(`title.holder "${holder}" matches no element; the title is drawn above the first block`, 'error');
    }
    if (target !== null) {
      target.appendChild(this.dom.header);

      return;
    }
    const { wrapper, redactor } = this.Blok.UI.nodes;

    wrapper.insertBefore(this.dom.header, redactor);
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
    this.Blok.YjsManager.setPageField('title', text, { typing: event instanceof InputEvent });
    this.renderText();
    this.notifyTitle({ source: 'user' });
  };

  /** Drops elements a native format key or a drop put in. Keeps the caret offset, clamped. */
  private flattenToText(title: HTMLElement, text: string): void {
    const selection = window.getSelection();
    const node = selection?.anchorNode ?? null;
    const inTitle = selection !== null && node !== null && title.contains(node);
    const before = document.createRange();

    if (inTitle) {
      before.setStart(title, 0);
      before.setEnd(node, selection.anchorOffset);
    }
    const caret = before.toString().length;

    title.replaceChildren(text);
    if (inTitle && title.firstChild !== null) {
      selection.setPosition(title.firstChild, Math.min(caret, text.length));
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

  private onPageChange(key: 'title' | 'icon', source: 'undo' | 'redo' | 'remote'): void {
    if (key === 'title') {
      this.renderText();
      this.notifyTitle({ source });
      if (source !== 'remote') {
        this.focus('end');
      }
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
    const selection = window.getSelection();
    const node = selection?.anchorNode ?? null;
    const caret = selection !== null && node !== null && title.contains(node) ? selection.anchorOffset : null;

    title.replaceChildren(...(text === '' ? [] : [text]));
    if (caret !== null && title.firstChild !== null) {
      selection?.setPosition(title.firstChild, Math.min(caret, text.length));
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
  };
}

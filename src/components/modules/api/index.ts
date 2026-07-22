/**
 * @module API
 * @copyright <CodeX> 2018
 *
 * Each block has a Blok API instance to use provided public methods
 * if you cant to read more about how API works, please see docs
 */
import type { API as APIInterfaces } from '../../../../types';
import { Module } from '../../__module';

/**
 * @class API
 */
export class API extends Module {
  /**
   * Blok Core API modules
   */
  public get methods(): APIInterfaces {
    const apiConfig = this.config;

    return {
      blocks: this.Blok.BlocksAPI.methods,
      caret: this.Blok.CaretAPI.methods,
      tools: this.Blok.ToolsAPI.methods,
      events: this.Blok.EventsAPI.methods,
      history: this.Blok.HistoryAPI.methods,
      listeners: this.Blok.ListenersAPI.methods,
      notifier: this.Blok.NotifierAPI.methods,
      sanitizer: this.Blok.SanitizerAPI.methods,
      saver: this.Blok.SaverAPI.methods,
      selection: this.Blok.SelectionAPI.methods,
      marks: this.Blok.MarksAPI.methods,
      styles: this.Blok.StylesAPI.classes,
      toolbar: this.Blok.ToolbarAPI.methods,
      inlineToolbar: this.Blok.InlineToolbarAPI.methods,
      tooltip: this.Blok.TooltipAPI.methods,
      i18n: this.Blok.I18nAPI.methods,
      readOnly: this.Blok.ReadOnlyAPI.methods,
      ui: this.Blok.UiAPI.methods,
      theme: this.Blok.ThemeAPI.methods,
      config: {
        get linkPaste() {
          return apiConfig.linkPaste;
        },
        get link() {
          return apiConfig.link;
        },
      },
      /**
       * Curated facade exposing exactly the publicly-typed RectangleSelection
       * methods. Assigning the whole module would leak untyped internals
       * (prepare(), isMouseDownWithinBounds, the Module base) that third
       * parties could come to rely on.
       */
      rectangleSelection: {
        cancelActiveSelection: (): void => this.Blok.RectangleSelection.cancelActiveSelection(),
        isRectActivated: (): boolean => this.Blok.RectangleSelection.isRectActivated(),
        clearSelection: (): void => this.Blok.RectangleSelection.clearSelection(),
        startSelection: (pageX: number, pageY: number, shiftKey?: boolean): void =>
          this.Blok.RectangleSelection.startSelection(pageX, pageY, shiftKey),
        endSelection: (): void => this.Blok.RectangleSelection.endSelection(),
      },
    };
  }
}

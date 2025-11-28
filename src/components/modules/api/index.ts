/**
 * @module API
 * @copyright <CodeX> 2018
 *
 * Each block has a Blok API instance to use provided public methods
 * if you cant to read more about how API works, please see docs
 */
import Module from '../../__module';
import type { API as APIInterfaces } from '../../../../types';

/**
 * @class API
 */
export default class API extends Module {
  /**
   * Blok Core API modules
   */
  public get methods(): APIInterfaces {
    return {
      blocks: this.Blok.BlocksAPI.methods,
      caret: this.Blok.CaretAPI.methods,
      tools: this.Blok.ToolsAPI.methods,
      events: this.Blok.EventsAPI.methods,
      listeners: this.Blok.ListenersAPI.methods,
      notifier: this.Blok.NotifierAPI.methods,
      sanitizer: this.Blok.SanitizerAPI.methods,
      saver: this.Blok.SaverAPI.methods,
      selection: this.Blok.SelectionAPI.methods,
      styles: this.Blok.StylesAPI.classes,
      toolbar: this.Blok.ToolbarAPI.methods,
      inlineToolbar: this.Blok.InlineToolbarAPI.methods,
      tooltip: this.Blok.TooltipAPI.methods,
      i18n: this.Blok.I18nAPI.methods,
      readOnly: this.Blok.ReadOnlyAPI.methods,
      ui: this.Blok.UiAPI.methods,
    };
  }

  /**
   * Returns Blok Core API methods for passed tool
   * @param toolName - tool name
   * @param isTune - is tool a block tune
   */
  public getMethodsForTool(toolName: string, isTune: boolean): APIInterfaces {
    return Object.assign(
      this.methods,
      {
        i18n: this.Blok.I18nAPI.getMethodsForTool(toolName, isTune),
      }
    ) as APIInterfaces;
  }
}

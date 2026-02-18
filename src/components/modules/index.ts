import { BlocksAPI } from './api/blocks';
import { CaretAPI } from './api/caret';
import { EventsAPI } from './api/events';
import { HistoryAPI } from './api/history';
import { I18nAPI } from './api/i18n';
import { API } from './api/index';
import { InlineToolbarAPI } from './api/inlineToolbar';
import { ListenersAPI } from './api/listeners';
import { NotifierAPI } from './api/notifier';
import { ReadOnlyAPI } from './api/readonly';
import { SanitizerAPI } from './api/sanitizer';
import { SaverAPI } from './api/saver';
import { SelectionAPI } from './api/selection';
import { StylesAPI } from './api/styles';
import { ToolbarAPI } from './api/toolbar';
import { ToolsAPI } from './api/tools';
import { TooltipAPI } from './api/tooltip';
import { UiAPI } from './api/ui';
import { BlockEvents } from './blockEvents';
import { BlockManager } from './blockManager';
import { BlockSelection } from './blockSelection';
import { Caret } from './caret';
import { CrossBlockSelection } from './crossBlockSelection';
import { DragController as DragManager } from './drag/DragController';
import { I18n } from './i18n';
import { ModificationsObserver } from './modificationsObserver';
import { Paste } from './paste';
import { ReadOnly } from './readonly';
import { RectangleSelection } from './rectangleSelection';
import { Renderer } from './renderer';
import { Saver } from './saver';
import { BlockSettings } from './toolbar/blockSettings';
import { Toolbar } from './toolbar/index';
import { InlineToolbar } from './toolbar/inline';
import { Tools } from './tools';
import { UI } from './ui';
import { YjsManager } from './yjs';

/**
 * Named exports for better tree-shaking.
 * Consumers can import only the modules they need.
 */
export {
  // API Modules
  BlocksAPI,
  CaretAPI,
  EventsAPI,
  HistoryAPI,
  I18nAPI,
  API,
  InlineToolbarAPI,
  ListenersAPI,
  NotifierAPI,
  ReadOnlyAPI,
  SanitizerAPI,
  SaverAPI,
  SelectionAPI,
  ToolsAPI,
  StylesAPI,
  ToolbarAPI,
  TooltipAPI,
  UiAPI,

  // Toolbar Modules
  BlockSettings,
  Toolbar,
  InlineToolbar,

  // Modules
  I18n,
  BlockEvents,
  BlockManager,
  BlockSelection,
  Caret,
  CrossBlockSelection,
  DragManager,
  ModificationsObserver,
  Paste,
  ReadOnly,
  RectangleSelection,
  Renderer,
  Saver,
  Tools,
  UI,
  YjsManager,
};

/**
 * Default export for backwards compatibility and internal use.
 */
export const Modules = {
  // API Modules
  BlocksAPI,
  CaretAPI,
  EventsAPI,
  HistoryAPI,
  I18nAPI,
  API,
  InlineToolbarAPI,
  ListenersAPI,
  NotifierAPI,
  ReadOnlyAPI,
  SanitizerAPI,
  SaverAPI,
  SelectionAPI,
  ToolsAPI,
  StylesAPI,
  ToolbarAPI,
  TooltipAPI,
  UiAPI,

  // Toolbar Modules
  BlockSettings,
  Toolbar,
  InlineToolbar,

  // Modules
  I18n,
  BlockEvents,
  BlockManager,
  BlockSelection,
  Caret,
  CrossBlockSelection,
  DragManager,
  ModificationsObserver,
  Paste,
  ReadOnly,
  RectangleSelection,
  Renderer,
  Saver,
  Tools,
  UI,
  YjsManager,
};
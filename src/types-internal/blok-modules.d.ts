/** ./api */
import { BlocksAPI } from '../components/modules/api/blocks';
import { CaretAPI } from '../components/modules/api/caret';
import { EventsAPI } from '../components/modules/api/events';
import { HistoryAPI } from '../components/modules/api/history';
import { I18nAPI } from '../components/modules/api/i18n';
import { API } from '../components/modules/api/index';
import { InlineToolbarAPI } from '../components/modules/api/inlineToolbar';
import { ListenersAPI } from '../components/modules/api/listeners';
import { MarksAPI } from '../components/modules/api/marks';
import { MediaAPI } from '../components/modules/api/media';
import { NotifierAPI } from '../components/modules/api/notifier';
import { ReadOnlyAPI } from '../components/modules/api/readonly';
import { SanitizerAPI } from '../components/modules/api/sanitizer';
import { SaverAPI } from '../components/modules/api/saver';
import { SelectionAPI } from '../components/modules/api/selection';
import { StylesAPI } from '../components/modules/api/styles';
import { ToolbarAPI } from '../components/modules/api/toolbar';
import { TooltipAPI } from '../components/modules/api/tooltip';
import { UiAPI } from '../components/modules/api/ui';

import { ThemeAPI } from '../components/modules/api/theme';
import { ViewStateAPI } from '../components/modules/api/viewState';
/** ./toolbar */
import { BlockSettings } from '../components/modules/toolbar/blockSettings';
import { Toolbar } from '../components/modules/toolbar/index';
import { InlineToolbar } from '../components/modules/toolbar/inline/index';

/** . */
import { BlockEvents } from '../components/modules/blockEvents';
import { BlockManager } from '../components/modules/blockManager';
import { BlockSelection } from '../components/modules/blockSelection';
import { Caret } from '../components/modules/caret';
import { CrossBlockSelection } from '../components/modules/crossBlockSelection';
import { DragController as DragManager } from '../components/modules/drag/DragController';
import { Find } from '../components/modules/find';
import { ModificationsObserver } from '../components/modules/modificationsObserver';
import { Paste } from '../components/modules/paste';
import { PageReferences } from '../components/modules/pageReferences';
import { PageTitle } from '../components/modules/pageTitle';
import { ReadOnly } from '../components/modules/readonly';
import { RectangleSelection } from '../components/modules/rectangleSelection';
import { Renderer } from '../components/modules/renderer';
import { MediaFailures } from '../components/modules/mediaFailures';
import { Saver } from '../components/modules/saver';
import { Tools } from '../components/modules/tools';
import { UI } from '../components/modules/ui';
import { HandlersAPI } from '../components/modules/api/handlers';
import { ToolsAPI } from '../components/modules/api/tools';
import { UploaderAPI } from '../components/modules/api/uploader';
import { I18n } from '../components/modules/i18n';

import { Collaboration } from '../components/modules/collaboration';
import { TabSync } from '../components/modules/tabSync';
import { ThemeManager } from '../components/modules/themeManager';
import { UserDirectory } from '../components/modules/userDirectory';
import { YjsManager } from '../components/modules/yjs';

export interface BlokModules {
  // API Modules
  BlocksAPI: BlocksAPI,
  CaretAPI: CaretAPI,
  HandlersAPI: HandlersAPI,
  ToolsAPI: ToolsAPI,
  UploaderAPI: UploaderAPI,
  EventsAPI: EventsAPI,
  HistoryAPI: HistoryAPI,
  I18nAPI: I18nAPI,
  API: API,
  InlineToolbarAPI: InlineToolbarAPI,
  ListenersAPI: ListenersAPI,
  MarksAPI: MarksAPI,
  MediaAPI: MediaAPI,
  NotifierAPI: NotifierAPI,
  ReadOnlyAPI: ReadOnlyAPI,
  SanitizerAPI: SanitizerAPI,
  SaverAPI: SaverAPI,
  SelectionAPI: SelectionAPI,
  StylesAPI: StylesAPI,
  ToolbarAPI: ToolbarAPI,
  TooltipAPI: TooltipAPI,
  UiAPI: UiAPI,
  ThemeAPI: ThemeAPI,
  ViewStateAPI: ViewStateAPI,

  // Toolbar Modules
  BlockSettings: BlockSettings,
  Toolbar: Toolbar,
  InlineToolbar: InlineToolbar,

  // Modules
  I18n: I18n,
  BlockEvents: BlockEvents,
  BlockManager: BlockManager,
  BlockSelection: BlockSelection,
  Caret: Caret,
  CrossBlockSelection: CrossBlockSelection,
  Find: Find,
  DragManager: DragManager,
  ModificationsObserver: ModificationsObserver,
  Paste: Paste,
  PageReferences: PageReferences,
  PageTitle: PageTitle,
  ReadOnly: ReadOnly,
  RectangleSelection: RectangleSelection,
  Renderer: Renderer,
  MediaFailures: MediaFailures,
  Saver: Saver,
  Tools: Tools,
  UI: UI,
  ThemeManager: ThemeManager,
  UserDirectory: UserDirectory,
  Collaboration: Collaboration,
  TabSync: TabSync,
  YjsManager: YjsManager,
}

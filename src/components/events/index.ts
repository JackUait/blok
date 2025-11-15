import type { RedactorDomChangedPayload } from './RedactorDomChanged';
import { RedactorDomChanged } from './RedactorDomChanged';
import type { BlockChangedPayload } from './BlockChanged';
import { BlockChanged } from './BlockChanged';
import type { BlockHovered, BlockHoveredPayload } from './BlockHovered';
import type { FakeCursorAboutToBeToggledPayload } from './FakeCursorAboutToBeToggled';
import { FakeCursorAboutToBeToggled } from './FakeCursorAboutToBeToggled';
import type { FakeCursorHaveBeenSetPayload } from './FakeCursorHaveBeenSet';
import { FakeCursorHaveBeenSet } from './FakeCursorHaveBeenSet';
import type { EditorMobileLayoutToggledPayload } from './EditorMobileLayoutToggled';
import { EditorMobileLayoutToggled } from './EditorMobileLayoutToggled';
import type { BlockSettingsOpenedPayload } from './BlockSettingsOpened';
import { BlockSettingsOpened } from './BlockSettingsOpened';
import type { BlockSettingsClosedPayload } from './BlockSettingsClosed';
import { BlockSettingsClosed } from './BlockSettingsClosed';

/**
 * Events fired by Editor Event Dispatcher
 */
export {
  RedactorDomChanged,
  BlockChanged,
  FakeCursorAboutToBeToggled,
  FakeCursorHaveBeenSet,
  EditorMobileLayoutToggled,
  BlockSettingsOpened,
  BlockSettingsClosed
};

/**
 * Event name -> Event payload
 */
export interface EditorEventMap {
  [BlockHovered]: BlockHoveredPayload;
  [RedactorDomChanged]: RedactorDomChangedPayload;
  [BlockChanged]: BlockChangedPayload;
  [FakeCursorAboutToBeToggled]: FakeCursorAboutToBeToggledPayload;
  [FakeCursorHaveBeenSet]: FakeCursorHaveBeenSetPayload;
  [EditorMobileLayoutToggled]: EditorMobileLayoutToggledPayload;
  [BlockSettingsOpened]: BlockSettingsOpenedPayload;
  [BlockSettingsClosed]: BlockSettingsClosedPayload;
}

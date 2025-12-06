import type { RedactorDomChangedPayload } from './RedactorDomChanged';
import { RedactorDomChanged } from './RedactorDomChanged';
import type { BlockChangedPayload } from './BlockChanged';
import { BlockChanged } from './BlockChanged';
import type { BlockHovered, BlockHoveredPayload } from './BlockHovered';
import type { FakeCursorAboutToBeToggledPayload } from './FakeCursorAboutToBeToggled';
import { FakeCursorAboutToBeToggled } from './FakeCursorAboutToBeToggled';
import type { FakeCursorHaveBeenSetPayload } from './FakeCursorHaveBeenSet';
import { FakeCursorHaveBeenSet } from './FakeCursorHaveBeenSet';
import type { BlokMobileLayoutToggledPayload } from './BlokMobileLayoutToggled';
import { BlokMobileLayoutToggled } from './BlokMobileLayoutToggled';
import type { BlockSettingsOpenedPayload } from './BlockSettingsOpened';
import { BlockSettingsOpened } from './BlockSettingsOpened';
import type { BlockSettingsClosedPayload } from './BlockSettingsClosed';
import { BlockSettingsClosed } from './BlockSettingsClosed';
import type { HistoryStateChangedPayload } from './HistoryStateChanged';
import { HistoryStateChanged } from './HistoryStateChanged';

/**
 * Events fired by Blok Event Dispatcher
 */
export {
  RedactorDomChanged,
  BlockChanged,
  FakeCursorAboutToBeToggled,
  FakeCursorHaveBeenSet,
  BlokMobileLayoutToggled,
  BlockSettingsOpened,
  BlockSettingsClosed,
  HistoryStateChanged
};

/**
 * Event name -> Event payload
 */
export interface BlokEventMap {
  [BlockHovered]: BlockHoveredPayload;
  [RedactorDomChanged]: RedactorDomChangedPayload;
  [BlockChanged]: BlockChangedPayload;
  [FakeCursorAboutToBeToggled]: FakeCursorAboutToBeToggledPayload;
  [FakeCursorHaveBeenSet]: FakeCursorHaveBeenSetPayload;
  [BlokMobileLayoutToggled]: BlokMobileLayoutToggledPayload;
  [BlockSettingsOpened]: BlockSettingsOpenedPayload;
  [BlockSettingsClosed]: BlockSettingsClosedPayload;
  [HistoryStateChanged]: HistoryStateChangedPayload;
}

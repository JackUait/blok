import type { BlockChangedPayload } from './BlockChanged';
import { BlockChanged } from './BlockChanged';
import type { BlockChildrenMountedPayload } from './BlockChildrenMounted';
import { BlockChildrenMounted } from './BlockChildrenMounted';
import type { BlockHovered, BlockHoveredPayload } from './BlockHovered';
import type { BlockRenderedPayload } from './BlockRendered';
import { BlockRendered } from './BlockRendered';
import type { BlocksRenderedPayload } from './BlocksRendered';
import { BlocksRendered } from './BlocksRendered';
import type { BlockSettingsClosedPayload } from './BlockSettingsClosed';
import { BlockSettingsClosed } from './BlockSettingsClosed';
import type { BlockSettingsOpenedPayload } from './BlockSettingsOpened';
import { BlockSettingsOpened } from './BlockSettingsOpened';
import type { CollaborationStatusChangedPayload } from './CollaborationStatusChanged';
import { CollaborationStatusChanged } from './CollaborationStatusChanged';
import type { BlokMobileLayoutToggledPayload } from './BlokMobileLayoutToggled';
import { BlokMobileLayoutToggled } from './BlokMobileLayoutToggled';
import type { FakeCursorAboutToBeToggledPayload } from './FakeCursorAboutToBeToggled';
import { FakeCursorAboutToBeToggled } from './FakeCursorAboutToBeToggled';
import type { FakeCursorHaveBeenSetPayload } from './FakeCursorHaveBeenSet';
import { FakeCursorHaveBeenSet } from './FakeCursorHaveBeenSet';
import type { I18nChangedPayload } from './I18nChanged';
import { I18nChanged } from './I18nChanged';
import { RedactorDomChanged } from './RedactorDomChanged';
import type { RedactorDomChangedPayload } from './RedactorDomChanged';
import { SaveFailed } from './SaveFailed';
import type { SaveFailedPayload } from './SaveFailed';

/**
 * Events fired by Blok Event Dispatcher
 */
export {
  RedactorDomChanged,
  BlockChanged,
  BlockChildrenMounted,
  BlockRendered,
  BlocksRendered,
  FakeCursorAboutToBeToggled,
  FakeCursorHaveBeenSet,
  BlokMobileLayoutToggled,
  BlockSettingsOpened,
  BlockSettingsClosed,
  I18nChanged,
  SaveFailed,
  CollaborationStatusChanged,
};

/**
 * Event name -> Event payload
 */
export interface BlokEventMap {
  [BlockHovered]: BlockHoveredPayload;
  [RedactorDomChanged]: RedactorDomChangedPayload;
  [BlockChanged]: BlockChangedPayload;
  [BlockChildrenMounted]: BlockChildrenMountedPayload;
  [BlockRendered]: BlockRenderedPayload;
  [BlocksRendered]: BlocksRenderedPayload;
  [FakeCursorAboutToBeToggled]: FakeCursorAboutToBeToggledPayload;
  [FakeCursorHaveBeenSet]: FakeCursorHaveBeenSetPayload;
  [BlokMobileLayoutToggled]: BlokMobileLayoutToggledPayload;
  [BlockSettingsOpened]: BlockSettingsOpenedPayload;
  [BlockSettingsClosed]: BlockSettingsClosedPayload;
  [I18nChanged]: I18nChangedPayload;
  [SaveFailed]: SaveFailedPayload;
  [CollaborationStatusChanged]: CollaborationStatusChangedPayload;
}

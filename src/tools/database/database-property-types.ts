import {
  IconArrowDiagonal,
  IconAt,
  IconCalendar,
  IconCheck,
  IconCheckbox,
  IconClock,
  IconCursorButton,
  IconEmojiMap,
  IconHash,
  IconLetterCase,
  IconLink,
  IconListBulleted,
  IconNumero,
  IconPaperclip,
  IconPeople,
  IconPhone,
  IconSearch,
  IconSelectCircle,
  IconSigma,
  IconStatusCircle,
  IconTextLines,
  IconUserCircle,
} from '../../components/icons';
import type { PropertyType } from './types';

export interface PropertyTypeMeta {
  icon: string;
  labelKey: string;
}

/** Icon and label per type: Notion's glyph for each type, drawn in Blok Line. */
export const PROPERTY_TYPE_META: Readonly<Record<PropertyType, PropertyTypeMeta>> = {
  title: { icon: IconLetterCase, labelKey: 'tools.database.propertyTypeTitle' },
  text: { icon: IconTextLines, labelKey: 'tools.database.propertyTypeText' },
  richText: { icon: IconTextLines, labelKey: 'tools.database.propertyTypeText' },
  number: { icon: IconHash, labelKey: 'tools.database.propertyTypeNumber' },
  select: { icon: IconSelectCircle, labelKey: 'tools.database.propertyTypeSelect' },
  multiSelect: { icon: IconListBulleted, labelKey: 'tools.database.propertyTypeMultiSelect' },
  status: { icon: IconStatusCircle, labelKey: 'tools.database.propertyTypeStatus' },
  date: { icon: IconCalendar, labelKey: 'tools.database.propertyTypeDate' },
  person: { icon: IconPeople, labelKey: 'tools.database.propertyTypePerson' },
  files: { icon: IconPaperclip, labelKey: 'tools.database.propertyTypeFiles' },
  checkbox: { icon: IconCheckbox, labelKey: 'tools.database.propertyTypeCheckbox' },
  url: { icon: IconLink, labelKey: 'tools.database.propertyTypeUrl' },
  phone: { icon: IconPhone, labelKey: 'tools.database.propertyTypePhone' },
  email: { icon: IconAt, labelKey: 'tools.database.propertyTypeEmail' },
  uniqueId: { icon: IconNumero, labelKey: 'tools.database.propertyTypeUniqueId' },
  createdTime: { icon: IconClock, labelKey: 'tools.database.propertyTypeCreatedTime' },
  lastEditedTime: { icon: IconClock, labelKey: 'tools.database.propertyTypeLastEditedTime' },
  createdBy: { icon: IconUserCircle, labelKey: 'tools.database.propertyTypeCreatedBy' },
  lastEditedBy: { icon: IconUserCircle, labelKey: 'tools.database.propertyTypeLastEditedBy' },
  relation: { icon: IconArrowDiagonal, labelKey: 'tools.database.propertyTypeRelation' },
  rollup: { icon: IconSearch, labelKey: 'tools.database.propertyTypeRollup' },
  formula: { icon: IconSigma, labelKey: 'tools.database.propertyTypeFormula' },
  button: { icon: IconCursorButton, labelKey: 'tools.database.propertyTypeButton' },
  place: { icon: IconEmojiMap, labelKey: 'tools.database.propertyTypePlace' },
  verification: { icon: IconCheck, labelKey: 'tools.database.propertyTypeVerification' },
};

/** Notion's "Type" list order (measured 2026-10-25), limited to the types Blok has. Notion has no Verification. */
const ADDABLE_ORDER: readonly PropertyType[] = [
  'text', 'number', 'select', 'multiSelect', 'status', 'date', 'person', 'files', 'checkbox', 'url', 'email', 'phone',
  'formula', 'relation', 'rollup', 'createdTime', 'createdBy', 'lastEditedTime', 'lastEditedBy', 'button', 'place', 'uniqueId',
  'verification',
];

/** Types a person can add or change to. Person needs the host's people directory. */
export const addablePropertyTypes = (hasPeople: boolean): PropertyType[] =>
  ADDABLE_ORDER.filter((type) => hasPeople || type !== 'person');

/** The meta of a type, or text's for a type from a newer client. */
export const propertyTypeMeta = (type: PropertyType): PropertyTypeMeta =>
  // Own keys only: saved data can name "__proto__" or "constructor", which a plain lookup resolves to Object built-ins.
  Object.hasOwn(PROPERTY_TYPE_META, type) ? PROPERTY_TYPE_META[type] : PROPERTY_TYPE_META.text;

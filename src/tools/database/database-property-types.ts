import {
  IconBookmark,
  IconArrowDiagonal,
  IconCalendar,
  IconCheck,
  IconCursor,
  IconEmojiSmile,
  IconEmojiWink,
  IconEquation,
  IconFile,
  IconGlobe,
  IconHash,
  IconListChecklist,
  IconMap,
  IconMail,
  IconMessage,
  IconMultiSelect,
  IconPencil,
  IconPlayerPlay,
  IconPlus,
  IconSearch,
  IconSelect,
  IconSliders,
  IconText,
} from '../../components/icons';
import type { PropertyType } from './types';

export interface PropertyTypeMeta {
  icon: string;
  labelKey: string;
}

/** Icon and label per type. Glyphs reuse Blok icons; Notion's own are unmeasured. */
export const PROPERTY_TYPE_META: Readonly<Record<PropertyType, PropertyTypeMeta>> = {
  title: { icon: IconText, labelKey: 'tools.database.propertyTypeTitle' },
  text: { icon: IconText, labelKey: 'tools.database.propertyTypeText' },
  richText: { icon: IconText, labelKey: 'tools.database.propertyTypeText' },
  number: { icon: IconHash, labelKey: 'tools.database.propertyTypeNumber' },
  select: { icon: IconSelect, labelKey: 'tools.database.propertyTypeSelect' },
  multiSelect: { icon: IconMultiSelect, labelKey: 'tools.database.propertyTypeMultiSelect' },
  status: { icon: IconSliders, labelKey: 'tools.database.propertyTypeStatus' },
  date: { icon: IconCalendar, labelKey: 'tools.database.propertyTypeDate' },
  person: { icon: IconEmojiSmile, labelKey: 'tools.database.propertyTypePerson' },
  files: { icon: IconFile, labelKey: 'tools.database.propertyTypeFiles' },
  checkbox: { icon: IconListChecklist, labelKey: 'tools.database.propertyTypeCheckbox' },
  url: { icon: IconGlobe, labelKey: 'tools.database.propertyTypeUrl' },
  phone: { icon: IconMessage, labelKey: 'tools.database.propertyTypePhone' },
  email: { icon: IconMail, labelKey: 'tools.database.propertyTypeEmail' },
  uniqueId: { icon: IconBookmark, labelKey: 'tools.database.propertyTypeUniqueId' },
  createdTime: { icon: IconPlus, labelKey: 'tools.database.propertyTypeCreatedTime' },
  lastEditedTime: { icon: IconPencil, labelKey: 'tools.database.propertyTypeLastEditedTime' },
  createdBy: { icon: IconEmojiWink, labelKey: 'tools.database.propertyTypeCreatedBy' },
  lastEditedBy: { icon: IconCursor, labelKey: 'tools.database.propertyTypeLastEditedBy' },
  relation: { icon: IconArrowDiagonal, labelKey: 'tools.database.propertyTypeRelation' },
  rollup: { icon: IconSearch, labelKey: 'tools.database.propertyTypeRollup' },
  formula: { icon: IconEquation, labelKey: 'tools.database.propertyTypeFormula' },
  button: { icon: IconPlayerPlay, labelKey: 'tools.database.propertyTypeButton' },
  place: { icon: IconMap, labelKey: 'tools.database.propertyTypePlace' },
  verification: { icon: IconCheck, labelKey: 'tools.database.propertyTypeVerification' },
};

/** Notion's "Select type" order (research/08), limited to the types Blok has. */
const ADDABLE_ORDER: readonly PropertyType[] = [
  'text', 'number', 'select', 'multiSelect', 'status', 'date', 'person', 'files', 'checkbox', 'url', 'phone', 'email',
  'relation', 'rollup', 'formula', 'button', 'uniqueId', 'place', 'createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy',
  'verification',
];

/** Types a person can add or change to. Person needs the host's people directory. */
export const addablePropertyTypes = (hasPeople: boolean): PropertyType[] =>
  ADDABLE_ORDER.filter((type) => hasPeople || type !== 'person');

/** The meta of a type, or text's for a type from a newer client. */
export const propertyTypeMeta = (type: PropertyType): PropertyTypeMeta =>
  // Own keys only: saved data can name "__proto__" or "constructor", which a plain lookup resolves to Object built-ins.
  Object.hasOwn(PROPERTY_TYPE_META, type) ? PROPERTY_TYPE_META[type] : PROPERTY_TYPE_META.text;

import { isReadOnlyType } from './value-helpers';
import { legacyEntries, mergeDuplicates, resolveViewProperties } from './view-properties';
import type { DatabaseViewConfig, PropertyDefinition, PropertyType, PropertyValue, ViewPropertySetting } from './types';

/** Status is never a question in Notion: auto-create skips it and "Existing properties" leaves it out (research/19 §3a-b). */
export const FORM_ASKABLE: readonly PropertyType[] = [
  'title', 'text', 'richText', 'url', 'email', 'phone', 'number', 'checkbox', 'select', 'multiSelect', 'date', 'place',
  'person', 'files', 'relation',
];

export interface FormQuestion {
  property: PropertyDefinition;
  /** The question's stored settings in the view: required, maxSelections, questionName. */
  setting: ViewPropertySetting;
}

/** The questions a form shows, in order: its visible properties a person can answer. */
export const formQuestions = (view: DatabaseViewConfig, schema: PropertyDefinition[]): FormQuestion[] => {
  const stored = Array.isArray(view.properties) ? mergeDuplicates(view.properties.map((entry) => ({ ...entry }))) : legacyEntries(view, schema);

  return resolveViewProperties(view, schema)
    .filter((entry) => entry.visible)
    .flatMap((entry) => {
      const property = schema.find((candidate) => candidate.id === entry.id);

      if (property === undefined || isReadOnlyType(property.type) || !FORM_ASKABLE.includes(property.type)) return [];

      return [{ property, setting: stored.find((candidate) => candidate.id === property.id) ?? { id: entry.id, visible: entry.visible } }];
    });
};

// The HTML standard's "valid e-mail address": what an <input type="email"> accepts.
const EMAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export type FormAnswerProblem = 'required' | 'email' | 'relationLimit' | 'maxSelections';

/** Why the form refuses this answer, or undefined. `value` undefined: the question was left blank. */
export const formAnswerProblem = (question: FormQuestion, value: PropertyValue | undefined): FormAnswerProblem | undefined => {
  const { property, setting } = question;

  if (setting.required === true && value === undefined) return 'required';
  if (property.type === 'email' && typeof value === 'string' && value !== '' && !EMAIL.test(value)) return 'email';
  if (property.type === 'relation' && property.relation?.limit === 1 && Array.isArray(value) && value.length > 1) return 'relationLimit';
  if (setting.maxSelections !== undefined && Array.isArray(value) && value.length > setting.maxSelections) return 'maxSelections';

  return undefined;
};

import { nanoid } from 'nanoid';
import type { I18n } from '../../../types';

/**
 * The "A property named <name> already exists" line under a property name field
 * (research/14 §3). `show(null)` hides it. The input keeps what the user typed.
 */
export const nameTakenError = (
  input: HTMLInputElement,
  attribute: string,
  i18n: Pick<I18n, 't'>
): { element: HTMLElement; show: (takenName: string | null) => void } => {
  const element = document.createElement('div');

  element.id = `blok-database-property-name-error-${nanoid()}`;
  element.setAttribute(attribute, '');
  element.hidden = true;

  return {
    element,
    show: (takenName) => {
      element.hidden = takenName === null;
      element.textContent = takenName === null ? '' : i18n.t('tools.database.propertyNameTaken', { name: takenName });
      if (takenName === null) {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      } else {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', element.id);
      }
    },
  };
};

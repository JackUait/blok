import { TOOLTIP_MUTED_INK } from '../../components/modules/toolbar/tooltip';
import { onHover } from '../../components/utils/tooltip';
import { getElementDirection } from '../../components/utils/direction';

/**
 * research/31 §1, research/35 §4: a property's hint. The name, then the
 * description in muted ink when there is one; wraps at 280px.
 */
export const propertyHint = (name: string, description?: string): HTMLElement => {
  const box = document.createElement('div');
  const text = document.createElement('div');
  const nameLine = document.createElement('div');

  box.setAttribute('data-blok-database-header-hint', '');
  Object.assign(box.style, { padding: '5px 8px', fontWeight: '400', lineHeight: '16.8px', textAlign: 'start' });
  text.setAttribute('data-blok-database-header-hint-text', '');
  Object.assign(text.style, { maxWidth: '280px', width: 'max-content', overflowWrap: 'break-word' });
  nameLine.textContent = name;
  text.appendChild(nameLine);
  if (description !== undefined && description !== '') {
    const descriptionLine = document.createElement('div');

    descriptionLine.textContent = description;
    Object.assign(descriptionLine.style, { color: TOOLTIP_MUTED_INK, whiteSpace: 'pre-line' });
    text.appendChild(descriptionLine);
  }
  box.appendChild(text);

  return box;
};

/**
 * research/35 §4: the hint sits on the inline-start side of a card value or
 * drawer label, like the peek handle hint: the left, or the right in RTL.
 */
export const onPropertyHover = (trigger: HTMLElement, name: string, description?: string, gap?: number): void => {
  onHover(trigger, propertyHint(name, description), {
    bare: true,
    gap,
    // A getter: the trigger is not in the page yet when this binds, so its direction is read on hover.
    get placement(): string {
      return getElementDirection(trigger) === 'rtl' ? 'right' : 'left';
    },
  });
};

import { TOOLTIP_MUTED_INK } from '../../components/modules/toolbar/tooltip';

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

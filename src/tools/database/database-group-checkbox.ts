import { IconCheck } from '../../components/icons';

/**
 * A checkbox group's name: a 14x14 box, then the property name (notion-motion.md Round 84b §3, Round 85c §2).
 * Both groups read the same name, so the box carries `state` ("Checked"/"Unchecked") for screen readers.
 */
export const checkboxGroupName = (checked: boolean, name: string | Node, state: string): HTMLElement => {
  const wrap = document.createElement('span');
  const box = document.createElement('span');

  wrap.setAttribute('data-blok-database-group-checkbox', '');
  box.setAttribute('data-blok-database-checkbox', '');
  box.setAttribute('data-state', checked ? 'checked' : 'unchecked');
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', state);
  if (checked) box.innerHTML = IconCheck;
  wrap.append(box, name);

  return wrap;
};

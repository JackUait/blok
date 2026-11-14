import { createAvatar } from './avatar';
import { el } from './dom';

export interface PeopleTableRow {
  email: string;
  name?: string;
  subtitle?: string;
  controls?: HTMLElement;
}

export interface PeopleTableOptions {
  userHeader?: string;
  actionHeader: string;
  rows: readonly PeopleTableRow[];
  attribute?: string;
}

/** Two-column people table: identity (avatar + email) and actions. */
export function createPeopleTable(options: PeopleTableOptions): HTMLTableElement {
  const table = el('table', { attribute: options.attribute ?? 'data-desktop-people-table' });
  const head = el('thead');
  const heading = el('tr');
  heading.append(el('th', { text: options.userHeader ?? 'Utilisateur' }), el('th', { text: options.actionHeader }));
  head.append(heading);
  const body = el('tbody');
  for (const row of options.rows) {
    const root = el('tr', { attribute: 'data-desktop-people-row' });
    const identityCell = el('td');
    const identity = el('div', { attribute: 'data-desktop-people-identity' });
    const avatar = createAvatar({ email: row.email, name: row.name, attribute: 'data-desktop-people-avatar' });
    const text = el('div');
    text.append(el('strong', { text: row.name ?? row.email }));
    if (row.name) text.append(el('p', { text: row.email, attribute: 'data-desktop-people-email' }));
    if (row.subtitle) text.append(el('p', { text: row.subtitle, attribute: 'data-desktop-people-subtitle' }));
    identity.append(avatar, text);
    identityCell.append(identity);
    const controlsCell = el('td');
    if (row.controls) controlsCell.append(row.controls);
    root.append(identityCell, controlsCell);
    body.append(root);
  }
  table.append(head, body);
  return table;
}

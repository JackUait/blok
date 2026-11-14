import { el } from './dom';

export interface EmptyStateOptions {
  title: string;
  description?: string;
  attribute?: string;
  icon?: string | HTMLElement;
  action?: HTMLElement;
}

/** Title + optional description / icon / action for an empty list or panel. */
export function createEmptyState(options: EmptyStateOptions): HTMLElement {
  const root = el('div', { attribute: options.attribute ?? 'data-desktop-empty-state' });
  if (options.icon) {
    const icon = el('span', { attribute: 'data-desktop-empty-state-icon' });
    icon.setAttribute('aria-hidden', 'true');
    if (typeof options.icon === 'string') icon.innerHTML = options.icon;
    else icon.append(options.icon);
    root.append(icon);
  }
  root.append(el('strong', { text: options.title }));
  if (options.description) root.append(el('p', { text: options.description }));
  if (options.action) root.append(options.action);
  return root;
}

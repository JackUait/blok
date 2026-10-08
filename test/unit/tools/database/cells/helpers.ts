import { vi } from 'vitest';

import type { CellEditorContext } from '../../../../../src/tools/database/cells/types';
import type { PropertyDefinition, PropertyType, SelectOption } from '../../../../../src/tools/database/types';

export const makeProperty = (type: PropertyType, options?: SelectOption[]): PropertyDefinition => ({
  id: 'p',
  name: 'P',
  type,
  position: 'a0',
  ...(options !== undefined ? { config: { options } } : {}),
});

export const makeEditorContext = (overrides: Partial<CellEditorContext> = {}): CellEditorContext => ({
  i18n: { t: (key: string) => key },
  readOnly: false,
  locale: 'en-US',
  weekStart: 0,
  hourCycle: 'h23',
  onCommit: vi.fn(),
  onCancel: vi.fn(),
  onClose: vi.fn(),
  ...overrides,
});

export const makeAnchor = (): HTMLButtonElement => {
  const anchor = document.createElement('button');

  document.body.appendChild(anchor);

  return anchor;
};

/** The open editor's root, portaled to the body. */
export const editorRoot = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-cell-editor]');

export const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(event);

  return event;
};

/** A press outside every popover, as the registry sees it. */
export const pressOutside = (): void => {
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
};

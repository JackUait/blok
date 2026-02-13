import type { I18n } from '../../../types/api';
import {
  IconInsertAbove,
  IconInsertBelow,
  IconInsertLeft,
  IconInsertRight,
  IconTrash,
  IconHeaderRow,
  IconHeaderColumn,
} from '../../components/icons';
import { PopoverDesktop, PopoverItemType } from '../../components/utils/popover';

import { GRIP_HOVER_SIZE } from './table-grip-visuals';
import { createHeadingToggle } from './table-heading-toggle';
import type { RowColAction } from './table-row-col-controls';

import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';

/**
 * State for the currently active grip popover.
 */
export interface PopoverState {
  popover: PopoverDesktop | null;
  grip: HTMLElement | null;
}

/**
 * Options for building popover menu items.
 */
export interface PopoverMenuOptions {
  getColumnCount: () => number;
  getRowCount: () => number;
  isHeadingRow: () => boolean;
  isHeadingColumn: () => boolean;
  onAction: (action: RowColAction) => void;
  i18n: I18n;
}

/**
 * Callbacks the popover needs from the controls class.
 */
export interface OpenPopoverCallbacks {
  clearHideTimeout: () => void;
  hideAllGripsExcept: (grip: HTMLElement) => void;
  applyActiveClasses: (grip: HTMLElement) => void;
  applyVisibleClasses: (grip: HTMLElement) => void;
  scheduleHideAll: () => void;
  destroyPopover: () => void;
  onGripPopoverClose?: () => void;
}

/**
 * Build the popover menu items for a column grip.
 */
export const buildColumnMenuItems = (colIndex: number, options: PopoverMenuOptions): PopoverItemParams[] => {
  const headingItems: PopoverItemParams[] = colIndex === 0
    ? [
      {
        type: PopoverItemType.Html,
        element: createHeadingToggle({
          icon: IconHeaderColumn,
          label: options.i18n.t('tools.table.headerColumn'),
          isActive: options.isHeadingColumn(),
          onToggle: () => {
            options.onAction({ type: 'toggle-heading-column' });
          },
        }),
      },
      { type: PopoverItemType.Separator },
    ]
    : [];

  const baseItems: PopoverItemParams[] = [
    {
      icon: IconInsertLeft,
      title: options.i18n.t('tools.table.insertColumnLeft'),
      closeOnActivate: true,
      onActivate: (): void => {
        options.onAction({ type: 'insert-col-left', index: colIndex });
      },
    },
    {
      icon: IconInsertRight,
      title: options.i18n.t('tools.table.insertColumnRight'),
      closeOnActivate: true,
      onActivate: (): void => {
        options.onAction({ type: 'insert-col-right', index: colIndex });
      },
    },
  ];

  const canDelete = options.getColumnCount() > 1;
  const deleteItems: PopoverItemParams[] = [
    { type: PopoverItemType.Separator },
    {
      icon: IconTrash,
      title: options.i18n.t('tools.table.deleteColumn'),
      isDestructive: true,
      isDisabled: !canDelete,
      closeOnActivate: true,
      onActivate: (): void => {
        options.onAction({ type: 'delete-col', index: colIndex });
      },
    },
  ];

  return [...headingItems, ...baseItems, ...deleteItems];
};

/**
 * Build the popover menu items for a row grip.
 */
export const buildRowMenuItems = (rowIndex: number, options: PopoverMenuOptions): PopoverItemParams[] => {
  const headingItems: PopoverItemParams[] = rowIndex === 0
    ? [
      {
        type: PopoverItemType.Html,
        element: createHeadingToggle({
          icon: IconHeaderRow,
          label: options.i18n.t('tools.table.headerRow'),
          isActive: options.isHeadingRow(),
          onToggle: () => {
            options.onAction({ type: 'toggle-heading' });
          },
        }),
      },
      { type: PopoverItemType.Separator },
    ]
    : [];

  const baseItems: PopoverItemParams[] = [
    {
      icon: IconInsertAbove,
      title: options.i18n.t('tools.table.insertRowAbove'),
      closeOnActivate: true,
      onActivate: (): void => {
        options.onAction({ type: 'insert-row-above', index: rowIndex });
      },
    },
    {
      icon: IconInsertBelow,
      title: options.i18n.t('tools.table.insertRowBelow'),
      closeOnActivate: true,
      onActivate: (): void => {
        options.onAction({ type: 'insert-row-below', index: rowIndex });
      },
    },
  ];

  const canDelete = options.getRowCount() > 1;
  const deleteItems: PopoverItemParams[] = [
    { type: PopoverItemType.Separator },
    {
      icon: IconTrash,
      title: options.i18n.t('tools.table.deleteRow'),
      isDestructive: true,
      isDisabled: !canDelete,
      closeOnActivate: true,
      onActivate: (): void => {
        options.onAction({ type: 'delete-row', index: rowIndex });
      },
    },
  ];

  return [...headingItems, ...baseItems, ...deleteItems];
};

/**
 * Create a popover anchored to the given grip and prepare it for display.
 * Returns the new state. The caller must call `popover.show()` after
 * storing the state so that any callbacks fired during show see the
 * updated popover reference.
 */
export const createGripPopover = (
  type: 'row' | 'col',
  index: number,
  grips: { col: HTMLElement[]; row: HTMLElement[] },
  menuOptions: PopoverMenuOptions,
  callbacks: OpenPopoverCallbacks
): PopoverState => {
  callbacks.destroyPopover();
  callbacks.clearHideTimeout();

  const grip = type === 'col'
    ? grips.col[index]
    : grips.row[index];

  if (!grip) {
    return { popover: null, grip: null };
  }

  const items = type === 'col'
    ? buildColumnMenuItems(index, menuOptions)
    : buildRowMenuItems(index, menuOptions);

  const popover = new PopoverDesktop({
    items,
    trigger: grip,
    flippable: true,
  });

  popover.on(PopoverEvent.Closed, () => {
    // The caller's destroyPopover handles nulling the shared state and
    // calling popover.destroy(). The re-entrant Closed event is caught
    // by the guard inside destroyPopover (checks if popover is already null).
    callbacks.destroyPopover();
    callbacks.applyVisibleClasses(grip);
    callbacks.scheduleHideAll();
    callbacks.onGripPopoverClose?.();
  });

  // Hide all other grips and make the active one blue
  callbacks.hideAllGripsExcept(grip);
  callbacks.applyActiveClasses(grip);

  // Expand the grip to hover size so it remains visible while popover is open
  if (type === 'col') {
    grip.style.height = `${GRIP_HOVER_SIZE}px`;
  } else {
    grip.style.width = `${GRIP_HOVER_SIZE}px`;
  }

  return { popover, grip };
};

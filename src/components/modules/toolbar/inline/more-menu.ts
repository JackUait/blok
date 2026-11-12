import type { PopoverItemChildren, PopoverItemDefaultParams, PopoverItemParams } from '../../../../../types';
import { INLINE_TOOL_MORE_MENU } from '../../../../shared/inline-tool-order';
import { PopoverItemType } from '../../../utils/popover';

interface MoreMenuOptions {
  /** Hover hint of the ⋯ button */
  title: string;
  /** Icon of the ⋯ button */
  icon: string;
}

const isDefaultItem = (item: PopoverItemParams): item is PopoverItemDefaultParams =>
  item.type === undefined || item.type === PopoverItemType.Default;

const isOn = (item: PopoverItemDefaultParams): boolean =>
  typeof item.isActive === 'function' ? item.isActive() : item.isActive === true;

const childrenOf = (item: PopoverItemDefaultParams): PopoverItemChildren | undefined =>
  'children' in item ? item.children : undefined;

/** A plain list of rows, not a custom panel like Equation's field. */
const isList = (children: PopoverItemChildren | undefined): children is PopoverItemChildren & { items: PopoverItemDefaultParams[] } =>
  children?.items !== undefined && children.items.length > 0 && children.items.every(isDefaultItem);

/**
 * Turns one grid button into rows of the ⋯ menu. A button whose children are a
 * plain list (Superscript & subscript) gives its rows; any other button
 * becomes one row, with its hover hint as the label and its shortcut on the
 * right.
 */
const toRows = (item: PopoverItemDefaultParams): PopoverItemDefaultParams[] => {
  const children = childrenOf(item);

  if (isList(children)) {
    return children.items;
  }

  const { hint, ...row } = item;

  return [{
    ...row,
    title: row.title ?? hint?.title,
    secondaryLabel: row.secondaryLabel ?? hint?.description,
  }];
};

/**
 * Moves the less used built-in tools (INLINE_TOOL_MORE_MENU) out of the
 * inline toolbar grid into one ⋯ button. The ⋯ button is the last tool, before
 * the Ask AI row. Custom tools and Hint stay in the grid.
 * @param items - the toolbar's popover items, after the replacesToolbar swap
 * @param options - the ⋯ button's hint and icon
 */
export const groupIntoMoreMenu = (items: PopoverItemParams[], options: MoreMenuOptions): PopoverItemParams[] => {
  const moved = items.filter((item): item is PopoverItemDefaultParams =>
    isDefaultItem(item) && item.name !== undefined && INLINE_TOOL_MORE_MENU.includes(item.name)
  );

  if (moved.length === 0) {
    return items;
  }

  const rows = moved.flatMap(toRows);
  // A moved list's open/close hooks save and restore the selection its rows act on.
  const lists = moved.map(childrenOf).filter(isList);

  const more: PopoverItemDefaultParams = {
    type: PopoverItemType.Default,
    name: 'more',
    icon: options.icon,
    hint: { title: options.title },
    isActive: () => rows.some(isOn),
    children: {
      hideChevron: true,
      placement: 'beside',
      align: 'start',
      items: rows,
      onOpen: () => lists.forEach((children) => children.onOpen?.()),
      onClose: () => lists.forEach((children) => children.onClose?.()),
    },
  };

  const kept = items.filter((item) => !moved.includes(item as PopoverItemDefaultParams));
  const askAi = kept.findIndex((item) => 'name' in item && item.name === 'askAi');
  const ruled = askAi > 0 && kept[askAi - 1].type === PopoverItemType.Separator;
  const at = askAi === -1 ? kept.length : askAi - (ruled ? 1 : 0);

  return [...kept.slice(0, at), more, ...kept.slice(at)];
};

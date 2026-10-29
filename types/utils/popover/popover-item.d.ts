import { HintParams, HintPosition, HintTextAlignment } from "./hint";
import { PopoverItemType } from "./popover-item-type";

export { PopoverItemType } from './popover-item-type';

/**
 * Represents popover item children configuration
 */
export interface PopoverItemChildren {
  /**
   * True if children items should be searchable
   */
  searchable?: boolean;

  /**
   * Placeholder of the children's search field. Defaults to the menu's own.
   */
  searchPlaceholder?: string;

  /**
   * True if popover with children should be displayed instantly and not after item click/hover.
   * False by default.
   * Now is used only in the inline popover.
   */
  isOpen?: boolean;

  /**
   * False if keyboard navigation should be disabled in the children popover.
   * True by default
   */
  isFlippable?: boolean;

 /**
  * Items of nested popover that should be open on the current item hover/click (depending on platform)
  */
  items?: PopoverItemParams[];

  /**
   * Called once children popover is opened
   */
  onOpen?: () => void;

  /**
   * Called once children popover is closed
   */
  onClose?: () => void;

  /**
   * True if the chevron icon should be hidden for this item.
   * Useful for items like link tool that render custom content instead of a dropdown list.
   */
  hideChevron?: boolean;

  /**
   * Draws a "…" button in place of the chevron, with `label` as its hover hint.
   * Only a click on "…" or ArrowRight opens the children: hovering the row does not.
   * Give the item its own onActivate for what a click on the row does.
   */
  moreButton?: { label: string };

  /**
   * Where the children popover opens relative to the parent popover.
   * 'beside' (default) opens it next to the parent, vertically centered on
   * the trigger item; 'below' opens it under the parent with left edges
   * aligned (e.g. the inline toolbar's link field); 'dropdown' opens it under
   * the item's value, or over it when there is no room under it, like a
   * select. A 'dropdown' list opens on click or a key, never on hover, and
   * moving the pointer over other rows leaves it open. 'under' opens it right
   * under the item, its end edge on the item's end edge.
   */
  placement?: 'beside' | 'below' | 'dropdown' | 'under';

  /**
   * Where a 'beside' popover sits on the vertical axis: 'center' (default)
   * centres it on the trigger item; 'start' puts its top edge on the item's top.
   */
  align?: 'center' | 'start';

  /**
   * True if the children open on a click or a key only, never on hover.
   * While they are open a transparent layer covers the parent popover, so
   * hovering its other items does nothing, and a click on it closes them.
   * False by default.
   */
  clickOnly?: boolean;

  /**
   * Width of the nested popover. Defaults to '280px'.
   * Use 'auto' to fit content width.
   */
  width?: string;

  /**
   * Custom class of the nested popover, stamped as `data-blok-popover-custom-class`
   * like the root popover's `class`, so a host can style one submenu on its own.
   */
  class?: string;

  /**
   * Minimum width of the nested popover when auto-sizing.
   * Has no effect when `width` is set to an explicit value.
   */
  minWidth?: string;
}

/**
 * Adds children property to the item
 */
export type WithChildren<T> = Omit<T, 'onActivate'> & {
  /**
   * Popover item children configuration
   */
  children: PopoverItemChildren;

  /**
   * Optional action of the row itself. On the desktop popover a click or
   * Enter runs it, while hover and ArrowRight open the children. Without it
   * a click opens the children. The mobile popover opens the children and runs it.
   */
  onActivate?: PopoverItemDefaultBaseParams['onActivate'];
};

/**
 * Represents popover item with confirmation.
 */
export type PopoverItemDefaultWithConfirmationParams = Omit<PopoverItemDefaultBaseParams, 'onActivate'> & {
  /**
   * Popover item parameters that should be applied on item activation.
   * May be used to ask user for confirmation before executing popover item activation handler.
   */
  confirmation: PopoverItemDefaultBaseParams;

  /**
   * Items with confirmation should not have onActivate handler
   */
  onActivate?: never;
};

/**
 * Represents popover item separator.
 * Special item type that is used to separate items in the popover.
 */
export interface PopoverItemSeparatorParams {
  /**
   * Item type
   */
  type: PopoverItemType.Separator;
}

/**
 * Represents popover item with custom html content
 */
export interface PopoverItemHtmlParams {
  /**
   * Item type
   */
  type: PopoverItemType.Html;

  /**
   * Custom html content to be displayed in the popover
   */
  element: HTMLElement;

  /**
   * Hint data to be displayed on item hover
   */
  hint?: HintParams;

  /**
   * True if popover should close once item is activated
   */
  closeOnActivate?: boolean;

  /**
   * Item name
   * Used in data attributes needed for automated end-to-end tests
   */
  name?: string;
}

/**
 * Common parameters for all kinds of default popover items: with or without confirmation
 */
export interface PopoverItemDefaultBaseParams {
  /**
   * Item type
   */
  type?: PopoverItemType.Default;

  /**
   * Displayed text.
   */
  title?: string;

  /**
   * A live host element rendered in place of the text {@link title} — appended
   * as-is with its node identity preserved, so an external renderer (e.g. a
   * React portal rendering a host-i18n label) keeps owning and updating it.
   * When set it wins over `title` for display; keep providing `title`/
   * {@link englishTitle} so search and promoted-item dedup (which key off the
   * string title) still have a term to match. Mirrors the `icon` dual model
   * without widening the widely-consumed string `title`.
   */
  titleEl?: HTMLElement;

  /**
   * Item icon to be appeared near a title.
   *
   * Either an HTML string (rendered via innerHTML) or a live HTMLElement —
   * the element is appended as-is with its node identity preserved, so an
   * external renderer (e.g. a React portal) can keep owning and updating it.
   */
  icon?: string | HTMLElement;

  /**
   * Icon to be displayed on the trailing (right) side of the item.
   * Rendered without a box background, suitable for indicators like a checkmark.
   */
  trailingIcon?: string;

  /**
   * Additional displayed text
   */
  secondaryLabel?: string;

  /**
   * The item's current value, as plain grey text before the chevron
   * (the "Number" in "Number format › Number"). Unlike secondaryLabel,
   * it is not drawn as a keyboard shortcut.
   */
  valueLabel?: string;

  /**
   * An element drawn before {@link valueLabel}, such as a colour swatch.
   * Appended as-is. Needs a valueLabel.
   */
  valueIcon?: HTMLElement;

  /**
   * A grey line under the title, such as "No properties will be deleted"
   * under "Reset to original page layout".
   */
  description?: string;

  /**
   * Draws the chevron on a row without children: a row that opens another
   * surface (the "Edit formula" row opens the formula editor).
   */
  chevron?: boolean;

  /**
   * Grey text after the title, shown as "· <text>" only in search results.
   * Not searched and not part of the title.
   */
  searchSuffix?: string;

  /**
   * True if item should be highlighted as active
   */
  isActive?: boolean | (() => boolean);

  /**
   * True if item should be disabled
   */
  isDisabled?: boolean;

  /**
   * True if item represents a destructive action (e.g. delete).
   * Applies red text/icon color and red-tinted hover background.
   */
  isDestructive?: boolean;

  /**
   * True if popover should close once item is activated
   */
  closeOnActivate?: boolean;

  /**
   * Item name
   * Used in data attributes needed for shortcuts work and automated end-to-end tests
   */
  name?: string;

  /**
   * Defines whether item should toggle on click.
   * Can be represented as boolean value or a string key.
   * In case of string, works like radio buttons group and highlights as inactive any other item that has same toggle key value.
   */
  toggle?: boolean | string;

  /**
   * Hint data to be displayed on item hover
   */
  hint?: HintParams;

  /**
   * Custom data attributes to be added to the item element.
   * Keys should be in camelCase (e.g., 'headerLevel' becomes 'data-header-level')
   */
  dataset?: Record<string, string>;

  /**
   * English title for multilingual search.
   * Used to search against English terms even when UI is in another language.
   */
  englishTitle?: string;

  /**
   * Additional search terms for this item.
   * Used to match alternative names or keywords.
   */
  searchTerms?: string[];

  /**
   * Popover item activation handler
   *
   * @param item - activated item
   * @param event - event that initiated item activation
   */
  onActivate: (item: PopoverItemParams, event?: PointerEvent) => void;
}

/**
 * Default, non-separator and non-html popover items type
 */
export type PopoverItemDefaultParams =
  PopoverItemDefaultBaseParams |
  PopoverItemDefaultWithConfirmationParams |
  WithChildren<PopoverItemDefaultBaseParams>;

/**
 * Represents single popover item
 */
export type PopoverItemParams =
  PopoverItemDefaultParams |
  PopoverItemSeparatorParams |
  PopoverItemHtmlParams |
  WithChildren<PopoverItemHtmlParams>;

/**
 * Parameters of how to render hint for the popover item
 */
type PopoverItemHintRenderParams = {
  /**
   * Hint position relative to the item
   */
  position?: HintPosition;

  /**
   * Horizontal alignment of the hint content.
   * 'start' by default.
   */
  alignment?: HintTextAlignment;

  /**
   * If false, hint will not be rendered.
   * True by default.
   * Used to disable hints on mobile popover
   */
  enabled?: boolean;
};


/**
 * Common popover item render params shared across item types
 */
interface PopoverItemCommonRenderParams {
  /**
   * If true, item is rendered inside an inline popover.
   * Applies different styling for inline context.
   */
  isInline?: boolean;

  /**
   * If true, item is rendered inside a nested popover within an inline popover.
   * Applies nested popover styling.
   */
  isNestedInline?: boolean;
}

/**
 * Popover item render params.
 * The parameters that are not set by user via popover api but rather depend on technical implementation
 */
export type PopoverItemRenderParamsMap = {
  [PopoverItemType.Default]?: PopoverItemCommonRenderParams & {
    /**
     * Wrapper tag for the item.
     * Div by default
     */
    wrapperTag?: 'div' | 'button';

    /**
     * Hint render params
     */
    hint?: PopoverItemHintRenderParams;

    /**
     * If true, adds a gap/margin after the icon.
     * True by default. Set to false for inline tools where icons are displayed without titles.
     */
    iconWithGap?: boolean;

    /**
     * ARIA role for the item's root element.
     * 'menuitem' (default) for menu popovers; 'option' for listbox popovers
     * (e.g. the Toolbox combobox). When 'menuitem', toggleable items are
     * automatically upgraded to 'menuitemcheckbox' with aria-checked.
     */
    menuItemRole?: 'menuitem' | 'option';
  };

  [PopoverItemType.Html]?: PopoverItemCommonRenderParams & {
    /**
     * Hint render params
     */
    hint?: PopoverItemHintRenderParams
  };

  [PopoverItemType.Separator]?: PopoverItemCommonRenderParams;
};

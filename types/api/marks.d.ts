/**
 * A declared value of a mark's attribute or style property.
 *
 * String values are static: they participate in the mark's identity and are
 * written verbatim. Function values are dynamic: they are resolved from the
 * state passed to `apply`/`toggle`, and are deliberately EXCLUDED from
 * identity — only the property's presence counts. That is what makes a colour
 * picker one mark that updates in place, rather than N mutually-cancelling
 * marks.
 */
export type MarkValue<State = void> = string | ((state: State) => string);

/**
 * Declarative description of an inline mark — the wrapper element a formatting
 * span produces (e.g. `<mark style="color: …">`, `<span class="hl">`).
 *
 * Identity is derived from `tag` + `className` + static `attributes`/`style`
 * values. Two specs sharing tag, classNames and static attributes belong to
 * the same FAMILY and compose on a single element instead of nesting — e.g.
 * a text-colour spec and a background-colour spec both on `<mark>`.
 *
 * A style property whose current value is `transparent` counts as unset, both
 * for identity checks and when deciding whether a wrapper is empty enough to
 * unwrap.
 */
export interface MarkSpec<State = void> {
  /**
   * Tag name of the wrapper element (case-insensitive), e.g. `mark`, `span`.
   */
  tag: string;

  /**
   * Additional tag names that count as the SAME mark when matching existing
   * elements (e.g. `strong` with alias `b`, `i` with alias `em`). Newly
   * created wrappers always use `tag`; alias-tagged wrappers are recognized,
   * stripped and split exactly like canonical ones.
   */
  aliasTags?: string[];

  /**
   * Class name(s) the wrapper must carry. All of them are required for a
   * match; extra classes on the element are tolerated.
   */
  className?: string | string[];

  /**
   * Attributes the wrapper carries. Static values must match exactly;
   * function values only require the attribute to be present.
   */
  attributes?: Record<string, MarkValue<State>>;

  /**
   * Inline style properties the wrapper carries. Static values must match
   * exactly; function values only require the property to be set (and not
   * `transparent`).
   */
  style?: Record<string, MarkValue<State>>;
}

/**
 * Current values of a matched mark's declared properties, read from the DOM.
 */
export interface MarkSnapshot {
  /**
   * The matched wrapper element.
   */
  element: HTMLElement;

  /**
   * Declared style properties that are currently set (unset and
   * `transparent`-valued properties are omitted).
   */
  style: Record<string, string>;

  /**
   * Declared attributes currently present on the element.
   */
  attributes: Record<string, string>;
}

/**
 * Range-aware inline-mark operations.
 *
 * Every method defaults to the live selection's first range when no range is
 * passed. Unlike `selection.findParentTag`, these operate on the WHOLE range:
 * `has` answers "is every text node in the range covered", `apply`/`remove`
 * split partially-covered wrappers at the range boundaries, update
 * fully-covering wrappers in place, and restore the selection afterwards.
 */
export interface Marks {
  /**
   * Whether every text node in the range is inside a wrapper matching the
   * spec. Whitespace-only text nodes are ignored. At a collapsed caret this
   * checks the caret's ancestors.
   * @param spec - mark description
   * @param range - range to check; defaults to the current selection
   */
  has<State>(spec: MarkSpec<State>, range?: Range): boolean;

  /**
   * Nearest ancestor element matching the spec, starting from the given node
   * (or the current selection's start container).
   * @param spec - mark description
   * @param from - node to start the upward search from
   */
  find<State>(spec: MarkSpec<State>, from?: Node): HTMLElement | null;

  /**
   * Read the current values of the spec's declared properties from the
   * wrapper at the range start. Returns null when the range is not inside a
   * matching wrapper.
   * @param spec - mark description
   * @param range - range to read from; defaults to the current selection
   */
  read<State>(spec: MarkSpec<State>, range?: Range): MarkSnapshot | null;

  /**
   * Wrap the range in the mark (or update matching wrappers in place).
   * Splits partially-covered same-family wrappers at the range boundaries,
   * extends the range over browser-excluded trailing whitespace, and leaves
   * the new contents selected. Returns the created/updated wrapper elements.
   * @param spec - mark description
   * @param state - value passed to the spec's function-form properties
   * @param range - range to format; defaults to the current selection
   */
  apply<State>(spec: MarkSpec<State>, state?: State, range?: Range): HTMLElement[];

  /**
   * Remove the spec's declared properties/classes from wrappers in the range,
   * unwrapping wrappers left bare. Splits partially-covered wrappers so text
   * outside the range keeps its formatting. Restores the selection. Returns
   * the wrappers that survived (kept other properties).
   * @param spec - mark description
   * @param range - range to deformat; defaults to the current selection
   */
  remove<State>(spec: MarkSpec<State>, range?: Range): HTMLElement[];

  /**
   * `remove` when the range already has the mark, `apply` otherwise.
   * Returns the resulting state: true when the mark is now applied.
   * @param spec - mark description
   * @param state - value passed to the spec's function-form properties
   * @param range - range to toggle; defaults to the current selection
   */
  toggle<State>(spec: MarkSpec<State>, state?: State, range?: Range): boolean;
}

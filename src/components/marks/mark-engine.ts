import type { SanitizerConfig } from '../../../types';
import type { MarkSnapshot, MarkSpec, MarkValue } from '../../../types/api';
import {
  collectFormattingAncestors,
  extendRangeToTrailingWhitespace,
  findFormattingAncestor,
  isRangeFormatted,
} from '../inline-tools/utils/formatting-range-utils';

/**
 * Range-aware inline-mark engine.
 *
 * Extracted from the Marker inline tool, which grew every hard piece of this
 * machinery first: boundary splitting so partially-covered wrappers keep
 * formatting outside the range, per-property style composition, unwrap of
 * wrappers left bare, and selection restoration after DOM surgery. The engine
 * generalizes it over a declarative {@link MarkSpec} so every mark-shaped
 * inline tool (core or consumer) shares ONE implementation.
 *
 * All operations act on an explicit Range and manage the live selection the
 * way the extracted tools always did (the applied contents stay selected).
 */

/**
 * A style property whose value is `transparent` carries no visual identity —
 * it exists only to override UA defaults (e.g. the browser's yellow <mark>
 * background). It counts as UNSET for identity checks and for the
 * unwrap-bareness decision. Extracted verbatim from Marker's `hasOtherStyle`.
 * @param value - current property value
 */
const isStyleValueSet = (value: string): boolean => {
  return value !== '' && value !== 'transparent';
};

/**
 * All tag names an element may carry to count as this mark: the canonical
 * tag plus any aliases (e.g. `strong` + `b`), uppercased for tagName compare
 * @param spec - mark description
 */
const specTagNames = <State>(spec: MarkSpec<State>): string[] => {
  return [spec.tag, ...(spec.aliasTags ?? [])].map((tag) => tag.toUpperCase());
};

/**
 * Normalize the spec's className field to an array
 * @param spec - mark description
 */
const specClassNames = <State>(spec: MarkSpec<State>): string[] => {
  if (spec.className === undefined) {
    return [];
  }

  return Array.isArray(spec.className) ? spec.className : [spec.className];
};

/**
 * Resolve a declared value: static strings pass through, function forms are
 * called with the state
 * @param value - declared value
 * @param state - state for function-form values
 */
const resolveMarkValue = <State>(value: MarkValue<State>, state: State | undefined): string => {
  return typeof value === 'function' ? value(state as State) : value;
};

/**
 * Whether an element matches the spec's full identity: tag + classNames +
 * static attributes/styles by value, function-form properties by presence.
 * @param spec - mark description
 * @param element - element to test
 */
export const matchesMarkSpec = <State>(spec: MarkSpec<State>, element: Element): boolean => {
  if (!matchesMarkFamily(spec, element)) {
    return false;
  }

  const style = (element as HTMLElement).style;

  return Object.entries(spec.style ?? {}).every(([prop, value]) => {
    const current = style.getPropertyValue(prop);

    /**
     * Function-form values are excluded from identity: presence is enough
     */
    return typeof value === 'function' ? isStyleValueSet(current) : current === value;
  });
};

/**
 * Whether an element belongs to the spec's FAMILY: same tag, classNames and
 * static attributes. Style values are excluded — that is what lets two specs
 * of the same family (text colour / background colour) compose on one element
 * instead of nesting or cancelling.
 * @param spec - mark description
 * @param element - element to test
 */
const matchesMarkFamily = <State>(spec: MarkSpec<State>, element: Element): boolean => {
  if (!specTagNames(spec).includes(element.tagName)) {
    return false;
  }

  const hasDeclaredClasses = specClassNames(spec).every((className) => element.classList.contains(className));

  if (!hasDeclaredClasses) {
    return false;
  }

  return Object.entries(spec.attributes ?? {}).every(([name, value]) => {
    return typeof value === 'function' ? element.hasAttribute(name) : element.getAttribute(name) === value;
  });
};

/**
 * Whether every text node in the range sits inside a wrapper matching the
 * spec (whitespace-only nodes ignored; collapsed ranges check ancestors)
 * @param spec - mark description
 * @param range - range to check
 */
export const hasMark = <State>(spec: MarkSpec<State>, range: Range): boolean => {
  return isRangeFormatted(range, (element) => matchesMarkSpec(spec, element), { ignoreWhitespace: true });
};

/**
 * Nearest ancestor element matching the spec's full identity
 * @param spec - mark description
 * @param from - node to start the upward search from
 */
export const findMark = <State>(spec: MarkSpec<State>, from: Node | null): HTMLElement | null => {
  return findFormattingAncestor(from, (element) => matchesMarkSpec(spec, element));
};

/**
 * Read current values of the spec's declared properties from the wrapper at
 * the range start
 * @param spec - mark description
 * @param range - range whose start anchors the search
 */
export const readMark = <State>(spec: MarkSpec<State>, range: Range): MarkSnapshot | null => {
  const element = findMark(spec, range.startContainer);

  if (!element) {
    return null;
  }

  const style: Record<string, string> = {};

  for (const prop of Object.keys(spec.style ?? {})) {
    const value = element.style.getPropertyValue(prop);

    if (isStyleValueSet(value)) {
      style[prop] = value;
    }
  }

  const attributes: Record<string, string> = {};

  for (const name of Object.keys(spec.attributes ?? {})) {
    const value = element.getAttribute(name);

    if (value !== null) {
      attributes[name] = value;
    }
  }

  return { element, style, attributes };
};

/**
 * Write the spec's classes, attributes and style properties onto an element
 * @param element - target wrapper
 * @param spec - mark description
 * @param state - state for function-form values
 */
const writeSpecOnto = <State>(element: HTMLElement, spec: MarkSpec<State>, state: State | undefined): void => {
  for (const className of specClassNames(spec)) {
    element.classList.add(className);
  }

  for (const [name, value] of Object.entries(spec.attributes ?? {})) {
    element.setAttribute(name, resolveMarkValue(value, state));
  }

  for (const [prop, value] of Object.entries(spec.style ?? {})) {
    element.style.setProperty(prop, resolveMarkValue(value, state));
  }
};

/**
 * Remove the spec's declared classes, attributes and style properties from an
 * element, dropping empty class/style attributes afterwards
 * @param element - target wrapper
 * @param spec - mark description
 */
const stripSpecFrom = <State>(element: HTMLElement, spec: MarkSpec<State>): void => {
  for (const className of specClassNames(spec)) {
    element.classList.remove(className);
  }

  for (const name of Object.keys(spec.attributes ?? {})) {
    element.removeAttribute(name);
  }

  for (const prop of Object.keys(spec.style ?? {})) {
    element.style.removeProperty(prop);
  }

  if (element.classList.length === 0) {
    element.removeAttribute('class');
  }

  if (element.style.length === 0) {
    element.removeAttribute('style');
  }
};

/**
 * Whether a wrapper carries no identity of its own anymore: no classes, no
 * attributes beyond (possibly empty) class/style, and no style properties
 * that aren't `transparent`-valued fillers. Bare wrappers are unwrapped.
 * @param element - wrapper to test
 */
const isBareWrapper = (element: HTMLElement): boolean => {
  if (element.classList.length > 0) {
    return false;
  }

  const style = element.style;
  const props = Array.from({ length: style.length }, (_, i) => style.item(i));

  if (props.some((prop) => isStyleValueSet(style.getPropertyValue(prop)))) {
    return false;
  }

  return Array.from(element.attributes).every((attribute) => {
    return attribute.name === 'style' || attribute.name === 'class';
  });
};

/**
 * Unwrap an element, moving its children to its parent
 * @param element - element to unwrap
 */
const unwrapElement = (element: HTMLElement): void => {
  const parent = element.parentNode;

  if (!parent) {
    return;
  }

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }

  parent.removeChild(element);
};

/**
 * Find a single family wrapper that contains both range boundaries
 * @param spec - mark description
 * @param range - range to check
 */
const findContainingWrapper = <State>(spec: MarkSpec<State>, range: Range): HTMLElement | null => {
  const familyOf = (element: Element): boolean => matchesMarkFamily(spec, element);
  const start = findFormattingAncestor(range.startContainer, familyOf);
  const end = findFormattingAncestor(range.endContainer, familyOf);

  return start !== null && start === end ? start : null;
};

/**
 * Whether the range covers the wrapper's entire contents
 * @param range - selection range
 * @param wrapper - wrapper element
 */
const rangeCoversContents = (range: Range, wrapper: HTMLElement): boolean => {
  const wrapperRange = document.createRange();

  wrapperRange.selectNodeContents(wrapper);

  return (
    range.compareBoundaryPoints(Range.START_TO_START, wrapperRange) <= 0 &&
    range.compareBoundaryPoints(Range.END_TO_END, wrapperRange) >= 0
  );
};

/**
 * Extract content after a boundary point into a new sibling wrapper cloned
 * from the original (all attributes preserved)
 * @param wrapper - wrapper to split
 * @param boundaryNode - node at the boundary
 * @param boundaryOffset - offset at the boundary
 */
const extractTrailing = (wrapper: HTMLElement, boundaryNode: Node, boundaryOffset: number): void => {
  const trailingRange = document.createRange();

  trailingRange.setStart(boundaryNode, boundaryOffset);
  trailingRange.setEnd(wrapper, wrapper.childNodes.length);

  const contents = trailingRange.extractContents();

  if (!contents.textContent) {
    return;
  }

  const clone = wrapper.cloneNode(false) as HTMLElement;

  clone.appendChild(contents);
  wrapper.after(clone);
};

/**
 * Extract content before a boundary point into a new sibling wrapper cloned
 * from the original (all attributes preserved)
 * @param wrapper - wrapper to split
 * @param boundaryNode - node at the boundary
 * @param boundaryOffset - offset at the boundary
 */
const extractLeading = (wrapper: HTMLElement, boundaryNode: Node, boundaryOffset: number): void => {
  const leadingRange = document.createRange();

  leadingRange.setStart(wrapper, 0);
  leadingRange.setEnd(boundaryNode, boundaryOffset);

  const contents = leadingRange.extractContents();

  if (!contents.textContent) {
    return;
  }

  const clone = wrapper.cloneNode(false) as HTMLElement;

  clone.appendChild(contents);
  wrapper.before(clone);
};

/**
 * Split family wrappers that extend beyond the range boundaries, so the
 * operation only affects the portion inside the range and text outside keeps
 * its formatting
 * @param spec - mark description
 * @param range - selection range
 */
const splitFamilyAtBoundaries = <State>(spec: MarkSpec<State>, range: Range): void => {
  const familyOf = (element: Element): boolean => matchesMarkFamily(spec, element);
  const wrappers = collectFormattingAncestors(range, familyOf);

  for (const wrapper of wrappers) {
    const wrapperRange = document.createRange();

    wrapperRange.selectNodeContents(wrapper);

    const startsBefore = range.compareBoundaryPoints(Range.START_TO_START, wrapperRange) <= 0;
    const endsAfter = range.compareBoundaryPoints(Range.END_TO_END, wrapperRange) >= 0;

    if ((startsBefore && endsAfter) || !wrapper.parentNode) {
      continue;
    }

    /**
     * Split at the end boundary first, so start offsets stay valid
     */
    if (!endsAfter) {
      splitTrailingAndPinRange(wrapper, range);
    }

    if (!startsBefore) {
      splitLeadingAndPinRange(wrapper, range);
    }
  }
};

/**
 * Split off the wrapper content after the range end, then pin the range end
 * back to the surviving text node — extracting content around a boundary
 * makes browsers/jsdom re-seat the live range inconsistently
 * @param wrapper - wrapper to split
 * @param range - live range whose end sits inside the wrapper
 */
const splitTrailingAndPinRange = (wrapper: HTMLElement, range: Range): void => {
  const endNode = range.endContainer;

  extractTrailing(wrapper, endNode, range.endOffset);

  if (endNode.nodeType === Node.TEXT_NODE && endNode.isConnected) {
    range.setEnd(endNode, (endNode as Text).length);
  }
};

/**
 * Split off the wrapper content before the range start, then pin the range
 * start back to the surviving text node
 * @param wrapper - wrapper to split
 * @param range - live range whose start sits inside the wrapper
 */
const splitLeadingAndPinRange = (wrapper: HTMLElement, range: Range): void => {
  const startNode = range.startContainer;

  extractLeading(wrapper, startNode, range.startOffset);

  if (startNode.nodeType === Node.TEXT_NODE && startNode.isConnected) {
    range.setStart(startNode, 0);
  }
};

/**
 * Select an element's contents
 * @param element - element whose contents should be selected
 */
const selectContents = (element: HTMLElement): void => {
  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  const range = document.createRange();

  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
};

/**
 * Split a wrapper around a range so only the selected portion gets the new
 * spec values. Produces up to three segments: before (original), selected
 * (updated), after (original).
 * @param wrapper - wrapper to split
 * @param range - selection range within the wrapper
 * @param spec - mark description
 * @param state - state for function-form values
 */
const splitWrapperAroundRange = <State>(
  wrapper: HTMLElement,
  range: Range,
  spec: MarkSpec<State>,
  state: State | undefined
): HTMLElement => {
  const parent = wrapper.parentNode;

  if (!parent) {
    return wrapper;
  }

  const beforeRange = document.createRange();

  beforeRange.setStart(wrapper, 0);
  beforeRange.setEnd(range.startContainer, range.startOffset);

  const afterRange = document.createRange();

  afterRange.setStart(range.endContainer, range.endOffset);
  afterRange.setEnd(wrapper, wrapper.childNodes.length);

  const beforeContents = beforeRange.extractContents();
  const selectedContents = range.extractContents();
  const afterContents = afterRange.extractContents();

  const middle = wrapper.cloneNode(false) as HTMLElement;

  writeSpecOnto(middle, spec, state);
  middle.appendChild(selectedContents);

  const fragment = document.createDocumentFragment();

  if (beforeContents.textContent) {
    const before = wrapper.cloneNode(false) as HTMLElement;

    before.appendChild(beforeContents);
    fragment.appendChild(before);
  }

  fragment.appendChild(middle);

  if (afterContents.textContent) {
    const after = wrapper.cloneNode(false) as HTMLElement;

    after.appendChild(afterContents);
    fragment.appendChild(after);
  }

  parent.replaceChild(fragment, wrapper);
  selectContents(middle);

  return middle;
};

/**
 * Wrap the range in the mark, or update matching wrappers in place.
 * Returns the created/updated wrapper elements.
 * @param spec - mark description
 * @param state - state for function-form values
 * @param range - range to format
 */
export const applyMark = <State>(spec: MarkSpec<State>, state: State | undefined, range: Range): HTMLElement[] => {
  if (range.collapsed) {
    return [];
  }

  extendRangeToTrailingWhitespace(range);

  const containing = findContainingWrapper(spec, range);

  if (containing) {
    if (rangeCoversContents(range, containing)) {
      writeSpecOnto(containing, spec, state);

      return [containing];
    }

    return [splitWrapperAroundRange(containing, range, spec, state)];
  }

  splitFamilyAtBoundaries(spec, range);

  /**
   * Wrappers holding a range boundary get CLONED into the extracted fragment
   * by extractContents, leaving an empty shell behind — remember them so the
   * shells can be swept after insertion
   */
  const familyOf = (element: Element): boolean => matchesMarkFamily(spec, element);
  const boundaryWrappers = collectFormattingAncestors(range, familyOf);

  const wrapper = document.createElement(spec.tag);

  writeSpecOnto(wrapper, spec, state);
  wrapper.appendChild(range.extractContents());

  /**
   * Family wrappers that travelled into the new wrapper would nest duplicate
   * formatting — strip the spec's properties from them (after extraction, so
   * no live range boundary can be re-seated by the unwrapping), and unwrap
   * the ones left bare
   */
  const nestedFamily = Array.from(wrapper.querySelectorAll(specTagNames(spec).join(','))).filter(
    (nested): nested is HTMLElement => nested instanceof HTMLElement && matchesMarkFamily(spec, nested)
  );

  for (const nested of nestedFamily) {
    stripSpecFrom(nested, spec);

    if (isBareWrapper(nested)) {
      unwrapElement(nested);
    }
  }

  range.insertNode(wrapper);

  for (const shell of boundaryWrappers) {
    if (shell.isConnected && (shell.textContent ?? '').length === 0) {
      shell.remove();
    }
  }

  selectContents(wrapper);

  return [wrapper];
};

/**
 * Walk text nodes within a parent to find the nodes and offsets matching
 * character positions in the parent's textContent
 * @param parent - parent element to walk
 * @param startIdx - start character index
 * @param endIdx - end character index
 */
const findTextBoundaries = (
  parent: HTMLElement,
  startIdx: number,
  endIdx: number
): { startNode: Text | null; startNodeOffset: number; endNode: Text | null; endNodeOffset: number } => {
  const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
  const result = { startNode: null as Text | null, startNodeOffset: 0, endNode: null as Text | null, endNodeOffset: 0 };
  const charCounter = { value: 0 };

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const nodeLength = node.textContent?.length ?? 0;

    if (result.startNode === null && charCounter.value + nodeLength > startIdx) {
      result.startNode = node;
      result.startNodeOffset = startIdx - charCounter.value;
    }

    if (charCounter.value + nodeLength >= endIdx) {
      result.endNode = node;
      result.endNodeOffset = endIdx - charCounter.value;
      break;
    }

    charCounter.value += nodeLength;
  }

  return result;
};

/**
 * Restore selection by locating the selected text within a surviving parent —
 * the fallback when range anchors were detached by DOM surgery
 * @param selection - window selection to restore
 * @param parent - element that survived the mutation
 * @param text - text that was selected before the mutation
 */
const restoreSelectionByText = (selection: Selection, parent: HTMLElement | null, text: string): void => {
  if (!parent || text.length === 0) {
    return;
  }

  const fullText = parent.textContent ?? '';
  const startIdx = fullText.indexOf(text);

  if (startIdx === -1) {
    return;
  }

  const { startNode, startNodeOffset, endNode, endNodeOffset } = findTextBoundaries(parent, startIdx, startIdx + text.length);

  if (startNode && endNode) {
    const restored = document.createRange();

    restored.setStart(startNode, startNodeOffset);
    restored.setEnd(endNode, endNodeOffset);
    selection.removeAllRanges();
    selection.addRange(restored);
  }
};

/**
 * Remove the spec's declared properties from family wrappers in the range,
 * unwrapping wrappers left bare. Returns the wrappers that survived.
 * @param spec - mark description
 * @param range - range to deformat
 */
export const removeMark = <State>(spec: MarkSpec<State>, range: Range): HTMLElement[] => {
  const selection = window.getSelection();
  const familyOf = (element: Element): boolean => matchesMarkFamily(spec, element);

  /**
   * Capture anchors and text before DOM surgery so the selection can be
   * re-established afterwards (browsers may collapse it on DOM changes)
   */
  const startContainer = range.startContainer;
  const startOffset = range.startOffset;
  const endContainer = range.endContainer;
  const endOffset = range.endOffset;
  const selectedText = range.toString();
  const ancestor = range.commonAncestorContainer;
  const ancestorEl = ancestor.nodeType === Node.ELEMENT_NODE ? (ancestor as HTMLElement) : ancestor.parentElement;
  const enclosingWrapper = ancestorEl ? findFormattingAncestor(ancestorEl, familyOf) : null;
  const survivingParent = enclosingWrapper ? enclosingWrapper.parentElement ?? ancestorEl : ancestorEl;

  /**
   * A collapsed caret targets its enclosing wrapper whole — splitting around
   * a zero-width range would slice the wrapper's contents into siblings
   */
  if (!range.collapsed) {
    /**
     * Symmetric with apply: browsers exclude trailing whitespace from
     * triple-click/Ctrl+A selections, and leaving it formatted would strand
     * a whitespace-only wrapper after the split
     */
    extendRangeToTrailingWhitespace(range);
    splitFamilyAtBoundaries(spec, range);
  }

  const survivors: HTMLElement[] = [];

  for (const wrapper of collectFormattingAncestors(range, familyOf)) {
    stripSpecFrom(wrapper, spec);

    if (isBareWrapper(wrapper)) {
      unwrapElement(wrapper);
    } else {
      survivors.push(wrapper);
    }
  }

  if (!selection) {
    return survivors;
  }

  const anchorsRestored =
    startContainer.isConnected &&
    endContainer.isConnected &&
    restoreSelectionFromAnchors(selection, startContainer, startOffset, endContainer, endOffset);

  if (!anchorsRestored) {
    restoreSelectionByText(selection, survivingParent, selectedText);
  }

  return survivors;
};

/**
 * Re-establish the selection from captured range anchors; returns false when
 * the anchors turned out stale (offsets no longer valid after DOM surgery)
 * @param selection - window selection to restore
 * @param startContainer - captured start container
 * @param startOffset - captured start offset
 * @param endContainer - captured end container
 * @param endOffset - captured end offset
 */
const restoreSelectionFromAnchors = (
  selection: Selection,
  startContainer: Node,
  startOffset: number,
  endContainer: Node,
  endOffset: number
): boolean => {
  try {
    const restored = document.createRange();

    restored.setStart(startContainer, startOffset);
    restored.setEnd(endContainer, endOffset);
    selection.removeAllRanges();
    selection.addRange(restored);

    return true;
  } catch {
    return false;
  }
};

/**
 * `remove` when the range already carries the mark, `apply` otherwise.
 * Returns true when the mark is now applied.
 * @param spec - mark description
 * @param state - state for function-form values
 * @param range - range to toggle
 */
export const toggleMark = <State>(spec: MarkSpec<State>, state: State | undefined, range: Range): boolean => {
  if (hasMark(spec, range)) {
    removeMark(spec, range);

    return false;
  }

  applyMark(spec, state, range);

  return true;
};

/**
 * Collapse the live selection to a caret right after a node's content
 * @param node - text node to place the caret in
 * @param offset - character offset for the caret
 */
const placeCaretAt = (node: Node, offset: number): void => {
  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  const caret = document.createRange();

  caret.setStart(node, offset);
  caret.setEnd(node, offset);
  selection.removeAllRanges();
  selection.addRange(caret);
};

/**
 * Toggle the mark at a collapsed caret using the zero-width-space
 * pending-format protocol: toggling ON inserts a wrapper holding a ZWSP and
 * places the caret inside it, so the next typed characters inherit the mark;
 * toggling OFF splits the enclosing wrapper around a ZWSP so typing continues
 * unformatted while the surrounding text keeps its formatting.
 * Returns true when the mark is now applied at the caret.
 * @param spec - mark description
 * @param state - state for function-form values
 * @param range - collapsed range marking the caret position
 */
export const toggleMarkAtCaret = <State>(spec: MarkSpec<State>, state: State | undefined, range: Range): boolean => {
  const zwsp = document.createTextNode('\u200B');

  if (hasMark(spec, range)) {
    range.insertNode(zwsp);

    const zwspRange = document.createRange();

    zwspRange.selectNode(zwsp);
    removeMark(spec, zwspRange);
    placeCaretAt(zwsp, 1);

    return false;
  }

  const wrapper = document.createElement(spec.tag);

  writeSpecOnto(wrapper, spec, state);
  wrapper.appendChild(zwsp);
  range.insertNode(wrapper);
  placeCaretAt(zwsp, 1);

  return true;
};

/**
 * Derive the sanitizer rule a mark produces: allowlist the spec's tag, strip
 * style properties and classes the spec does not declare, keep declared
 * attributes. Function-form values are handled by property NAME (names are
 * always known even when values are dynamic), so dynamic values can never be
 * silently dropped on save.
 * @param spec - mark description
 */
export const markSanitizerConfig = <State>(spec: MarkSpec<State>): SanitizerConfig => {
  const declaredStyles = Object.keys(spec.style ?? {});
  const declaredClasses = specClassNames(spec);
  const declaredAttributes = Object.entries(spec.attributes ?? {});

  const rule = (node: Element): { [attr: string]: boolean | string } => {
    const element = node as HTMLElement;
    const allowed: { [attr: string]: boolean | string } = {};

    const styleProps = Array.from({ length: element.style.length }, (_, i) => element.style.item(i));

    for (const prop of styleProps) {
      if (!declaredStyles.includes(prop)) {
        element.style.removeProperty(prop);
      }
    }

    if (element.style.length > 0) {
      allowed.style = true;
    }

    for (const className of Array.from(element.classList)) {
      if (!declaredClasses.includes(className)) {
        element.classList.remove(className);
      }
    }

    if (element.classList.length > 0) {
      allowed.class = true;
    }

    for (const [name, value] of declaredAttributes) {
      const current = element.getAttribute(name);

      if (current === null) {
        continue;
      }

      /**
       * Static attribute values are identity: strip mismatches instead of
       * letting arbitrary payloads ride a declared attribute name
       */
      if (typeof value === 'string' && current !== value) {
        continue;
      }

      allowed[name] = true;
    }

    return allowed;
  };

  return Object.fromEntries(
    specTagNames(spec).map((tagName) => [tagName.toLowerCase(), rule])
  );
};

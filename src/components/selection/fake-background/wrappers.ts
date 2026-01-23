import { Dom as $ } from '../../dom';

import { FakeBackgroundShadows } from './shadows';
import { FakeBackgroundTextNodes } from './text-nodes';

/**
 * Wrapper creation and processing utilities for fake background.
 */
export class FakeBackgroundWrappers {
  /**
   * Wraps passed range with a highlight span styled like an unfocused selection (gray)
   * @param range - range to wrap
   */
  static wrapRangeWithHighlight(range: Range): HTMLElement | null {
    if (range.collapsed) {
      return null;
    }

    const wrapper = $.make('span');

    wrapper.setAttribute('data-blok-testid', 'fake-background');
    wrapper.setAttribute('data-blok-fake-background', 'true');
    wrapper.setAttribute('data-blok-mutation-free', 'true');
    // Don't use background-color here - we'll use box-shadow only to avoid overlap issues
    // The box-shadow will be applied later in applyLineHeightExtensions
    wrapper.style.color = 'inherit';
    // box-decoration-break: clone ensures background/padding applies per-line for multi-line inline elements
    wrapper.style.boxDecorationBreak = 'clone';
    (wrapper.style as unknown as Record<string, string>)['-webkit-box-decoration-break'] = 'clone';
    // Preserve trailing whitespace so the highlight covers spaces at end of lines
    wrapper.style.whiteSpace = 'pre-wrap';

    const contents = range.extractContents();

    if (contents.childNodes.length === 0) {
      return null;
    }

    wrapper.appendChild(contents);
    range.insertNode(wrapper);

    return wrapper;
  }

  /**
   * Post-processes highlight wrappers to split multi-line spans and apply proper styling
   * @param wrappers - array of wrapper elements
   * @returns array of all wrapper elements (may be more than input if splits occurred)
   */
  static postProcessHighlightWrappers(wrappers: HTMLElement[]): HTMLElement[] {
    const allWrappers: HTMLElement[] = [];

    wrappers.forEach((wrapper) => {
      const splitWrappers = this.splitMultiLineWrapper(wrapper);
      allWrappers.push(...splitWrappers);
    });

    return allWrappers;
  }

  /**
   * Splits a multi-line wrapper into separate spans per line and applies box-shadow to each
   * This ensures gaps between lines are properly filled
   * @param wrapper - the highlight wrapper element
   * @returns array of wrapper elements (original if single line, or new per-line wrappers)
   */
  static splitMultiLineWrapper(wrapper: HTMLElement): HTMLElement[] {
    const clientRects = wrapper.getClientRects();

    if (clientRects.length <= 1) {
      FakeBackgroundShadows.applyBoxShadowToWrapper(wrapper);
      return [wrapper];
    }

    const textContent = wrapper.textContent || '';
    const parent = wrapper.parentNode;

    if (!parent || !textContent) {
      FakeBackgroundShadows.applyBoxShadowToWrapper(wrapper);
      return [wrapper];
    }

    const wrappers: HTMLElement[] = [];
    const textNode = wrapper.firstChild;

    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      FakeBackgroundShadows.applyBoxShadowToWrapper(wrapper);
      return [wrapper];
    }

    const lineBreaks = FakeBackgroundTextNodes.findLineBreakPositions(textNode as Text, clientRects.length);

    if (lineBreaks.length === 0) {
      FakeBackgroundShadows.applyBoxShadowToWrapper(wrapper);
      return [wrapper];
    }

    const segments = FakeBackgroundTextNodes.splitTextAtPositions(textContent, lineBreaks);
    const fragment = document.createDocumentFragment();

    segments.forEach((segment) => {
      if (segment.length === 0) {
        return;
      }

      const newWrapper = $.make('span');

      newWrapper.setAttribute('data-blok-testid', 'fake-background');
      newWrapper.setAttribute('data-blok-fake-background', 'true');
      newWrapper.setAttribute('data-blok-mutation-free', 'true');
      newWrapper.style.color = 'inherit';
      newWrapper.style.boxDecorationBreak = 'clone';
      (newWrapper.style as unknown as Record<string, string>)['-webkit-box-decoration-break'] = 'clone';
      newWrapper.style.whiteSpace = 'pre-wrap';
      newWrapper.textContent = segment;

      fragment.appendChild(newWrapper);
      wrappers.push(newWrapper);
    });

    parent.replaceChild(fragment, wrapper);

    return wrappers;
  }

  /**
   * Removes fake background wrapper
   * @param element - wrapper element
   */
  static unwrapFakeBackground(element: HTMLElement): void {
    const parent = element.parentNode;

    if (!parent) {
      return;
    }

    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }

    parent.removeChild(element);
  }
}

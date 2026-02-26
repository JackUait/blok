import type { LineGroup, LineRect } from './types';

/**
 * Box-shadow calculations for fake background functionality.
 */
export class FakeBackgroundShadows {
  private static readonly BG_COLOR = 'rgba(0, 0, 0, 0.08)';

  /**
   * Applies box-shadow to a wrapper to extend the background to fill line-height
   * @param wrapper - the wrapper element
   */
  static applyBoxShadowToWrapper(wrapper: HTMLElement): void {
    const parent = wrapper.parentElement;

    if (!parent) {
      return;
    }

    const parentStyle = window.getComputedStyle(parent);
    const wrapperStyle = window.getComputedStyle(wrapper);

    const lineHeight = parseFloat(parentStyle.lineHeight);
    const fontSize = parseFloat(wrapperStyle.fontSize);

    // If lineHeight is NaN (e.g., "normal"), estimate it as 1.2 * fontSize
    const effectiveLineHeight = Number.isNaN(lineHeight) ? fontSize * 1.2 : lineHeight;

    // Calculate extension needed to fill the line-height
    const rect = wrapper.getBoundingClientRect();
    const extension = Math.max(0, (effectiveLineHeight - rect.height) / 2);

    if (extension > 0) {
      // eslint-disable-next-line no-param-reassign
      wrapper.style.boxShadow = `0 ${extension}px 0 ${this.BG_COLOR}, 0 -${extension}px 0 ${this.BG_COLOR}`;
    }
  }

  /**
   * Applies additional box-shadow extensions to fill gaps between separate spans
   * This is only needed when there are multiple spans that may have gaps between them
   * @param spans - array of highlight span elements
   */
  static applyLineHeightExtensions(spans: HTMLElement[]): void {
    // Collect all line rects from all spans
    const allLineRects = this.collectAllLineRects(spans);

    if (allLineRects.length === 0) {
      return;
    }

    // Sort by vertical position
    allLineRects.sort((a, b) => a.top - b.top);

    // Group rects that are on the same visual line
    const lineGroups = this.groupRectsByLine(allLineRects);

    // Apply box-shadow to each span based on its line position (for inter-span gaps)
    spans.forEach((span) => {
      this.applyMultiLineBoxShadow(span, lineGroups);
    });
  }

  /**
   * Collects all line rectangles from all spans using getClientRects()
   * @param spans - array of span elements
   */
  static collectAllLineRects(spans: HTMLElement[]): LineRect[] {
    const rects: LineRect[] = [];

    spans.forEach((span) => {
      const clientRects = span.getClientRects();

      Array.from(clientRects).forEach((rect) => {
        rects.push({
          top: rect.top,
          bottom: rect.bottom,
          span,
        });
      });
    });

    return rects;
  }

  /**
   * Groups rectangles by their visual line
   * @param rects - array of line rectangles
   */
  static groupRectsByLine(rects: LineRect[]): LineGroup[] {
    const lines: LineGroup[] = [];

    rects.forEach((rect) => {
      // Find if this rect belongs to an existing line
      const existingLine = lines.find((line) => Math.abs(line.top - rect.top) < 2);

      if (existingLine) {
        // Extend the line if needed
        existingLine.top = Math.min(existingLine.top, rect.top);
        existingLine.bottom = Math.max(existingLine.bottom, rect.bottom);
      } else {
        lines.push({ top: rect.top, bottom: rect.bottom });
      }
    });

    // Sort lines by top position
    lines.sort((a, b) => a.top - b.top);

    return lines;
  }

  /**
   * Applies box-shadow to a span that may span multiple lines
   * Calculates extensions based on the span's position within the overall selection
   * @param span - the span element
   * @param lineGroups - grouped line rectangles
   */
  private static applyMultiLineBoxShadow(
    span: HTMLElement,
    lineGroups: LineGroup[]
  ): void {
    const clientRects = span.getClientRects();

    if (clientRects.length === 0) {
      return;
    }

    const parent = span.parentElement;

    if (!parent) {
      return;
    }

    const parentStyle = window.getComputedStyle(parent);
    const lineHeight = parseFloat(parentStyle.lineHeight);
    const fontSize = parseFloat(window.getComputedStyle(span).fontSize);
    const effectiveLineHeight = Number.isNaN(lineHeight) ? fontSize * 1.2 : lineHeight;

    const firstRect = clientRects[0];
    const lastRect = clientRects[clientRects.length - 1];

    const firstLineIndex = this.findLineIndex(firstRect.top, lineGroups);
    const lastLineIndex = this.findLineIndex(lastRect.top, lineGroups);

    const spanSpansMultipleLines = clientRects.length > 1 && firstLineIndex !== lastLineIndex;

    const isFirstLine = firstLineIndex === 0;
    const isLastLine = lastLineIndex === lineGroups.length - 1;

    const baseExtension = Math.max(0, (effectiveLineHeight - firstRect.height) / 2);

    const topExtension = spanSpansMultipleLines
      ? this.calculateLineTopExtension(baseExtension, isFirstLine, lineGroups, firstLineIndex)
      : baseExtension;
    const bottomExtension = spanSpansMultipleLines
      ? this.calculateLineBottomExtension(baseExtension, isLastLine, lineGroups, lastLineIndex)
      : baseExtension;

    const boxShadow = this.buildBoxShadow(topExtension, bottomExtension);

    // eslint-disable-next-line no-param-reassign
    span.style.boxShadow = boxShadow;
  }

  /**
   * Finds the line index for a given top position
   * @param top - the top position
   * @param lineGroups - grouped line rectangles
   */
  private static findLineIndex(top: number, lineGroups: LineGroup[]): number {
    const index = lineGroups.findIndex((line) => Math.abs(line.top - top) < 5);
    return index >= 0 ? index : 0;
  }

  /**
   * Calculates top extension for a line
   * Only uses base extension - gaps are filled by the previous line's bottom extension
   * @param baseExtension - the base extension value
   * @param _isFirstLine - whether this is the first line
   * @param _lineGroups - grouped line rectangles
   * @param _lineIndex - the line index
   */
  private static calculateLineTopExtension(
    baseExtension: number,
    _isFirstLine: boolean,
    _lineGroups: LineGroup[],
    _lineIndex: number
  ): number {
    // Top extension is always just the base extension
    // The gap between lines is filled entirely by the previous line's bottom extension
    // This prevents overlapping shadows that would cause darker bands
    return baseExtension;
  }

  /**
   * Calculates bottom extension for a line, accounting for gap to next line
   * The bottom extension fills the gap up to where the next line's top extension begins
   * This prevents overlap: line N's bottom shadow-sm meets line N+1's top shadow exactly
   * @param baseExtension - the base extension value
   * @param isLastLine - whether this is the last line
   * @param lineGroups - grouped line rectangles
   * @param lineIndex - the line index
   */
  private static calculateLineBottomExtension(
    baseExtension: number,
    isLastLine: boolean,
    lineGroups: LineGroup[],
    lineIndex: number
  ): number {
    if (isLastLine) {
      return baseExtension;
    }

    const currentLine = lineGroups[lineIndex];
    const nextLine = lineGroups[lineIndex + 1];

    // The next line's span will have its own top extension (baseExtension)
    // So we only need to extend to meet that point, not overlap it
    // Gap = nextLine.top - currentLine.bottom
    // Next line's top extension covers: nextLine.top - baseExtension to nextLine.top
    // So we extend from currentLine.bottom to (nextLine.top - baseExtension)
    const gapToNextLine = nextLine.top - currentLine.bottom;
    const nextLineTopExtension = baseExtension; // Next line will also extend up by baseExtension

    // We extend: baseExtension (our own) + gap - nextLineTopExtension
    const gapWeNeedToCover = Math.max(0, gapToNextLine - nextLineTopExtension);

    return baseExtension + gapWeNeedToCover;
  }

  /**
   * Builds box-shadow CSS value from top and bottom extensions
   * Uses inset shadow for the element's own background (to avoid using background-color)
   * and regular shadows for vertical extensions
   * @param topExtension - the top extension value
   * @param bottomExtension - the bottom extension value
   */
  private static buildBoxShadow(topExtension: number, bottomExtension: number): string {
    const shadows: string[] = [];

    // Use inset shadow to create the background color effect
    // This replaces background-color to avoid overlap issues between spans
    shadows.push(`inset 0 0 0 9999px ${this.BG_COLOR}`);

    // Add vertical extensions
    if (bottomExtension > 0) {
      shadows.push(`0 ${bottomExtension}px 0 ${this.BG_COLOR}`);
    }
    if (topExtension > 0) {
      shadows.push(`0 -${topExtension}px 0 ${this.BG_COLOR}`);
    }

    return shadows.join(', ');
  }
}

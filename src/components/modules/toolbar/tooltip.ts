import { Dom as $ } from '../../dom';

/**
 * A single text segment within a tooltip line.
 * When `highlight` is true, the segment is rendered as a white-colored span.
 */
export interface TooltipSegment {
  text: string;
  highlight: boolean;
  /** Isolates direction-sensitive tokens such as keyboard shortcuts. */
  direction?: 'ltr' | 'rtl' | 'auto';
}

/**
 * A tooltip line can be either:
 * - a plain string (the first word is automatically highlighted in white), or
 * - an array of TooltipSegment objects for precise per-token highlighting.
 */
export type TooltipLine = string | TooltipSegment[];

/** The muted ink of a two-tone hint (Notion's inverse secondary, research/31 §1); the bright part uses the tooltip font colour. */
export const TOOLTIP_MUTED_INK = 'rgb(173, 169, 163)';

/**
 * Applies highlight styling (the tooltip ink, semibold weight) to a span element.
 */
const applyHighlight = (span: HTMLElement): void => {
  // eslint-disable-next-line no-param-reassign -- intentional styling helper
  span.style.color = 'var(--blok-tooltip-font)';
  // eslint-disable-next-line no-param-reassign -- intentional styling helper
  span.style.fontWeight = '500';
};

/**
 * Creates a tooltip content element with multiple lines and consistent styling.
 * The first word of each string line takes the tooltip ink to highlight keywords.
 * Segment-based lines allow highlighting multiple specific tokens per line.
 *
 * @param lines - Array of lines; each line is a string or an array of TooltipSegment
 * @returns The tooltip container element
 */
export const createTooltipContent = function(lines: TooltipLine[]): HTMLElement {
  const container = $.make('div');

  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '0px';
  container.style.color = TOOLTIP_MUTED_INK;

  lines.forEach((line) => {
    const lineEl = $.make('div');

    if (Array.isArray(line)) {
      // Segment-based line: render highlighted or direction-isolated segments as spans.
      line.forEach((segment) => {
        if (segment.highlight || segment.direction !== undefined) {
          const span = $.make('span', null, { textContent: segment.text });

          if (segment.direction !== undefined) {
            span.dir = segment.direction;
          }

          if (segment.highlight) {
            applyHighlight(span);
          }

          lineEl.appendChild(span);
        } else {
          lineEl.appendChild(document.createTextNode(segment.text));
        }
      });
    } else {
      // String-based line: highlight the first word
      const spaceIndex = line.indexOf(' ');

      if (spaceIndex > 0) {
        const firstWord = line.substring(0, spaceIndex);
        const rest = line.substring(spaceIndex);
        const styledWord = $.make('span', null, { textContent: firstWord });

        applyHighlight(styledWord);
        lineEl.appendChild(styledWord);
        lineEl.appendChild(document.createTextNode(rest));
      } else {
        lineEl.appendChild(document.createTextNode(line));
      }
    }

    container.appendChild(lineEl);
  });

  return container;
};

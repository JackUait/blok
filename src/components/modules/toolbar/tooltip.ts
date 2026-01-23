import { Dom as $ } from '../../dom';

/**
 * Creates a tooltip content element with multiple lines and consistent styling.
 * The first word of each line is styled in white to highlight keyboard shortcuts.
 *
 * @param lines - Array of text strings, each will be displayed on its own line
 * @returns The tooltip container element
 */
export const createTooltipContent = function(lines: string[]): HTMLElement {
  const container = $.make('div');

  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '4px';

  lines.forEach((text) => {
    const line = $.make('div');
    const spaceIndex = text.indexOf(' ');

    if (spaceIndex > 0) {
      const firstWord = text.substring(0, spaceIndex);
      const rest = text.substring(spaceIndex);
      const styledWord = $.make('span', null, { textContent: firstWord });

      styledWord.style.color = 'white';
      line.appendChild(styledWord);
      line.appendChild(document.createTextNode(rest));
    } else {
      line.appendChild(document.createTextNode(text));
    }

    container.appendChild(line);
  });

  return container;
};

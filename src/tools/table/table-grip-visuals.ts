import { Dom } from '../../components/dom';
import { IconMenu } from '../../components/icons';

export const GRIP_HOVER_SIZE = 16;

/**
 * Sets only the size dimension of a grip pill (height for col, width for row).
 * Use this in full-state resets where the bg class is already handled by a className overwrite.
 */
export const setGripPillSize = (grip: HTMLElement, type: 'col' | 'row', size: number): void => {
  if (type === 'col') {
    Object.assign(grip.style, { height: `${size}px` });
  } else {
    Object.assign(grip.style, { width: `${size}px` });
  }
};

/**
 * Creates an SVG element with a dot grid pattern for the drag handle affordance.
 * Column grips get a horizontal 3×2 layout; row grips get a vertical 2×3 layout.
 */
export const createGripDotsSvg = (orientation: 'horizontal' | 'vertical'): SVGElement => {
  const svg = Dom.make('div', null, { innerHTML: IconMenu }).firstElementChild as SVGElement;
  const isHorizontal = orientation === 'horizontal';

  svg.setAttribute('width', isHorizontal ? '14' : '10');
  svg.setAttribute('height', isHorizontal ? '10' : '14');
  // Crop the 20-unit icon without scaling its dots or the compact pill.
  svg.setAttribute('viewBox', isHorizontal ? '3 5 14 10' : '5 3 10 14');
  svg.setAttribute('fill', 'currentColor');
  svg.classList.add(
    'opacity-0',
    'transition-opacity',
    'duration-150',
    'text-gray-400',
    'pointer-events-none'
  );

  if (isHorizontal) {
    for (const circle of svg.querySelectorAll('circle')) {
      circle.setAttribute('transform', 'rotate(90 10 10)');
    }
  }

  return svg;
};

/**
 * Expand a grip element to the hover state.
 * Column grips expand height; row grips expand width.
 */
export const expandGrip = (grip: HTMLElement, type: 'col' | 'row'): void => {
  if (type === 'col') {
    Object.assign(grip.style, { height: `${GRIP_HOVER_SIZE}px` });
  } else {
    Object.assign(grip.style, { width: `${GRIP_HOVER_SIZE}px` });
  }

  grip.classList.add('bg-gray-200');
  grip.classList.remove('bg-gray-300');

  const svg = grip.querySelector('svg');

  if (svg) {
    svg.classList.remove('opacity-0');
    svg.classList.add('opacity-100');
  }
};

/**
 * Collapse a grip element back to its idle pill size.
 * Column grips shrink height; row grips shrink width.
 */
export const collapseGrip = (grip: HTMLElement, type: 'col' | 'row', pillSize: number): void => {
  setGripPillSize(grip, type, pillSize);

  grip.classList.remove('bg-gray-200');
  grip.classList.add('bg-gray-300');

  const svg = grip.querySelector('svg');

  if (svg) {
    svg.classList.add('opacity-0');
    svg.classList.remove('opacity-100');
  }
};

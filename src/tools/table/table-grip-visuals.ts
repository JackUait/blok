export const GRIP_HOVER_SIZE = 16;

/**
 * Dot positions for vertical layout (2 cols × 3 rows) — used by row grips.
 */
const VERTICAL_DOTS: [number, number][] = [
  [2, 2], [8, 2],
  [2, 7], [8, 7],
  [2, 12], [8, 12],
];

/**
 * Dot positions for horizontal layout (3 cols × 2 rows) — used by column grips.
 */
const HORIZONTAL_DOTS: [number, number][] = [
  [2, 2], [7, 2], [12, 2],
  [2, 8], [7, 8], [12, 8],
];

/**
 * Creates an SVG element with a dot grid pattern for the drag handle affordance.
 * Column grips get a horizontal 3×2 layout; row grips get a vertical 2×3 layout.
 */
export const createGripDotsSvg = (orientation: 'horizontal' | 'vertical'): SVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const isHorizontal = orientation === 'horizontal';

  svg.setAttribute('width', isHorizontal ? '14' : '10');
  svg.setAttribute('height', isHorizontal ? '10' : '14');
  svg.setAttribute('viewBox', isHorizontal ? '0 0 14 10' : '0 0 10 14');
  svg.setAttribute('fill', 'currentColor');
  svg.classList.add(
    'opacity-0',
    'transition-opacity',
    'duration-150',
    'text-gray-400',
    'pointer-events-none'
  );

  const positions = isHorizontal ? HORIZONTAL_DOTS : VERTICAL_DOTS;

  for (const [cx, cy] of positions) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');

    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', '1.5');
    svg.appendChild(circle);
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
  if (type === 'col') {
    Object.assign(grip.style, { height: `${pillSize}px` });
  } else {
    Object.assign(grip.style, { width: `${pillSize}px` });
  }

  grip.classList.remove('bg-gray-200');
  grip.classList.add('bg-gray-300');

  const svg = grip.querySelector('svg');

  if (svg) {
    svg.classList.add('opacity-0');
    svg.classList.remove('opacity-100');
  }
};

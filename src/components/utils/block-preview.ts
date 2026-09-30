/**
 * Building blocks for toolbox preview drawings (see ToolboxPreviewConfig).
 * Drawings are plain DOM styled by src/styles/block-preview/*.css; they never
 * instantiate a real tool.
 */

type Child = Node | string;

/**
 * Makes an element with attributes and children.
 * @param tag - element tag
 * @param attrs - attributes to set
 * @param children - nodes or text
 */
export const h = (tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement => {
  const el = document.createElement(tag);

  Object.entries(attrs).forEach(([name, value]) => el.setAttribute(name, value));
  el.append(...children);

  return el;
};

/**
 * Root of one drawing. `name` keys its stylesheet rules: [data-blok-preview="<name>"].
 * @param name - drawing name, unique across all previews
 * @param children - drawing content
 */
export const createPreview = (name: string, ...children: Child[]): HTMLElement =>
  h('div', { 'data-blok-preview': name }, ...children);

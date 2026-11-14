import { styleTextField } from './controls';

export interface ElOptions {
  text?: string;
  /** Boolean data attribute (e.g. `data-cloud-muted`). */
  attribute?: string;
  attrs?: Record<string, string>;
  className?: string;
  children?: Array<Node | string>;
}

export interface ButtonOptions {
  label: string;
  onClick: () => void | Promise<void>;
  primary?: boolean;
  attribute?: string;
  type?: 'button' | 'submit';
  className?: string;
}

export interface FieldOptions {
  form: HTMLElement;
  label: string;
  type: string;
  name: string;
  value?: string;
  required?: boolean;
  id?: string;
}

/** Create an element with named options instead of positional helpers. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, options: ElOptions = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attribute) node.setAttribute(options.attribute, '');
  if (options.className) node.className = options.className;
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) node.setAttribute(name, value);
  }
  if (options.children) node.append(...options.children);
  return node;
}

/** Shared blok-button with named click / primary options. */
export function button(options: ButtonOptions): HTMLButtonElement {
  const node = el('button', {
    text: options.label,
    attribute: options.attribute,
    className: options.className ?? 'blok-button',
  });
  node.type = options.type ?? 'button';
  if (options.primary) node.setAttribute('data-cloud-primary', '');
  node.addEventListener('click', () => { void options.onClick(); });
  return node;
}

/** Label + text field appended to a form, matching the gateway field pattern. */
export function field(options: FieldOptions): HTMLInputElement {
  const id = options.id ?? `cloud-${options.name}`;
  const title = el('label', { text: options.label, attrs: { for: id } });
  const input = el('input');
  styleTextField(input);
  input.type = options.type;
  input.name = options.name;
  input.id = id;
  input.value = options.value ?? '';
  input.required = options.required ?? true;
  options.form.append(title, input);
  return input;
}

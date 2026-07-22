/**
 * ViewNode → React element mapping for the synchronous view bindings.
 * Real elements via `createElement` recursion — never `dangerouslySetInnerHTML`.
 */
import { createElement } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ViewNode } from '@bloklabs/core/view';

/** HTML void elements — must never receive children. */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Presence-valued HTML attributes mapped to boolean React props. `checked`
 * is handled separately (→ `defaultChecked`, so React does not treat the
 * input as controlled).
 */
const BOOLEAN_ATTRIBUTES = new Set([
  'disabled', 'open', 'controls', 'autoplay', 'loop', 'muted', 'required',
  'multiple', 'playsinline', 'reversed', 'hidden', 'default', 'novalidate',
  'allowfullscreen', 'itemscope',
]);

/** HTML attribute name → React prop name (beyond the identity mapping). */
const ATTRIBUTE_NAME_MAP: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  srcset: 'srcSet',
  srclang: 'srcLang',
  datetime: 'dateTime',
  autoplay: 'autoPlay',
  playsinline: 'playsInline',
  novalidate: 'noValidate',
  allowfullscreen: 'allowFullScreen',
  crossorigin: 'crossOrigin',
  referrerpolicy: 'referrerPolicy',
  contenteditable: 'contentEditable',
  spellcheck: 'spellCheck',
  maxlength: 'maxLength',
  minlength: 'minLength',
  usemap: 'useMap',
  itemscope: 'itemScope',
};

/**
 * Convert a sanitized `style` attribute string to a React style object
 * (React only accepts object styles). Custom properties keep their raw name;
 * everything else is camelCased.
 * @param css - style attribute text
 */
const styleStringToObject = (css: string): CSSProperties => {
  const style: Record<string, string> = {};

  for (const declaration of css.split(';')) {
    const separator = declaration.indexOf(':');

    if (separator === -1) {
      continue;
    }

    const property = declaration.slice(0, separator).trim();
    const value = declaration.slice(separator + 1).trim();

    if (property === '' || value === '') {
      continue;
    }

    const key = property.startsWith('--')
      ? property
      : property.toLowerCase().replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

    style[key] = value;
  }

  return style;
};

/**
 * Map one ViewNode attribute record to React props.
 * @param attrs - sanitized attributes from the view tree
 * @param key - sibling index used as the React key
 */
const attrsToProps = (attrs: Record<string, string>, key: number): Record<string, unknown> => {
  const props: Record<string, unknown> = { key };

  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'style') {
      props.style = styleStringToObject(value);
      continue;
    }

    if (name === 'checked') {
      props.defaultChecked = true;
      continue;
    }

    if (name === 'value') {
      props.defaultValue = value;
      continue;
    }

    if (BOOLEAN_ATTRIBUTES.has(name)) {
      props[ATTRIBUTE_NAME_MAP[name] ?? name] = true;
      continue;
    }

    props[ATTRIBUTE_NAME_MAP[name] ?? name] = value;
  }

  return props;
};

/**
 * Map a list of ViewNodes to React nodes. Element keys come from the sibling
 * index (the tree is static per render).
 * @param nodes - view tree siblings
 */
export const viewNodesToReact = (nodes: ViewNode[]): ReactNode[] => {
  return nodes.map((node, index): ReactNode => {
    if ('text' in node) {
      return node.text;
    }

    const props = attrsToProps(node.attrs, index);

    if (VOID_ELEMENTS.has(node.tag) || node.children.length === 0) {
      return createElement(node.tag, props);
    }

    return createElement(node.tag, props, ...viewNodesToReact(node.children));
  });
};

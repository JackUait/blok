/**
 * The DOM members html-cleaner.ts and markdown/sanitize-html.ts read on an
 * element, plus the rest of the tree-walking surface. A form control named
 * after any of them breaks a walk; one named `name`, `title` or `submit`
 * (as real forms do) does not. Add a member here when either walk starts
 * reading it.
 */
const WALKED_MEMBERS = new Set([
  'nodeType', 'nodeName', 'tagName', 'localName', 'namespaceURI', 'ownerDocument',
  'attributes', 'childNodes', 'children', 'firstChild', 'lastChild', 'previousSibling', 'nextSibling',
  'parentNode', 'parentElement', 'textContent', 'innerHTML', 'outerHTML',
  'insertBefore', 'appendChild', 'removeChild', 'replaceChild', 'remove', 'replaceWith', 'before', 'after',
  'getAttribute', 'setAttribute', 'hasAttribute', 'removeAttribute', 'compareDocumentPosition', 'contains', 'cloneNode',
]);

/**
 * A `<form>` exposes each named control (by `name` or `id`) as a property, and
 * those shadow the form's own DOM members: with `<input name="nextSibling">`
 * inside, `form.nextSibling` is that input. A sanitizer that reads such a
 * member walks the wrong nodes, so it must drop the form whole instead.
 *
 * The check reads only through prototypes, which the controls cannot shadow.
 * Browsers do not list named controls in `Object.getOwnPropertyNames`.
 * @param element - element to check
 */
export const isClobbered = (element: Element): boolean => {
  if (Object.prototype.toString.call(element) !== '[object HTMLFormElement]') {
    return false;
  }

  // Only the form's own members can be shadowed; its descendants are read as usual.
  const children = Array.from(Reflect.get<Element, 'children'>(Element.prototype, 'children', element));
  const named = children.flatMap((child) => [ child, ...Array.from(child.querySelectorAll('[name], [id]')) ]);

  return named.some((control) => [ control.getAttribute('name'), control.getAttribute('id') ]
    .some((name) => name !== null && WALKED_MEMBERS.has(name)));
};

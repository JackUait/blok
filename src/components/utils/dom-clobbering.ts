/**
 * The DOM members html-cleaner.ts and markdown/sanitize-html.ts read on an
 * element, plus the rest of the tree-walking surface. A form control named
 * after any of them breaks a walk; one named `name`, `title` or `submit`
 * (as real forms do) does not. Add a member here when either walk starts
 * reading it.
 */
const WALKED_MEMBERS = [
  'nodeType', 'nodeName', 'tagName', 'localName', 'namespaceURI', 'ownerDocument',
  'attributes', 'childNodes', 'children', 'firstChild', 'lastChild', 'previousSibling', 'nextSibling',
  'parentNode', 'parentElement',
  'insertBefore', 'appendChild', 'removeChild', 'replaceChild', 'remove', 'replaceWith', 'before', 'after',
  'getAttribute', 'setAttribute', 'hasAttribute', 'removeAttribute', 'compareDocumentPosition', 'contains', 'cloneNode',
];

/**
 * A `<form>` exposes each named control as a property, and those shadow the
 * form's own DOM members: with `<input name="nextSibling">` (inside it, or
 * outside with `form="id"`), `form.nextSibling` is that input. A sanitizer
 * that reads such a member walks the wrong nodes, so it drops the form whole.
 *
 * Each member is compared with what the prototype gives for this form, which
 * a control cannot shadow.
 * @param element - element to check
 */
export const isClobbered = (element: Element): boolean => {
  if (Object.prototype.toString.call(element) !== '[object HTMLFormElement]') {
    return false;
  }

  const prototype = Object.getPrototypeOf(element) as Record<string, unknown>;

  return WALKED_MEMBERS.some((member) => Reflect.get(element, member) !== Reflect.get(prototype, member, element));
};

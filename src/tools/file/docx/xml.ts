/**
 * Namespace-agnostic helpers over a parsed OOXML part. Elements and attributes
 * are matched by local name, so transitional (`schemas.openxmlformats.org`) and
 * strict (`purl.oclc.org`) documents read the same.
 */

/** Child elements of `el`, optionally only those with the given local name. */
export function kids(el: Element, name?: string): Element[] {
  return Array.from(el.children).filter((child) => name === undefined || child.localName === name);
}

/** First child element with the given local name. */
export function kid(el: Element | null | undefined, name: string): Element | null {
  if (el === null || el === undefined) {
    return null;
  }

  return Array.from(el.children).find((child) => child.localName === name) ?? null;
}

/** First descendant element with the given local name. */
export function find(el: Element, name: string): Element | null {
  return Array.from(el.getElementsByTagName('*')).find((child) => child.localName === name) ?? null;
}

/** All descendant elements with the given local name. */
export function findAll(el: Element, name: string): Element[] {
  return Array.from(el.getElementsByTagName('*')).filter((child) => child.localName === name);
}

/** Attribute value by local name, whatever its prefix. */
export function attr(el: Element | null | undefined, name: string): string | null {
  if (el === null || el === undefined) {
    return null;
  }

  return Array.from(el.attributes).find((a) => a.localName === name)?.value ?? null;
}

/** `w:val` of the named child. */
export function val(el: Element | null | undefined, name: string): string | null {
  return attr(kid(el, name), 'val');
}

/**
 * An on/off property (`<w:b/>`, `<w:b w:val="0"/>`): true, false, or null when
 * the element is absent.
 */
export function onOff(el: Element | null | undefined, name: string): boolean | null {
  const prop = kid(el, name);
  if (prop === null) {
    return null;
  }
  const value = attr(prop, 'val');

  return value === null || !['0', 'false', 'off', 'none'].includes(value);
}

/** A finite number from an attribute, or null. */
export function num(value: string | null): number | null {
  if (value === null || value.trim() === '') {
    return null;
  }
  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

/** Twentieths of a point → `Npt` (rounded to 0.05pt). */
export function twips(value: string | null): string | null {
  const n = num(value);

  return n === null ? null : `${round(n / 20)}pt`;
}

/** Round to two decimals and drop trailing zeros. */
export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** EMU (English Metric Unit) → CSS pixels. */
export function emuToPx(value: string | null): number | null {
  const n = num(value);

  return n === null ? null : Math.round(n / 9525);
}

const HEX_COLOR = /^[0-9a-f]{6}$/i;

/** A `RRGGBB` attribute as `#rrggbb`; null for `auto` and anything else. */
export function hexColor(value: string | null): string | null {
  return value !== null && HEX_COLOR.test(value) ? `#${value.toLowerCase()}` : null;
}

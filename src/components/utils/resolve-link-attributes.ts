import type { BlokConfig } from '../../../types';

import { isSamePageLink } from '../../tools/link/registry';

type LinkConfig = NonNullable<BlokConfig['link']>;

/**
 * The final anchor attributes for a single link, after applying the editor's
 * `link` config. `attributes` holds any extra attributes the richer `transform`
 * asked for (e.g. `class`, `title`, `data-*`); the managed `href`/`target`/`rel`
 * are kept separate so callers can apply them last and stay authoritative.
 */
export interface ResolvedLinkAttributes {
  href: string;
  target: string;
  rel: string;
  attributes: Record<string, string>;
}

/**
 * Resolves the final anchor attributes for a link from the editor's `link`
 * config. Shared by every anchor-producing path (the interactive Link inline
 * tool, the render pipeline and the paste pipeline) so hand-created, stored and
 * pasted links are treated identically.
 *
 * Rules:
 * - same-page destinations (`#anchor` or the current origin + pathname) always
 *   default to `_self` — decided from the *original* href, before any transform
 *   may proxy it to another origin — so in-page navigation never spawns a tab;
 * - the richer `transform` supersedes the `transformHref` shorthand; when it is
 *   set, `transformHref` is ignored;
 * - any field the `transform` leaves undefined (or a `void` return) falls back to
 *   these defaults.
 *
 * @param originalHref - the anchor's href before transformation
 * @param element - the anchor being built or updated (for context: text + node)
 * @param link - the resolved `link` config from the editor configuration
 */
export function resolveLinkAttributes(
  originalHref: string,
  element: HTMLAnchorElement,
  link: LinkConfig,
): ResolvedLinkAttributes {
  const defaultTarget = isSamePageLink(originalHref) ? '_self' : (link.target ?? '_blank');
  const defaultRel = link.rel ?? 'nofollow';

  if (link.transform !== undefined) {
    const result = link.transform({
      href: originalHref,
      text: element.textContent ?? '',
      element,
    }) ?? {};

    return {
      href: result.href ?? originalHref,
      target: result.target ?? defaultTarget,
      rel: result.rel ?? defaultRel,
      attributes: result.attributes ?? {},
    };
  }

  return {
    href: link.transformHref ? link.transformHref(originalHref) : originalHref,
    target: defaultTarget,
    rel: defaultRel,
    attributes: {},
  };
}

/**
 * Applies {@link ResolvedLinkAttributes} to an anchor. Extra `attributes` are
 * written first so the managed `href`/`target`/`rel` stay authoritative even if
 * the transform named one of them in `attributes`.
 * @param anchor - the anchor to write to
 * @param resolved - the attributes to set
 */
export function applyResolvedLinkAttributes(anchor: HTMLAnchorElement, resolved: ResolvedLinkAttributes): void {
  for (const [name, value] of Object.entries(resolved.attributes)) {
    anchor.setAttribute(name, value);
  }

  anchor.setAttribute('href', resolved.href);
  anchor.setAttribute('target', resolved.target);
  anchor.setAttribute('rel', resolved.rel);
}

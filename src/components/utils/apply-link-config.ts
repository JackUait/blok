import type { BlokConfig } from '../../../types';

import { applyResolvedLinkAttributes, resolveLinkAttributes } from './resolve-link-attributes';

/**
 * Anchor-building configuration shared by the interactive Link inline tool,
 * the render pipeline and the paste pipeline.
 */
type LinkConfig = NonNullable<BlokConfig['link']>;

/**
 * Applies the editor's `link` config to every anchor inside `root`.
 *
 * Mirrors the behaviour of the interactive Link inline tool so that anchors
 * coming from stored block HTML (render) or pasted markup (paste) receive the
 * same treatment as anchors the user creates by hand:
 *
 * - `target` is forced (default `_blank`), except same-page destinations
 *   (`#anchors` or the current origin+pathname) which always open in the same
 *   window regardless of config,
 * - `rel` is forced (default `nofollow`),
 * - `transformHref` rewrites the existing href when provided, or the richer
 *   `transform` sets href/target/rel/extra attributes per anchor.
 *
 * @param root - element (or fragment) whose descendant anchors should be processed
 * @param link - the resolved `link` config from the editor configuration
 */
export function applyLinkConfig(root: ParentNode, link: LinkConfig): void {
  root.querySelectorAll('a').forEach((anchor) => {
    const href = anchor.getAttribute('href');

    // An anchor without an href has no destination to transform or classify; it
    // still gets target/rel forced, matching hand-created links.
    if (href === null) {
      anchor.setAttribute('target', link.target ?? '_blank');
      anchor.setAttribute('rel', link.rel ?? 'nofollow');

      return;
    }

    applyResolvedLinkAttributes(anchor, resolveLinkAttributes(href, anchor, link));
  });
}

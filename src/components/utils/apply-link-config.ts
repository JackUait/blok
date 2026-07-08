import type { BlokConfig } from '../../../types';

import { isSamePageLink } from '../../tools/link/registry';

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
 * - `transformHref` rewrites the existing href when provided.
 *
 * @param root - element (or fragment) whose descendant anchors should be processed
 * @param link - the resolved `link` config from the editor configuration
 */
export function applyLinkConfig(root: ParentNode, link: LinkConfig): void {
  const configuredTarget = link.target ?? '_blank';
  const rel = link.rel ?? 'nofollow';
  const { transformHref } = link;

  root.querySelectorAll('a').forEach((anchor) => {
    const href = anchor.getAttribute('href');

    // Decide same-page from the original href, before transformHref may proxy it
    // to another origin — the link still conceptually leads to the current page.
    const target = href !== null && isSamePageLink(href) ? '_self' : configuredTarget;

    if (transformHref !== undefined && href !== null) {
      anchor.setAttribute('href', transformHref(href));
    }

    anchor.setAttribute('target', target);
    anchor.setAttribute('rel', rel);
  });
}

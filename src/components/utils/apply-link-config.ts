import type { BlokConfig } from '../../../types';

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
 * - `target` is forced (default `_blank`),
 * - `rel` is forced (default `nofollow`),
 * - `transformHref` rewrites the existing href when provided.
 *
 * @param root - element (or fragment) whose descendant anchors should be processed
 * @param link - the resolved `link` config from the editor configuration
 */
export function applyLinkConfig(root: ParentNode, link: LinkConfig): void {
  const target = link.target ?? '_blank';
  const rel = link.rel ?? 'nofollow';
  const { transformHref } = link;

  root.querySelectorAll('a').forEach((anchor) => {
    if (transformHref !== undefined) {
      const href = anchor.getAttribute('href');

      if (href !== null) {
        anchor.setAttribute('href', transformHref(href));
      }
    }

    anchor.setAttribute('target', target);
    anchor.setAttribute('rel', rel);
  });
}

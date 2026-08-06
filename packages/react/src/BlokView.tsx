import type { HTMLAttributes, ReactNode } from 'react';
import type { BlocksToHtmlOptions } from '@bloklabs/core/view';
import type { LooseOutputData, OutputData } from '@bloklabs/core';

import { useBlokView } from './useBlokView';

/**
 * Props for {@link BlokView}. Beyond the render options below, any standard
 * `<div>` attribute (`id`, `style`, `data-*`, `aria-*`, event handlers, …) is
 * forwarded onto the single wrapper element.
 */
export interface BlokViewProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Saved document to display (strict or loose wire shape; nullish tolerated). */
  data: OutputData | LooseOutputData | null | undefined;
  /** View schema from `defineBlokSchema` — display under the composition that produced the document. */
  schema?: BlocksToHtmlOptions['schema'];
  /** Custom per-tool renderers; win over built-ins. */
  renderers?: BlocksToHtmlOptions['renderers'];
  /** Unknown-tool policy (default 'skip'). */
  onUnknownBlock?: BlocksToHtmlOptions['onUnknownBlock'];
  /** Stamp `data-blok-tool="<type>"` on each block root as a styling hook (pairs with the opt-in view stylesheet). */
  toolAttributes?: BlocksToHtmlOptions['toolAttributes'];
  /** Stamp `data-blok-id="<id>"` on each block root (list items on their `<li>`) for "copy link to block" deep links. */
  blockIds?: BlocksToHtmlOptions['blockIds'];
  /** Pure URL rewrite hook for block URLs + inline anchors, run before the unsafe-scheme strip. */
  transformUrl?: BlocksToHtmlOptions['transformUrl'];
  /** Custom renderers for inline elements, keyed by lowercase tag name (equations, mentions). */
  inlineRenderers?: BlocksToHtmlOptions['inlineRenderers'];
  /**
   * Render with the editor's presentational classes and per-block scaffolding
   * so the output matches a read-only editor render (default `true`). Needs
   * `@bloklabs/core/view.css` imported to paint. Set `false` for unstyled
   * semantic markup.
   */
  classes?: BlocksToHtmlOptions['classes'];
}

/**
 * Display a saved Blok document synchronously — one `<div>` wrapper, no
 * editor chrome, no async, no effects. Content is mapped from the sanitized
 * view tree to real React elements (never `dangerouslySetInnerHTML`), so it
 * renders identically under SSR.
 *
 * This is the intended read-only path — reach for it instead of mounting the
 * full editing runtime (`BlokEditor readOnly`), which ships toolbar, history,
 * and mutation machinery to every viewer. Pair with `defineBlokSchema` to
 * display custom-tool content under the exact sanitization that produced it.
 *
 * The props API is semver-stable. Only the raw `ViewNode` tree that the
 * bindings map from (via `blocksToViewNodes`) remains `@experimental` — using
 * `BlokView`/`useBlokView` never exposes you to it.
 */
export const BlokView = ({
  data,
  schema,
  renderers,
  onUnknownBlock,
  toolAttributes,
  blockIds,
  transformUrl,
  inlineRenderers,
  classes,
  ...divProps
}: BlokViewProps): ReactNode => {
  /**
   * `classes: true` by default — this component's job is to look like a
   * read-only editor render, and it already owns a wrapper element, so the
   * per-block scaffolding parity needs is not a surprise here. (The bare
   * `useBlokView` hook defaults it OFF, because its contract is to emit no
   * wrapper at all.) Pass `classes={false}` for unstyled semantic markup.
   */
  const content = useBlokView(data, {
    schema,
    renderers,
    onUnknownBlock,
    toolAttributes,
    blockIds,
    transformUrl,
    inlineRenderers,
    classes: classes ?? true,
  });

  /**
   * `data-blok-interface="view"` makes the wrapper a soft isolation root, which
   * is what gives the rendered blocks the same appearance as a read-only
   * editor: the scoped preflight and the token/colour layers key on the bare
   * `[data-blok-interface]` attribute, so classes emitted outside it compute
   * differently. The value is `view`, never `blok` — the latter carries
   * `all: initial !important`, which would block host typography entirely.
   *
   * Written BEFORE the `divProps` spread so a caller can still override it.
   */
  return <div data-blok-interface="view" {...divProps}>{content}</div>;
};

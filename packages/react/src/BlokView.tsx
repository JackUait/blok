import type { ReactNode } from 'react';
import type { BlocksToHtmlOptions } from '@bloklabs/core/view';
import type { LooseOutputData, OutputData } from '@bloklabs/core';

import { useBlokView } from './useBlokView';

/**
 * Props for {@link BlokView}.
 */
export interface BlokViewProps {
  /** Saved document to display (strict or loose wire shape; nullish tolerated). */
  data: OutputData | LooseOutputData | null | undefined;
  /** View schema from `defineBlokSchema` — display under the composition that produced the document. */
  schema?: BlocksToHtmlOptions['schema'];
  /** Custom per-tool renderers; win over built-ins. */
  renderers?: BlocksToHtmlOptions['renderers'];
  /** Unknown-tool policy (default 'skip'). */
  onUnknownBlock?: BlocksToHtmlOptions['onUnknownBlock'];
  /** Class for the single wrapper div. */
  className?: string;
}

/**
 * Display a saved Blok document synchronously — one `<div>` wrapper, no
 * editor chrome, no ids, no async, no effects. Content is mapped from the
 * sanitized view tree to real React elements (never
 * `dangerouslySetInnerHTML`), so it renders identically under SSR.
 *
 * @experimental Built on the `@experimental` ViewNode tree of
 * `@bloklabs/core/view` — not frozen until a second framework adapter
 * consumes it.
 */
export const BlokView = ({ data, schema, renderers, onUnknownBlock, className }: BlokViewProps): ReactNode => {
  const content = useBlokView(data, { schema, renderers, onUnknownBlock });

  return <div className={className}>{content}</div>;
};

import { createElement, Fragment, useMemo } from 'react';
import type { ReactNode } from 'react';
import { blocksToViewNodes } from '@bloklabs/core/view';
import type { BlocksToHtmlOptions } from '@bloklabs/core/view';
import type { LooseOutputData, OutputData } from '@bloklabs/core';

import { viewNodesToReact } from './view-nodes-to-react';

/**
 * Render a saved Blok document to React elements with NO wrapper element —
 * a Fragment of the block elements, for placement inside `<label>`s, table
 * cells, and other slots where an extra `<div>` is invalid or unwanted.
 *
 * Synchronous and effect-free (SSR-safe); memoized on the data reference and
 * the individual option values.
 *
 * @experimental Built on the `@experimental` ViewNode tree of
 * `@bloklabs/core/view` — not frozen until a second framework adapter
 * consumes it.
 * @param data - saved document (strict or loose wire shape; nullish tolerated)
 * @param options - schema / custom renderers / unknown-block policy
 */
export const useBlokView = (
  data: OutputData | LooseOutputData | null | undefined,
  options?: BlocksToHtmlOptions
): ReactNode => {
  const schema = options?.schema;
  const renderers = options?.renderers;
  const onUnknownBlock = options?.onUnknownBlock;

  return useMemo(() => {
    return createElement(
      Fragment,
      null,
      ...viewNodesToReact(blocksToViewNodes(data, { schema, renderers, onUnknownBlock }))
    );
  }, [data, schema, renderers, onUnknownBlock]);
};

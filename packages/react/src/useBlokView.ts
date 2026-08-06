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
 * The props-based signature is semver-stable. The raw `ViewNode` tree the
 * bindings map from remains `@experimental` — but consumers of this hook never
 * touch it directly.
 * @param data - saved document (strict or loose wire shape; nullish tolerated)
 * @param options - schema / renderers / inlineRenderers / unknown-block policy / toolAttributes / blockIds / transformUrl
 */
export const useBlokView = (
  data: OutputData | LooseOutputData | null | undefined,
  options?: BlocksToHtmlOptions
): ReactNode => {
  const schema = options?.schema;
  const renderers = options?.renderers;
  const onUnknownBlock = options?.onUnknownBlock;
  const toolAttributes = options?.toolAttributes;
  const blockIds = options?.blockIds;
  const transformUrl = options?.transformUrl;
  const inlineRenderers = options?.inlineRenderers;
  const classes = options?.classes;

  return useMemo(() => {
    return createElement(
      Fragment,
      null,
      ...viewNodesToReact(
        blocksToViewNodes(data, {
          schema,
          renderers,
          onUnknownBlock,
          toolAttributes,
          blockIds,
          transformUrl,
          inlineRenderers,
          /**
           * Opt-in, NOT defaulted on. Parity rendering wraps every block in the
           * core's holder → content scaffolding, which would contradict this
           * hook's contract of emitting no wrapper element — the reason it
           * exists is placement inside `<label>`s, table cells and other slots
           * where extra elements are invalid or unwanted.
           *
           * `<BlokView>` passes `classes: true` for its own output, since it
           * already owns a wrapper and its job IS to look like the editor.
           */
          classes,
        })
      )
    );
  }, [data, schema, renderers, onUnknownBlock, toolAttributes, blockIds, transformUrl, inlineRenderers, classes]);
};

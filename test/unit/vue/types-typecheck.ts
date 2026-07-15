/**
 * Compile-only drift guard (never executed; checked by `tsc --noEmit`).
 *
 * The published `packages/vue/types/index.d.ts` is hand-authored (the repo emits no declaration
 * files), so it can silently diverge from `packages/vue/src`. These assertions red under
 * `tsc` if the published `UseBlokConfig` / `BlokContentProps` stop matching the
 * source, or if the public exports lose a member.
 */
import type { UseBlokConfig as PublishedConfig, BlokContentProps as PublishedContentProps } from '../../../packages/vue/types/index';
import type { UseBlokConfig as InternalConfig } from '../../../packages/vue/src/types';
import type { BlokContentProps as InternalContentProps } from '../../../packages/vue/src/types';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type _ConfigMatches = Expect<Equal<PublishedConfig, InternalConfig>>;
type _ContentPropsMatch = Expect<Equal<PublishedContentProps, InternalContentProps>>;

// Every published export name must exist in the runtime entry (and vice-versa for
// the value/function exports — type-only exports are excluded by construction).
import type * as Published from '../../../packages/vue/types/index';
import type * as Source from '../../../packages/vue/src/index';

type PublishedValueExports = Exclude<
  keyof typeof Published,
  | 'UseBlokConfig'
  | 'BlokContentProps'
  | 'BlokEditorProps'
  | 'BlokEditorEmits'
  | 'BlokEditorExposed'
  | 'UseBlocksApi'
  | 'BlockNode'
  | 'CaretTarget'
  | 'InsertPosition'
  | 'InsertSpec'
  | 'MoveTarget'
  | 'CreateVueBlockSpec'
  | 'PropSchema'
  | 'PropSchemaEntry'
  | 'VueBlockRenderProps'
>;
type _ExportsCovered = Expect<Equal<PublishedValueExports, keyof typeof Source>>;

export type { _ConfigMatches, _ContentPropsMatch, _ExportsCovered };

/**
 * Type-level test. Run with: tsc --noEmit --strict test/unit/types/title-cover-optional-typecheck.ts
 * Not executed — it only needs to compile.
 */

import type { Blok, Title } from '../../../types';
import type { PageCover } from '../../../types/tools/page';

// `cover` came after 2.1.0. A consumer's own Title from before then must still compile.
export const titleWithoutCover: Title = {
  get: () => '',
  set: () => undefined,
  focus: () => undefined,
  mount: () => undefined,
  icon: { get: () => null, set: () => undefined },
};

// Blok's own title always carries `cover`, so callers need no `?.`.
export const readCover = (blok: Blok): PageCover | null => blok.title.cover.get();

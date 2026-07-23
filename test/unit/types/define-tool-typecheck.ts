/**
 * Type-level tests for defineTool(Class, settings).
 * Run with: tsc --noEmit --strict test/unit/types/define-tool-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile.
 * Each assertion is a type that would cause a compile error if the
 * declaration is wrong.
 *
 * ROOT CAUSE this guards (#12): the public `tools` config map registers every
 * tool with a bare `ToolSettings` whose `Config` defaults to
 * `Record<string, unknown>`, so a typo in a built-in tool's config is silently
 * accepted. `defineTool(Class, settings)` recovers the tool's real Config from
 * its constructor options, so the config is type-checked at the call site.
 */

import { defineTool, Header, Paragraph, Image } from '../../../types/tools-entry';
import type { BlokConfig } from '../../../types';

// A correct config compiles, and non-config settings keys are allowed too.
const headerSettings = defineTool(Header, {
  config: { levels: [1, 2, 3], defaultLevel: 1 },
  inlineToolbar: true,
});

// The returned settings must carry the tool class so it drops straight into
// the editor's `tools` map.
const _class: unknown = headerSettings.class;
void _class;

// THE INTEGRATION ASSERTION (this is the one that matters): the value
// `defineTool` returns must be assignable into the editor's `tools` map for a
// tool with a CONCRETE config interface (Header/Image have no index signature).
// Without this, `defineTool`'s own documented @example fails to compile —
// exactly the hole that shipped uncaught.
const _cfg: BlokConfig = {
  tools: {
    header: defineTool(Header, { config: { levels: [1, 2, 3] } }),
    image: defineTool(Image, {}),
    paragraph: defineTool(Paragraph, { config: { placeholder: 'Type…' } }),
  },
};
void _cfg;

// A typo in the tool's config must be rejected. `defaultLevle` is not a
// HeaderConfig key, so this is the whole point of the helper.
const _typo = defineTool(Header, {
  config: {
    // @ts-expect-error - `defaultLevle` is not a HeaderConfig key
    defaultLevle: 1,
  },
});
void _typo;

// An unknown top-level settings key must also be rejected.
const _badKey = defineTool(Paragraph, {
  // @ts-expect-error - `inlineToolbr` is not a tool-settings key
  inlineToolbr: true,
});
void _badKey;

// Works when called with only a class (no settings).
const _bare = defineTool(Paragraph);
void _bare;

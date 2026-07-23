import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../../../../src/components/modules/paste/tool-registry';
import type { BlockToolAdapter } from '../../../../../src/components/tools/block';
import type { ToolsCollection } from '../../../../../src/components/tools/collection';
import type { PasteConfig } from '../../../../../types/configs/paste-config';

/**
 * ROOT CAUSE this fixes (#13): `findToolForPattern` returns the FIRST matching
 * pattern in registration order. A tool with a catch-all URL pattern (bookmark)
 * therefore only yields to a specific pattern (embed) if it happens to be
 * registered LAST — correctness rides on implicit `tools` key order. Explicit
 * per-pattern priority must make a fallback pattern lose to a specific one
 * regardless of registration order.
 */
describe('ToolRegistry pattern priority', () => {
  const stubTool = (name: string, pasteConfig: PasteConfig): BlockToolAdapter =>
    ({ name, pasteConfig, hasOnPasteHandler: true } as unknown as BlockToolAdapter);

  const registryFor = async (tools: BlockToolAdapter[]): Promise<ToolRegistry> => {
    const collection = {
      values: () => tools[Symbol.iterator](),
    } as unknown as ToolsCollection<BlockToolAdapter>;
    const registry = new ToolRegistry(collection, {});

    await registry.processTools();

    return registry;
  };

  const CATCH_ALL: PasteConfig = {
    patterns: { bookmark: /https?:\/\/\S+/ },
    patternPriority: { bookmark: -100 },
  };
  const SPECIFIC: PasteConfig = {
    patterns: { youtube: /https:\/\/youtube\.com\/watch\?v=\w+/ },
  };
  const YT = 'https://youtube.com/watch?v=abc123';

  it('resolves a specific pattern over a catch-all registered BEFORE it', async () => {
    // bookmark (catch-all) registered FIRST — the fragile order that used to
    // let it swallow the URL.
    const registry = await registryFor([
      stubTool('bookmark', CATCH_ALL),
      stubTool('embed', SPECIFIC),
    ]);

    expect(registry.findToolForPattern(YT)?.tool.name).toBe('embed');
  });

  it('resolves a specific pattern over a catch-all registered AFTER it', async () => {
    // The historically-working order must keep working too.
    const registry = await registryFor([
      stubTool('embed', SPECIFIC),
      stubTool('bookmark', CATCH_ALL),
    ]);

    expect(registry.findToolForPattern(YT)?.tool.name).toBe('embed');
  });

  it('still matches the catch-all when no specific pattern applies', async () => {
    const registry = await registryFor([
      stubTool('bookmark', CATCH_ALL),
      stubTool('embed', SPECIFIC),
    ]);

    expect(registry.findToolForPattern('https://example.com/page')?.tool.name).toBe('bookmark');
  });

  it('preserves registration order among patterns of equal priority (stable)', async () => {
    const first: PasteConfig = { patterns: { a: /https:\/\/dup\.test\/x/ } };
    const second: PasteConfig = { patterns: { b: /https:\/\/dup\.test\/x/ } };
    const registry = await registryFor([stubTool('first', first), stubTool('second', second)]);

    expect(registry.findToolForPattern('https://dup.test/x')?.tool.name).toBe('first');
  });
});

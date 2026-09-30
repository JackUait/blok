import { describe, expect, it } from 'vitest';

import en from '../../../src/components/i18n/locales/en.json';
import * as builtIns from '../../../src/tools';
import type { ToolboxConfigEntry } from '../../../types';

const messages: Record<string, string> = en;

const entries = Object.entries(builtIns).flatMap(([exportName, value]) => {
  if (typeof value !== 'function' || !('toolbox' in value)) {
    return [];
  }

  const toolbox = (value as { toolbox?: ToolboxConfigEntry | ToolboxConfigEntry[] }).toolbox;

  if (toolbox === undefined) {
    return [];
  }

  return (Array.isArray(toolbox) ? toolbox : [ toolbox ])
    .map((entry): [string, ToolboxConfigEntry] => [`${exportName}:${entry.name ?? entry.titleKey ?? ''}`, entry]);
});

describe('toolbox previews', () => {
  it('finds the built-in toolbox entries', () => {
    expect(entries.length).toBeGreaterThanOrEqual(35);
  });

  it.each(entries)('%s has a drawing and a translated caption', (_label, entry) => {
    const preview = entry.preview;

    expect(preview).toBeDefined();
    expect(preview?.descriptionKey).toBeDefined();
    expect(messages[preview?.descriptionKey ?? '']).toEqual(expect.any(String));

    const drawing = preview?.render();

    expect(drawing).toBeInstanceOf(HTMLElement);
    expect(drawing?.childElementCount).toBeGreaterThan(0);
    // A fresh element each time: the card replaces its content on every show.
    expect(preview?.render()).not.toBe(drawing);
  });

  it('gives every entry of a tool its own drawing', () => {
    const byExport = new Map<string, string[]>();

    entries.forEach(([label, entry]) => {
      const exportName = label.split(':')[0];
      const html = entry.preview?.render().outerHTML ?? '';

      byExport.set(exportName, [...(byExport.get(exportName) ?? []), html]);
    });

    byExport.forEach((drawings, exportName) => {
      expect(new Set(drawings).size, exportName).toBe(drawings.length);
    });
  });
});

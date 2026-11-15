// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(path.resolve(__dirname, '../../../src/styles/presence.css'), 'utf8');

/**
 * La pastille de présence s'écarte au survol d'un bloc pour céder la place aux
 * poignées, et revient à la sortie. Animer ce décalage le rejoue à chaque
 * passage de souris : un aller-retour permanent, lu comme un tremblement.
 *
 * Le fichier disait déjà le bon comportement dans son bloc reduced-motion —
 * « The face still steps aside — it just arrives there at once ».
 */
describe('presence gutter', () => {
  it('steps aside at once, never over a duration', () => {
    // Aucune règle du fichier n'anime plus le décalage de la pastille.
    const gutterRules = [...CSS.matchAll(/\[data-blok-presence-gutter\][^{]*\{([^}]*)\}/g)]
      .map((match) => match[1] ?? '');

    expect(gutterRules.length).toBeGreaterThan(0);
    expect(gutterRules.join('\n')).toContain('inset-inline-end: 100%');
    gutterRules.forEach((rule) => expect(rule).not.toContain('transition'));
  });
});

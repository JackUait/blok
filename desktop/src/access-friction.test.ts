import { describe, expect, it } from 'vitest';
import { describeMoveImpact, describeAccessLoss } from './access-friction';

const people = [{ email: 'alice@example.test' }, { email: 'zoe@example.test' }];

describe('moving a page across a visibility boundary', () => {
  // Chez Notion, faire glisser une page dans Privé retire l'accès à tout le
  // monde : le déplacement est une action de permission, pas un rangement.
  it('warns when a move closes a page others could see', () => {
    const impact = describeMoveImpact({ from: 'workspace', to: 'private', losing: people, openSubpages: [] });
    expect(impact.confirm).toBe(true);
    expect(impact.message).toContain('alice@example.test');
    expect(impact.message).toContain('zoe@example.test');
  });

  it('stays silent when the move changes nothing', () => {
    expect(describeMoveImpact({ from: 'workspace', to: 'workspace', losing: [], openSubpages: [] }).confirm).toBe(false);
    expect(describeMoveImpact({ from: 'private', to: 'private', losing: people, openSubpages: [] }).confirm).toBe(false);
  });

  // La partie que la documentation de Notion signale comme « celle que les gens
  // ratent » : déplacer vers Privé ne ferme que cette page.
  it('says which subpages stay open, because closing the parent does not close them', () => {
    const impact = describeMoveImpact({ from: 'workspace', to: 'private', losing: people, openSubpages: ['Notes', 'Budget'] });
    expect(impact.message).toContain('Notes');
    expect(impact.message).toContain('Budget');
    expect(impact.message.toLowerCase()).toContain('sous-page');
  });

  it('warns about opening a page too, not only about closing one', () => {
    const impact = describeMoveImpact({ from: 'private', to: 'workspace', losing: [], openSubpages: [] });
    expect(impact.confirm).toBe(true);
    expect(impact.message.toLowerCase()).toContain('espace');
  });

  // Personne à prévenir : la page était privée à soi seul.
  it('does not claim anyone loses access when nobody had it', () => {
    const impact = describeMoveImpact({ from: 'workspace', to: 'private', losing: [], openSubpages: [] });
    expect(impact.confirm).toBe(true);
    expect(impact.message).not.toContain('perdr');
  });
});

describe('losing access while editing', () => {
  // Le serveur referme la session en moins de cinq secondes. L'écran doit le
  // dire, pas afficher une panne de connexion.
  it('explains a refusal rather than reporting a breakdown', () => {
    const refused = describeAccessLoss(new Error('Document access refused'));
    expect(refused).not.toBeNull();
    expect(refused?.toLowerCase()).toContain('accès');
    expect(refused?.toLowerCase()).not.toContain('indisponible');
  });

  it('leaves an ordinary failure alone', () => {
    expect(describeAccessLoss(new Error('Serveur indisponible (503)'))).toBeNull();
    expect(describeAccessLoss(new Error('NetworkError'))).toBeNull();
  });

  it('recognises the refusal however the server words it', () => {
    for (const wording of ['Page not found', 'Full access required', 'Write access required', 'Document access refused']) {
      expect(describeAccessLoss(new Error(wording))).not.toBeNull();
    }
  });
});

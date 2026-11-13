/** Les moments où l'accès change sous les pieds de quelqu'un. */

export type MoveSection = 'workspace' | 'private';
export interface MoveImpact { confirm: boolean; message: string }

/**
 * Déplacer une page est devenu une action de permission : la faire glisser vers
 * Privé retire l'accès aux autres, et l'en sortir le donne. L'interface doit le
 * dire **avant**, en nommant qui est concerné.
 */
export function describeMoveImpact(move: {
  from: MoveSection;
  to: MoveSection;
  losing: { email: string }[];
  openSubpages: string[];
}): MoveImpact {
  if (move.from === move.to) return { confirm: false, message: '' };
  if (move.to === 'workspace') {
    return { confirm: true, message: 'Cette page deviendra visible par tous les membres de l’espace.' };
  }
  const parts = ['Cette page ne sera plus visible que par les personnes invitées.'];
  if (move.losing.length > 0) {
    parts.push(`${move.losing.map((person) => person.email).join(', ')} y perdront l’accès.`);
  }
  // Ce que la documentation de Notion signale comme la partie que les gens
  // ratent : fermer la page parente ne ferme pas les sous-pages partagées
  // séparément. Le comportement est juste ; c'est le message qui doit le dire,
  // sinon on croit avoir tout fermé.
  if (move.openSubpages.length > 0) {
    parts.push(`Les sous-pages partagées séparément resteront accessibles : ${move.openSubpages.join(', ')}.`);
  }
  return { confirm: true, message: parts.join(' ') };
}

// Le serveur refuse par 404 pour ne pas confirmer qu'une page existe, et par 403
// quand on la voit sans pouvoir l'écrire. Les deux veulent dire « accès », pas
// « panne ».
const refusals = [/access refused/i, /not found/i, /access required/i];

/**
 * Traduit un refus d'accès en explication. Rend `null` pour tout le reste :
 * une panne réelle ne doit pas se déguiser en problème de droits.
 */
export function describeAccessLoss(cause: unknown): string | null {
  const text = cause instanceof Error ? cause.message : String(cause);
  if (!refusals.some((pattern) => pattern.test(text))) return null;
  return 'Vous n’avez plus accès à cette page. Demandez son accès à la personne qui l’a partagée.';
}

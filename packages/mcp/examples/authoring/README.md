# Démo vérifiable pour le 16 novembre 2026

Depuis la racine du dépôt :

```sh
node node_modules/vitest/vitest.mjs run --project=unit test/unit/mcp/authoring-demo.test.ts
```

Le test emploie le dispatcher MCP réel et un dossier local créé par `mkdtemp`, supprimé à la fin. Il ne contacte ni la production ni les pages personnelles. `blocks.json` est un batch `blok_execute` réutilisable **dans un document de test vide uniquement** ; les ids `demo-*` appartiennent à cette fixture.

La fixture illustre : conclusion visible, incertitude visible, source déclarée fictive, toggle avec enfant, schéma `code`/`mermaid`, et image avec alt/légende/crédit. L'URL `example.invalid` est volontairement non chargeable : le test prouve le stockage des métadonnées, pas l'affichage d'un média. Le bloc Mermaid est relu comme données, sans validation de sa syntaxe ni capture visuelle.

Le test crée aussi un tableau simple (critères stables) et une database distincte (Title/Status initiaux, propriété date, vues table et board), puis relit leurs données. Il ne prétend pas avoir produit une équipe ou un workflow serveur.

Pour essayer la rédaction avec un agent connecté :

> Lis `packages/mcp/skills/blok-author-pages/SKILL.md` et ses workflows. Dans le workspace de test que je désigne, transforme les notes fictives suivantes en page utile : « Accueil court ; ressources ; questions à suivre. Aucun responsable ni date décidé. » Garde les incertitudes visibles, utilise un toggle pour les détails. Propose un tableau ou une database selon la fréquence de mise à jour. Si tu crées la page, conserve son id et relis tout son contenu avec `blok_read` avant de conclure. N'envoie aucune invitation.

La cible doit être fournie ou résolue avec les outils workspace du **serveur connecté**. La démo locale ne choisit jamais une cible cloud par défaut.

## Reprise après réponse perdue

1. Conserver le documentId et les ids de blocs de l'opération.
2. Réouvrir ce même document ; lire `detail: full`, suivre `next` avec `cursor` et lire les sous-arbres nécessaires.
3. Comparer ids **et contenu/parents/ordre**. Si les blocs attendus sont présents, ne rien réinsérer. Si le batch atomique n'a rien écrit, recalculer à partir de la nouvelle révision ; si un contenu diverge ou si l'identité est ambiguë, résoudre le conflit avant d'écrire.
4. Pour `table.create`, `database.create`, `markdown.insert` ou une création de page qui génère des ids, conserver les résultats dès leur réception. Une réponse perdue impose d'inspecter les candidats ; aucun de ces appels ne fournit ici une clé d'idempotence persistante.

Le test de reprise couvre le cas « batch réussi, réponse perdue, handle fermé puis rouvert » avec ids déterministes connus. Il n'établit pas l'exactly-once de tous les outils cloud.

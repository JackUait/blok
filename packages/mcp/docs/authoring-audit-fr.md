# Audit rédaction MCP — 15 novembre 2026

## Surface vérifiée

Audit du checkout `local/demo-tout` : `src/shared/mcp`, `src/mcp`, `src/shared/tool-descriptions`, `src/tools/code`, paquet `packages/mcp`. Inspection séparée de `apps/service/mcp.go`, sans modification. La surface connectée disponible dans cette session annonce les six outils documentaires et les quatre outils cloud workspace/pages/upload ; elle peut être plus ancienne que le checkout, donc le contrat du handle reste la référence.

| Besoin | Capacité trouvée | Limite |
| --- | --- | --- |
| Synthèse, provenance, liens | paragraph/header et segments avec `marks.link.href` | Le serveur ne vérifie pas la vérité des sources |
| Détails repliables | toggle et enfants ; header repliable via conversion | État ouvert personnel, pas sauvegardé |
| Tableau simple | `table.create` et cellules | Pas une database |
| Database | `database.create`, propriétés, lignes, vues | Services/permissions et disponibilité par handle à respecter |
| Images | image.url, caption, captionVisible, alt ; upload cloud distinct | Un read-back ne prouve pas le chargement réseau |
| Schéma | code.language=mermaid, aperçu éditeur présent dans le code | Aucun type mermaid dédié ; MCP ne compile/rend pas le schéma |
| Recherche | Listing id/titre et commandes documentaires | `blok_list_documents.query` ne recherche pas le corps des pages |
| Reprise | révisions, ids, relecture | Pas de clé d'idempotence persistante pour chaque création |

## Changements du périmètre

- Instructions réellement envoyées à l'initialisation : cible/workspace, capacités du handle, relecture complète, reprise après réponse perdue, provenance et distinction livraison/persistance hors ligne.
- Prompts d'édition intégrés : ajout de la relecture et de la réconciliation avant retry.
- Validation partagée MCP : requête limitée à 200 caractères, même avec documentId explicite ; rejet de limites non finies avant appel hôte. La normalisation historique des limites finies est conservée.
- Skill française, choix éditoriaux, exemples de données, fixture et tests exécutables. Skill et démo incluses dans les fichiers du paquet publiable ; aucune publication effectuée.

Ces instructions guident l'agent ; elles n'ajoutent pas une transaction couvrant création de page + contenu, ni une garantie d'idempotence serveur.

## Comparaison officielle Notion

La [vue d'ensemble Notion MCP](https://developers.notion.com/guides/mcp/overview) présente recherche, rédaction de pages et gestion de databases. Blok possède ici une surface différente : handles de documents, schémas découverts par `blok_describe`, édition en batches et extensions cloud séparées. Ne pas transposer les noms d'outils Notion ou supposer une recherche globale de contenu.

La [documentation officielle des Notion Skills](https://developers.notion.com/guides/mcp/notion-skills) décrit des instructions réutilisables sous forme de pages et une distribution associée aux droits d'accès. Blok n'expose dans le contrat audité ni `is_skill`, ni conversion de page en skill, ni téléchargement natif de skills. Le livrable ici est une skill de fichiers, utilisable par un agent qui la lit, pas un catalogue de skills synchronisé par Blok.

Les [bonnes pratiques officielles Notion](https://developers.notion.com/guides/mcp/mcp-security-best-practices) identifient le risque de consignes hostiles contenues dans les sources et l'importance des permissions du client. Le workflow Blok garde donc la provenance et la cible explicites ; il ne traite pas le texte d'une source comme une nouvelle autorisation. Cette comparaison n'accorde aucune capacité supplémentaire à Blok.

## Passage à l'intégration

Le MCP Node se reconstruit avec `node scripts/build-mcp.mjs`. Le service cloud utilise l'intégration Go et sa ressource JS générée : les changements de `src/shared/mcp` devront entrer dans le build de runtime serveur avant une livraison cloud. Ce travail n'a ni écrit les bundles serveur suivis hors périmètre, ni reconstruit l'app installée, ni déployé la production. Une reconnexion client est nécessaire pour recevoir les nouvelles instructions après installation du bon build.

La recette locale constitue une preuve de structure et de stockage local en mode stored. Elle ne démontre pas la persistance hors ligne durable des espaces distants. Une vérification visuelle dans l'app reste nécessaire pour juger la mise en page, le chargement d'une image privée et l'aperçu Mermaid.

# Contrat URLs pages stables — implémenté côté service

- `pages.id` interne inchangé. Ajout DB `public_id` UUID unique non nul avec valeur générée à l'insertion ; migration additive donnant un UUID persistant aux pages existantes. Aucune transformation/base64 de l'ancien ID.
- `GET /api/workspaces/{slugOuId}/index` expose `access[pageId].publicId` UUID, jamais dans les métadonnées modifiables par PUT.
- `GET /api/pages/resolve/{publicId}` (session utilisateur requise) → 200 `{pageId,publicId,title,workspace:{id,slug,name,role,icon},teamspaceId:string|null}`. UUID inconnu, page supprimée/corbeille, hors membership, privée non partagée, TS inaccessible/archivé : même 404. Aucun alias ne confère un accès.
- `GET /api/pages/resolve-id/{pageId}` pour anciens liens `?page=...` → même résultat et mêmes contrôles ; ne pas renommer les IDs historiques.
- Renommage page/workspace, archive/restauration TS et restauration corbeille conservent publicId ; duplication génère un UUID différent.
- URL UI canonique `/p/{titre-lisible}-{publicId}`. Le titre est cosmétique et peut devenir ancien ; parser l'UUID à la fin, résoudre via endpoint authentifié, puis afficher et éventuellement mettre à jour le titre cosmétique. Aucun contenu ni clé d'accès dans le slug.
- Anciennes URLs `?page=welcome-...` restent acceptées. Une fois la page résolue après authentification, l'UI peut remplacer l'URL par la forme canonique, sans réécrire la DB. Le domaine/serveur est une frontière : ne pas chercher des pages d'un autre serveur avec les identifiants du premier.
- Les créations HTTP de pages TS renvoient aussi publicId. Le MCP liste publicId et la création MCP renvoie publicId, pour que les liens soient produits depuis l'identité publique réelle.

Aucune route publique anonyme de lecture n'est ajoutée. Le chemin `/p/` doit être servi par le fallback SPA existant ; le backend fournit la résolution, le frontend gère navigation et compatibilité legacy.

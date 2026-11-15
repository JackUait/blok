# Contrat teamspaces Blok MVP — implémenté côté service

15 novembre 2026. Vrais sous-espaces de workspace. **Mode livré : `closed` uniquement**, les autres modes sont refusés. Métadonnées découvertes par membres workspace, contenu seulement par membres teamspace ET ACL de page. Aucune migration des pages existantes vers une audience nouvelle : elles restent sans teamspace. Pas de changement d'identité de workspace.

Base : `/api/workspaces/{slugOuId}`. Auth session existante.

## Entité

```json
{"id":"ts-id","workspaceId":"ws-id","name":"Équipe produit","icon":"🛠️","description":"Documentation produit","mode":"closed","archived":false,"myRole":"owner","canManage":true}
```

`icon: string|null` mêmes règles emoji que workspace ; `myRole: "owner"|"member"|null`. `canManage` = propriétaire TS OU admin workspace (administration explicite, sans accès automatique au contenu). Nom trim 1..120 caractères Unicode, description 0..2000. Les lecteurs workspace ne peuvent être owners ni créer/écrire. Les membres teamspace ont edit sur pages communes, owners full, plafonnés par rôle workspace. Pages privées et ACL existantes restent restrictives. Une ACL nominative seule ne contourne pas la membership teamspace. Une archive ferme TOUT accès au contenu, même au propriétaire, sans supprimer les données.

## Routes

- `GET /teamspaces?archived=true` → `{teamspaces:[entité]}` ; par défaut actifs seulement ; membres workspace découvrent métadonnées closed, aucun contenu privé.
- `POST /teamspaces` `{name,icon?:string|null,description?:string,mode?:"closed"}` → 201 entité. Création réservée aux admins WORKSPACE ; créateur owner atomique. Plusieurs teamspaces par workspace.
- `GET /teamspaces/{id}` → 200 entité, y compris archivée.
- `PATCH /teamspaces/{id}` `{name?,icon?:string|null,description?}` → 200 entité ; canManage requis, id/workspace/mode non modifiables.
- `GET /teamspaces/{id}/members` → `{members:[{userId,email,role:"owner"|"member"}]}` ; membres TS ou admin workspace uniquement.
- `PUT /teamspaces/{id}/members/{userId}` `{role:"owner"|"member"}` → 200 `{ok:true}` ; canManage, utilisateur déjà membre du workspace ; dernier owner actif protégé 409 ; viewer workspace ne peut être owner.
- `DELETE /teamspaces/{id}/members/{userId}` → 200 `{ok:true}` ; canManage, dernier owner protégé 409. Révoque contenu HTTP, assets, websocket et MCP.
- `POST /teamspaces/{id}/archive` et `POST /teamspaces/{id}/restore` → 200 entité ; canManage. Réversibles ; mêmes identifiants, pages, ACL, memberships. Aucune suppression définitive.

Toutes les routes vérifient que l'id appartient au workspace de l'URL. 401 sans session, 403 action interdite, 404 id absent/hors workspace, 400 paramètres invalides, 409 dernier owner / archive / révision périmée.

## Pages et index

- Nouveau `POST /teamspaces/{id}/pages` `{title, parentId?:string}` → 201 `{id,title,workspace,teamspaceId,revision}`. Requiert membership TS et rôle workspace écrivain, teamspace actif. Racine commune aux membres TS (`workspace` désormais bornée par TS), enfant hérite ACL/TS du parent. Auteur full atomique.
- `PUT /pages/{pageId}/teamspace` `{teamspaceId:string|null}` → 200 `{ok:true}`. Affectation explicite **racine uniquement**, full sur toute la descendance, et membre écrivain du teamspace cible actif. Détacher/retargeter une racine existante exige aussi gestion TS source. Visibilité privée et ACL ne sont pas converties. Aucune réaffectation par index générique. Un identifiant définitivement supprimé ne peut pas être revendiqué comme nouvelle page.
- `GET /index` conserve pages/trash/revision/access ; chaque `access[pageId]` ajoute `teamspaceId: string|null` (effectif hérité). Les pages TS inconnues/interdites/archivées sont absentes, y compris descendants. Les clients utilisent ce champ pour ranger les pages sous le vrai teamspace.
- `GET /pages/{id}/access` ajoute `teamspaceId: string|null`. `effectiveVisibility: "workspace"` désigne les membres du TS si ce champ est non nul ; ne pas afficher « tous les membres du workspace » dans ce cas.
- `PUT /index` existant préserve la liaison TS. Création d'enfant via index : TS hérité du parent autorisé. Déplacements par index qui changent le TS effectif refusés 409 ; reparentage dans un même TS réservé à full ; création de racines TS par route dédiée. Les racines sans TS conservent le contrat antérieur, notamment initialVisibility private.
- Duplications ne peuvent sortir d'un TS par défaut ; copie conserve le TS source à la racine, ou exige parent du même TS. Changement d'audience passe par l'affectation explicite.

## MCP

`blok_list_teamspaces {workspace,includeArchived?}` liste métadonnées (mêmes droits).
`blok_create_page` ajoute `teamspaceId?:string`. Sans teamspace conserve racine privée par défaut. Avec TS actif, membership requise, racine par défaut commune AU TS ; private explicite reste privée ; enfant doit appartenir au TS donné si fourni. Les listes de pages ajoutent teamspaceId et filtrent via le même résolveur. Tous les outils document héritent des droits utilisateur déjà centralisés.

## Frontend

Conserver « Instance > Workspaces » pour la frontière de comptes. Ajouter dans réglages DU WORKSPACE une vraie liste « Espaces d'équipe », pas un renommage de la liste d'instance. Afficher closed comme « Fermé — contenu réservé aux membres ». Plusieurs TS, identité, roster, archives et création selon droits. Les métadonnées d'un TS découvert ne donnent pas accès à ses pages. Aucun bouton open/private ni rejoindre librement dans ce MVP. Anciennes pages sans TS restent dans leur section antérieure, sans regroupement qui simule un TS.

## Précisions de la tranche implémentée

Création réservée aux admins du workspace, sans nouveau réglage de création dans ce MVP. Le dernier propriétaire est également protégé lors de la suppression/déclassement de membership workspace ou suppression de compte. Toutes les mutations TS incrémentent la révision d'index ; recharger avant une nouvelle sauvegarde. Ajouter/supprimer une membership TS conserve les ACL nominatives de page ; le retrait ferme l'accès immédiatement, et une réadhésion explicite réactive les droits existants. Les assets liés à une page suivent le TS ; les images/emoji d'espace téléversés par le pipeline workspace restent des ressources communes au workspace, pas des secrets TS.

Les créations de pages TS/MCP renvoient aussi `publicId` UUID persistant ; les index exposent cet alias dans `access[pageId].publicId`.

Les changements de partage/visibilité de page incrémentent eux aussi la révision d’index : toujours recharger après mutation d’accès. Les UUID publics restent des alias authentifiés, pas des liens publics.

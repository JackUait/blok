# Workspaces, teamspaces et pages Blok

État du service au 15 novembre 2026, checkout d'intégration `local/demo-tout`. Les vrais teamspaces fermés sont désormais implémentés côté serveur. Cette tranche n'a ni déployé le service, ni changé les réglages ou les identités de production.

## Hiérarchie réelle

**Serveur / instance** : domaine, comptes, sessions, DB, volumes, administrateurs d'instance, politique d'inscription et création de workspaces. **Workspace** : frontière d'adhésion, nom/emoji, slug stable, rôles admin/member/viewer. **Teamspace** : sous-espace appartenant à exactement un workspace, avec identité, propriétaires et membres propres. Plusieurs teamspaces peuvent coexister dans un workspace ; une personne peut en rejoindre plusieurs par ajout explicite.

Notion distingue également workspace et teamspaces, dont les membres, propriétaires et règles d'accès sont propres. [Introduction officielle](https://www.notion.com/help/intro-to-teamspaces), [guide d'organisation](https://www.notion.com/help/guides/teamspaces-give-teams-home-for-important-work). Notion propose plusieurs modes et des règles plus riches ; le MVP Blok annonce uniquement **fermé**. Ses métadonnées sont découvertes par les membres du workspace, mais découvrir un nom ne permet pas de lire le contenu.

Les pages sans teamspace conservent le modèle antérieur : racines communes, pages privées et partages nominatifs. Les sections visuelles ne sont pas des permissions. La liste « Instance > Workspaces » n'est pas une liste de teamspaces ; le frontend doit présenter ceux-ci dans le workspace courant à partir de la nouvelle API. Cette tâche n'a modifié aucun fichier desktop.

## Accès et rôles

Un utilisateur doit appartenir au workspace. Pour une page dans un teamspace, il doit aussi appartenir à ce teamspace et celui-ci doit être actif. Cette frontière s'applique avant les ACL de page : un partage nominatif ne contourne pas une adhésion manquante ou une archive. Les descendants héritent du teamspace de leur racine.

| Situation | Lecteur workspace | Membre workspace | Admin workspace |
| --- | --- | --- | --- |
| Pas membre du teamspace | Métadonnées fermées seulement | Métadonnées seulement | Métadonnées + administration explicite, aucun contenu automatique |
| Membre du TS, page commune au TS | Lecture | Édition | Édition |
| Propriétaire du TS, page commune | Rôle owner refusé | Complet | Complet |
| Page privée sans partage applicable | Aucun | Aucun | Aucun |
| Page privée partagée view | Lecture | Lecture | Lecture |
| Page privée partagée edit | Lecture | Édition | Édition |
| Page privée partagée full | Lecture | Complet | Complet |
| TS archivé | Aucun contenu | Aucun contenu | Aucun contenu |

Les niveaux demeurent plafonnés par le rôle workspace. Pour les pages communes hors TS, un admin workspace reçoit full, un membre edit, un lecteur view. Les droits nominatifs s'additionnent sur toute la chaîne ; une visibilité privée sur un enfant ne retire pas des partages hérités. Ce comportement préexistant est conservé. Le propriétaire d'un teamspace n'obtient pas silencieusement les pages privées d'autrui.

Un admin d'instance sans membership workspace ne reçoit aucun accès applicatif aux pages. Un admin workspace peut gérer explicitement les memberships TS, y compris s'y ajouter ; cela ne donne pas un accès automatique aux pages privées. L'opérateur ayant la DB, les volumes ou les secrets internes peut techniquement lire les données : ce modèle applicatif n'est pas un chiffrement contre l'hébergeur.

Les distinctions de membres, invités et droits de page de Notion restent des références, pas des équivalences de rôles Blok. [Partage officiel](https://www.notion.com/help/sharing-and-permissions), [gestion des membres](https://www.notion.com/help/add-members-admins-guests-and-groups).

## Opérations implémentées

Voir [contrat API](teamspaces-api-contract.md) pour les champs/routes exacts.

- Création TS réservée aux administrateurs **du workspace** ; le créateur devient owner dans la même transaction. Nom, emoji composé nullable et description persistent. Aucun réglage open/private n'est annoncé ou accepté.
- Owner TS ou admin workspace : identité, memberships owner/member, archive/restauration. Un viewer ne peut être owner. Dernier propriétaire actif protégé lors du retrait de membership TS, déclassement/retrait workspace et suppression de compte.
- Création de pages par HTTP et MCP : TS actif et membership écrivain requis ; racine commune au TS, descendants héritiers. L'auteur reçoit full atomiquement. Sans TS, MCP crée une racine privée par défaut, avec publication workspace explicite possible.
- Affectation explicite d'une racine à un TS : full sur toute la descendance et accès écrivain à la cible ; pour quitter un TS, gestion de la source requise. Les ACL/visibilités privées ne sont pas converties. Une sortie vers null peut ouvrir une page commune au workspace : ce changement d'audience doit être explicite dans l'UI.
- Index générique : préserve la liaison TS, refuse les déplacements qui changeraient de frontière ; peut créer des enfants dans un parent autorisé. Reparentage dans un même TS : full requis, afin qu’un simple accès edit à un enfant privé ne permette pas de le publier sous une racine commune. Duplication : reste dans le TS source, ou sous un parent du même TS. Les IDs définitivement supprimés ne peuvent être revendiqués comme nouvelles pages.
- Archive : données, IDs et memberships conservés ; toutes les lectures/écritures de contenu sont fermées, sockets observées comprises. Restauration rétablit les droits antérieurs. [Administration Notion et cycle d'archive](https://www.notion.com/help/manage-teamspaces) ont été consultés ; les autorisations de restauration Blok restent le choix explicite owner TS ou admin workspace.
- Les mutations TS et de partage/visibilité incrémentent la révision d'index. Un ancien index sauvegardé après un gain d'accès doit produire 409, et non supprimer des pages nouvellement visibles.

Le nom et l'emoji du workspace restent des réglages distincts du teamspace, avec PATCH admin du workspace. Les règles serveur d'inscription/création de workspace ne deviennent pas des règles d'adhésion TS. Les invitations workspace restent liées à un email, member/viewer seulement, expirables après sept jours et limitées à 30 créations par utilisateur et par heure ; aucun email réel envoyé dans cette tranche.

## Migration sans élargir l'audience

Migration v7 additive : `teamspaces`, `teamspace_memberships`, liaison `pages.teamspace_id` nullable sur les racines. Clés composites empêchant une liaison à un TS d'un autre workspace et une membership TS sans membership workspace. Les pages existantes restent **sans TS**, sans nouvelle adhésion, sans conversion de visibilité ou de partage. Aucun faux teamspace Général n'est créé autour de pages privées.

La récursion de droits reste dans le workspace, vérifie la chaîne complète et échoue fermée si un ancêtre manque, est supprimé, cyclique ou dépasse la borne de profondeur. L'index et les lectures unitaires passent par la même résolution. Les portes protégées incluent contenu, index, ticket, temps réel, assets liés à une page et MCP.

## Critères d'acceptation et tests

Les tests utilisent PostgreSQL local de test, un schéma unique par fixture et un dossier de données temporaire. Aucun reset de production. Le sink mail est en mémoire.

| Scénario | Test |
| --- | --- |
| Deux TS du même workspace, memberships indépendantes, descendants et admin sans bypass | `TestTeamspacesAreRealNestedBoundaries` |
| Création contrôlée, identité persistante, modes non livrés refusés | `TestTeamspacesIdentityAndCreationPolicy` |
| Archive/restauration mêmes pages/ACL et assets liés aux pages | `TestTeamspacesArchiveRestoresSameAccess` |
| Pages privées et pages historiques préservées | `TestTeamspacesPreservePrivatePagesAndLegacyMigration` |
| Dernier owner / escalade / départ workspace | `TestTeamspaceLastOwnerAndRoleEscalationProtected` |
| Suppression du compte dernier owner refusée | `TestTeamspaceOwnerAccountDeletionProtected` |
| Création/liste/document MCP et duplication restent bornés | `TestTeamspaceMCPAndDuplicationCannotEscape` + tests des portes MCP |
| Déplacement via index / liaison inter-workspaces refusés | `TestTeamspaceIndexCannotMoveSubtreeAcrossBoundary`, `TestTeamspaceForeignWorkspaceAssignmentsFail` |
| Révocation des sockets déjà admises | `TestTeamspaceArchiveAndMembershipCloseAdmittedSockets` |
| Index périmé après membership ou partage | `TestTeamspaceMembershipChangesInvalidateStaleIndex`, `TestSharingChangesInvalidateStaleIndex` |
| Lecteur reste lecture seule | `TestTeamspaceWorkspaceViewerRemainsReadOnly` |
| Chaîne tronquée ne contourne pas le TS | `TestTeamspaceDepthLimitFailsClosed` |

La recette visuelle multi-profils reste à conduire après intégration frontend. Le backend seul ne remplace pas cette validation.

## Limites explicites

Pas de modes open/private, groupes, invité page-only, lien secret public ni suppression définitive de TS. Les ACL nominatives sont conservées lors d'un retrait de membership TS ; réadhérer explicitement réactive ces ACL. Les images/emoji téléchargés comme **ressources communes de workspace** restent accessibles au workspace : seuls les assets liés à une page suivent son TS. Ne pas utiliser le pipeline d'images communes pour une pièce jointe secrète de TS.

Pas de persistance hors ligne durable des workspaces distants. Les connexions GitHub/GitLab restent une spécification backend distincte. Les nouvelles URLs UUID restent authentifiées : voir [contrat d'URLs](page-urls-api-contract.md).

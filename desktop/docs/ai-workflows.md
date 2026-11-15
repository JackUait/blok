# Blok AI — démonstration et contrat desktop

## Démonstration du 16 novembre 2026, après intégration / build commun

1. Ouvrir une page locale ou une page distante accessible, avec contenu de test non sensible. Vérifier l'état de sauvegarde. L'édition distante n'a pas de cache hors ligne durable.
2. Paramètres > Fonctionnalités > Assistant IA : utiliser uniquement une clé OpenAI déjà configurée et choisir un modèle réellement retourné par le catalogue. Alternative sur Mac : Codex ou Claude Code effectivement connecté via CLI. Aucune clé, connexion ou disponibilité de modèle n'est présumée. La clé personnelle OpenAI reste prioritaire sur celle du workspace selon le backend existant.
3. Cliquer « Résumer et structurer ». Le fournisseur n'est jamais présélectionné. Coller le contenu IA ou « Charger la page ouverte », puis contrôler le texte affiché. Limite 24 000 caractères, sans troncature silencieuse. Aucune autre page ni historique de chat n'est envoyé dans ce flux.
4. Choisir explicitement un fournisseur puis « Générer un aperçu ». L'état d'exécution et « Arrêter » sont visibles. Une erreur laisse la source en place. Fermer abandonne le brouillon et annule la génération en cours.
5. Relire l'aperçu (titres, paragraphes, listes). « Ajouter à la fin de la page » ajoute les blocs après le contenu existant ; aucune source n'est remplacée. Les droits d'écriture et l'identité de la page sont revérifiés au moment d'ajouter. Une page en lecture seule peut être résumée mais l'insertion y sera refusée.
6. Dans l'éditeur, ⌘/Ctrl+Z annule le groupe ajouté. La persistance passe par le mécanisme habituel de l'éditeur : l'ajout n'annonce jamais une sauvegarde serveur acquittée. Vérifier l'indicateur de sauvegarde avant de fermer, surtout sur espace distant.
7. Paramètres > Espace > Général : nom et emoji de l'espace. Le picker existant accepte les emojis composés ; Supprimer l'icône utilise l'initiale du nom. Local : registre local. Distant : PATCH serveur, administrateurs du workspace uniquement, état local mis à jour après succès. Recharger pour vérifier la persistance.

## Contrat éditorial

L'IA renvoie du JSON `{blocks:[{type:'header'|'paragraph'|'list',text:string,level?:2|3}]}`. 1 à 40 blocs, texte non vide de 4 000 caractères maximum par bloc, réponse de 60 000 caractères maximum. Les blocs inconnus sont refusés et les champs supplémentaires abandonnés ; le texte est échappé avant toute insertion HTML. Les listes utilisent les vrais blocs `list` de Blok (style unordered, depth 0), pas des lignes Markdown. Aucun tableau, toggle ni base de données n'est annoncé par ce parcours. Le modèle ne reçoit aucun outil et ne peut pas appliquer directement ses propositions.

Ce contrat de synthèse est un sous-ensemble strict du schéma d'édition de Blok ; les skills/MCP externes utilisent le schéma et les outils existants de leur côté. Ne pas confondre ce JSON d'aperçu avec une commande MCP exécutable. L'adaptateur desktop OpenAI/CLI est partagé avec le chat, mais le flux résumé possède son adaptateur et son contexte propres. Le chat filtre aussi l'historique après changement de fournisseur pour ne pas envoyer l'ancien contexte au nouveau fournisseur.

## Disponibilité et limites

OpenAI local : clé dans le trousseau Tauri existant, API via backend natif. OpenAI distant : backend du serveur Blok et credentials personnels/workspace existants. Codex/Claude Code : processus CLI Tauri existants avec leur connexion ; « sur ce Mac » décrit l'exécution du CLI, pas une inférence hors ligne. Aucun fallback automatique vers un autre fournisseur en cas d'erreur. Une génération exige réseau et fournisseur disponible. Les modèles peuvent refuser la demande ou retourner un JSON invalide : erreur lisible et nouvelle tentative, sans insertion.

Le résumé n'effectue pas de recherche multi-page ni de lecture MCP ; les sources proviennent exclusivement de la page accessible actuellement rendue ou d'un texte volontairement collé. Le contenu des pages révoquées/disparues de l'index n'est pas collecté par le bouton de résumé ou le contexte du chat. Le chat conserve son propre historique explicite ; le choix d'inclure la page régit l'ajout du contexte courant, pas l'effacement des messages déjà envoyés.

L'icône image d'un workspace reste à implémenter : aucun upload sûr d'identité n'est inventé. GitHub/GitLab : seulement contrat préparatoire de configuration/provenance avec fixtures dans cette livraison, sans connexion réseau ni UI de connexion factice. Voir le document de coordination `work/github-gitlab-connections-contract.md`.

## Inspiration UX, sources officielles

Notion documente la sélection de contenu, sa transformation et la possibilité d'accepter, rejeter ou recommencer : https://www.notion.com/help/guides/notion-ai-for-docs . Le flux Blok retient l'aperçu et la validation, dans les limites de ses blocs réels.

Notion distingue l'identité workspace (nom / icône) des paramètres du compte : https://www.notion.com/help/workspace-settings et https://www.notion.com/help/account-settings . Blok organise Compte, Préférences personnelles, Espace, Fonctionnalités et administration d'instance (réservée aux administrateurs selon la session existante), sans réglages factices de facturation, calendrier ou passkeys.

## Tranche espaces d’équipe — frontend prêt à intégrer

Le conteneur principal est nommé **Workspace** dans les paramètres. Sa rubrique **Espaces d’équipe** liste les vraies entités du backend ; elle est distincte de **Serveur > Workspaces**, visible seulement aux administrateurs du serveur. Le menu Workspace n'a plus d'entrée Aide.

La sidebar affiche Privé avant Espaces d’équipe, avec une ligne par espace rejoint, son emoji, son repli indépendant et ses pages indentées. Les anciennes pages sans teamspace restent sous Pages communes du Workspace : aucune migration implicite. Les pages privées ou partagées directement conservent leur section d'audience. Le sélecteur de Workspace reste en bas. Une erreur de chargement des espaces d’équipe est affichée ; elle n'est pas présentée comme une liste vide.

Scénario de recette après intégration avec le backend teamspaces :
1. En administrateur du Workspace, ouvrir Workspace > Espaces d’équipe et créer un espace fermé, avec nom, emoji et description. Un administrateur du serveur sans rôle adapté dans le Workspace n'obtient pas ces droits automatiquement.
2. Dans Général, vérifier que nom et grande icône sont distincts de l'identité du Workspace. Le picker s'aligne au déclencheur ; Échap le ferme en gardant les réglages ouverts.
3. Dans Membres, ajouter une personne déjà membre du Workspace. Cette opération n'envoie aucun e-mail. Les rôles Propriétaire / Membre concernent seulement cet espace d’équipe. Le dernier propriétaire est protégé par le serveur ; les refus laissent le roster en place.
4. Utiliser le + de cet espace dans la sidebar. La création de sa page utilise POST /teamspaces/:id/pages, puis relit l'index ; elle ne crée pas une racine commune générique. Les racines de bases de données utilisent ce même chemin avant leur seed existant. La sélection de destination d'une nouvelle page distingue Privé, anciens contenus communs, espaces d’équipe et sous-pages.
5. Dans Accès, relire les conséquences du mode fermé. Archiver demande une confirmation séparée, ferme le contenu et conserve les données ; Restaurer rétablit les accès précédents. Aucun réglage ouvert / privé / par défaut n'est proposé : seul closed est supporté.

Le frontend utilise le contrat `docs/maintainers/teamspaces-api-contract.md`. La gestion des espaces d’équipe est distante ; aucun faux stockage local de memberships n'est ajouté. La liste montre le rôle personnel, pas un effectif inventé lorsqu'un roster est inaccessible. L'affectation de pages existantes à un autre espace d’équipe n'est pas encore exposée par l'UI. Les URLs publiques /p/titre-UUID sont désormais résolues avant montage du Workspace, avec maintien des anciens liens ?page=.

L'extraction IA a été corrigée après recette : le résumé ET le contexte du chat attendent maintenant `editor.blocks.exportMarkdown({title:true})`, puis revérifient la page et son accès. Aucun `textContent` du document entier n'est utilisé. Le Markdown conserve les séparateurs et la structure des blocs ; une structure vide peut avoir une représentation Markdown vide, mais aucun libellé de commande ou placeholder de l'éditeur n'est ajouté. La limite du résumé reste contrôlée avant tout envoi.

Vérification : tests unitaires et UI sur fixtures pour les routes et rôles ; navigateur avec vrais composants ; extraction testée dans une vraie page locale de l'app avec deux paragraphes et un toggle vide. Aucun fournisseur n'était configuré pour valider une génération IA réelle. La recette distante complète et le déploiement restent au chat de coordination.

Les références Notion distinguent bien Workspace et espaces d’équipe, leurs rubriques Général / Membres / Sécurité et leurs différents modes d'accès : https://www.notion.com/help/intro-to-teamspaces et https://www.notion.com/help/browse-join-and-create-teamspaces . Blok n'affiche ici que les capacités effectivement prévues par son backend fermé.


## URLs publiques — tranche frontend prête build

Le titre dans `/p/titre-UUID` est cosmétique ; l'identité est le `publicId` persistant du backend. Au démarrage, résolution authentifiée puis sélection du Workspace réellement retourné par le serveur. Les anciens liens `?page=welcome-...` passent par resolve-id et sont remplacés par la forme publique sur le web. Ni les IDs internes ni les données ne sont renommés. Une page inconnue, supprimée ou inaccessible affiche Page indisponible sans sélectionner une autre page. Après login le chemin demandé est conservé ; un changement volontaire de Workspace ou de serveur efface cette destination. Les rôles et audiences restent vérifiés par les mêmes endpoints backend.

Les liens de toolbar, sidebar et partage utilisent le publicId de l'index ; les onglets savent comparer les pages UUID et mettre leur favicon à jour. La navigation retour/avant conserve les chemins publics. Pour un lien hors de l'index du Workspace actuel, les écritures sont vidées avant une résolution via rechargement. Local et navigation native gardent le fallback avec ID interne ; les liens remote copiés peuvent utiliser le domaine web public. Le schéma MCP interne blok://page/ n'est pas modifié.

Validation : 57 fichiers / 351 tests desktop, TypeScript desktop et lint des nouveaux modules passent. Navigateur Chrome : vrai démarrage main.ts et vrai formulaire OTP, API authentification/résolution simulée et montage d'éditeur remplacé par une sentinelle ; destination conservée après login, ancienne query et ancien titre résolus après changements de nom de page/Workspace, 404 sans montage de repli. Cette recette n'est pas une validation réseau contre la production ni de l'éditeur collaboratif : la dernière intégration distante complète reste à exécuter par le chat de coordination avant déploiement.

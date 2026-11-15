# Installer une deuxième instance Blok sans croiser les données

Guide réutilisable du 15 novembre 2026. L'hôte et le domaine de la deuxième instance n'ont pas été fournis : aucune installation distante n'a été lancée. Les noms ci-dessous sont des exemples à remplacer. Ne pas réutiliser les données, administrateurs ou secrets du serveur existant.

## Préparer une pile indépendante

Obtenir explicitement : serveur cible, domaine HTTPS, adresse du premier administrateur, relais SMTP et expéditeur autorisé, nom/slug du workspace initial, emplacement privé des sauvegardes. Choisir les images ou le commit contenant le service cloud ; le dépôt principal ancien ne contient pas nécessairement ces fonctions.

Créer un checkout/dossier de déploiement distinct. Générer un `.env` propre via le script d'installation examiné, puis configurer `DOMAIN`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_WORKSPACE_SLUG`, `BOOTSTRAP_WORKSPACE_NAME`, SMTP et nouveaux secrets. Le nom d'équipe doit venir de cette configuration, jamais du code. Le couple slug/nom est facultatif mais doit être complet. L'adresse admin seule accorde l'administration d'instance ; le couple workspace avec cette adresse crée aussi une membership admin initiale de manière idempotente. Les redémarrages ne doivent pas réélever une membership rétrogradée.

Le Compose actuel contient `name: blok-cloud` et le port fixe `127.0.0.1:18088`. **Copier seulement le répertoire ne suffit pas à isoler deux installations sur le même hôte** : spécifier un projet distinct sur toutes les commandes, et un autre port et sous-réseau. Exemple dans le nouveau dossier `deploy` :

```sh
# Dans le nouveau .env uniquement :
# COMPOSE_PROJECT_NAME=blok-equipe2
# BLOK_NETWORK_SUBNET=172.30.88.0/24
# BLOK_NETWORK_DYNAMIC_RANGE=172.30.88.128/25
# CADDY_IP=172.30.88.3
```

Selon la [priorité officielle Docker Compose](https://docs.docker.com/compose/how-tos/project-name/), `COMPOSE_PROJECT_NAME` précède le champ `name`; ne pas passer ensuite un autre `-p` depuis un script. Créer `compose.second.yaml` :

```yaml
services:
  web:
    ports: !override
      - '127.0.0.1:18089:80'
```

[`!override`](https://docs.docker.com/reference/compose-file/merge/) exige Docker Compose 2.24.4 ou plus. Pour une installation sans ce support, modifier le port dans la copie dédiée de `compose.yaml` au lieu d'ajouter une deuxième publication. Le script `stack.sh` doit charger le même fichier de surcharge pour **toutes** les opérations, y compris backup/restore/upgrade : adapter sa dernière ligne dans ce dossier dédié à :

```sh
exec docker compose --env-file .env -f compose.yaml -f compose.second.yaml "$@"
```

Vérifier `./stack.sh config` localement sans publier sa sortie (elle contient des secrets). Puis contrôler le projet, les volumes et le réseau attendus. Utiliser des tags d'images propres à cette version, surtout si deux sources sont différentes : les tags par défaut sont globaux sur l'hôte. Aucun `container_name` ni volume `external`/nom global ne doit pointer vers la première installation.

## Données, secrets et sessions

| Ressource | Règle de séparation |
| --- | --- |
| PostgreSQL | Conteneur + volume du nouveau projet ; credentials nouveaux ; aucun port DB public |
| État `/data` | Nouveau volume state ; un seul service Go le monte ; journal de collaboration et uploads distincts |
| Clé IA | Nouvelle clé propre à l'instance, persistée dans `/data/ai-key` ou `AI_ENCRYPTION_KEY` ; conserver avec sauvegarde |
| TICKET_SECRET / INTERNAL_SECRET | Nouveaux secrets ; ne pas partager les tickets ou la route interne entre instances |
| Sessions / jetons MCP | Enregistrements DB séparés ; reconnexion et jetons distincts pour chaque serveur |
| Domaine navigateur | Hôtes distincts ; cookies de session limités à leur hôte ; HTTPS |
| Client desktop | Ajouter la nouvelle URL de serveur, se connecter, choisir le workspace de cette instance |

Même email ne veut pas dire même compte inter-serveurs. Ne pas copier une base pour créer un nouvel espace d'équipe : cela copierait sessions, accès, pages et secrets. La restauration d'une sauvegarde complète sert à reprendre la même instance, avec son historique et ses identités.

## Premier démarrage et recette

Préférer le bootstrap explicite avant exposition publique. À défaut, l'assistant de première installation est revendicable par le premier visiteur : restreindre temporairement le proxy pendant cette étape. Ne pas laisser un setup neuf ouvert en attente d'un administrateur.

1. Examiner le rendu Compose puis démarrer `./stack.sh up -d --build --wait --wait-timeout 180` sur la nouvelle cible uniquement.
2. Configurer le proxy HTTPS du nouveau domaine vers le nouveau port local, avec WebSocket. Les routes `/internal/` doivent rester bloquées publiquement selon le Caddyfile fourni.
3. Vérifier `/healthz`, l'identité du domaine, le premier admin et le workspace initial. Après connexion explicitement choisie par l'utilisateur, vérifier livraison du code SMTP.
4. Garder inscription `invite` et création `admins_only` pour le démarrage d'équipe ; vérifier dans les réglages d'instance, sans toucher à ceux du premier serveur. Les domaines d'inscription serveur ne constituent pas une membership workspace.
5. Régler le nom et l'emoji du workspace via PATCH admin. Chez Notion ces réglages sont dans Workspace → General ; Blok ne livre ici que le nom et l'emoji. [Référence officielle](https://www.notion.com/help/workspace-settings).
6. Créer des utilisateurs de recette explicitement autorisés, exécuter la matrice de `collaboration-permissions.md` dans deux profils + MCP. Aucune invitation de vrais collègues sans choix explicite de l'utilisateur.
7. Confirmer que les comptes et pages du serveur 1 ne sont pas accessibles avec les sessions/tickets du serveur 2 et réciproquement. Aucun mode hors ligne durable distant ne doit être annoncé.

## Sauvegarde et restauration vérifiable

Les scripts existants `backup.sh` / `restore.sh` utilisent `stack.sh` : garantir qu'ils visent le nouveau projet et sa surcharge. `backup.sh` arrête proprement le Go, vérifie sa sortie, exporte PostgreSQL et archive **tout** `/data`, puis redémarre le service. La DB seule n'est pas une sauvegarde suffisante du journal Blok.

Conserver hors serveur le dossier complet (marqueur `complete`, `database.dump`, `state.tar.gz`, commit/images) et une copie privée séparée du `.env`/clé IA. Protéger ces fichiers : ils contiennent données privées et sessions. Faire un essai de restauration dans une troisième pile isolée, sans DNS public, email sortant ni accès utilisateurs : une copie de recette d'une DB porte aussi les sessions originales.

`restore.sh /chemin/absolu/backup` exige base et state vides, et refuse d'écraser une installation. Restaurer avec les images/code correspondants puis vérifier une page, ses assets, droits, clés IA et révocation de session. Pour une reprise de la même instance, arrêter l'ancienne pour éviter deux journaux divergents. Ne jamais utiliser `down -v`, un reset DB ou une suppression de volume comme procédure de mise à jour.

La sauvegarde/restauration de ce nouveau serveur reste à exécuter sur l'hôte choisi. Les présentes modifications n'ont pas testé une reprise distante réelle.

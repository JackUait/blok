# Blok pour Tousambassadeurs

Ce déploiement sert le navigateur et les clients Tauri sur `https://blok.tousamba.cloud`.
Il comprend Caddy (HTTPS + interface), le service Go et PostgreSQL 17. Un seul service Go doit utiliser le volume de collaboration.

## Démonstration sur ton ordinateur

```sh
./deploy/demo.sh start
```

Ouvre [Blok local](http://localhost:8088) et la [boîte mail locale](http://localhost:8089).
Connecte-toi avec `admin@example.test` pour administrer, `membre@example.test` pour le membre déjà ajouté, ou `demandeur@example.test` pour demander à rejoindre l'espace.
Chaque connexion envoie un code neuf dans cette boîte locale. Aucun e-mail réel n'est envoyé. Utilise deux fenêtres privées/profils de navigateur pour comparer les rôles en même temps.

`./deploy/demo.sh stop` arrête la démo sans effacer les données ; `./deploy/demo.sh status` affiche les conteneurs.
Cette pile distincte (`blok-local`) est limitée à l'ordinateur via `127.0.0.1`. La boîte mail donne accès aux codes : elle est uniquement destinée à la démonstration locale. Le déploiement public ci-dessous utilise Resend et ne contient pas ce service.

## Installation sur ton VPS

Prérequis : Git, Docker avec Compose v2, OpenSSL, accès aux ports TCP 80/443 (UDP 443 facultatif).
Fais pointer le DNS A de `blok.tousamba.cloud` vers le VPS choisi ; retire un éventuel AAAA qui pointe ailleurs.
Si un proxy utilise déjà ces ports, adapte Compose et le routage avant de lancer la pile.

```sh
git clone --branch feat/tousambassadeurs-cloud https://github.com/joceqo/blok.git
cd blok
./deploy/install.sh
```

Le premier lancement crée `deploy/.env` et trois secrets aléatoires, puis s'arrête.
Édite ce fichier sur le serveur :

```dotenv
DOMAIN=blok.tousamba.cloud
BOOTSTRAP_ADMIN_EMAIL=ton-adresse@example.com
MAIL_FROM=Blok <connexion@tousamba.cloud>
RESEND_API_KEY=ta-cle-resend
```

Ne remplace pas les trois secrets générés. Le mot de passe PostgreSQL doit rester hexadécimal pour son utilisation dans l'URL de connexion.
Le fichier `.env` est ignoré par Git. Garde-en une copie privée hors du VPS.

Dans Resend, ajoute et vérifie le domaine d'expédition, puis utilise une clé permettant l'envoi.
Les enregistrements DNS exacts sont indiqués dans leur interface : [domaines vérifiés Resend](https://resend.com/docs/dashboard/domains/introduction).
L'adresse `MAIL_FROM` doit appartenir au domaine vérifié. Aucune clé Resend n'entre dans le frontend.

```sh
./deploy/install.sh
./deploy/stack.sh ps
./deploy/stack.sh logs --tail 100 app web
```

Caddy obtient le certificat HTTPS lorsque le DNS et les ports sont prêts.
Ouvre le site, entre l'adresse `BOOTSTRAP_ADMIN_EMAIL` et le code reçu : cet utilisateur est administrateur de Tousambassadeurs.
L'attribution initiale ne se produit qu'une fois ; modifier cette variable après installation ne promeut pas un nouveau compte.

Si le réseau Docker `172.30.87.0/24` existe déjà, change ensemble `BLOK_NETWORK_SUBNET`, `BLOK_NETWORK_DYNAMIC_RANGE` et `CADDY_IP` dans `.env`. L'adresse fixe de Caddy doit rester hors de la plage dynamique.
Seul Caddy est un proxy de confiance ; PostgreSQL et le service Go n'exposent aucun port sur le VPS.

## Membres et administration

Un nouvel utilisateur vérifie son e-mail, puis demande à rejoindre Tousambassadeurs.
Un administrateur peut approuver/refuser la demande, inviter par e-mail, changer un rôle ou retirer un membre.
L'invitation devient effective à la prochaine connexion avec l'adresse invitée.

| Rôle | Accès |
| --- | --- |
| Administrateur | Pages et gestion des membres/invitations/demandes |
| Membre | Lecture et modification des pages de l'espace |
| Lecteur | Lecture des pages de l'espace |

Le dernier administrateur ne peut pas être retiré ou rétrogradé. Les permissions portent sur tout l'espace ; il n'y a pas encore de partage privé par page ni de console super-administrateur inter-espaces.
Le schéma de gestion des membres s'inspire du parcours [Paramètres → Membres de Notion](https://www.notion.com/help/add-members-admins-guests-and-groups), avec des rôles simplifiés.

## Tauri et espaces locaux

La même interface peut se lancer dans Tauri. Depuis les réglages, connecte un serveur HTTPS et vérifie ton e-mail pour ouvrir un espace partagé.
Les sessions natives sont conservées dans le trousseau du système. Les données d'un espace local restent sur la machine, séparées des espaces serveur et des autres comptes.
Changer d'espace attend les écritures en cours ; une synchronisation distante impossible bloque le changement pour éviter de perdre une modification.
Le démarrage d'un espace serveur demande une connexion réseau. Les espaces locaux fonctionnent hors ligne ; leur contenu n'est pas automatiquement publié vers le serveur.

Pour compiler Tauri avec Node, Rust et les dépendances natives de la plateforme installés :

```sh
corepack enable
yarn install --immutable
npm ci --prefix desktop
npm run tauri --prefix desktop -- build
```

## Où sont les données ?

| Volume Docker | Contenu |
| --- | --- |
| `blok-cloud_postgres` | Utilisateurs, sessions, espaces, rôles, index des pages et projections du contenu |
| `blok-cloud_state` | Journal durable de collaboration `/data/collab` et fichiers joints `/data/uploads` |
| `blok-cloud_caddy_data` | Certificats HTTPS |

Les images contiennent le programme. Les volumes contiennent les données et survivent à leur remplacement.
**La base seule ne suffit pas à sauvegarder les documents : conserve aussi le volume `state`.**
Ne lance pas `docker compose down -v` sur une installation à conserver.

## Sauvegarde et mise à jour

```sh
./deploy/backup.sh
# Après récupération et revue de la nouvelle version du code :
./deploy/upgrade.sh
```

La sauvegarde arrête brièvement le service Go pour vider les écritures, vérifie son arrêt propre, exporte PostgreSQL et archive `/data`, puis redémarre le service.
Elle écrit `deploy/backups/<date>/` avec `database.dump`, `state.tar.gz`, le commit et les images utilisés, et un marqueur `complete`.
Copie ce dossier hors du VPS et conserve séparément `.env`. Les sauvegardes incluent des sessions et des données privées : garde-les privées.
Le script de mise à jour sauvegarde d'abord, construit les images puis remplace les conteneurs. Il ne fait pas de `git pull` ni de choix de branche à ta place.

Le schéma PostgreSQL est initialisé et mis à niveau dans une transaction au démarrage, avec verrou contre les démarrages concurrents.
Pour les futures évolutions, ajoute des migrations compatibles aux versions de schéma ; ne remplace jamais les volumes pour mettre le code à jour.
Une image ancienne n'est pas nécessairement compatible avec un schéma plus récent : un retour complet utilise la sauvegarde et le code correspondant.

## Changer de VPS / restauration

1. Fais une sauvegarde finale sur l'ancien VPS. Arrête ensuite `app web` et garde-les arrêtés pour éviter deux installations divergentes.
2. Copie le dossier de sauvegarde complet et `.env` vers le nouveau VPS. Récupère le commit indiqué dans `source-commit`.
3. Construis les images, sans lancer le service Go, puis restaure :

```sh
./deploy/stack.sh build --pull
./deploy/restore.sh /chemin/absolu/vers/la/sauvegarde
```

4. Fais pointer le DNS vers le nouveau VPS, vérifie la connexion, une page existante et une pièce jointe.

La restauration refuse une base ou un volume de données non vide. Elle ne supprime rien pour forcer le passage.
Si elle échoue après avoir commencé, conserve la sauvegarde et inspecte les logs avant de reprendre sur une destination vide.
En gardant le même domaine et les secrets, les liens et identités restent cohérents. Changer aussi le domaine nécessite de migrer les URL absolues des pièces jointes.
Les certificats peuvent être réémis par Caddy ; les données locales Tauri d'un ordinateur ne font pas partie de la sauvegarde serveur.

## Vérifications de développement

L'API est documentée dans `apps/service/API.md`. Les tests Go avec PostgreSQL et les tests navigateur utilisent uniquement un collecteur local d'e-mails : aucun envoi réel n'est nécessaire.
Le collecteur exige explicitement `APP_ENV=development` et `DEV_MAIL_DIRECTORY`; il est interdit en production.
Le scénario navigateur est `desktop/src/cloud/browser-e2e.mjs` (voir ses variables au début du fichier).

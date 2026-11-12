# Blok pour Tousambassadeurs

Ce déploiement sert le navigateur et les clients Tauri sur `https://blok.tousamba.cloud`.
Il comprend Caddy (interface + proxy HTTP interne), le service Go et PostgreSQL 17. Le proxy déjà présent sur le VPS termine HTTPS. Un seul service Go doit utiliser le volume de collaboration.

## Démonstration sur ton ordinateur

```sh
./deploy/demo.sh start
```

Ouvre [Blok local](http://localhost:8088) et la [boîte mail locale](http://localhost:8089).
Connecte-toi avec `admin@example.test` pour administrer, `membre@example.test` pour le membre déjà ajouté, ou `demandeur@example.test` pour demander à rejoindre l'espace.
Chaque connexion envoie un code neuf dans cette boîte locale. Aucun e-mail réel n'est envoyé. Utilise deux fenêtres privées/profils de navigateur pour comparer les rôles en même temps.

`./deploy/demo.sh stop` arrête la démo sans effacer les données ; `./deploy/demo.sh status` affiche les conteneurs.
Cette pile distincte (`blok-local`) est limitée à l'ordinateur via `127.0.0.1`. La boîte mail donne accès aux codes : elle est uniquement destinée à la démonstration locale. Le déploiement public ci-dessous utilise ton relais SMTP et ne contient pas ce service.

## Construire les images sur ton VPS

Prérequis : Git, Docker avec Compose v2, OpenSSL et un proxy HTTPS existant pour le domaine.
Fais pointer le DNS A de `blok.tousamba.cloud` vers le VPS choisi ; retire un éventuel AAAA qui pointe ailleurs.
Le seul port publié par Blok est `127.0.0.1:18088`, absent des ports déjà occupés fournis pour ce VPS. Configure ton proxy existant pour transmettre `blok.tousamba.cloud` vers `http://127.0.0.1:18088`, en conservant Host et les connexions WebSocket. Le port 18088 est local uniquement ; les ports 80, 443 et 5432 existants ne sont pas utilisés par Blok.

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
MAILER_HOST=smtprelay.nexenture.fr
MAILER_PORT=465
MAILER_USER=
MAILER_PASSWORD=
MAILER_FROM_EMAIL=blok@nexenture.fr
MAILER_FROM_NAME=blok
```

Ne remplace pas les trois secrets générés. Le mot de passe PostgreSQL doit rester hexadécimal pour son utilisation dans l'URL de connexion.
Le fichier `.env` est ignoré par Git. Garde-en une copie privée hors du VPS.

Le port **465** utilise TLS dès la connexion, avec validation du certificat. Renseigne `MAILER_USER` et `MAILER_PASSWORD` si ton relais exige une authentification ; laisse les deux vides uniquement si le relais autorise ton serveur sans identifiants. L’expéditeur `blok@nexenture.fr` doit être autorisé par le relais. Aucun envoi réel n’est effectué par le script d’installation : la première demande de connexion permet de vérifier la livraison.

Dans `.env`, une ligne par variable, **sans antislash final**. Un mot de passe contenant `$` ou `#` doit être entouré d’apostrophes pour rester littéral, par exemple `MAILER_PASSWORD='valeur-à-remplacer'`. Ne publie pas ce fichier.

Dans Compose, les valeurs `MAILER_*` non vides sont prioritaires ; les anciens noms `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` et `SMTP_FROM` restent acceptés. Quand un hôte SMTP est configuré, SMTP est utilisé. Sans hôte SMTP, `RESEND_API_KEY` et `MAIL_FROM` permettent encore d’utiliser Resend.

```sh
cd deploy
sudo docker compose up -d --build --wait --wait-timeout 180
sudo docker compose ps
sudo docker compose logs --tail 100 app web
```

Le proxy existant gère le certificat HTTPS public. Caddy écoute en HTTP sur le port 80 du conteneur, publié uniquement sur `127.0.0.1:18088`. `PUBLIC_URL` reste l’adresse HTTPS du domaine. Vérifie la pile depuis le VPS avec `curl http://127.0.0.1:18088/healthz`.
Ouvre le site, entre l'adresse `BOOTSTRAP_ADMIN_EMAIL` et le code reçu : cet utilisateur est administrateur de Tousambassadeurs.
L'attribution initiale ne se produit qu'une fois ; modifier cette variable après installation ne promeut pas un nouveau compte.

Si le réseau Docker `172.30.87.0/24` existe déjà, change ensemble `BLOK_NETWORK_SUBNET`, `BLOK_NETWORK_DYNAMIC_RANGE` et `CADDY_IP` dans `.env`. L'adresse fixe de Caddy doit rester hors de la plage dynamique.
Seul Caddy est un proxy de confiance ; PostgreSQL et le service Go n'exposent aucun port sur le VPS.

## Utiliser des images préconstruites

`compose.images.yaml` lance les mêmes trois services sans aucune compilation et sans checkout du code. Charge d’abord les images Blok adaptées à l’architecture du VPS avec `docker load`, puis utilise ce fichier comme `compose.yaml`. Renseigne `APP_IMAGE` et `WEB_IMAGE` avec les tags chargés dans `.env` ; les deux services utilisent `pull_policy: never`. PostgreSQL utilise toujours l’image officielle.

Le paquet exporté pour `debian@sandbox-tousamba-cloud` est en **linux/amd64 (x86_64)**. Il contient `images.tar`, `compose.yaml`, `.env.example`, `prepare.sh` et les scripts de sauvegarde/restauration. Après extraction :

```sh
cd blok-vps-amd64
./prepare.sh
nano .env
sudo docker load -i images.tar
sudo docker compose up -d --wait --wait-timeout 180
```

Le script `prepare.sh` crée les secrets, sans démarrer les conteneurs. Renseigne ton adresse administrateur et l’authentification du relais SMTP avant le lancement. Les données ne font pas partie de l’archive d’images : les volumes sont créés au premier démarrage. Docker Engine avec Compose v2 est nécessaire ; [installation officielle sur Debian](https://docs.docker.com/engine/install/debian/).

## Membres et administration

Un nouvel utilisateur vérifie son e-mail, puis demande à rejoindre Tousambassadeurs.
Un administrateur peut approuver/refuser la demande, inviter par e-mail, changer un rôle ou retirer un membre.
L'invitation devient effective à la prochaine connexion avec l'adresse invitée.

Dans l'éditeur, le menu de l'espace ouvre **Paramètres** dans une dialog avec navigation à gauche. Les préférences, le compte et les accès sont réunis dans cette fenêtre ; sa fermeture rend la main à la page ouverte.
**Inviter des membres** ouvre une dialog compacte avec les adresses séparées par des virgules, le rôle et un message facultatif (2 000 caractères maximum). Les invitations réussies ne sont pas renvoyées lorsqu'on réessaie après un échec partiel.

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
| `blok-cloud_postgres` | Utilisateurs, sessions, espaces, rôles, index des pages, projections du contenu et clés OpenAI chiffrées |
| `blok-cloud_state` | Journal durable de collaboration `/data/collab`, fichiers joints `/data/uploads` et clé de chiffrement `/data/ai-key` |
| `blok-cloud_caddy_data` | État du Caddy interne (le certificat public est géré par le proxy existant) |

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
Les certificats sont gérés par le proxy existant ; les données locales Tauri d'un ordinateur ne font pas partie de la sauvegarde serveur.

## Vérifications de développement

L'API est documentée dans `apps/service/API.md`. Les tests Go avec PostgreSQL et les tests navigateur utilisent uniquement un collecteur local d'e-mails : aucun envoi réel n'est nécessaire.
Le collecteur exige explicitement `APP_ENV=development` et `DEV_MAIL_DIRECTORY`; il est interdit en production.
Le scénario navigateur est `desktop/src/cloud/browser-e2e.mjs` (voir ses variables au début du fichier).


## Assistant OpenAI

Dans **Paramètres → Assistant IA**, chaque membre peut enregistrer sa clé OpenAI et choisir son modèle. Les administrateurs peuvent aussi configurer une clé et un modèle partagés pour le workspace. La clé personnelle est prioritaire sur la clé partagée ; une erreur de clé personnelle ne déclenche jamais un repli facturé au workspace. Retirer la clé personnelle réactive la clé partagée si elle existe.

Le sélecteur de l’assistant affiche le fournisseur, le modèle et la provenance de la clé. Il permet de choisir un autre modèle de texte accessible à la clé. Aucun appel de génération ne part avant l’envoi d’une demande. Le catalogue vient d’OpenAI ; la présence d’un modèle ne garantit pas sa compatibilité avec toutes les options de Responses.

Les secrets ne sont jamais renvoyés au navigateur ni conservés dans son localStorage. Le serveur chiffre les clés avec AES-GCM. Par défaut, il crée une clé aléatoire dans `/data/ai-key` (permissions 0600), incluse dans `state.tar.gz`. **Conserver ce fichier avec la base est indispensable pour retrouver les clés après restauration ou changement de VPS.** Si `AI_ENCRYPTION_KEY` est défini, il doit contenir 32 octets aléatoires encodés en base64 ; conservez alors cette variable avec les secrets du déploiement. La changer ne rechiffre pas les clés existantes.

Dans l’app macOS, un espace en ligne utilise le même compte et les mêmes règles que le navigateur. Un espace local utilise une clé personnelle distincte dans le trousseau du Mac. Codex et Claude Code restent disponibles via leur connexion CLI sur le Mac. Les clés du trousseau ne sont pas dans la sauvegarde serveur.

La demande et le contexte de page explicitement activé sont envoyés à OpenAI via le serveur (ou directement depuis la partie native pour un espace local), avec `store: false`. Les appels sont facturés par OpenAI au titulaire de la clé utilisée. Les tests automatisés simulent OpenAI et ne nécessitent aucune clé réelle.

### React Grab dans la démo locale

La cible web accepte l’argument de build `VITE_REACT_GRAB=true`. Il est activé dans `compose.demo.yaml` et désactivé par défaut pour le serveur. Dans les réglages de la démo, « Sélectionner un élément » lance React Grab ; le raccourci est `⌘/Ctrl + Maj + G`. Collez ensuite le contexte dans le chat. La télémétrie de React Grab est désactivée. Les réglages étant écrits en DOM, le contexte inclut leur fichier source et le HTML sélectionné, sans inventer de pile de composants React.

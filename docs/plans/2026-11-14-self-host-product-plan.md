# Blok self-host : un produit, pas un déploiement

> **Statut :** conception. Aucune ligne de code écrite. §13 donne l'ordre de
> livraison.
>
> **Périmètre :** `apps/service` (le backend cloud Go), le client `desktop/src`
> et `deploy/`. La bibliothèque publiée n'est pas touchée : aucun type de
> `types/`, aucune donnée sauvegardée de bloc, aucune clé de configuration
> publique ne change. Ce n'est donc pas un changement cassant au sens de
> `CLAUDE.md`. Le contrat cloud (`apps/service/API.md`) change, lui, et suit
> dans le lot qui le modifie.
>
> **Ne pas confondre** `apps/service` (l'application cloud self-hostable, objet
> de ce document) avec `packages/server` (la bibliothèque sidecar publiée en Go,
> C# et Rust). La loi de parité des trois serveurs ne s'applique pas ici.

## 1. Objectif

Blok a un backend cloud complet et un modèle de permissions par page solide,
livré la semaine dernière (`docs/plans/2026-11-13-page-permissions-design.md`).
Ce qui manque n'est pas la mécanique : c'est **tout ce qui entoure la première
heure**.

Aujourd'hui, une personne qui veut héberger Blok doit patcher du Go et du
TypeScript pour retirer le nom d'un client, éditer un fichier d'environnement
avant de voir le moindre écran, et découvrir seule que son relais SMTP est mal
réglé — au premier échec de connexion, derrière une erreur opaque.

L'objectif : qu'un `docker compose up` mène à un produit qui s'explique, dont
l'hébergeur contrôle qui entre, et dont les utilisateurs comprennent les droits.

La référence est Notion pour l'expérience, et AFFiNE pour la comparaison
technique — c'est le projet open source le plus proche de ce qu'on construit, et
il a déjà tranché la plupart de ces questions (§16).

## 2. Ce qui existe aujourd'hui

Vérifié dans le worktree, pas supposé.

**L'instance est codée en dur pour un client.** `apps/service/service.go:102`
insère `workspaces(slug='tousambassadeurs', name='Tousambassadeurs')` à **chaque**
démarrage. Le gateway affiche « Bienvenue chez Tousambassadeurs »
(`desktop/src/cloud/index.ts:82`) et appelle `client.workspace('tousambassadeurs')`
(`:123`). `desktop/src/main.ts:21` a `https://blok.tousamba.cloud` en défaut
natif. `deploy/.env.example` porte `blok.tousamba.cloud` et
`smtprelay.nexenture.fr` en valeurs par défaut **silencieuses**.

La marque touche **18 fichiers** hors `work/` et `node_modules` :

```
apps/service/   service.go · API.md · README.md · service_test.go
                workspace_rename_test.go · ai_test.go
deploy/         .env.example · Caddyfile · compose.yaml · compose.images.yaml
                README.md · seed-demo.py
desktop/src/    main.ts · cloud/index.ts · cloud/gateway.test.ts
                cloud/browser-e2e.mjs · settings.test.ts · mcp-settings.test.ts
```

**Il n'y a pas de premier démarrage.** Le premier administrateur naît de
`BOOTSTRAP_ADMIN_EMAIL`, une seule fois à vie via la table `bootstrap_markers`
(`service.go:105-121`). Changer la variable ensuite est **ignoré en silence**.
Une faute de frappe dans l'adresse laisse l'instance sans administrateur
joignable, et il n'existe aucune commande de récupération : `cmd/` ne contient
que `server/main.go`.

**L'inscription est ouverte à tous.** `auth.go:93` crée le compte à la première
vérification de code réussie :

```go
INSERT INTO users(id,email) VALUES($1,$2)
  ON CONFLICT(email) DO UPDATE SET email=excluded.email RETURNING id,email
```

Toute adresse délivrable obtient un compte. Il n'existe **aucun** réglage pour
fermer la porte — ni liste d'autorisation, ni restriction de domaine, ni mode
sur-invitation. Les seuls garde-fous sont des limites de débit : 30 codes par
heure et par IP, 8 par adresse, un délai de 45 secondes avant renvoi
(`auth.go:31,42`).

**La création d'espaces est libre.** `workspaces.go:25-65` : tout compte
authentifié crée un espace et en devient `admin`. Seul garde :
`s.rate("workspace:"+u.ID, 10)`, soit dix **par heure glissante** — pas un quota
cumulatif.

**Il n'y a aucun administrateur d'instance.** `users(id, email, created_at)` n'a
pas de colonne de rôle, il n'existe ni table `settings`, ni table `admins`, ni
route `/admin`. Toute la configuration est lue **une seule fois** au démarrage
(`ConfigFromEnv()`, appelée dans `cmd/server/main.go:24`) : changer le SMTP ou le
domaine exige d'éditer `.env` et de redémarrer les conteneurs.

**Le mail est le chemin critique, et il n'est jamais testé.** Blok n'a pas de
mot de passe : la connexion passe entièrement par un code à six chiffres. Si
l'envoi échoue, `requestCode` supprime le code et répond
`503 "Email delivery unavailable"` (`auth.go:48-50`) — **personne ne peut se
connecter, administrateur compris.** Or `Config.validate()` ne vérifie que la
*syntaxe* de la configuration mail, jamais la délivrabilité. Avec les valeurs
par défaut de `.env.example`, le service démarre sain, passe son healthcheck, et
casse au premier login. `deploy/README.md:48` l'assume noir sur blanc.

**Il n'y a aucune prise en main.** Une recherche exhaustive sur
`getting started|onboarding|welcome|bienvenue|checklist|tour|tutorial|premiers pas`
dans `src/`, `desktop/src/`, `packages/` et `apps/` ne remonte rien de produit.
Tout l'accueil d'un nouvel espace tient dans `desktop/src/workspace-empty.ts` —
**20 lignes**, un paragraphe et un bouton. Il n'y a pas non plus d'écran
d'acceptation d'invitation : l'adhésion est consommée silencieusement au login
(`auth.go:98-105`), et l'invité ne voit jamais qui l'a invité, dans quoi, ni
avec quel message.

**Ce qui est bon et ne bouge pas.** Le modèle de permissions par page est fin et
testé : `niveau = min(plafond(rôle), max(base, max des partages de la chaîne))`,
visibilité `inherit|private|workspace` héritée du parent avec fermeture par
défaut, table `page_shares`, révocation des sessions ouvertes en moins de cinq
secondes (`access.go:50`), et une **loi d'architecture** — `permissions_law_test.go`
parcourt l'AST de tous les fichiers non-test et fait échouer toute fonction qui
interroge `pages` ou `assets` sans passer par un garde, sauf exemption motivée.

## 3. Décisions

| Question | Décision |
| --- | --- |
| Mono-espace ou multi-espaces | **Un réglage de déploiement**, pas un choix de code. Le mode mono-espace est la politique de création « désactivée ». |
| Premier administrateur | **Les deux chemins, choisis par la configuration.** `BOOTSTRAP_ADMIN_EMAIL` renseigné → chemin par variable d'environnement. Vide → l'instance démarre « setup requis » et sert un assistant web. |
| Inscription par défaut | **Sur invitation seulement.** |
| Console d'administration | **Dans la modale de réglages du client**, rubrique « Instance » réservée à l'administrateur d'instance. Pas de site `/admin` séparé. |

## 4. Le modèle : l'instance devient une entité

Migration **5**, à la fin de `apps/service/schema.sql`. Le fichier est rejoué en
entier à chaque démarrage sous `pg_advisory_xact_lock`, avec
`schema_migrations` comme jalons ; les rattrapages se conditionnent sur
`NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=5)` — même motif que la
migration 4.

```sql
CREATE TABLE IF NOT EXISTS instance_settings(
  id boolean PRIMARY KEY DEFAULT true CHECK(id),      -- la 2e ligne est impossible
  name text NOT NULL DEFAULT 'Blok',
  signup_policy text NOT NULL DEFAULT 'invite'
    CHECK(signup_policy IN ('invite','domain','open')),
  signup_domains text[] NOT NULL DEFAULT '{}',
  workspace_creation text NOT NULL DEFAULT 'admins_only'
    CHECK(workspace_creation IN ('anyone','admins_only','disabled')),
  default_workspace_id text REFERENCES workspaces(id),
  setup_completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text REFERENCES users(id));

CREATE TABLE IF NOT EXISTS instance_admins(
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS setup_tokens(
  digest text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE users ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
```

### 4.1 Une ligne unique typée, pas un magasin clé/valeur

| | Ligne unique typée | Clé/valeur |
| --- | --- | --- |
| Domaine des énumérations | `CHECK(…)` en base, **même mécanisme que `memberships.role`** | re-validation en Go, la base accepte n'importe quoi |
| Lecture du cache | un `SELECT` donne l'instantané complet | N lignes à recomposer |
| Écriture d'un PATCH multi-champs | un `UPDATE … RETURNING` atomique | N upserts, atomicité à fabriquer |
| Coût d'un nouveau réglage | une migration `ADD COLUMN IF NOT EXISTS` | « gratuit », et c'est le problème : aucune contrainte |

Le `CHECK(id)` sur un `boolean PRIMARY KEY DEFAULT true` rend la seconde ligne
**impossible**, pas seulement improbable. Cette ligne sert aussi de **mutex
d'instance** (`SELECT … FOR UPDATE`), exactement comme `workspaces` en sert déjà
un dans `mutateMember` (`workspaces.go:258`).

### 4.2 `instance_admins` en table, pas une colonne sur `users`

1. **Le projet modélise déjà « rôle dans une portée » par une table de
   jonction** (`memberships`). Un administrateur d'instance est la même forme
   avec la portée réduite à l'instance.
2. **La promotion est un événement, pas un attribut** : `granted_by` et
   `created_at` sont ce que la commande de récupération et le futur journal
   d'audit auront besoin de lire.
3. **Zéro ligne est un état lisible** — « aucun administrateur encore » — et
   `count(*)` est directement la requête de protection du dernier
   administrateur, même forme que pour les espaces.
4. **La table est son propre index.** Lister les administrateurs sur une colonne
   serait un balayage de `users`.

Le seul contre-argument — éviter une jointure sur le chemin chaud — tombe : le
drapeau se replie dans la requête de session existante, à coût nul.

```go
// service.go — session()
`SELECT u.id, u.email, u.name, ia.user_id IS NOT NULL
   FROM sessions s JOIN users u ON u.id=s.user_id
   LEFT JOIN instance_admins ia ON ia.user_id=u.id
  WHERE s.id=$1 AND s.expires_at>now()`
```

`User` gagne `InstanceAdmin bool`. **C'est un changement de charge utile de
`/api/session` et `/api/auth/verify-code`** : `API.md` et les types desktop dans
le même lot.

`users.name` est le seul élargissement de périmètre de ce document, à une
trentaine de lignes : l'assistant demande un nom, l'avatar est aujourd'hui
`email.charAt(0)` réimplémenté en quatre endroits, et le panneau « Mon compte »
est intégralement en lecture seule.

### 4.3 Lecture à chaud

`Service.settingsValue` est un `atomic.Pointer[InstanceSettings]`, chargé dans
`New()` avant `routes()`, et rafraîchi par un ticker calqué sur
`startAccessSweep` (`access.go:50`). Il doit être **arrêté dans `Close()` ET
dans `Drain()`**, comme `stopAccessSweep` (`service.go:157,165`) — sinon un test
qui recrée un `Service` laisse une goroutine qui interroge une base détruite.

Deux invariants, à écrire en test :

- **L'écrivain ne lit jamais son propre cache périmé.** Le PATCH fait
  `UPDATE … RETURNING *` et stocke le résultat dans la même fonction : effet
  immédiat, pas dans dix secondes.
- **Le cache ne répond jamais à la question « le setup est-il encore
  ouvert ? »** Cette question est transactionnelle (`FOR UPDATE`). Le cache
  répond aux questions de *politique*, jamais à la question *une-seule-fois*.
  Les confondre rouvre la revendication de l'instance.

Le ticker existe pour le second écrivain réel, `blokctl` (§8). La latence est
bornée et doit être écrite dans la documentation : « un réglage modifié par un
autre processus prend effet en moins de dix secondes ».

### 4.4 Migrer l'existant sans rien casser

```sql
-- Une instance qui a déjà des membres n'attend pas d'assistant.
UPDATE instance_settings SET setup_completed_at=now()
 WHERE setup_completed_at IS NULL AND EXISTS(SELECT 1 FROM memberships);

-- ...et elle garde les politiques sous lesquelles elle tournait.
UPDATE instance_settings SET signup_policy='open', workspace_creation='anyone'
 WHERE NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=5)
   AND EXISTS(SELECT 1 FROM memberships);

-- Un espace unique est l'espace par défaut : le client cesse de nommer un slug.
UPDATE instance_settings SET default_workspace_id=(SELECT id FROM workspaces)
 WHERE default_workspace_id IS NULL AND (SELECT count(*) FROM workspaces)=1;
```

C'est la seule asymétrie de ce document, et elle est délibérée : **le défaut
strict vaut pour qui installe, pas pour qui tourne déjà.** Basculer une instance
en service sur invitation verrouillerait dehors des gens sur le point de
rejoindre.

La garde `NOT EXISTS(… version=5)` n'est pas cosmétique. Le schéma étant rejoué
à chaque démarrage, sans elle **chaque redémarrage écraserait le choix de
l'administrateur**. C'est le piège le plus coûteux du document (§14).

## 5. Le premier démarrage

### 5.1 La règle

| `BOOTSTRAP_ADMIN_EMAIL` | Comportement au démarrage |
| --- | --- |
| renseigné | upsert du compte, `INSERT INTO instance_admins … ON CONFLICT DO NOTHING`, `setup_completed_at = coalesce(…, now())`. **À chaque démarrage, idempotent.** |
| vide, des administrateurs d'instance existent | rien |
| vide, aucun administrateur, instance héritée | promotion des `admin` de l'**espace par défaut** uniquement, journalisée nommément |
| vide, aucun administrateur, setup en attente | frappe ou conserve un jeton, journalise l'URL à chaque démarrage |

La variable **ne touche plus jamais `memberships`** : elle gouverne
l'administrateur *d'instance*. C'est ce qui réconcilie deux exigences qui
semblaient opposées — « changer la variable est ignoré silencieusement » est un
défaut, mais « une rétrogradation délibérée doit tenir » est une garantie, déjà
épinglée par `service_test.go:482-500`, qui doit rester vert.

Le fichier `.env` est déjà la racine de confiance du déploiement : il porte
`DATABASE_URL`, `TICKET_SECRET` et `INTERNAL_SECRET`. Qui peut l'éditer peut
déjà lire la base. En faire un chemin de récupération assumé et documenté est
honnête.

### 5.2 Fermer la fenêtre entre `docker compose up` et la première visite

Sans garde, le premier visiteur d'une instance fraîche en devient
l'administrateur. Quatre couches, chacune utile seule.

**(a) Un jeton, pas un formulaire ouvert.** Le service frappe un `opaque()`,
n'en stocke que le digest dans `setup_tokens`, et écrit le texte clair dans
`DATA_DIRECTORY/setup-token`, mode `0600`. Les logs ne reçoivent que **l'URL**,
jamais le jeton : les logs partent souvent vers un agrégateur lu par plus de
monde que le volume de données. Le rituel est
`docker compose exec app cat /data/setup-token`.

**(b) Revendication une-seule-fois, transactionnelle.** `POST /api/setup/claim`,
dans une seule transaction : `SELECT setup_completed_at … FOR UPDATE` → 409 si
non nul → `subtle.ConstantTimeCompare` du digest → création du compte, de la
ligne `instance_admins` et de l'espace initial → `setup_completed_at = now()` →
`DELETE FROM setup_tokens`. Le verrou de ligne rend la course entre deux
revendiquants impossible.

**(c) La possession de la boîte mail reste prouvée.** La revendication
**n'accorde pas de session** : elle enregistre l'adresse comme administrateur et
déclenche un code de connexion ordinaire. Un jeton fuité ne suffit donc pas sans
la boîte, et une boîte ne suffit pas sans le jeton. C'est précisément pourquoi
le test de délivrabilité doit être appelable **depuis l'assistant, avant la
revendication** : `POST /api/setup/email-test`.

> *Alternative écartée :* accorder la session directement contre le jeton. Plus
> simple, mais cela fait du jeton un mot de passe — et un fichier `0600` dans un
> volume Docker sauvegardé n'en est pas un. Le prix payé, « si le mail est
> cassé, l'assistant est en impasse », est exactement ce que couvre `blokctl`.

**(d) Les défauts rendent l'instance inerte par construction.**
`signup_policy='invite'` avec zéro compte et zéro invitation ⇒ `request-code`
n'émet aucun code. `workspace_creation='admins_only'` avec zéro administrateur
d'instance ⇒ toute création d'espace est refusée. Aucun garde supplémentaire à
écrire : c'est une conséquence des valeurs par défaut, et c'est à tester comme
telle.

### 5.3 Dé-câbler `tousambassadeurs`

`service.go:102` disparaît, remplacé par un couple d'environnement optionnel
`BOOTSTRAP_WORKSPACE_SLUG` / `BOOTSTRAP_WORKSPACE_NAME`, renseigné avec
`BOOTSTRAP_ADMIN_EMAIL`. **Le déploiement existant reproduit exactement son
comportement d'aujourd'hui en ajoutant deux lignes à `deploy/.env`** — et le
slug devient un choix de déploiement au lieu d'une constante Go.

`Config.validate()` gagne trois contrôles : si `AdminEmail` est non vide,
`normalizeEmail` doit réussir (aujourd'hui une faute de frappe n'échoue qu'au
tout premier démarrage, `service.go:111`) ; le couple espace doit être renseigné
des deux côtés ou d'aucun ; le slug doit satisfaire `slugPattern`.

`bootstrap_markers` devient inutilisée. La garder — une table vide ne coûte
rien — et le dire en commentaire, plutôt que de la supprimer dans le même lot.

## 6. Les politiques

### 6.1 Inscription, sans oracle d'énumération

`POST /api/auth/request-code` **répond toujours la même chose**,
`200 {ok:true}`, pour toute adresse syntaxiquement valide passant les limites de
débit. Seul l'effet de bord change.

| Adresse | Politique | Effet |
| --- | --- | --- |
| compte existant | toutes | code envoyé |
| inconnue, invitation en attente | toutes | code envoyé |
| inconnue, domaine listé | `domain` | code envoyé |
| inconnue | `open` | code envoyé |
| inconnue, non autorisée | `invite` · `domain` | **aucune ligne `login_codes`, aucun mail** |

Le refus se matérialise à `verify-code` par le `401 "Invalid or expired code"`
**existant** (`auth.go:79`), mot pour mot celui d'un code faux. Aucune chaîne
d'erreur nouvelle, donc aucun oracle.

Placement dans `requestCode` : **après** les deux écritures de limite de débit
(`auth.go:31`), **avant** la génération du code — les deux chemins consomment le
même quota, donc le compteur ne devient pas un oracle à son tour. Fuite
résiduelle à documenter honnêtement : le chemin refusé saute l'aller-retour
SMTP, il est donc plus rapide ; la variance de latence d'un relais réel écrase
largement cet écart.

**Second garde, dans la transaction de `verify-code`.** Un code frappé sous
`open` peut être échangé dix minutes plus tard sous `invite`. Entre le
`DELETE FROM login_codes` (`auth.go:88`) et l'`INSERT INTO users` (`:93`) :

```go
func (s *Service) signupAllowed(ctx context.Context, q querier, email string) (bool, error)
// compte existant OU invitation 'pending' non expirée ⇒ true
// sinon : open ⇒ true · domain ⇒ appartenance ⇒ invite ⇒ false
```

`querier` (`permissions.go:128`) accepte déjà indifféremment le pool et une
transaction. Le domaine se compare **par égalité exacte** sur la partie après le
dernier `@` de l'adresse normalisée — jamais `strings.HasSuffix`, qui laisserait
passer `@notexample.com` pour `example.com`.

> **Hors périmètre, à signaler** : l'acceptation d'invitation n'existe que dans
> `verifyCode` (`auth.go:98`). Un compte déjà connecté qui reçoit une invitation
> n'obtient rien avant un nouveau cycle de connexion. En mode sur-invitation,
> l'invitation devient *aussi* le droit d'inscription, donc cet écart pèse plus
> lourd qu'avant. Le correctif est un `POST /api/invitations/accept` dédié — pas
> une écriture cachée dans `GET /api/session`.

### 6.2 Création d'espaces

Dans `createWorkspace`, après `s.require` :

```go
switch s.settings().WorkspaceCreation {
case "disabled":
    problem(w, 403, "Workspace creation is disabled on this instance"); return
case "admins_only":
    if !u.InstanceAdmin { problem(w, 403, "Instance administrator required"); return }
}
```

La limite de dix par heure reste par-dessus : elle borne aussi un
administrateur. **Le mode mono-espace, c'est `disabled`** — pas un chemin de
code séparé.

À nommer explicitement, sinon cela devient un ticket de support :
`POST /api/admin/workspaces` n'est **jamais** gouverné par cette politique. Sans
cela, une instance `disabled` sans aucun espace serait briquée. Et l'assistant
de premier démarrage doit créer le premier espace au moment où il s'apprête à
poser `disabled`.

`mcp.go` n'offre aucune création d'espace (`blok_create_page` seulement) : rien
à changer côté MCP.

## 7. Les API

| Route | Auth | Réponse |
| --- | --- | --- |
| `GET /api/instance` | aucune | `{name, setupRequired, signupPolicy, workspaceCreation, defaultWorkspace: null \| {slug,name}}` |
| `POST /api/setup/claim` | jeton | `{token,email,name,instanceName?,workspace?}` ; 403 · 409 · 429 |
| `POST /api/setup/email-test` | jeton | `{ok,backend}` \| 503 `{error,backend}` ; refusé si le setup est terminé |
| `GET` · `PATCH /api/admin/settings` | admin d'instance | PATCH à champs **pointeurs** (absent ≠ vide), un seul `UPDATE … coalesce($1,x) … RETURNING *` |
| `GET` · `POST /api/admin/users` | admin d'instance | liste paginée · création d'un compte sans invitation d'espace |
| `PATCH` · `DELETE /api/admin/users/{id}` | admin d'instance | 409 `"Keep at least one instance administrator"` |
| `GET` · `POST /api/admin/workspaces` | admin d'instance | `{id,slug,name,memberCount,createdAt}` — **métadonnées seules** ; le POST contourne la politique |
| `POST /api/admin/email-test` | admin d'instance | idem, limité à dix par heure |

Le drapeau d'administrateur voyage par `GET /api/session`, **jamais** par
`GET /api/instance` : cette dernière est anonyme, et y exposer les adresses des
administrateurs offrirait une cible de hameçonnage toute prête.

### 7.1 La loi d'architecture et le compte de pages

`permissions_law_test.go` fait échouer toute fonction non-test dont le corps
contient `from pages`. Un compteur de pages dans `GET /api/admin/workspaces`
tomberait dessus.

**Décision : pas de `pageCount` dans le premier lot.** `memberCount` vient de
`memberships`, table non gardée, et le lot reste propre. Si le compte de pages
devient nécessaire, il s'isole dans une fonction minuscule dont la signature
prouve qu'elle ne rend rien d'autre, avec une exemption motivée :

```go
// permissionExemptions["workspacePageCounts"] =
//   "compte les pages par espace ; ne rend ni identifiant, ni titre, ni contenu.
//    L'accès administrateur au CONTENU reste hors périmètre (permissions §8),
//    il exige un journal d'audit."
```

Doublée d'un test qui assert que la charge utile d'administration ne contient
aucun identifiant ni titre de page. Attention : la loi échoue **aussi** sur une
exemption devenue orpheline, donc renommer la fonction plus tard casse le test
tant que l'exemption n'est pas mise à jour.

### 7.2 Test de délivrabilité

`Config.mailBackend() string` rend `"injected" | "development" | "smtp" |
"resend" | ""`. Il doit refléter **exactement** l'ordre de sélection de `send`
(`mail.go:85-122`), et un test unitaire doit vérifier que les deux restent
synchronisés — y compris le piège que le commentaire `mail.go:96` signale
déjà : SMTP l'emporte silencieusement sur une clé Resend résiduelle. Rendre
`backend` dans la réponse est précisément ce qui rend ce piège visible.

Les messages d'erreur de `mail.go` sont déjà des chaînes fixes et assainies
(`"SMTP connection failed"`, `"SMTP authentication failed"`…) : elles nomment la
panne sans jamais refléter la réponse du serveur, donc elles sont sûres à
exposer telles quelles.

### 7.3 Suppression de compte : deux clés étrangères bloquent

`users` n'a aucun `ON DELETE` dans tout le schéma.

| Référence | Traitement dans la transaction |
| --- | --- |
| `sessions`, `mcp_tokens`, `memberships`, `join_requests`, `page_shares.user_id`, `ai_credentials` | suppression |
| **`page_shares.granted_by`** `NOT NULL` | réattribution à l'administrateur qui supprime |
| **`workspace_emojis.created_by`** `NOT NULL` | idem |

Si ce poids paraît trop lourd pour un premier lot, l'alternative basse-risque
est une **désactivation** (`users.disabled_at`, refusée dans `session()` et
`verify-code`), la suppression dure venant plus tard. À trancher explicitement,
pas à laisser dériver.

## 8. La récupération : `apps/service/cmd/blokctl`

```
blokctl admin grant <email>      crée le compte si besoin, le promeut admin d'instance
blokctl admin list
blokctl admin revoke <email>     refuse le dernier
blokctl settings show
blokctl settings set signup-policy=open workspace-creation=anyone
blokctl setup token              réimprime ou refrappe tant que le setup est en attente
blokctl email test <adresse>     prouve la délivrabilité depuis l'intérieur du conteneur
```

Second binaire du même module, même étage de `deploy/Dockerfile`. Usage :
`docker compose exec app blokctl admin grant moi@example.com`.

**Il ne doit PAS appeler `cloud.New`** : cela démarrerait Blok, le MCP et la
veille d'accès, et prendrait le répertoire de collaboration que le serveur
détient. Exporter à la place une surface étroite :

```go
func Operate(ctx context.Context, c Config) (*Ops, error) // ouvre le pool seul
func (o *Ops) GrantInstanceAdmin(ctx context.Context, email string) (created bool, err error)
func (o *Ops) RevokeInstanceAdmin(ctx context.Context, email string) error
func (o *Ops) Settings(ctx context.Context) (InstanceSettings, error)
func (o *Ops) SetSettings(ctx context.Context, patch SettingsPatch) (InstanceSettings, error)
func (o *Ops) SetupToken(ctx context.Context, regenerate bool) (string, error)
```

Les handlers HTTP appellent **les mêmes fonctions** : une seule implémentation
de chaque règle, protection du dernier administrateur comprise, et testable sans
HTTP au passage.

`Operate` **refuse de migrer** : `SELECT max(version) FROM schema_migrations` et
erreur si la version est inférieure à celle attendue. Un CLI qui migrerait
pendant qu'un serveur plus ancien tourne est un dégât, pas une commodité. Cette
porte séparée évite aussi la vérification de clé IA de `New`
(`service.go:128-142`), qui ferait échouer le CLI sur une machine sans le
fichier de clé.

## 9. L'administration dans le client

### 9.1 Deux décisions d'architecture

**On amende `desktop/src/cloud/index.ts`, on ne le remplace pas.** Son contrat
`mountCloudGateway(root, options) → {destroy, refresh}` est juste, et il est
épinglé par une spécification exécutable, `cloud/gateway.test.ts` — entrée
directe quand il n'y a qu'un espace, candidat en attente qui reste dehors, 401
qui ramène à la connexion, validation d'origine du serveur. Réécrire de zéro
jette cette spécification. On remplace les internes vue par vue, derrière un
petit routeur.

**L'assistant de premier démarrage est une route du gateway, pas une page
`/setup` séparée.** Le gateway possède déjà la coque plein écran non
authentifiée, le sélecteur de serveur et la surface d'erreur ; une page à part
les dupliquerait — et serait **inatteignable depuis l'app Tauri**, qui ne navigue
pas par URL.

Le routeur passe de quatre vues à neuf : `boot · unreachable · setup ·
login(email) · login(code) · invite · spaces · create-workspace · join`.

Au passage, `admin()` (`cloud/index.ts:173-217`) disparaît : c'est l'écran
Membres **en double**, en listes brutes, déjà divergent de la version des
réglages. Le lien `?manage=` ouvre l'espace puis la modale, et `main.ts:78` a
déjà ce chemin d'événement.

### 9.2 L'assistant

Quatre cartes, « Étape n sur 4 », retour arrière qui conserve la saisie, et
**rien n'est écrit côté serveur avant la dernière** — un seul POST.

| Étape | Demande | Phrase affichée |
| --- | --- | --- |
| 1 · Cette instance | Jeton de setup, nom | « Ce nom s'affiche sur l'écran de connexion et dans les e-mails. » L'écran donne la commande `docker compose exec app cat /data/setup-token` à copier. |
| 2 · Administrateur | Nom, adresse | « Cette adresse recevra un code de connexion. **Blok n'a pas de mot de passe.** » Sans cette phrase, l'absence du champ ressemble à un bug. Bouton « Vérifier l'envoi ». |
| 3 · Premier espace | Nom ; identifiant **dérivé**, avec aperçu `votre-serveur.fr/mon-equipe` et un « Modifier » qui révèle le champ | Un drapeau `touched` pour qu'un identifiant édité à la main cesse de suivre le nom. |
| 4 · Qui peut entrer | `signupPolicy` puis `workspaceCreation`, défauts pré-sélectionnés | « Invitation seule — personne ne crée de compte sans y être invité. Modifiable à tout moment dans Réglages → Instance → Accès. » |

Au terme : « Un code a été envoyé à … », et **enchaînement direct sur l'étape
code de la connexion**, adresse pré-remplie. Pas de page de félicitations.

Deux pièges : ne jamais faire confiance à un `setupRequired` mis en cache
(re-fetch avant de rendre) ; et `run()` (`cloud/index.ts:73-78`) désactive *tous*
les boutons puis les réactive *tous* — avec un assistant qui en a de
légitimement désactivés, il les ressuscite. Mémoriser l'état avant, le restaurer
après.

### 9.3 La rubrique « Instance » des réglages

Un `data-desktop-settings-nav-heading` « Instance » s'ajoute après « Espace »
(`settings.ts:241`), construit **uniquement** si `session.user.instanceAdmin` —
même motif que `if (admin) navList.append(membersTab)` (`:242`). Jamais de
rendu-puis-masquage. `createDesktopFooter` étant synchrone et le drapeau
asynchrone, les entrées s'ajoutent après résolution, ce qui fait **perdre son
`as const` à `navEntries`** (`:243-247`).

Refactor préalable obligatoire : `showPanel` (`:329-335`) pose `aria-current` à
la main sur sept onglets ; avec cinq de plus, c'est de la copie. Le remplacer
par une `Map<SettingsPanel, HTMLButtonElement>` et une boucle. Le corps des
panneaux va dans `instance/instance-settings.ts`, `settings.ts` restant une
coque — comme `mountAiSettings`, `mountMcpSettings` et `mountWorkspaceMembers`.

| Panneau | Contenu |
| --- | --- |
| Général | Nom (éditable) · adresse publique et versions (lecture seule) · « Administrée par … » |
| Accès | `signupPolicy` et `workspaceCreation` en `createChoice`, **chaque option portant sa conséquence en une phrase**. Enregistrement immédiat ; échec ⇒ retour à la valeur serveur |
| Comptes | Table : adresse, nom, date, nombre d'espaces. Menu « … » → Promouvoir · Supprimer (destructif, confirmé) |
| Espaces | Table : nom, identifiant, membres, date. **Aucun accès au contenu** |
| Santé et e-mail | Trois lignes pastille + texte (base, fichiers, envoi) · expéditeur configuré · **« Envoyer un e-mail de test »**, résultat en ligne et erreur SMTP sous `<details>` |

Le bouton d'e-mail de test est la pièce la plus utile du lot : aujourd'hui un
SMTP mal réglé ne se découvre qu'au premier login raté, derrière un 503 opaque,
avec le diagnostic enfoui dans `docker compose logs app`.

**Piège** : une confirmation ouverte depuis un panneau Instance est une modale
*dans* la modale de réglages — il faut passer `container: dialog`, comme le fait
déjà `openWorkspaceInvitation`, sinon `inert` piège le focus.

## 10. La prise en main

### 10.1 La page de bienvenue est un document de blocs

Pas une vue spéciale — loi « Everything is a block » de `CLAUDE.md`. Elle est
posée par `POST /api/workspaces/:slug/pages/:id/seed` (`documents.go:547`), qui
prend déjà un `OutputData` complet : le contenu est une fixture JSON côté
client, à l'image des *starters* de base de données
(`src/tools/database/database-starters.ts`), seul patron de galerie de modèles
du dépôt — à généraliser plutôt qu'à dupliquer.

Son contenu reprend la forme de la page « Welcome to Notion », mais enseigne les
gestes **de Blok**, chacun vérifiable en une action : une liste à cases (taper
`/` pour la boîte à outils · glisser un bloc par sa poignée · `Tab` pour
imbriquer · `@` pour mentionner une page ou une date · le bouton **Partager**),
un lien vers une sous-page « Droits et partage » (§11), et une base de données
d'exemple montée avec un starter existant.

**Où le semis se déclenche** : pas dans le gateway, qui n'a ni repository ni
éditeur, mais dans `desktop/src/workspace.ts` sur le chemin
`showEmptyWorkspace()`. Condition : index vide, jamais semé, et pas un `viewer`.

**Piège** : deux membres ouvrant l'espace vide en même temps créeraient deux
copies, que `workspace-merge.ts` garderait toutes les deux. D'où un **identifiant
déterministe** `welcome-<workspaceId>`, que la fusion dédoublonne. Un semis en
échec retombe silencieusement sur l'état vide.

### 10.2 L'état vide

`createEmptyWorkspaceState` garde son nom — ses deux tests existants restent
vrais — et gagne trois cartes de démarrage : *Créer une page* · *Partir d'un
modèle* · *Inviter des personnes*, plus deux liens discrets. Pour un lecteur :
« Aucune page n'est partagée avec vous pour le moment », **sans bouton de
création** (garantie existante à ne pas casser).

### 10.3 La surface d'aide

Elle se branche sur le menu de pied de barre latérale déjà construit par
`createDesktopFooter` (`settings.ts:131`), à côté de « Paramètres » : une entrée
**Aide** ouvrant un `PopoverDesktop` — *Premiers pas* (rouvre la page semée) ·
*Qui peut voir quoi* (ouvre la page Droits) · *Raccourcis clavier* · *Signaler un
problème* (`mailto:` vers l'administrateur d'instance) · la ligne de version.

Pas de tour guidé, pas de `?` flottant en bas à droite : la place est prise par
le bouton de l'assistant (`workspace.ts:671`), et un tour qui s'impose au
premier lancement est exactement ce que les enregistrements Notion montrent de
plus fatigant.

### 10.4 L'écran d'acceptation d'invitation

C'est l'écran manquant que les enregistrements rendent évident (§17). Il nomme
l'hôte, l'espace, le rôle reçu et le message, avec deux cas d'erreur
explicites : adresse connectée différente de l'adresse invitée (« Cette
invitation est pour autre@x.fr, vous êtes connecté comme vous@x.fr » + changer de
compte), et invitation expirée ou révoquée.

## 11. Rendre les droits lisibles

Le modèle est fin — trois rôles d'espace, trois niveaux de page, un plafond et
un héritage — et il n'est expliqué **nulle part** dans l'interface.

Source unique : `desktop/src/access-vocabulary.ts` (`WORKSPACE_ROLES`,
`PAGE_LEVELS`, `roleOptions`), qui remplace les trois dictionnaires existants
(`cloud/index.ts:41`, `workspace-settings.ts:22`, ternaire `settings.ts:381`) et
`levelNames` de `share-sheet.ts:17`.

Levier clé, déjà présent : les items de `PopoverDesktop` acceptent une
`description` en seconde ligne. Il suffit d'ajouter `description?: string` à
`ChoiceOption` (`desktop/src/ui/controls.ts`) et de la propager — **les cinq
sélecteurs de rôle et de niveau expliquent alors le rôle au moment du choix**,
sans aucun écran nouveau.

Trois autres endroits : l'en-tête du panneau Membres ; l'écran d'acceptation
d'invitation ; et surtout la **feuille de partage**, où il faut nommer le cumul :

> « Les droits d'une page s'ajoutent à ceux de l'espace : un lecteur de l'espace
> ne peut pas modifier une page, même partagée en modification. »

C'est le seul endroit où l'interface ment aujourd'hui. `share-sheet.ts` connaît
`myLevel` mais n'expose jamais le plafond par rôle, alors que le serveur
l'applique : `capOf` (`permissions.go:58`) plafonne un `viewer` à `view` quel
que soit le partage reçu.

## 12. Déploiement et documentation

- **Inverser les obligations dans `compose.yaml`.** Aujourd'hui
  `PUBLIC_URL: https://${DOMAIN:-blok.tousamba.cloud}` (`:28`) a un défaut
  silencieux, alors que `BOOTSTRAP_ADMIN_EMAIL: ${…:?}` (`:35`) est obligatoire —
  exactement l'inverse de ce qu'il faut. `DOMAIN` et `MAILER_FROM_EMAIL` passent
  en `${VAR:?}` ; `BOOTSTRAP_ADMIN_EMAIL` passe en `:-`, sinon le chemin
  « variable vide → assistant » ne peut jamais démarrer.
- `.env.example` et `Caddyfile` perdent `tousamba.cloud`,
  `smtprelay.nexenture.fr` et `blok@nexenture.fr`.
- `install.sh` devient interactif (domaine, SMTP, mode de setup) avec un repli
  `--non-interactive`, au lieu du script à deux passages actuel, qui ne vérifie
  jamais que `.env` a été édité.
- Ajouter `deploy/prepare.sh`, documenté au `README.md:72` mais **absent du
  dépôt** — il n'existe que dans `work/release-image-smoke/`. Et `stack.sh:4` a
  `-f compose.yaml` en dur, donc le chemin « images préconstruites » exige
  aujourd'hui un renommage manuel.
- `backup.sh` doit inclure `.env` : sans lui, perdre le fichier c'est perdre
  `TICKET_SECRET`, `INTERNAL_SECRET` et `AI_ENCRYPTION_KEY`, donc toutes les
  clés OpenAI chiffrées.
- `compose.demo.yaml:35` force `BOOTSTRAP_ADMIN_EMAIL: admin@example.test` : le
  passer en `${BOOTSTRAP_ADMIN_EMAIL-admin@example.test}` et ajouter
  `./deploy/demo.sh start --setup`. **Sans cela, l'assistant n'est testable
  qu'en production.**
- `deploy/README.md` cesse de s'intituler « Blok pour Tousambassadeurs » et de
  renvoyer vers une branche privée ; une page self-host entre dans `docs/`, qui
  n'en a aucune — `docs/src/routes/server.tsx` ne parle que de la bibliothèque
  `@bloklabs/server`, pas de l'application cloud.

## 13. Livraison

Chaque lot est une branche, se relit seul, et laisse le produit cohérent. **Le
test est écrit d'abord et vu ÉCHOUER** avant le code.

### Backend — `apps/service/`

| # | Lot | Fichiers | Test qui échoue d'abord |
| --- | --- | --- | --- |
| B1 | Réglages d'instance, cache atomique, sonde publique | `schema.sql` (mig. 5), **`instance.go`**, `service.go` | défauts stricts sur base neuve · `settings()` ne tape pas Postgres · l'écrivain voit son écriture · **le réglage survit à un redémarrage** |
| B2 | Administrateurs d'instance, drapeau de session, `PATCH settings` | `instance.go`, `service.go` | 403 non-admin sur chaque route · 409 dernier admin · `instanceAdmin` dans `/api/session` |
| B3 | Bootstrap refondu : chemin env, jeton, routes de setup, migration | `service.go` (remplace 102-121), **`setup.go`**, `config.go` | base neuve ⇒ `setupRequired` + fichier `0600` · jeton faux 403 · double revendication 409 · base héritée ⇒ `setupRequired:false` · **`service_test.go:482-500` reste vert** |
| B4 | Politique d'inscription | `auth.go`, `instance.go` | adresse inconnue sur-invitation ⇒ 200 **et aucun mail délivré** · politique basculée pendant la validité du code ⇒ 401 · les deux chemins consomment le même quota |
| B5 | Politique de création d'espaces, espace par défaut | `workspaces.go`, `instance.go` | les trois modes · la route admin contourne `disabled` |
| B6 | Listes d'administration, test de délivrabilité | **`admin.go`**, `mail.go` | **aucun identifiant ni titre de page dans la charge utile** · `mailBackend()` suit l'ordre de `send()` |
| B7 | `blokctl` | `cmd/blokctl/`, `instance.go` | `grant` crée et promeut · `revoke` refuse le dernier · refus sur schéma périmé · n'ouvre ni Blok ni MCP |
| B8 | Retrait du `tousambassadeurs` codé en dur | `service.go`, `config.go`, les `*_test.go`, `deploy/*` | instance neuve ⇒ zéro espace · le couple d'env reproduit le comportement d'aujourd'hui |

**Enchaînement :** B1 → B2 → {B3, B4, B5} → B6 → B7 → B8. B8 vient en dernier
parce que `cloud/index.ts:123` doit d'abord lire `/api/instance.defaultWorkspace`.

### Client — `desktop/src/`

| # | Lot | Test qui échoue d'abord |
| --- | --- | --- |
| C1 | **Socle UI** : `ui/dom.ts` (`el`/`button`/`field` à **options nommées**), `ui/avatar.ts`, `ui/empty-state.ts`, `ui/people-table.ts`, `ui/feedback.ts`, `access-vocabulary.ts` | les libellés de rôle sont **identiques à ceux affichés aujourd'hui** |
| C2 | **Gateway dé-marqué + routeur**, suppression d'`admin()`, erreurs nommées | **`gateway.test.ts` passe sans qu'une assertion de comportement change** · test d'architecture : zéro occurrence de la marque sous `desktop/src` |
| C3 | **Assistant + entrées d'espace** : `setup`, `unreachable`, `create-workspace`, `join`, `invite` | `setupRequired` monte l'assistant et **jamais** un formulaire de connexion · serveur injoignable ⇒ écran dédié |
| C4 | **Rubrique « Instance »** des réglages | la rubrique est **absente du DOM** pour un non-admin |
| C5 | **Droits lisibles** | aucun libellé de rôle écrit en dur hors du module · la ligne de cumul figure dans la feuille de partage |
| C6 | **Prise en main** | semis une seule fois, identifiant déterministe, un `viewer` ne sème pas · **les deux tests existants de `workspace-empty` restent verts** |

**Enchaînement :** C1 → C2 → {C3, C4} → C5 → C6. C4 et C6 touchent tous deux
`createDesktopFooter` : jamais en parallèle.

Le socle C1 **ajoute** ses modules sans migrer d'appelant, sauf le vocabulaire
des rôles, qui est mécanique. Règle ensuite : *un lot ne migre vers `ui/dom.ts`
que les fichiers qu'il touche déjà*. Aucun commit « grande migration ».

## 14. Les quatre pièges qui coûtent le plus

1. **`schema.sql` est rejoué EN ENTIER à chaque démarrage.** Le rattrapage des
   politiques pour l'existant doit être gardé par `NOT EXISTS(… version=5)`,
   sinon chaque redémarrage écrase le choix de l'administrateur. Cela mérite son
   propre test : démarrer, changer le réglage par l'API, redémarrer, vérifier
   qu'il tient.
2. **Le cache de réglages ne doit pas répondre à la question une-seule-fois.**
   Politique ⇒ pointeur atomique ; revendication du setup ⇒ `FOR UPDATE`. Les
   confondre rouvre la revendication.
3. **`workspace_creation='disabled'` + `signup_policy='invite'` + zéro espace =
   instance morte.** L'assistant crée le premier espace au moment où il pose
   `disabled`, et `/api/instance` rend honnêtement `defaultWorkspace:null` pour
   que l'interface le dise.
4. **La promotion héritée doit rester étroite.** Limitée aux `admin` de
   l'**espace par défaut**, jamais de tous les espaces — sinon une instance
   multi-espaces montée à la main promeut une poignée de gens d'un coup. À
   journaliser nommément.

## 15. Tests

**Go** — `./apps/service/test.sh`, qui lance la suite dans un conteneur Go sans
toolchain locale, avec un PostgreSQL jetable :

```sh
docker run -d --name blok-test-pg -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=blok_test -p 55432:5432 postgres:17-alpine
./apps/service/test.sh
```

**Client** — `cd desktop && yarn test`. **Projet** — `yarn lint` et `yarn test` à
la racine, en gate final.

**Intégration navigateur réelle** — `desktop/src/cloud/browser-e2e.mjs` existe
déjà : Playwright contre un vrai service, sans aucun mock d'API ni de session,
en lisant les codes dans le répertoire de mail de développement. C3, C4 et C6 y
ajoutent chacun un parcours plutôt que de créer un second harnais. Locators
sémantiques ou `data-blok-testid` uniquement, jamais de sélecteur de classe.

**Bout en bout sur la démo** — c'est le seul test qui prouve ce document :

```sh
./deploy/demo.sh stop
docker volume rm blok-local_state blok-local_postgres   # l'état du setup vit en base
./deploy/demo.sh start --setup
```

1. `http://localhost:8088` affiche l'assistant, pas le gateway.
2. `docker compose exec app cat /data/setup-token` donne le jeton ; l'étape 2
   doit pouvoir envoyer un e-mail de test **avant** de rien créer.
3. La revendication crée l'espace et envoie un code ; la boîte locale
   (`:8089`) le donne ; l'app s'ouvre sur la page de bienvenue.
4. Réglages → Instance → Accès : passer en `invite`. Une adresse tierce qui
   demande un code reçoit `{ok:true}`, **aucun mail n'arrive**, et aucun compte
   n'apparaît dans Instance → Comptes.
5. Passer `workspace_creation` à `disabled` : le gateway explique au lieu de
   griser, et `POST /api/workspaces` répond 403.
6. Instance → Santé : l'e-mail de test arrive ; couper le SMTP et rejouer doit
   montrer l'erreur réelle, pas un 503 opaque.
7. Inviter une seconde adresse : l'invité voit un écran nommant l'hôte, l'espace
   et son rôle — pas une adhésion silencieuse.
8. Arrêter puis relancer : l'instance ne repasse **jamais** par l'assistant, et
   le réglage modifié à l'étape 4 **tient**.

## 16. Comparaison Blok / Notion / AFFiNE

Les lignes AFFiNE sont vérifiées dans son dépôt le 14 novembre 2026 (§17).

| | Blok aujourd'hui | AFFiNE | Après ce document |
| --- | --- | --- | --- |
| Rôle serveur | **aucun** | admin d'instance, console `/admin` | `instance_admins` |
| Assistant de premier démarrage | **aucun** (variable d'env, une fois à vie) | `/admin/setup`, 3 étapes | route `setup` du gateway, 4 étapes, protégée par jeton |
| Politique d'inscription | **aucune** (ouverte à tous) | `allowSignup`, `allowSignupForOauth`, `requireEmailDomainVerification` | `signup_policy` ∈ `invite` · `domain` · `open`, défaut `invite` |
| Création d'espaces | libre, 10/heure | libre, sans garde de rôle | `workspace_creation` ∈ `anyone` · `admins_only` · `disabled` |
| Rôles d'espace | `admin` · `member` · `viewer` | `Owner 99` · `Admin 10` · `Collaborator 1` · `External -99` | inchangé |
| Rôles de document | `full` · `edit` · `view` + visibilité | `Owner 99` · `Manager 30` · `Editor 20` · `Commenter 15` · `Reader 10` · `External 0` | inchangé ; `comment` viendra avec les commentaires |
| Quotas par espace | **aucun** | stockage, taille de blob, sièges, rétention d'historique | hors périmètre |
| Partage public d'un document | **aucun**, interdit jusque dans le `CHECK` SQL | publication par le rôle `Manager` | hors périmètre |
| Journal d'audit | **aucun** | — | hors périmètre, prérequis de tout accès admin au contenu |
| Console de files de jobs | **aucune** | QueueDash sur BullMQ | hors périmètre (pas de file de jobs dans Blok) |

**Ce que Blok a en plus, et qu'il faut préserver** — ces quatre points sont des
acquis, pas des détails :

- l'héritage de visibilité le long de la chaîne des parents, avec **fermeture
  par défaut** sur une chaîne cassée, cyclique ou trop profonde ;
- la séparation stricte **plafond / base** (`capOf` vs `baseOf`) : un
  administrateur d'espace n'atteint pas une page privée d'autrui, et ce n'est
  pas une politique mais une propriété de la formule ;
- la **révocation en direct** des sessions de collaboration, en moins de cinq
  secondes, sans rechargement ;
- la **loi d'architecture AST** qui empêche toute nouvelle route de lire `pages`
  ou `assets` sans garde, exemptions motivées comprises.

Noter aussi une divergence d'architecture assumée : AFFiNE déplace ses décisions
de permission vers Rust (`permission/types.ts` porte le commentaire « Action
names for Node callers; Rust owns permission decisions »), là où Blok les garde
en Go dans `permissions.go`, prouvées par une table de vérité unitaire.

## 17. Sources

### Notion

Pages d'aide consultées le 14 novembre 2026 :

- [Intro to workspaces](https://www.notion.com/help/intro-to-workspaces) — les
  sections de barre latérale (Teamspace, Shared, Private, Favorites), le
  commutateur d'espaces en pied de barre, le réglage *Allowed Email Domains* qui
  conditionne l'auto-inscription, et le fait qu'un plan payant ne couvre **qu'un
  espace**, pas le compte entier.
- [Manage members, admins & guests](https://www.notion.com/help/add-members-admins-guests-and-groups)
  — les rôles assignables (Workspace owner, Membership admin, Member), les
  membres temporaires et les invités, et la facturation par membre.

Les six pages qui fondent le modèle de permissions lui-même — niveaux de
partage, règle du droit le plus large, dérivation des sections de barre
latérale, *admin content search*, transfert des pages privées d'un membre
parti — sont citées au §11 de
`docs/plans/2026-11-13-page-permissions-design.md` et ne sont pas redonnées ici.

### Enregistrements d'écran analysés le 14 novembre 2026

Trois captures du parcours Notion, de l'inscription à l'arrivée d'un invité.
Elles motivent directement trois décisions de ce document :

1. **Inscription et prise en main** (1 min 14 s) — code de vérification,
   personnalisation du profil, choix d'usage, promotion de l'app desktop, puis
   un espace pré-rempli : page « Welcome to Notion » avec sa liste à cases,
   base « To Do List », teamspaces, et un tour guidé *sautable*. → §10.1.
2. **Invitation d'un membre** (25 s) — le sélecteur de rôle affiche `Member`
   avec un badge **Plus** : sur le plan gratuit, on ne peut inviter qu'en
   *Workspace owner*. C'est la démonstration qu'un rôle dont le libellé ment sur
   sa disponibilité est pire que son absence. → §11.
3. **Arrivée de l'invité** (41 s) — le lien annonce « connectez-vous pour voir
   **cette page** », mais l'invité atterrit sur une barre latérale vide, sans
   jamais savoir qui l'a invité. Le champ e-mail accepte silencieusement un code
   collé et répond « adresse non valide ». → §10.4.

### AFFiNE

Dépôt [toeverything/AFFiNE](https://github.com/toeverything/AFFiNE), branche
`canary`, consulté le 14 novembre 2026. Chaque chemin ci-dessous a été ouvert et
vérifié ; aucun n'est cité de mémoire.

- [`packages/frontend/admin/src/modules`](https://github.com/toeverything/AFFiNE/tree/canary/packages/frontend/admin/src/modules)
  — la console d'administration, découpée en `about`, `accounts`, `auth`,
  `dashboard`, `nav`, `panel`, `settings`, `setup`, `workspaces`. C'est la forme
  que nous **n'adoptons pas** : notre administration vit dans la modale de
  réglages du client (§3), parce que Blok n'a pas de front d'administration
  séparé à maintenir.
- [`packages/backend/server/src/models/common/role.ts`](https://github.com/toeverything/AFFiNE/blob/canary/packages/backend/server/src/models/common/role.ts)
  — `WorkspaceRole` : `External -99`, `Collaborator 1`, `Admin 10`, `Owner 99`.
  `DocRole` : `None -(1 << 15)`, `External 0`, `Reader 10`, `Commenter 15`,
  `Editor 20`, `Manager 30`, `Owner 99`. Les poids numériques jouent le même
  rôle que notre ordre total `levelNone < levelView < levelEdit < levelFull`.
- [`packages/backend/server/src/core/auth/config.ts`](https://github.com/toeverything/AFFiNE/blob/canary/packages/backend/server/src/core/auth/config.ts)
  — l'interface `AuthConfig` déclare `allowSignup`, `allowSignupForOauth` et
  `requireEmailDomainVerification` ; leurs valeurs viennent des descripteurs du
  module natif. Le fichier définit en propre `signInRateLimit`
  (`{ttl: 60_000, ipLimit: 20, emailLimit: 5}`), `passwordRequirements` et
  `trustedCloudflareHeaders`. À comparer à nos limites de `auth.go:31`.
- [`packages/backend/server/src/core/permission`](https://github.com/toeverything/AFFiNE/tree/canary/packages/backend/server/src/core/permission)
  — `permission-map.ts`, `types.ts`, `service.ts`, `builder.ts`, `resource.ts`.
  `types.ts` ne fait que ré-exporter les rôles depuis `models` et porte le
  commentaire « Action names for Node callers; Rust owns permission decisions ».

### Blok

- `docs/plans/2026-11-13-page-permissions-design.md` — le modèle de permissions
  par page sur lequel tout ce document s'appuie, et dont le §8 place l'accès
  administrateur au contenu et le journal d'audit hors périmètre.
- `docs/plans/2026-08-22-backend-service-design.md` — la conception d'origine du
  service, et la distinction entre `packages/server` (bibliothèque sidecar) et
  `apps/service` (application cloud).

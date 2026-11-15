# Dépendances serveur : connexions GitHub et GitLab personnelles

Spécification d'intégration, 15 novembre 2026. **Aucun connecteur GitHub/GitLab serveur n'est livré ici.** Aucun compte n'a été connecté ni requête authentifiée envoyée. Priorité de cette livraison : permissions de pages, icône workspace, recette d'équipe. La tâche frontend peut préparer le parcours ; une interface ne doit pas annoncer une connexion enregistrée avant existence du backend.

## État existant inspecté

Le service sait chiffrer des credentials OpenAI avec AES-GCM et nonce aléatoire (`ai_crypto.go`), une clé d'instance persistée dans `/data/ai-key` ou fournie par configuration, et des données associées liées au propriétaire. `ai_credentials` distingue personnel / workspace. Le client HTTP IA (`ai.go`) vise des endpoints OpenAI fixes, a un timeout et refuse les redirects. Les tests IA couvrent isolation des propriétaires, chiffrement et refus des redirects. Ces briques inspirent le connecteur ; elles ne constituent pas un stockage de tokens Git ni un proxy arbitraire sécurisé.

L'upload d'assets appartient au stockage de pages, avec un autre contrat. Ne pas réutiliser aveuglément un proxy d'images ou le client OpenAI pour exécuter des URLs de dépôts fournies par un utilisateur.

## Contrat backend proposé, à valider avec le contrat frontend

Une connexion est **personnelle et propre au serveur Blok**. Nouvelle table `source_connections` : `id`, `user_id` FK, `provider github|gitlab`, `label`, `web_origin`, `api_base`, `encrypted_token`, `created_at`, `updated_at`, `last_verified_at`. Déduire l'origine et la racine API en configuration validée ; ne jamais prendre un endpoint libre à chaque requête. Ajouter des permissions/scopes constatés comme métadonnées informatives, pas comme preuve d'autorisation permanente. Pas de secret dans les listes, logs, erreurs ou contenu IA.

Routes proposées (non implémentées) :
- `GET /api/connections` : métadonnées uniquement pour l'utilisateur connecté.
- `POST /api/connections` : provider, origin, label, token ; vérification d'identité fournisseur avant sauvegarde et chiffrement.
- `PATCH /api/connections/{id}` : étiquette ou rotation du token ; changement d'origine = revalidation et nouveau secret, jamais réutilisation du token de l'origine précédente.
- `DELETE /api/connections/{id}` : suppression locale, sans promettre révoquer le token chez le fournisseur.
- `POST /api/connections/{id}/read` : ressource typée repo/file/issue/pull-request/merge-request et IDs/chemins validés ; lecture bornée, aucun proxy URL générique, aucune mutation fournisseur.

Chaque requête SQL porte `WHERE id=$id AND user_id=$caller`. Admin instance et admin workspace ne peuvent lister ou utiliser les secrets d'un autre compte. Le chiffrement doit lier `instance + provider + origin + connectionID + userID` dans les données associées ; une ligne déplacée ne devient pas un credential valide. Les caches et extraits sont indexés par utilisateur et connexion, avec durée de vie et purge à la déconnexion. Les limites du token fournisseur restent la deuxième frontière d'autorisation, revérifiée à chaque lecture.

GitHub recommande les tokens fins avec permissions des endpoints choisis ; les tokens agissent au nom du propriétaire. [Authentification REST officielle GitHub](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api). GitLab accepte notamment tokens personnels et OAuth ; l'API et le scope exact dépendent de l'endpoint, avec `read_api` utilisable pour de nombreuses lectures. [Authentification REST officielle GitLab](https://docs.gitlab.com/api/rest/authentication/). Demander seulement la lecture requise ; un token admin global n'est pas un prérequis produit.

## Self-host et réseau

Accepter GitHub Enterprise et GitLab Self-Managed avec origine HTTPS personnalisée et racine API définie par le type de fournisseur. Les instances GitLab installées sous un préfixe de chemin doivent avoir une base API canonique explicite validée ; ne pas imposer uniquement les domaines SaaS.

Le self-host privé est voulu : ne pas refuser toute IP privée de façon arbitraire. Prévoir une liste **administrateur d'instance** d'origines self-host autorisées et des CIDR de destination autorisés pour celles-ci. Les utilisateurs ordinaires ne doivent pas pouvoir transformer une connexion en accès au réseau interne de Blok. Pour une origine non approuvée, seules les adresses publiques sont admissibles. Refuser loopback, link-local, metadata cloud et endpoints de l'instance Blok ; les adresses privées d'une origine approuvée doivent rester dans les CIDR explicitement autorisés.

Résoudre DNS, vérifier toutes les adresses et épingler la connexion aux adresses validées au moment du dial (protection contre rebinding), tout en gardant le bon nom TLS. TLS validé ; autorité privée ajoutée par l'admin au trust store, pas de `InsecureSkipVerify`. Refuser userinfo, fragments, protocole HTTP et ports imprévus. Un administrateur peut définir un port HTTPS personnalisé dans l'origine approuvée.

Ne suivre **aucun redirect authentifié**, même vers un sous-domaine supposé apparenté ; demander une correction explicite de l'origine. Le token ne part qu'à l'origine/API configurée, dans l'en-tête fournisseur. Pagination : reconstruire les pages autorisées ou valider exactement origine et préfixe API avant de suivre Link/next. Pas de secret dans query string. Borner timeout, taille de réponse, nombre de pages, débit par utilisateur et concurrence.

## Contenu remis à l'IA et au MCP

Présenter les sources et extraits choisis avant transmission au modèle. La lecture du dépôt ne signifie pas publication automatique dans le workspace : une page IA naît privée sauf destination/audience explicitement choisie. Une page partagée contenant un extrait devient accessible à son audience Blok, même aux personnes sans accès Git : afficher ce changement de portée. Une révocation Git future n'efface pas rétroactivement un texte déjà publié ; provenance et suppression doivent être gérables.

Les outils MCP transmettent l'identité de l'appelant, puis recherchent sa connexion personnelle ; pas de token de service global. Ils ne retournent que le contenu auquel le fournisseur autorise cet appelant. Ne jamais transmettre un token fournisseur au modèle. Traiter README, issues et commentaires comme données non fiables, pas comme instructions capables d'accorder d'autres accès, d'exfiltrer des secrets ou d'autoriser une écriture distante.

## Tests bloquant l'activation

Avant livraison de routes réelles : PostgreSQL isolé + deux utilisateurs ; lecture/rotation/suppression croisée refusée, ligne chiffrée illisible après changement owner/origin, aucun token dans les réponses. Serveurs HTTPS de test pour SaaS simulé, self-host sur port spécifique, autorité privée, redirects tiers, pagination externe, URL userinfo, DNS rebinding, destinations internes refusées et CIDR self-host autorisé. Tests 401/403/404/429 fournisseur, réponses volumineuses et timeout. Vérifier l'absence de requête de mutation fournisseur. Tester outils MCP avec l'identité de Bob contre une connexion Alice et une source devenue inaccessible.

Découpage : contrat partagé frontend/backend ; modèle chiffré + routes personnelles ; transport HTTP testé ; lecteurs typés ; sélection/provenance IA ; MCP. L'activation UI attend ces tests. Les garanties de réseau ci-dessus sont des critères de réalisation, pas des protections déjà implémentées pour un connecteur inexistant.

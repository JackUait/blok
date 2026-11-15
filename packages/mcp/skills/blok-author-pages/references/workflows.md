# Workflows de rédaction

## Résumer une source

Lire la source avant de la résumer. Séparer faits sourcés, déductions et propositions. Commencer par la conclusion utile, puis les points qui la justifient et la prochaine action éventuelle. Ne pas inventer un responsable, une date, une métrique ou une citation.

Conserver près des affirmations importantes un lien vers leur source précise. En fin de page, indiquer titre de source, auteur/organisme si connu, URL ou référence du fichier, date de publication si connue et date de consultation. Pour un contenu fourni sans provenance : « Notes fournies — auteur/date non indiqués ». Mentionner les lacunes ou contradictions qui pourraient changer la décision dans une section visible « À confirmer ». Dater les informations susceptibles de changer. Une reformulation IA n'est pas une source primaire.

## Transformer un texte en titres et toggles

Repérer l'idée de chaque section et lui donner un `header` de niveau cohérent. Mettre juste dessous sa conclusion en paragraphe. Créer un `toggle` pour une méthode, une preuve longue, une FAQ ou une annexe, avec les paragraphes enfants reliés au toggle par la position/parent que décrit `block.insert`.

Ne pas mettre l'intégralité de la page dans des toggles. Une échéance, une décision, un blocage ou une incertitude déterminante doit se voir sans ouvrir un volet. Ne pas écrire `isOpen` pour imposer un état : il est personnel et non sauvegardé. Pour transformer un titre existant en titre repliable, consulter `block.convert` ; écrire directement `isToggleable` peut contourner la gestion des enfants.

## Tableau simple ou database

| Besoin du lecteur | Forme à choisir |
| --- | --- |
| Lire quelques comparaisons stables selon les mêmes critères | `table.create`, avec vrais en-têtes |
| Lire une suite d'étapes ou une explication | Liste ou paragraphes |
| Suivre des éléments qui évoluent, filtrer, trier, changer de vue | `database.create` et actions de propriétés/vues/lignes |

Un tableau simple n'est pas une database : il ne crée ni propriétés typées ni vues. Éviter les cellules contenant de longs paragraphes. Découvrir `table.create` et sa structure `cells` de lignes, colonnes et segments.

Pour un suivi : décrire `database.create`, créer la base, **relire** son `schema` et ses `views`. La création intégrée ajoute Title et Status ; réutiliser leurs ids, sans supposer leur nom ni en ajouter des doublons. Décrire `database.addProperty`, puis ajouter seulement les champs nécessaires : date si une échéance existe, responsable si l'identité est résolue, statut si le suivi le demande. Utiliser les ids retournés pour les valeurs, jamais les libellés de colonnes. Décrire `database.addRow` et les formes des valeurs avant de remplir.

Choisir une vue table pour la revue détaillée, board pour un flux par statut ; calendar nécessite une propriété date adaptée. Ajouter une seconde vue uniquement si elle sert une question distincte. Lire la configuration avant `database.updateView` : plusieurs champs remplacent toute une liste. Ne pas déverrouiller une base ou publier un formulaire sans l'approbation requise. Le choix de la forme n'autorise aucune invitation ou notification réelle.

## Images

Découvrir le bloc `image` et le moyen d'upload disponible. Le cloud peut fournir `blok_upload_image` ; le CLI n'a pas cet outil. Les actions `image.uploadFile` nécessitent un uploader hôte ; sinon utiliser une URL durable déjà autorisée. Éviter les URL `blob:` temporaires. Ne pas transmettre un fichier à un service supplémentaire sans que la tâche l'autorise.

Insérer `url`, `alt` descriptif, `caption` en texte brut et `captionVisible: true` si cette clé est exposée. La légende explique l'intérêt de l'image et sa provenance ; ajouter un paragraphe contenant un vrai lien de source/crédit/licence lorsque connu. L'alt décrit ce que montre l'image, pas une répétition des crédits. Signaler une illustration IA et ne pas la présenter comme preuve. La relecture vérifie les métadonnées, pas l'accessibilité réseau ni le rendu : contrôler dans l'app si nécessaire.

## Schémas

Ce checkout propose Mermaid par un bloc `code` avec `language: "mermaid"` et `code` brut sans fences. Il n'existe pas de type `mermaid` dans le manifeste intégré. Décrire `code`, puis vérifier le rendu de l'hôte : le MCP accepte les données mais ne compile pas Mermaid et ne garantit pas sa validité visuelle.

Utiliser un schéma pour montrer une relation, un parcours ou un ordre qui serait moins clair en prose. Garder peu de nœuds et des libellés courts, puis ajouter une phrase qui explique le message. Si Mermaid est absent ou ne s'affiche pas, une liste d'étapes suffit ; utiliser une image avec alt/légende seulement si elle apporte quelque chose. Ne pas annoncer un diagramme rendu sur la seule foi du succès de `blok_execute`.

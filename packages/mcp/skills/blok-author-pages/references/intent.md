# Du besoin au contenu

Le choix des blocs vient après le choix de ce que le lecteur doit comprendre ou pouvoir faire. Ce cadrage est un raisonnement de rédaction, pas un formulaire obligatoire ni une fonction de recherche ajoutée au serveur MCP.

## Cadrer sans ralentir

Chercher dans la demande, la conversation et les sources déjà accessibles :

- **Résultat** : comprendre un sujet, réaliser une tâche, comparer des options ou contrôler une situation existante.
- **Lecteur et profondeur** : découverte, prise en main technique ou référence détaillée. Ne pas déduire le niveau de la seule orthographe de la demande.
- **Périmètre et preuves** : dépôt/version, système concerné, documents fournis, sources officielles à vérifier.
- **Livrable** : réponse dans le chat, page pédagogique, procédure, comparaison ou suivi ; destination lorsqu'une écriture est demandée.

Ne pas redemander une information déjà donnée. Si l'incertitude change fortement le contenu, poser une seule question utile, avec deux ou trois choix. Exemple : « Tu veux découvrir le sujet ou l'appliquer à la gestion des données dans Blok ? » Continuer à lire les sources indépendantes de la réponse. Si le contexte suffit, annoncer brièvement l'hypothèse puis rédiger. Ne pas demander systématiquement l'approbation d'un plan.

## Exemple : comprendre la codebase de Blok

« Fais-moi une doc pour comprendre la codebase de Blok » demande un parcours de compréhension, pas un inventaire de fichiers. Partir du dépôt réellement accessible et de sa révision connue. Si le dépôt manque, demander son accès ou sa localisation ; ne pas fabriquer une architecture à partir du nom du produit.

Progression possible, adaptée aux sources : rôle du produit → grands composants et responsabilités → parcours concret d'une action utilisateur jusqu'à la persistance → fichiers à lire dans cet ordre → exemple expliqué → limites et pistes pour poursuivre. Montrer les relations avec un schéma seulement si le contrat et l'hôte le permettent. Séparer le comportement vérifié, les déductions et les fonctionnalités simplement prévues.

Un lecteur qui veut contribuer aura besoin de points d'entrée, commandes vérifiées et tests pertinents. Un lecteur qui veut seulement comprendre n'a pas besoin d'une longue procédure d'installation. Citer les chemins et la révision ; ne pas recopier les secrets ou données personnelles présents dans les fichiers.

## Exemple : comprendre le RGPD ou gérer des données

« Qu'est-ce qu'une donnée privée ? » peut appeler une réponse courte avec exemples avant toute page. Clarifier le vocabulaire courant et les catégories juridiques au moyen de sources officielles actuelles. Ne pas assimiler automatiquement données personnelles, catégories sensibles et informations confidentielles.

« Fais-moi une documentation pour comprendre le RGPD » appelle une introduction progressive : vocabulaire, exemples et contre-exemples, principes utiles et application illustrative. Consulter les textes officiels et les autorités compétentes, avec liens précis et date de vérification. Ne pas présenter une reformulation IA comme source.

« Comment doit-on gérer les données dans Blok ? » appelle une analyse appliquée : déterminer le contexte territorial pertinent et les flux réellement connus (collecte, finalité, accès, stockage, destinataires, conservation et suppression). Lire les éléments disponibles avant de demander ce qui manque. Séparer obligations étayées, recommandations techniques et faits restant à confirmer. Ne pas inventer une durée de conservation, une base juridique, un destinataire ou un verdict de conformité.

Si aucun outil de recherche externe n'est disponible, signaler ce manque ; ne pas prétendre avoir vérifié l'actualité du droit. Une recherche juridique n'autorise pas l'envoi de données réelles à un autre service. Utiliser des exemples fictifs pour expliquer.

## Donner une forme utile

| Besoin | Contenu et forme |
| --- | --- |
| Comprendre | Titres progressifs, paragraphes explicatifs, exemples concrets |
| Explorer une architecture | Parcours commenté, références au code, schéma si disponible |
| Comparer | Tableau court avec critères explicites |
| Appliquer | Étapes et liste de vérification, prérequis visibles |
| Approfondir | Toggles pour détails secondaires ; conclusion et limites restent visibles |
| Suivre dans le temps | Database seulement si un suivi est demandé et supporté |

N'imposer ni tous ces blocs, ni un nombre fixe de sections. Un beau document vide d'explications ne répond pas à la demande. Les contraintes du handle, les droits et la relecture après écriture restent ceux de la skill principale.

## Recette qualitative

Ces scénarios évaluent une génération réelle ; des tests de chaînes de prompts ne prouvent pas la qualité du modèle.

1. Demande de découverte de la codebase avec dépôt accessible : observe-t-on des références vérifiables et un parcours concret, sans questionnaire inutile ?
2. Demande de contribution technique : les points d'entrée et commandes viennent-ils du dépôt lu ?
3. Simple question de vocabulaire RGPD : répond-on sans créer une page non demandée ?
4. Analyse appliquée avec flux inconnus : pose-t-on la question déterminante plutôt que d'inventer une conformité ?
5. Recherche externe indisponible : l'absence de vérification est-elle explicite ?
6. Sujet court : évite-t-on les databases, toggles et tableaux décoratifs ?
7. Page demandée : la structure relue contient-elle les explications, sources et limites prévues, dans le bon Workspace ?

# Contrat identité workspace — implémenté côté service

`GET /api/workspaces`, `GET /api/session` (`workspaces`), `GET /api/workspaces/{slugOuId}`, réponse `PATCH /api/workspaces/{slugOuId}` : ajout `icon: string | null` (emoji Unicode uniquement dans cette livraison).

`PATCH /api/workspaces/{slugOuId}` accepte `{ "name"?: string, "icon"?: string | null }`.
- champ absent : inchangé ; `icon: null` : suppression ; `icon: ""` : refus 400.
- nom non vide après trim, maximum 120 caractères Unicode ; `name: null` refusé.
- emoji composés (famille ZWJ, couleurs de peau, drapeaux, keycaps) acceptés ; maximum 64 points de code / 256 octets ; lettres ordinaires, HTML, SVG, URL refusés. Plusieurs symboles emoji sont acceptés ; l'UI sélectionne un emoji.
- mêmes autorisations que renommage existant : seul admin DU workspace ; admin d'instance sans rôle workspace ne contourne pas ce contrôle.
- slug, ID et révision d'index restent inchangés. PATCH atomique nom + icône, réponse 200 identité complète `{ id, slug, name, role, icon }`.
- anciens workspaces : icon null via migration additive ; pas de modification des identités admin.
- création inchangée ; réglage icône via PATCH après création.

Pas d'upload d'image d'identité dans ce contrat. Ne pas envoyer un asset URL comme icon. Un workspace est la frontière actuelle ; aucun teamspace distinct n'est créé.

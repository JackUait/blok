package cloud

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// Le modèle de permissions par page. Conception :
// docs/plans/2026-11-13-page-permissions-design.md
//
// Rien n'appelle encore ce fichier : il est posé et prouvé avant d'être branché,
// pour que la justesse de la résolution se démontre seule.

// Les niveaux sont totalement ordonnés : c'est ce qui rend « le droit le plus
// large l'emporte » exprimable comme un max, sans table de correspondance.
type level int

const (
	levelNone level = iota
	levelView
	levelEdit
	levelFull
)

func (l level) String() string {
	switch l {
	case levelView:
		return "view"
	case levelEdit:
		return "edit"
	case levelFull:
		return "full"
	}
	return ""
}

func parseLevel(raw string) level {
	switch raw {
	case "view":
		return levelView
	case "edit":
		return levelEdit
	case "full":
		return levelFull
	}
	return levelNone
}

// Le rôle d'espace joue deux rôles distincts, et les confondre casse le modèle.
//
// capOf est le PLAFOND du compte : ce qu'aucun partage ne peut dépasser. Un
// lecteur reste en lecture seule même si on lui donne l'édition — son rôle dit
// « ce compte ne modifie rien ici ». Un membre, lui, doit pouvoir atteindre
// l'accès complet : sinon personne hormis un administrateur ne pourrait partager
// une page, pas même celle qu'il vient de créer.
func capOf(role string) level {
	switch role {
	case "admin", "member":
		return levelFull
	case "viewer":
		return levelView
	}
	return levelNone
}

// baseOf est ce que la VISIBILITÉ D'ESPACE accorde, et rien d'autre. Un membre
// modifie les pages communes sans pour autant gouverner leurs accès ; il faut un
// partage explicite, ou le rôle d'administrateur, pour cela.
func baseOf(role string) level {
	if role == "member" {
		return levelEdit
	}
	return capOf(role)
}

const (
	visInherit   = "inherit"
	visPrivate   = "private"
	visWorkspace = "workspace"
)

// Un maillon de la chaîne d'une page vers sa racine : sa visibilité propre et le
// partage que l'appelant détient sur cette page précise.
type pageNode struct {
	ID         string
	Visibility string
	Share      level
}

// Les hiérarchies profondes ne doivent pas pouvoir faire tourner une résolution
// indéfiniment. La borne vaut aussi comme filet si une donnée corrompue crée un
// cycle : les permissions ne dépendent pas de la validation d'une autre couche
// pour terminer.
const maxPageDepth = 64

// resolve applique le modèle : min(plafond, max(base héritée, partages de la chaîne)).
// chain va de la page vers la racine.
func resolve(role string, chain []pageNode) level {
	ceiling := capOf(role)
	if ceiling == levelNone || len(chain) == 0 {
		return levelNone
	}
	visibility := ""
	granted := levelNone
	for _, node := range chain {
		if visibility == "" && node.Visibility != visInherit {
			visibility = node.Visibility
		}
		if node.Share > granted {
			granted = node.Share
		}
	}
	// Une chaîne sans visibilité explicite est une chaîne incomplète — tronquée,
	// cyclique, ou coupée par un ancêtre supprimé. On se referme.
	best := granted
	if base := baseOf(role); visibility == visWorkspace && base > best {
		best = base
	}
	if best > ceiling {
		best = ceiling
	}
	return best
}

// Accepte indifféremment le pool et une transaction en cours.
type querier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

const chainQuery = `WITH RECURSIVE chain AS (
  SELECT p.id, p.visibility, nullif(p.metadata->>'parentId','') AS parent, 0 AS depth
    FROM pages p WHERE p.id=$1 AND NOT p.deleted
  UNION ALL
  SELECT p.id, p.visibility, nullif(p.metadata->>'parentId',''), c.depth+1
    FROM pages p JOIN chain c ON p.id=c.parent
   WHERE c.depth+1 < $3 AND NOT p.deleted)
SELECT c.id, c.visibility, coalesce(sh.level,'')
  FROM chain c LEFT JOIN page_shares sh ON sh.page_id=c.id AND sh.user_id=$2
 ORDER BY c.depth`

// chainOf charge la page et ses ancêtres, de la page vers la racine, avec le
// partage de l'appelant sur chacun.
func (s *Service) chainOf(ctx context.Context, q querier, userID, pageID string) ([]pageNode, error) {
	rows, e := q.Query(ctx, chainQuery, pageID, userID, maxPageDepth)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	chain := []pageNode{}
	for rows.Next() {
		var node pageNode
		var share string
		if e = rows.Scan(&node.ID, &node.Visibility, &share); e != nil {
			return nil, e
		}
		node.Share = parseLevel(share)
		chain = append(chain, node)
	}
	return chain, rows.Err()
}

// effectiveLevel répond « que peut cette personne sur cette page ». Une absence
// d'adhésion à l'espace, ou une page inconnue, vaut aucun accès — pas une erreur.
func (s *Service) effectiveLevel(ctx context.Context, q querier, userID, pageID string) (level, error) {
	var role string
	e := q.QueryRow(ctx, `SELECT m.role FROM pages p
	  JOIN memberships m ON m.workspace_id=p.workspace_id AND m.user_id=$2
	 WHERE p.id=$1 AND NOT p.deleted`, pageID, userID).Scan(&role)
	if errors.Is(e, pgx.ErrNoRows) {
		return levelNone, nil
	}
	if e != nil {
		return levelNone, e
	}
	chain, e := s.chainOf(ctx, q, userID, pageID)
	if e != nil {
		return levelNone, e
	}
	return resolve(role, chain), nil
}

// Même réponse à partir d'une session plutôt que d'un identifiant d'utilisateur.
// Revérifier la session à chaque appel est ce qui rend une déconnexion et un
// retrait d'adhésion immédiatement effectifs.
func (s *Service) effectiveLevelForSession(ctx context.Context, q querier, session, pageID string) (level, error) {
	var userID, role string
	e := q.QueryRow(ctx, `SELECT s.user_id, m.role FROM sessions s
	  JOIN memberships m ON m.user_id=s.user_id
	  JOIN pages p ON p.workspace_id=m.workspace_id
	 WHERE s.id=$1 AND s.expires_at>now() AND p.id=$2 AND NOT p.deleted`, session, pageID).Scan(&userID, &role)
	if errors.Is(e, pgx.ErrNoRows) {
		return levelNone, nil
	}
	if e != nil {
		return levelNone, e
	}
	chain, e := s.chainOf(ctx, q, userID, pageID)
	if e != nil {
		return levelNone, e
	}
	return resolve(role, chain), nil
}

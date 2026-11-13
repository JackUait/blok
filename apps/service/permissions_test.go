package cloud

import "testing"

// La table de vérité du modèle de permissions par page. Elle vit sans PostgreSQL
// parce que la résolution elle-même doit être démontrable sans base : tout ce que
// SQL apporte, c'est la chaîne des parents et les partages de l'appelant.
func TestResolveTruthTable(t *testing.T) {
	page := func(visibility string, share level) pageNode {
		return pageNode{ID: "p", Visibility: visibility, Share: share}
	}
	cases := []struct {
		name  string
		role  string
		chain []pageNode
		want  level
	}{
		// Le rôle d'espace plafonne, il ne donne rien par lui-même.
		{"non-membre", "", []pageNode{page(visWorkspace, levelNone)}, levelNone},
		{"admin sur page d'espace", "admin", []pageNode{page(visWorkspace, levelNone)}, levelFull},
		{"membre sur page d'espace", "member", []pageNode{page(visWorkspace, levelNone)}, levelEdit},
		{"lecteur sur page d'espace", "viewer", []pageNode{page(visWorkspace, levelNone)}, levelView},
		{"rôle inconnu", "owner", []pageNode{page(visWorkspace, levelNone)}, levelNone},

		// Une page privée ne cède pas devant un rôle, administrateur compris.
		{"admin sans partage sur page privée", "admin", []pageNode{page(visPrivate, levelNone)}, levelNone},
		{"membre sans partage sur page privée", "member", []pageNode{page(visPrivate, levelNone)}, levelNone},

		// Un partage ouvre une page privée, jusqu'au plafond du rôle.
		{"partage vue sur page privée", "member", []pageNode{page(visPrivate, levelView)}, levelView},
		{"partage édition sur page privée", "member", []pageNode{page(visPrivate, levelEdit)}, levelEdit},
		{"partage complet sur page privée", "member", []pageNode{page(visPrivate, levelFull)}, levelFull},

		// Le plafond gagne toujours contre un partage plus large.
		{"lecteur avec partage édition", "viewer", []pageNode{page(visPrivate, levelEdit)}, levelView},
		{"lecteur avec partage complet", "viewer", []pageNode{page(visWorkspace, levelFull)}, levelView},

		// Le plafond et la base ne sont pas la même chose : un membre modifie les
		// pages communes sans gouverner leurs accès, mais il peut détenir l'accès
		// complet sur une page — sans quoi il ne pourrait jamais rien partager.
		{"membre sans partage ne gère pas les accès", "member", []pageNode{page(visWorkspace, levelNone)}, levelEdit},
		{"membre avec partage complet gère les accès", "member", []pageNode{page(visWorkspace, levelFull)}, levelFull},
		{"créateur d'une page privée peut la partager", "member", []pageNode{page(visPrivate, levelFull)}, levelFull},

		// Le droit le plus large l'emporte entre la base et les partages.
		{"partage vue sur page d'espace", "member", []pageNode{page(visWorkspace, levelView)}, levelEdit},
		{"partage complet élargit la base", "member", []pageNode{page(visWorkspace, levelFull)}, levelFull},

		// L'héritage : la première visibilité explicite en remontant gagne.
		{
			"enfant hérite de l'espace",
			"member",
			[]pageNode{page(visInherit, levelNone), {ID: "racine", Visibility: visWorkspace}},
			levelEdit,
		},
		{
			"enfant hérite du privé",
			"member",
			[]pageNode{page(visInherit, levelNone), {ID: "racine", Visibility: visPrivate}},
			levelNone,
		},
		{
			"le parent le plus proche gagne sur la racine",
			"member",
			[]pageNode{
				page(visInherit, levelNone),
				{ID: "parent", Visibility: visPrivate},
				{ID: "racine", Visibility: visWorkspace},
			},
			levelNone,
		},
		{
			"un partage sur un ancêtre vaut pour la descendance",
			"member",
			[]pageNode{
				page(visInherit, levelNone),
				{ID: "parent", Visibility: visPrivate, Share: levelEdit},
			},
			levelEdit,
		},
		{
			"un partage sur l'enfant survit au parent devenu privé",
			"member",
			[]pageNode{
				page(visInherit, levelView),
				{ID: "parent", Visibility: visPrivate},
			},
			levelView,
		},
		{
			"le partage le plus large de la chaîne gagne",
			"member",
			[]pageNode{
				page(visInherit, levelView),
				{ID: "parent", Visibility: visPrivate, Share: levelFull},
			},
			levelFull,
		},

		// Fermeture par défaut.
		{"chaîne vide", "admin", nil, levelNone},
		{"racine sans visibilité explicite", "member", []pageNode{page(visInherit, levelNone)}, levelNone},
		{
			"chaîne tronquée par la borne de profondeur",
			"member",
			[]pageNode{page(visInherit, levelNone), {ID: "parent", Visibility: visInherit}},
			levelNone,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := resolve(c.role, c.chain); got != c.want {
				t.Fatalf("resolve(%q) = %v, attendu %v", c.role, got, c.want)
			}
		})
	}
}

func TestLevelOrdering(t *testing.T) {
	if !(levelNone < levelView && levelView < levelEdit && levelEdit < levelFull) {
		t.Fatal("les niveaux doivent être totalement ordonnés")
	}
	for raw, want := range map[string]level{"view": levelView, "edit": levelEdit, "full": levelFull, "": levelNone, "owner": levelNone} {
		if got := parseLevel(raw); got != want {
			t.Fatalf("parseLevel(%q) = %v, attendu %v", raw, got, want)
		}
	}
	for _, l := range []level{levelView, levelEdit, levelFull} {
		if parseLevel(l.String()) != l {
			t.Fatalf("%v ne survit pas à l'aller-retour texte", l)
		}
	}
	if levelNone.String() != "" {
		t.Fatal("une absence d'accès n'a pas de nom stocké")
	}
}

// Une page dont la chaîne boucle ne doit pas donner d'accès par accident :
// la visibilité n'est jamais trouvée, donc le modèle se referme.
func TestResolveClosesOnCycle(t *testing.T) {
	chain := []pageNode{
		{ID: "a", Visibility: visInherit},
		{ID: "b", Visibility: visInherit},
		{ID: "a", Visibility: visInherit},
	}
	if got := resolve("admin", chain); got != levelNone {
		t.Fatalf("une chaîne cyclique a donné %v", got)
	}
}

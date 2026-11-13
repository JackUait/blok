package cloud

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Le risque principal du modèle de permissions n'est pas une erreur de logique :
// c'est une route ajoutée plus tard qui lit `pages` ou `assets` sans passer par
// le résolveur. Une porte oubliée annule les autres.
//
// Toute fonction qui interroge ces tables doit soit appeler un garde, soit
// figurer ci-dessous avec sa raison. Ajouter une fonction à cette liste est une
// décision ; l'oublier est un échec de la suite.
var permissionExemptions = map[string]string{
	// Le résolveur lui-même : il est ce que les autres appellent.
	"chainOf":                  "implémente la résolution",
	"effectiveLevel":           "implémente la résolution",
	"effectiveLevelForSession": "implémente la résolution",
	"workspaceLevels":          "implémente la résolution",

	// Pas de contenu : des identifiants, ou un drapeau posé après autorisation.
	"recheckWorkspace": "ne lit que des identifiants pour relancer une revérification",
	"currentIndex":     "ne lit que des identifiants et leur ordre ; l'appelant résout les niveaux",
	"ancestry":         "remonte la chaîne des parents ; c'est une brique du résolveur, pas un accès au contenu",
	"mintTicket":       "marque l'admission d'un document déjà autorisé par l'appelant",

	// Authentification propre, hors du modèle de permissions par page.
	"document":            "point interne, authentifié par INTERNAL_SECRET et bloqué au proxy public",
	"storeWorkspaceImage": "ressource d'espace sans page de rattachement",
}

var permissionGuards = []string{
	"effectiveLevel", "effectiveLevelForSession", "workspaceLevels",
	"authorizeDoc", "authorizeMCPDocument", "assetAllowed", "chainOf",
}

var guardedTables = []string{
	"from pages", "into pages", "update pages", "join pages",
	"from assets", "into assets", "update assets", "join assets",
}

func TestEveryPageQueryPassesThroughTheResolver(t *testing.T) {
	sources, e := filepath.Glob("*.go")
	if e != nil {
		t.Fatal(e)
	}
	// Une requête sortie en constante échapperait au scan du corps : on relève
	// d'abord ces noms, puis une fonction qui les référence compte comme
	// interrogeant la table.
	queryConstants := map[string]bool{}
	for _, path := range sources {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		file := parseSource(t, path)
		for _, decl := range file.Decls {
			declaration, ok := decl.(*ast.GenDecl)
			if !ok {
				continue
			}
			for _, spec := range declaration.Specs {
				value, ok := spec.(*ast.ValueSpec)
				if !ok {
					continue
				}
				for i, name := range value.Names {
					if i < len(value.Values) && mentionsGuardedTable(value.Values[i]) {
						queryConstants[name.Name] = true
					}
				}
			}
		}
	}

	unguarded := map[string]string{}
	seen := map[string]bool{}
	for _, path := range sources {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		for _, decl := range parseSource(t, path).Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			queries, calls := inspectFunction(fn)
			for name := range queryConstants {
				if calls[name] {
					queries = true
				}
			}
			if !queries {
				continue
			}
			seen[fn.Name.Name] = true
			if _, exempt := permissionExemptions[fn.Name.Name]; exempt {
				continue
			}
			guarded := false
			for _, guard := range permissionGuards {
				if calls[guard] {
					guarded = true
					break
				}
			}
			if !guarded {
				unguarded[fn.Name.Name] = path
			}
		}
	}
	for name, path := range unguarded {
		t.Errorf("%s (%s) interroge pages ou assets sans passer par le résolveur. Appelez-le, ou ajoutez une exemption motivée.", name, path)
	}
	// Une exemption qui ne correspond plus à rien cache la prochaine.
	for name := range permissionExemptions {
		if !seen[name] {
			t.Errorf("l'exemption %q ne correspond à aucune fonction interrogeant pages ou assets ; retirez-la", name)
		}
	}
}

func parseSource(t *testing.T, path string) *ast.File {
	t.Helper()
	body, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	file, e := parser.ParseFile(token.NewFileSet(), path, body, 0)
	if e != nil {
		t.Fatal(e)
	}
	return file
}

func mentionsGuardedTable(node ast.Node) bool {
	found := false
	ast.Inspect(node, func(n ast.Node) bool {
		literal, ok := n.(*ast.BasicLit)
		if !ok || literal.Kind != token.STRING {
			return true
		}
		if guardedTableIn(literal.Value) {
			found = true
		}
		return true
	})
	return found
}

func guardedTableIn(raw string) bool {
	text, e := strconv.Unquote(raw)
	if e != nil {
		text = raw
	}
	lowered := strings.ToLower(strings.Join(strings.Fields(text), " "))
	for _, table := range guardedTables {
		if strings.Contains(lowered, table) {
			return true
		}
	}
	return false
}

// inspectFunction dit si le corps contient une requête sur les tables gardées, et
// quels noms il référence.
func inspectFunction(fn *ast.FuncDecl) (bool, map[string]bool) {
	queries := false
	calls := map[string]bool{}
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		switch value := node.(type) {
		case *ast.BasicLit:
			if value.Kind == token.STRING && guardedTableIn(value.Value) {
				queries = true
			}
		case *ast.Ident:
			// Tous les noms référencés, pas seulement les appels : une requête
			// sortie en constante n'apparaît dans le corps que comme un nom.
			calls[value.Name] = true
		case *ast.SelectorExpr:
			calls[value.Sel.Name] = true
		}
		return true
	})
	return queries, calls
}

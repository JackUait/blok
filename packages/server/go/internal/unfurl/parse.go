// Package unfurl reads link-preview metadata out of an HTML page the way
// C#'s UnfurlMetadataParser does: HTML5 tree building, a depth cut at 512,
// Open Graph first, then Twitter, then the plain tags.
package unfurl

import (
	"bytes"
	"strings"
	"unicode"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"

	"github.com/JackUait/blok/packages/server/go/internal/dotnet"
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/outbound"
)

const maxOpenElementDepth = 512

// Metadata is UnfurlMetadata. Empty fields are absent.
type Metadata struct {
	Title, Description, Image, Favicon, Domain string
	// OEmbed is the first JSON oEmbed discovery link, resolved.
	OEmbed string
}

// Parse reads body as UTF-8, whatever charset the page names.
func Parse(body []byte, finalURL string) Metadata {
	base, ok := dotnet.ParseAbsoluteURI(finalURL)
	if !ok || base.Host == "" {
		base = nil
	}
	var title, ogTitle, twitterTitle, ogDescription, twitterDescription, description, ogImage, twitterImage, icon, appleIcon, oEmbed string
	// .NET decodes invalid UTF-8 to U+FFFD, one per maximal bad sequence.
	text := jsjson.FromString(string(body)).String()
	// AngleSharp parses with scripting off, so <noscript> holds markup.
	document, err := html.ParseWithOptions(strings.NewReader(text), html.ParseOptionEnableScripting(false))
	if err != nil {
		return build(base, "", "", nil, nil, "")
	}
	type frame struct {
		node  *html.Node
		depth int
		// sel is set below a <select>; see dropsInSelect.
		sel *selectState
	}
	stack := []frame{{document, 0, nil}}
	var raws []string
	titles := 0
	for len(stack) > 0 {
		top := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		node := top.node
		if node.Type == html.ElementNode && node.Data == "title" {
			titles++
		}
		if node.Type == html.ElementNode && node.Namespace == "" && node.Data == "title" && top.sel != nil && top.sel.open {
			// AngleSharp builds a title inside an option or button as
			// markup, not RCDATA, so it holds what follows as written.
			if raws == nil {
				raws = rawTitles(text)
			}
			if titles <= len(raws) {
				if held, err := html.ParseFragment(strings.NewReader(raws[titles-1]), &html.Node{Type: html.ElementNode, Data: "body", DataAtom: atom.Body}); err == nil {
					node = &html.Node{Type: html.ElementNode, Data: "title"}
					for _, child := range held {
						node.AppendChild(child)
					}
				}
			}
		}
		if node.Type == html.ElementNode {
			if top.depth > maxOpenElementDepth {
				return build(base, "", "", nil, nil, "")
			}
			tag := node.Data
			if top.sel.drops() {
				if node.Namespace == "" && (tag == "input" || tag == "keygen" || tag == "textarea") {
					top.sel.closed = true
				}
				tag = ""
			}
			switch tag {
			case "title":
				if node.Namespace == "" && node.FirstChild != nil {
					keepFirst(&title, textContent(node.FirstChild))
				} else if node.Namespace == "" {
					keepFirst(&title, "")
				}
			case "meta":
				property, name, content := attribute(node, "property"), attribute(node, "name"), attribute(node, "content")
				switch {
				case property == "og:title":
					keepFirst(&ogTitle, content)
				case name == "twitter:title":
					keepFirst(&twitterTitle, content)
				case property == "og:description":
					keepFirst(&ogDescription, content)
				case name == "twitter:description":
					keepFirst(&twitterDescription, content)
				case name == "description":
					keepFirst(&description, content)
				case property == "og:image":
					keepFirst(&ogImage, content)
				case name == "twitter:image":
					keepFirst(&twitterImage, content)
				}
			case "link":
				href := attribute(node, "href")
				if href == "" {
					break
				}
				for _, relation := range strings.FieldsFunc(attribute(node, "rel"), unicode.IsSpace) {
					relation = asciiLower(relation)
					// oEmbed JSON discovery only; XML discovery is ignored.
					if relation == "alternate" && asciiLower(attribute(node, "type")) == "application/json+oembed" {
						keepFirst(&oEmbed, href)
					}
					if relation == "icon" {
						keepFirst(&icon, href)
					} else if strings.HasPrefix(relation, "apple-touch-icon") {
						keepFirst(&appleIcon, href)
					}
				}
			}
		}
		// AngleSharp keeps template contents in a separate fragment, not
		// among the element's children.
		if node.Type == html.ElementNode && node.Namespace == "" && node.Data == "template" {
			continue
		}
		sel := top.sel
		if node.Type == html.ElementNode && node.Namespace == "" {
			switch {
			case node.Data == "select" && (sel == nil || sel.closed):
				sel = &selectState{}
			case sel.drops() && (node.Data == "option" || node.Data == "optgroup" || node.Data == "button"):
				sel = &selectState{open: true}
			}
		}
		var children []*html.Node
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			children = append(children, child)
		}
		for i := len(children) - 1; i >= 0; i-- {
			stack = append(stack, frame{children[i], top.depth + 1, sel})
		}
	}
	return build(base,
		firstNonEmpty(ogTitle, twitterTitle, title),
		firstNonEmpty(ogDescription, twitterDescription, description),
		[]string{ogImage, twitterImage},
		[]string{icon, appleIcon}, oEmbed)
}

// selectState stands in for AngleSharp 1.9.0's "in select" mode, which x/net
// does not have: x/net builds <select> by the customizable-select spec and
// keeps any element inside. AngleSharp drops a start tag (title, meta, link,
// div...) whose current node is the select itself, builds normally inside
// option, optgroup and button, and lets input, keygen or textarea close the
// select. unfurl-html.json pins the cases.
type selectState struct {
	open, closed bool
}

func (s *selectState) drops() bool {
	return s != nil && !s.open && !s.closed
}

// rawTitles is each <title>'s content as written, in document order, one
// for every title element the walk in Parse counts: the tokenizer gives an
// HTML title's RCDATA raw, before any entity is decoded. It follows the
// tree builder far enough to stay paired: inside svg or math no tag is raw
// text and a title is an element (written ""), svg's title, desc and
// foreignObject are HTML integration points, a breakout tag leaves foreign
// content, and titles in a template are skipped, as the walk never enters
// template contents.
func rawTitles(text string) []string {
	type foreign struct {
		name, space string
		integration bool
	}
	tokenizer := html.NewTokenizer(strings.NewReader(text))
	var titles []string
	var open []foreign
	templates := 0
	for {
		kind := tokenizer.Next()
		if kind == html.ErrorToken {
			return titles
		}
		if kind != html.StartTagToken && kind != html.SelfClosingTagToken && kind != html.EndTagToken {
			continue
		}
		nameBytes, _ := tokenizer.TagName()
		name := string(nameBytes)
		inForeign := len(open) > 0 && !open[len(open)-1].integration
		if kind == html.EndTagToken {
			popped := false
			for i := len(open) - 1; i >= 0; i-- {
				if open[i].name == name {
					open, popped = open[:i], true
					break
				}
			}
			if !popped && !inForeign && name == "template" && templates > 0 {
				templates--
			}
			continue
		}
		if inForeign && breakoutTags[name] {
			open, inForeign = nil, false
		}
		if inForeign {
			tokenizer.NextIsNotRawText()
			if name == "title" && templates == 0 {
				titles = append(titles, "")
			}
			if kind == html.StartTagToken {
				space := open[len(open)-1].space
				integration := space == "svg" && (name == "foreignobject" || name == "desc" || name == "title")
				open = append(open, foreign{name, space, integration})
			}
			continue
		}
		switch name {
		case "svg", "math":
			if kind == html.StartTagToken {
				open = append(open, foreign{name, name, false})
			}
			continue
		case "template":
			templates++
		case "noscript":
			// Scripting is off, so the parser reads its markup.
			tokenizer.NextIsNotRawText()
		}
		if name != "title" {
			continue
		}
		var raw strings.Builder
		for tokenizer.Next() == html.TextToken {
			raw.Write(tokenizer.Raw())
		}
		if templates == 0 {
			titles = append(titles, raw.String())
		}
	}
}

// breakoutTags are the start tags that end foreign content (the HTML
// spec's list; font only with color, face or size, which is left out).
var breakoutTags = map[string]bool{
	"b": true, "big": true, "blockquote": true, "body": true, "br": true, "center": true, "code": true,
	"dd": true, "div": true, "dl": true, "dt": true, "em": true, "embed": true, "h1": true, "h2": true,
	"h3": true, "h4": true, "h5": true, "h6": true, "head": true, "hr": true, "i": true, "img": true,
	"li": true, "listing": true, "menu": true, "meta": true, "nobr": true, "ol": true, "p": true,
	"pre": true, "ruby": true, "s": true, "small": true, "span": true, "strong": true, "strike": true,
	"sub": true, "sup": true, "table": true, "tt": true, "u": true, "ul": true, "var": true,
}

// asciiLower stands in for ToLowerInvariant before a compare with an ASCII
// word: invariant casing keeps U+0130, where strings.ToLower makes it "i".
func asciiLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if 'A' <= c && c <= 'Z' {
			b[i] = c + 'a' - 'A'
		}
	}
	return string(b)
}

// build keeps the first image and favicon a browser may load
// (outbound.BrowserURL), so an http og:image gives way to an https
// twitter:image. With a base, /favicon.ico is the last favicon to try.
func build(base *dotnet.URI, title, description string, images, favicons []string, oEmbed string) Metadata {
	domain := ""
	if base != nil {
		domain = strings.TrimPrefix(strings.ToLower(base.IdnHost), "www.")
		favicons = append(favicons, "/favicon.ico")
	}
	return Metadata{
		Title:       title,
		Description: description,
		Image:       firstBrowserURL(base, images),
		Favicon:     firstBrowserURL(base, favicons),
		Domain:      domain,
		OEmbed:      resolveURL(base, oEmbed),
	}
}

func firstBrowserURL(base *dotnet.URI, references []string) string {
	for _, reference := range references {
		if reference == "" {
			continue
		}
		if url := outbound.BrowserURL(base, reference); url != "" {
			return url
		}
	}
	return ""
}

func resolveURL(base *dotnet.URI, reference string) string {
	if reference == "" {
		return ""
	}
	var resolved *dotnet.URI
	var ok bool
	if base == nil {
		resolved, ok = dotnet.ParseAbsoluteURI(reference)
	} else {
		resolved, ok = dotnet.ResolveURI(base, reference)
	}
	if !ok || !resolved.IsHTTP() || resolved.Host == "" {
		return ""
	}
	return resolved.AbsoluteURI
}

func attribute(node *html.Node, name string) string {
	for _, a := range node.Attr {
		if a.Namespace == "" && a.Key == name {
			return strings.TrimSpace(a.Val)
		}
	}
	return ""
}

func keepFirst(destination *string, value string) {
	if *destination == "" {
		*destination = strings.TrimSpace(value)
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func textContent(node *html.Node) string {
	if node.Type == html.TextNode {
		return node.Data
	}
	var b bytes.Buffer
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.TextNode {
			b.WriteString(n.Data)
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(node)
	return b.String()
}

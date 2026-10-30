package blokdocs

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
)

// Converter converts saved Blok documents. It is safe for concurrent use; at
// most Options.PoolSize conversions run at once and the rest wait.
//
// Every method takes the document as JSON text. Envelope operations (all but
// ToHTML and ToMarkdown on a bare document) parse it on the host first, the
// way C# JsonNode.Parse does: nesting past 64 levels or a lone-surrogate
// escape is an InvalidDocument before any engine is used.
//
// Results that are strings come back as Go strings, so a lone surrogate the
// runtime writes into HTML or text becomes U+FFFD, as it does when C# writes
// the same string as UTF-8.
type Converter struct {
	runtime invoker

	mu      sync.Mutex
	version string
	schema  *string

	// warmed closes when the warm-up New started has finished.
	warmed <-chan struct{}
}

func (c *Converter) invoke(ctx context.Context, op, input string) (string, error) {
	output, err := c.runtime.Invoke(ctx, op, input, 0)
	if err != nil {
		return "", fromRuntime(err)
	}
	return output, nil
}

// Version is the document version the editor stamps. It is cached once
// known. A bundle built without the VERSION define answers "dev", which is
// never cached and fails with ErrNoVersion every time.
func (c *Converter) Version(ctx context.Context) (string, error) {
	c.mu.Lock()
	cached := c.version
	c.mu.Unlock()
	if cached != "" {
		return cached, nil
	}
	reported, err := c.invoke(ctx, "version", "{}")
	if err != nil {
		return "", err
	}
	if reported == "dev" || reported == "" {
		return "", ErrNoVersion
	}
	c.mu.Lock()
	c.version = reported
	c.mu.Unlock()
	return reported, nil
}

// Schema is the saved format as a JSON Schema document, fetched once.
func (c *Converter) Schema(ctx context.Context) (string, error) {
	c.mu.Lock()
	cached := c.schema
	c.mu.Unlock()
	if cached != nil {
		return *cached, nil
	}
	schema, err := c.invoke(ctx, "schema", "{}")
	if err != nil {
		return "", err
	}
	c.mu.Lock()
	c.schema = &schema
	c.mu.Unlock()
	return schema, nil
}

func (c *Converter) markdown(ctx context.Context, op, input string) (MarkdownConversion, error) {
	output, err := c.invoke(ctx, op, input)
	if err != nil {
		return MarkdownConversion{}, err
	}
	text, warnings, ok, err := readReport(output, "markdown")
	if err != nil {
		return MarkdownConversion{}, err
	}
	if !ok {
		return MarkdownConversion{}, noAnswer("Markdown conversion")
	}
	return MarkdownConversion{Markdown: text, Warnings: warnings}, nil
}

// ToMarkdown converts a document to Markdown and reports what did not survive.
// The document is sent as it is.
func (c *Converter) ToMarkdown(ctx context.Context, documentJSON string) (MarkdownConversion, error) {
	return c.markdown(ctx, "blocksToMarkdown", documentJSON)
}

// ToMarkdownWithPages is ToMarkdown with page metadata for page blocks and
// page links. pageHref, when not nil, builds each allowed page's link.
func (c *Converter) ToMarkdownWithPages(ctx context.Context, documentJSON string, pages map[string]*PageInfo, pageHref func(string) string) (MarkdownConversion, error) {
	input, err := pagesRequest(documentJSON, pages, pageHref, false)
	if err != nil {
		return MarkdownConversion{}, err
	}
	return c.markdown(ctx, "blocksToMarkdownWithPages", input)
}

// ToMarkdownWithTitle writes the document's title as a heading. An image icon is dropped.
func (c *Converter) ToMarkdownWithTitle(ctx context.Context, documentJSON string) (MarkdownConversion, error) {
	input, err := titleRequest(documentJSON)
	if err != nil {
		return MarkdownConversion{}, err
	}
	return c.markdown(ctx, "blocksToMarkdown", input)
}

// ToMarkdownWithTitleAndPages is ToMarkdownWithTitle with page metadata.
func (c *Converter) ToMarkdownWithTitleAndPages(ctx context.Context, documentJSON string, pages map[string]*PageInfo, pageHref func(string) string) (MarkdownConversion, error) {
	input, err := pagesRequest(documentJSON, pages, pageHref, true)
	if err != nil {
		return MarkdownConversion{}, err
	}
	return c.markdown(ctx, "blocksToMarkdownWithPages", input)
}

// ToHTML converts a document to HTML. The document is sent as it is.
func (c *Converter) ToHTML(ctx context.Context, documentJSON string) (string, error) {
	return c.invoke(ctx, "blocksToHtml", documentJSON)
}

// ToHTMLWithPages is ToHTML with page metadata.
func (c *Converter) ToHTMLWithPages(ctx context.Context, documentJSON string, pages map[string]*PageInfo, pageHref func(string) string) (string, error) {
	input, err := pagesRequest(documentJSON, pages, pageHref, false)
	if err != nil {
		return "", err
	}
	return c.invoke(ctx, "blocksToHtmlWithPages", input)
}

// ToHTMLWithTitle writes the document's title as an <h1>.
func (c *Converter) ToHTMLWithTitle(ctx context.Context, documentJSON string) (string, error) {
	input, err := titleRequest(documentJSON)
	if err != nil {
		return "", err
	}
	return c.invoke(ctx, "blocksToHtml", input)
}

// ToHTMLWithTitleAndPages is ToHTMLWithTitle with page metadata.
func (c *Converter) ToHTMLWithTitleAndPages(ctx context.Context, documentJSON string, pages map[string]*PageInfo, pageHref func(string) string) (string, error) {
	input, err := pagesRequest(documentJSON, pages, pageHref, true)
	if err != nil {
		return "", err
	}
	return c.invoke(ctx, "blocksToHtmlWithPages", input)
}

// ToPlainText converts a document to plain text. includeHiddenText adds text
// a reader does not see, such as image alt text.
func (c *Converter) ToPlainText(ctx context.Context, documentJSON string, includeHiddenText bool) (string, error) {
	input, err := plainTextRequest(documentJSON, includeHiddenText, false)
	if err != nil {
		return "", err
	}
	return c.invoke(ctx, "blocksToPlainText", input)
}

// ToPlainTextWithTitle puts the title on the first line.
func (c *Converter) ToPlainTextWithTitle(ctx context.Context, documentJSON string, includeHiddenText bool) (string, error) {
	input, err := plainTextRequest(documentJSON, includeHiddenText, true)
	if err != nil {
		return "", err
	}
	return c.invoke(ctx, "blocksToPlainText", input)
}

// ToPlainTextWithReport is ToPlainText plus the blocks the reader made nothing of.
func (c *Converter) ToPlainTextWithReport(ctx context.Context, documentJSON string, includeHiddenText bool) (PlainTextConversion, error) {
	input, err := plainTextRequest(documentJSON, includeHiddenText, false)
	if err != nil {
		return PlainTextConversion{}, err
	}
	output, err := c.invoke(ctx, "blocksToPlainTextWithReport", input)
	if err != nil {
		return PlainTextConversion{}, err
	}
	text, warnings, ok, err := readReport(output, "text")
	if err != nil {
		return PlainTextConversion{}, err
	}
	if !ok {
		return PlainTextConversion{}, noAnswer("plain-text conversion")
	}
	return PlainTextConversion{Text: text, Warnings: warnings}, nil
}

// ExtractTexts lists the strings worth translating, in document order.
// Code is included only when includeCode is set.
func (c *Converter) ExtractTexts(ctx context.Context, documentJSON string, includeCode bool) ([]string, error) {
	input, err := textsRequest(documentJSON, nil, includeCode)
	if err != nil {
		return nil, err
	}
	output, err := c.invoke(ctx, "extractTexts", input)
	if err != nil {
		return nil, err
	}
	node, err := parseAnswer(output)
	if err != nil {
		return nil, err
	}
	if node.Kind == jsjson.KindNull {
		return nil, noAnswer("texts")
	}
	return readStrings(node)
}

// InjectTexts puts translations back, in ExtractTexts order, and returns the
// document to store. A list of the wrong length is a *TextCountError.
func (c *Converter) InjectTexts(ctx context.Context, documentJSON string, texts []string, includeCode bool) (string, error) {
	if texts == nil {
		texts = []string{}
	}
	input, err := textsRequest(documentJSON, texts, includeCode)
	if err != nil {
		return "", err
	}
	output, err := c.invoke(ctx, "injectTexts", input)
	if err != nil {
		return "", err
	}
	result, err := answerObject(output, "document")
	if err != nil {
		return "", err
	}
	if mismatch := member(result, "mismatch"); mismatch != nil && mismatch.Kind != jsjson.KindNull {
		object, err := asObject(mismatch)
		if err != nil {
			return "", err
		}
		return "", &TextCountError{Expected: nodeText(member(object, "expected")), Received: nodeText(member(object, "received"))}
	}
	return documentOf(result)
}

// PageIndex lists the sub-pages a page document owns, the pages it links to,
// and each block's text. The document is sent raw, so a malformed block keeps
// its order.
func (c *Converter) PageIndex(ctx context.Context, documentJSON string) (PageIndex, error) {
	request := newEnvelope()
	if err := request.document(documentJSON); err != nil {
		return PageIndex{}, err
	}
	input, err := request.close()
	if err != nil {
		return PageIndex{}, err
	}
	output, err := c.invoke(ctx, "pageIndex", input)
	if err != nil {
		return PageIndex{}, err
	}
	node, err := parseAnswer(output)
	if err != nil {
		return PageIndex{}, err
	}
	object, err := readObject(node)
	if err != nil {
		return PageIndex{}, err
	}
	if object == nil {
		return PageIndex{}, noAnswer("page index")
	}
	return readPageIndex(object)
}

// RemapPageDocument copies a page document under new block and page ids.
// Maps that do not cover the document are an *UnmappedIDsError. A nil map
// reads as empty.
func (c *Converter) RemapPageDocument(ctx context.Context, documentJSON string, blockIDs, pageIDs map[string]string) (string, error) {
	request := newEnvelope()
	if err := request.document(documentJSON); err != nil {
		return "", err
	}
	request.idMap("blockIds", blockIDs)
	request.idMap("pageIds", pageIDs)
	input, err := request.close()
	if err != nil {
		return "", err
	}
	output, err := c.invoke(ctx, "remapPageDocument", input)
	if err != nil {
		return "", err
	}
	result, err := answerObject(output, "document")
	if err != nil {
		return "", err
	}
	if unmapped := member(result, "unmapped"); unmapped != nil && unmapped.Kind != jsjson.KindNull {
		return "", readUnmapped(unmapped)
	}
	return documentOf(result)
}

// Validate says whether Blok can read a document and whether it holds
// anything. It never fails except on ctx: a runtime failure is reported in
// Failure. A non-document is answered without an engine.
func (c *Converter) Validate(ctx context.Context, documentJSON string) (Validation, error) {
	failed := func(reason Reason) Validation {
		return Validation{UnrecognizedBlockTypes: []string{}, Failure: &reason}
	}
	if !LooksLikeADocument(documentJSON) {
		return failed(InvalidDocument), nil
	}
	output, err := c.invoke(ctx, "inspect", documentJSON)
	if err != nil {
		var conversion *ConversionError
		if errors.As(err, &conversion) {
			return failed(conversion.Reason), nil
		}
		return Validation{}, err
	}
	validation, err := readValidation(output)
	if err != nil {
		return failed(Unknown), nil
	}
	return validation, nil
}

// FromMarkdown imports Markdown as a document ready to store.
func (c *Converter) FromMarkdown(ctx context.Context, markdown string) (ImportConversion, error) {
	return c.importDocument(ctx, "markdownToBlocks", singleStringRequest("markdown", markdown))
}

// FromHTML imports HTML as a document ready to store.
func (c *Converter) FromHTML(ctx context.Context, html string) (ImportConversion, error) {
	return c.importDocument(ctx, "htmlToBlocks", singleStringRequest("html", html))
}

// The report rides beside the document on the wire, but a caller storing the
// document must not store it.
func (c *Converter) importDocument(ctx context.Context, op, input string) (ImportConversion, error) {
	output, err := c.invoke(ctx, op, input)
	if err != nil {
		return ImportConversion{}, err
	}
	node, err := parseAnswer(output)
	if err != nil {
		return ImportConversion{}, err
	}
	if node.Kind == jsjson.KindNull {
		return ImportConversion{}, noAnswer("document")
	}
	payload, err := asObject(node)
	if err != nil {
		return ImportConversion{}, err
	}
	warnings, err := readDegradations(member(payload, "warnings"))
	if err != nil {
		return ImportConversion{}, err
	}
	if warnings == nil {
		warnings = []Degradation{}
	}
	kept := &jsjson.Node{Kind: jsjson.KindObject}
	for _, m := range payload.Members {
		if key, err := m.Key(); err != nil || key.String() != "warnings" {
			kept.Members = append(kept.Members, m)
		}
	}
	document, err := writeAnswer(kept)
	if err != nil {
		return ImportConversion{}, err
	}
	return ImportConversion{DocumentJSON: document, Warnings: warnings}, nil
}

// WarmUp converts a long article, so the first real request does not pay
// for cold paths. Run it in a goroutine and ignore its error: warming must
// never stop a host from starting.
func (c *Converter) WarmUp(ctx context.Context) error {
	_, err := c.ToPlainText(ctx, warmUpDocument(), false)
	return err
}

// warmUpInBackground never fails a start: a slow host can push the warm-up
// past its own timeout, and that is no reason to refuse to serve.
func (c *Converter) warmUpInBackground() <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = c.WarmUp(context.Background())
	}()
	return done
}

func warmUpDocument() string {
	const paragraph = `Warm up <b>the</b> reader with <a href=\"https://example.com\">a link</a> ` +
		"and enough plain prose after it to be worth reading, paragraph "
	var b strings.Builder
	b.WriteString(`{"blocks":[`)
	for i := range 220 {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`{"id":"w` + strconv.Itoa(i) + `"`)
		if i%7 == 0 {
			b.WriteString(`,"type":"list","data":{"style":"unordered","text":"item &amp; more `)
		} else {
			b.WriteString(`,"type":"paragraph","data":{"text":"` + paragraph)
		}
		b.WriteString(strconv.Itoa(i) + `"}}`)
	}
	b.WriteString("]}")
	return b.String()
}

// LooksLikeADocument answers, from the JSON alone, whether input is shaped
// like a saved document: an object whose blocks member is an array, with no
// key repeated anywhere. It never says whether the blocks are readable.
//
// Repeats are refused because Jint (the C# engine) reads them differently
// from goja and node once the bundle is loaded.
func LooksLikeADocument(documentJSON string) bool {
	if strings.TrimSpace(documentJSON) == "" {
		return false
	}
	node, err := jsjson.ParseNode([]byte(documentJSON), jsjson.Options{RefuseDuplicates: true})
	if err != nil || node.Kind != jsjson.KindObject {
		return false
	}
	blocks := member(node, "blocks")
	return blocks != nil && blocks.Kind == jsjson.KindArray
}

// answerObject reads an {document | mismatch | unmapped} answer as C#
// JsonNode.Parse does.
func answerObject(output, what string) (*jsjson.Node, error) {
	node, err := parseAnswer(output)
	if err != nil {
		return nil, err
	}
	if node.Kind == jsjson.KindNull {
		return nil, noAnswer(what)
	}
	return asObject(node)
}

func asObject(node *jsjson.Node) (*jsjson.Node, error) {
	if node.Kind != jsjson.KindObject {
		return nil, &AnswerError{Message: "The node must be of type 'JsonObject'."}
	}
	return node, nil
}

func documentOf(result *jsjson.Node) (string, error) {
	document := member(result, "document")
	if document == nil || document.Kind == jsjson.KindNull {
		return "", noAnswer("document")
	}
	return writeAnswer(document)
}

// writeAnswer re-serializes like JsonNode.ToJsonString: key order and number
// text kept, non-ASCII and HTML-sensitive characters escaped.
func writeAnswer(node *jsjson.Node) (string, error) {
	out, err := node.AppendJSON(nil)
	if err != nil {
		return "", &AnswerError{Message: "Cannot read incomplete UTF-16 JSON text as string with missing low surrogate.", Err: err}
	}
	return string(out), nil
}

// nodeText is JsonNode.ToString(): a string's text, other values as JSON.
func nodeText(node *jsjson.Node) string {
	switch {
	case node == nil:
		return ""
	case node.Kind == jsjson.KindString:
		if text, err := node.Text(); err == nil {
			return text.String()
		}
	}
	out, err := node.AppendJSON(nil)
	if err != nil {
		return ""
	}
	return string(out)
}

func readUnmapped(node *jsjson.Node) error {
	object, err := readObject(node)
	if err != nil {
		return err
	}
	if object == nil {
		return noAnswer("id problems")
	}
	problems := &UnmappedIDsError{}
	if problems.MissingBlockIDs, err = readStrings(member(object, "missingBlockIds")); err != nil {
		return err
	}
	if problems.DuplicateBlockIDs, err = readStrings(member(object, "duplicateBlockIds")); err != nil {
		return err
	}
	if problems.IdlessBlocks, err = readInt(member(object, "idlessBlocks")); err != nil {
		return err
	}
	return problems
}

func readValidation(output string) (Validation, error) {
	node, err := parseAnswer(output)
	if err != nil {
		return Validation{}, err
	}
	object, err := readObject(node)
	if err != nil {
		return Validation{}, err
	}
	// Deserialize gave null: C# falls back to an Unknown failure but still
	// calls it a document.
	if object == nil {
		unknown := Unknown
		return Validation{IsDocument: true, UnrecognizedBlockTypes: []string{}, Failure: &unknown}, nil
	}
	v := Validation{IsDocument: true, UnrecognizedBlockTypes: []string{}}
	if v.IsEmpty, err = readBool(member(object, "isEmpty")); err != nil {
		return Validation{}, err
	}
	if v.BlockCount, err = readInt(member(object, "blockCount")); err != nil {
		return Validation{}, err
	}
	if v.MalformedBlockCount, err = readInt(member(object, "malformedBlockCount")); err != nil {
		return Validation{}, err
	}
	if types := member(object, "unrecognizedBlockTypes"); types != nil {
		if v.UnrecognizedBlockTypes, err = readStrings(types); err != nil {
			return Validation{}, err
		}
	}
	return v, nil
}

func readPageIndex(object *jsjson.Node) (PageIndex, error) {
	var index PageIndex
	present, err := readArray(member(object, "owners"), func(element *jsjson.Node) error {
		row, err := readObject(element)
		if err != nil || row == nil {
			index.Owners = append(index.Owners, PageOwnerEdge{})
			return err
		}
		var edge PageOwnerEdge
		if edge.PageID, err = readString(member(row, "pageId")); err != nil {
			return err
		}
		if edge.SourceBlockID, err = readString(member(row, "sourceBlockId")); err != nil {
			return err
		}
		if edge.Order, err = readInt(member(row, "order")); err != nil {
			return err
		}
		index.Owners = append(index.Owners, edge)
		return nil
	})
	if err != nil {
		return PageIndex{}, err
	}
	if present && index.Owners == nil {
		index.Owners = []PageOwnerEdge{}
	}
	present, err = readArray(member(object, "text"), func(element *jsjson.Node) error {
		row, err := readObject(element)
		if err != nil || row == nil {
			index.Text = append(index.Text, PageTextEntry{})
			return err
		}
		var entry PageTextEntry
		if entry.BlockID, err = readOptionalString(member(row, "blockId")); err != nil {
			return err
		}
		if entry.Order, err = readInt(member(row, "order")); err != nil {
			return err
		}
		if entry.Text, err = readString(member(row, "text")); err != nil {
			return err
		}
		index.Text = append(index.Text, entry)
		return nil
	})
	if err != nil {
		return PageIndex{}, err
	}
	if present && index.Text == nil {
		index.Text = []PageTextEntry{}
	}
	present, err = readArray(member(object, "references"), func(element *jsjson.Node) error {
		row, err := readObject(element)
		if err != nil || row == nil {
			index.References = append(index.References, PageReference{})
			return err
		}
		var reference PageReference
		if reference.PageID, err = readString(member(row, "pageId")); err != nil {
			return err
		}
		if reference.SourceBlockID, err = readOptionalString(member(row, "sourceBlockId")); err != nil {
			return err
		}
		if reference.Order, err = readInt(member(row, "order")); err != nil {
			return err
		}
		index.References = append(index.References, reference)
		return nil
	})
	if err != nil {
		return PageIndex{}, err
	}
	if present && index.References == nil {
		index.References = []PageReference{}
	}
	return index, nil
}

// envelope writes a request object the way C# JsonObject.ToJsonString does.
type envelope struct {
	buf []byte
	err error
}

func newEnvelope() *envelope { return &envelope{buf: []byte{'{'}} }

func (e *envelope) key(name string) {
	if len(e.buf) > 1 {
		e.buf = append(e.buf, ',')
	}
	e.buf = jsjson.AppendQuoted(e.buf, jsjson.FromString(name))
	e.buf = append(e.buf, ':')
}

// document parses the document like C# JsonNode.Parse (depth 64, repeats
// kept). Writing it back fails on a lone-surrogate escape, which C# also
// reports as InvalidDocument.
func (e *envelope) document(documentJSON string) error {
	node, err := jsjson.ParseNode([]byte(documentJSON), jsjson.Options{})
	if err != nil {
		return &ConversionError{Reason: InvalidDocument, Err: err}
	}
	e.key("document")
	if e.buf, err = node.AppendJSON(e.buf); err != nil {
		return &ConversionError{Reason: InvalidDocument, Err: err}
	}
	return nil
}

func (e *envelope) boolean(name string, value bool) {
	e.key(name)
	e.buf = strconv.AppendBool(e.buf, value)
}

func (e *envelope) str(name, value string) {
	e.key(name)
	e.buf = jsjson.AppendQuoted(e.buf, jsjson.FromString(value))
}

func (e *envelope) raw(name string, value []byte) {
	e.key(name)
	e.buf = append(e.buf, value...)
}

// Keys go out in UTF-16 order. Their order is not part of the contract: the
// bundle only looks entries up.
func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	slices.SortFunc(keys, func(a, b string) int { return jsjson.Compare(jsjson.FromString(a), jsjson.FromString(b)) })
	return keys
}

func (e *envelope) idMap(name string, ids map[string]string) {
	inner := newEnvelope()
	for _, key := range sortedKeys(ids) {
		inner.str(key, ids[key])
	}
	e.raw(name, append(inner.buf, '}'))
}

func (e *envelope) close() (string, error) {
	return string(append(e.buf, '}')), e.err
}

func singleStringRequest(name, value string) string {
	request := newEnvelope()
	request.str(name, value)
	out, _ := request.close()
	return out
}

func textsRequest(documentJSON string, texts []string, includeCode bool) (string, error) {
	request := newEnvelope()
	if err := request.document(documentJSON); err != nil {
		return "", err
	}
	request.boolean("includeCode", includeCode)
	if texts != nil {
		list := []byte{'['}
		for i, text := range texts {
			if i > 0 {
				list = append(list, ',')
			}
			list = jsjson.AppendQuoted(list, jsjson.FromString(text))
		}
		request.raw("texts", append(list, ']'))
	}
	return request.close()
}

func plainTextRequest(documentJSON string, includeHiddenText, title bool) (string, error) {
	request := newEnvelope()
	if err := request.document(documentJSON); err != nil {
		return "", err
	}
	request.boolean("includeHiddenText", includeHiddenText)
	if title {
		request.boolean("title", true)
	}
	return request.close()
}

// The runtime reads the title flag only from a wrapper: on a bare document,
// title is the title string itself.
func titleRequest(documentJSON string) (string, error) {
	request := newEnvelope()
	if err := request.document(documentJSON); err != nil {
		return "", err
	}
	request.boolean("title", true)
	return request.close()
}

// pagesRequest builds the entries before parsing the document, as C# does,
// so pageHref runs even for a document that then fails to parse.
func pagesRequest(documentJSON string, pages map[string]*PageInfo, pageHref func(string) string, title bool) (string, error) {
	entries := newEnvelope()
	for _, pageID := range sortedKeys(pages) {
		entries.raw(pageID, pageEntry(pageID, pages[pageID], pageHref))
	}
	request := newEnvelope()
	if err := request.document(documentJSON); err != nil {
		return "", err
	}
	request.raw("pages", append(entries.buf, '}'))
	if title {
		request.boolean("title", true)
	}
	return request.close()
}

func pageEntry(pageID string, info *PageInfo, pageHref func(string) string) []byte {
	if info == nil {
		return []byte("null")
	}
	entry := newEnvelope()
	if info.NoAccess {
		entry.str("access", "none")
		return append(entry.buf, '}')
	}
	if info.Title != nil {
		entry.str("title", *info.Title)
	}
	if info.Icon != nil {
		icon := newEnvelope()
		if info.Icon.IsImage() {
			icon.str("type", "image")
			icon.str("url", info.Icon.Value())
		} else {
			icon.str("type", "emoji")
			icon.str("value", info.Icon.Value())
		}
		entry.raw("icon", append(icon.buf, '}'))
	}
	if pageHref != nil {
		if href := pageHref(pageID); href != "" {
			entry.str("href", href)
		}
	}
	return append(entry.buf, '}')
}

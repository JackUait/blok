package convert

import (
	"github.com/JackUait/blok/packages/server/go/internal/jsjson"
	"github.com/JackUait/blok/packages/server/go/internal/yjs"
)

type legacyField struct {
	data      *yjs.Map
	kind, key string
	keyUnits  jsjson.Str
	html      jsjson.Str
	built     *yjs.XmlText
}

// legacyRichText is every top-level rich field still holding HTML (a plain
// Y.Text or a string), in every block map entry, not only the ones the
// export reaches: an orphan left holding HTML would surface later in a
// format-2 room. A database-row's nested documents stay plain JSON.
func legacyRichText(doc *yjs.Doc, fields *RichTextFields) []legacyField {
	var found []legacyField
	blockMap := doc.GetMap(str(blocksRoot))
	for _, id := range blockMap.Keys() {
		block, ok := mapValue(blockMap, id).(*yjs.Map)
		if !ok {
			continue
		}
		kind, ok := mapValue(block, str("type")).(jsjson.Str)
		if !ok {
			continue
		}
		data, ok := mapValue(block, str("data")).(*yjs.Map)
		if !ok {
			continue
		}
		for _, key := range data.Keys() {
			if !fields.IsRich(kind.String(), key.String()) {
				continue
			}
			var html jsjson.Str
			switch v := mapValue(data, key).(type) {
			case *yjs.Text:
				html = v.Units()
			case jsjson.Str:
				html = v
			default:
				continue
			}
			// Dropped as the client's stripNul drops it; kept, it would fail
			// the NUL guard after the whole read, on every open.
			found = append(found, legacyField{data: data, kind: kind.String(), key: key.String(), keyUnits: key, html: withoutNul(html)})
		}
	}
	return found
}

// CollectLegacyRichText is the HTML a format-1 room still holds in its rich
// fields, each string once: what MigrateRichText needs read. It writes nothing.
func CollectLegacyRichText(doc *yjs.Doc, fields *RichTextFields) []RichTextHTML {
	input := Collecting(fields)
	for _, field := range legacyRichText(doc, fields) {
		_, _ = input.Segments(field.kind, field.key, field.html)
	}
	return input.Found()
}

// MigrateRichText is format 1 to 2: each legacy rich field becomes a
// formatted text built from input's segments, all in one transaction. Every
// field is built first, so a refused one writes nothing. It returns how
// many fields were replaced.
func MigrateRichText(doc *yjs.Doc, input *RichTextInput) (int, error) {
	planned := legacyRichText(doc, input.Fields)
	for i := range planned {
		segments, err := richSegments(planned[i].kind, planned[i].key, planned[i].html, input)
		if err != nil {
			return 0, err
		}
		planned[i].built = newRichText(segments)
	}
	if len(planned) == 0 {
		return 0, nil
	}
	doc.Transact(func(t *yjs.Transaction) {
		for _, field := range planned {
			field.data.Set(t, field.keyUnits, field.built)
		}
	})
	return len(planned), nil
}

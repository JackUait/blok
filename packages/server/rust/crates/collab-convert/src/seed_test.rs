use std::collections::HashMap;
use std::sync::OnceLock;

use blok_collab_collabtest::read_bytes;
use blok_jsjson::{Node, Options as JsonOptions, Str, Value, parse_node, stringify};
use blok_jsruntime::{Options as PoolOptions, Pool};
use blok_yjs::{Doc, Options, Out};

use crate::editops::JSON_MAX_DEPTH;
use crate::error::Error;
use crate::export::{BLOCKS_ROOT, export, export_page};
use crate::export_test::{canonical, collab_cases};
use crate::fields::RichTextFields;
use crate::htmlreader::{HtmlReader, RuntimeHtmlReader};
use crate::richtextinput::RichTextInput;
use crate::seed::{SourceValue, collect_seed_html, seed, strict_value};

pub(crate) fn reader() -> &'static RuntimeHtmlReader<Pool> {
    static READER: OnceLock<RuntimeHtmlReader<Pool>> = OnceLock::new();
    READER.get_or_init(|| RuntimeHtmlReader {
        runtime: Pool::new(PoolOptions {
            pool_size: Some(1),
            ..PoolOptions::default()
        })
        .unwrap_or_else(|err| panic!("{err}")),
    })
}

pub(crate) fn node_of(relative: &str) -> Node {
    parse_node(
        &read_bytes(relative),
        JsonOptions {
            max_depth: JSON_MAX_DEPTH,
            ..JsonOptions::default()
        },
    )
    .unwrap_or_else(|err| panic!("{relative}: {err}"))
}

/// RichTextRuntime: collect the seed's HTML, read it in the runtime.
pub(crate) fn converted(blocks: &[Node]) -> HashMap<Str, Vec<Value>> {
    let found = collect_seed_html(blocks, &RichTextFields::built_in())
        .unwrap_or_else(|err| panic!("{err}"));
    let mut converted = HashMap::new();
    if found.is_empty() {
        return converted;
    }
    let read = crate::csharp_yrs_compat_test::block_on(reader().read(&found, None))
        .unwrap_or_else(|err| panic!("{err}"));
    for (field, segments) in found.iter().zip(read) {
        converted.insert(field.html.clone(), segments);
    }
    converted
}

pub(crate) fn exported(doc: &Doc) -> Value {
    let (blocks, slots) =
        export(doc, &RichTextFields::built_in(), None).unwrap_or_else(|err| panic!("{err}"));
    assert!(slots.is_empty(), "{} HTML slots", slots.len());
    Value::Array(blocks)
}

fn seed_converting(doc: &Doc, blocks: &[Node], page: Option<&blok_jsjson::Object<SourceValue>>) {
    let fields = RichTextFields::built_in();
    let mut input = RichTextInput::converting(&fields, converted(blocks));
    seed(doc, blocks, &mut input, page).unwrap_or_else(|err| panic!("{err}"));
}

// Twins of SeedingInputJsonExportsCanonicalJson and
// SeedRoundTripsThroughStateDiffIntoASecondDoc.
#[test]
fn seeding_the_input_exports_the_canonical_json() {
    let mut failures = Vec::new();
    for c in collab_cases() {
        let blocks = node_of(&format!("collab/{}/input.json", c.name)).items;
        let source = Doc::new(Options::default());
        seed_converting(&source, &blocks, None);
        let want = canonical(&c.segments);
        let got = canonical(&exported(&source));
        if got != want {
            failures.push(format!("{} seed:\n got {got}\nwant {want}", c.name));
            continue;
        }
        let replica = Doc::new(Options::default());
        let diff = source
            .encode_state_as_update(&replica.encode_state_vector())
            .unwrap_or_else(|err| panic!("{err}"));
        replica
            .apply_update(&diff)
            .unwrap_or_else(|err| panic!("{err}"));
        let got = canonical(&exported(&replica));
        if got != want {
            failures.push(format!("{} replica:\n got {got}\nwant {want}", c.name));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

// Twin of SeedingPageJsonExportsCanonicalPage.
#[test]
fn seeding_the_page_exports_the_canonical_page() {
    let mut pages = 0;
    let mut failures = Vec::new();
    for c in collab_cases() {
        let Some(page_canon) = &c.page_canon else {
            continue;
        };
        pages += 1;
        let blocks = node_of(&format!("collab/{}/input.json", c.name)).items;
        let doc = Doc::new(Options::default());
        let page = match strict_value(&node_of(&format!("collab/{}/page.json", c.name))) {
            Ok(SourceValue::Object(page)) => page,
            other => panic!("{}: {other:?}", c.name),
        };
        seed_converting(&doc, &blocks, Some(&page));
        let got = canonical(&Value::Object(
            export_page(&doc).unwrap_or_else(|err| panic!("{err}")),
        ));
        let want = canonical(page_canon);
        if got != want {
            failures.push(format!("{}:\n got {got}\nwant {want}", c.name));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert_eq!(pages, 7, "{pages} page cases");
}

pub(crate) fn seed_json(text: &str) -> Doc {
    let node = parse_node(
        text.as_bytes(),
        JsonOptions {
            max_depth: JSON_MAX_DEPTH,
            ..JsonOptions::default()
        },
    )
    .unwrap_or_else(|err| panic!("{err}"));
    let doc = Doc::new(Options::default());
    let fields = RichTextFields::built_in();
    seed(
        &doc,
        &node.items,
        &mut RichTextInput::refusing(&fields),
        None,
    )
    .unwrap_or_else(|err| panic!("{err}"));
    doc
}

// Two rows naming one rowId cannot share a key: the second gets a minted one.
#[test]
fn a_second_row_with_the_same_row_id_gets_its_own_key() {
    let doc = seed_json(
        r#"[{"id":"t","type":"table","data":{"content":[[{"rowId":"r"}],[{"rowId":"r","x":1}]]}}]"#,
    );
    assert_eq!(
        canonical(&exported(&doc)),
        r#"[{"data":{"content":[[{"rowId":"r"}],[{"rowId":"r","x":1}]]},"id":"t","type":"table"}]"#
    );
}

// A content string spreads into runes, an astral character whole. A lone
// surrogate never gets here: reading the string fails first, as in C#.
#[test]
fn a_content_string_spreads_into_runes() {
    let doc = seed_json(r#"[{"id":"p","type":"paragraph","data":{},"content":"a😀b"}]"#);
    let block = doc
        .get_map(BLOCKS_ROOT)
        .unwrap_or_else(|err| panic!("{err}"))
        .get("p")
        .and_then(|block| block.as_map())
        .unwrap_or_else(|| panic!("no block p"));
    let ids = block
        .get("contentIds")
        .and_then(|ids| ids.as_array())
        .unwrap_or_else(|| panic!("no contentIds"));
    let values: Vec<Value> = ids
        .values()
        .into_iter()
        .map(|id| match id {
            Out::Any(value) => value,
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(
        stringify(&Value::Array(values)).unwrap_or_else(|err| panic!("{err}")),
        "[\"a\",\"\u{1F600}\",\"b\"]"
    );
}

// GetValue<string> throws InvalidOperationException on a lone-surrogate
// escape (probed), so a seed reading one fails, and not as a DataError.
#[test]
fn a_seed_string_that_is_not_unicode_fails() {
    let node = parse_node(
        br#"[{"id":"p","type":"paragraph","data":{"x":"\ud800"}}]"#,
        JsonOptions {
            max_depth: JSON_MAX_DEPTH,
            ..JsonOptions::default()
        },
    )
    .unwrap_or_else(|err| panic!("{err}"));
    let fields = RichTextFields::built_in();
    let err = seed(
        &Doc::new(Options::default()),
        &node.items,
        &mut RichTextInput::refusing(&fields),
        None,
    );
    assert!(matches!(err, Err(Error::NotUnicode(_))), "{err:?}");
}

/// Go's rowKeyCounter: prefix and a nine-digit count, ten units like a minted key.
pub(crate) fn row_key_counter(prefix: &str) -> impl FnMut() -> Str + 'static {
    let prefix = prefix.to_owned();
    let mut next = 0;
    move || {
        next += 1;
        Str::from(format!("{prefix}{next:09}").as_str())
    }
}

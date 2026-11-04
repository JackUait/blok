use std::time::Instant;

use blok_jsjson::Str;

use crate::textdiff::{atomize, diff};

// Twin of C# TextDiffGraphemeTests: atoms the client's atomize answers.
const CASES: &[(&str, &str, &[&str])] = &[
    (
        "ASCII",
        "hello world",
        &["h", "e", "l", "l", "o", " ", "w", "o", "r", "l", "d"],
    ),
    (
        "ASCII markup",
        "<b>bold</b> &amp; plain",
        &[
            "<b>", "b", "o", "l", "d", "</b>", " ", "&amp;", " ", "p", "l", "a", "i", "n",
        ],
    ),
    ("combining acute", "e\u{301}", &["e\u{301}"]),
    (
        "stacked marks",
        "a\u{300}\u{327}b",
        &["a\u{300}\u{327}", "b"],
    ),
    (
        "skin tone",
        "\u{1F44D}\u{1F3FF}!",
        &["\u{1F44D}\u{1F3FF}", "!"],
    ),
    (
        "ZWJ family",
        "x\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}y",
        &["x", "\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}", "y"],
    ),
    ("flag", "\u{1F1EF}\u{1F1F5}", &["\u{1F1EF}\u{1F1F5}"]),
    (
        "two flags",
        "\u{1F1EF}\u{1F1F5}\u{1F1E9}\u{1F1EA}",
        &["\u{1F1EF}\u{1F1F5}", "\u{1F1E9}\u{1F1EA}"],
    ),
    (
        "tag flag",
        "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
        &["\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}"],
    ),
    ("keycap", "#\u{FE0F}\u{20E3}", &["#\u{FE0F}\u{20E3}"]),
    ("CRLF", "a\u{D}\u{A}b", &["a", "\u{D}\u{A}", "b"]),
    (
        "Hangul jamo",
        "\u{1100}\u{1161}\u{11A8}",
        &["\u{1100}\u{1161}\u{11A8}"],
    ),
    ("Thai", "\u{E01}\u{E33}", &["\u{E01}\u{E33}"]),
    ("plain emoji", "\u{1F600}", &["\u{1F600}"]),
    (
        "variation selector",
        "\u{2764}\u{FE0F}",
        &["\u{2764}\u{FE0F}"],
    ),
    (
        "Devanagari conjunct",
        "\u{915}\u{94D}\u{930}",
        &["\u{915}\u{94D}\u{930}"],
    ),
    (
        "Devanagari conjunct chain",
        "\u{915}\u{94D}\u{930}\u{94D}\u{92F}",
        &["\u{915}\u{94D}\u{930}\u{94D}\u{92F}"],
    ),
    (
        "Devanagari double linker",
        "\u{915}\u{94D}\u{94D}\u{930}",
        &["\u{915}\u{94D}\u{94D}\u{930}"],
    ),
    (
        "Devanagari nukta before linker",
        "\u{915}\u{93C}\u{94D}\u{930}",
        &["\u{915}\u{93C}\u{94D}\u{930}"],
    ),
    (
        "Devanagari spacing mark breaks the conjunct",
        "\u{915}\u{93E}\u{94D}\u{930}",
        &["\u{915}\u{93E}\u{94D}", "\u{930}"],
    ),
    (
        "ZWNJ breaks the conjunct",
        "\u{915}\u{200C}\u{94D}\u{930}",
        &["\u{915}\u{200C}\u{94D}", "\u{930}"],
    ),
    (
        "linker after a non-consonant",
        "b\u{94D}\u{930}",
        &["b\u{94D}", "\u{930}"],
    ),
    (
        "linker before a non-consonant",
        "\u{915}\u{94D}z",
        &["\u{915}\u{94D}", "z"],
    ),
    (
        "Bengali conjunct",
        "\u{995}\u{9CD}\u{9B0}",
        &["\u{995}\u{9CD}\u{9B0}"],
    ),
    (
        "Gujarati conjunct",
        "\u{A95}\u{ACD}\u{AB0}",
        &["\u{A95}\u{ACD}\u{AB0}"],
    ),
    (
        "Oriya conjunct",
        "\u{B15}\u{B4D}\u{B30}",
        &["\u{B15}\u{B4D}\u{B30}"],
    ),
    (
        "Telugu conjunct",
        "\u{C15}\u{C4D}\u{C30}",
        &["\u{C15}\u{C4D}\u{C30}"],
    ),
    (
        "Malayalam conjunct",
        "\u{D15}\u{D4D}\u{D30}",
        &["\u{D15}\u{D4D}\u{D30}"],
    ),
    (
        "conjunct in markup",
        "<i>\u{915}\u{94D}\u{930}</i>",
        &["<i>", "\u{915}\u{94D}\u{930}", "</i>"],
    ),
    (
        "conjunct beside an entity",
        "&amp;\u{915}\u{94D}\u{930}",
        &["&amp;", "\u{915}\u{94D}\u{930}"],
    ),
    ("tag then accent", "<b>\u{301}x", &["<b>", "\u{301}", "x"]),
    (
        "Prepend before a complete tag",
        "\u{600}<b>bold</b> tail",
        &[
            "\u{600}", "<b>", "b", "o", "l", "d", "</b>", " ", "t", "a", "i", "l",
        ],
    ),
    (
        "Prepend before a closing tag",
        "\u{600}</a>x",
        &["\u{600}", "</a>", "x"],
    ),
    (
        "Prepend before a tag with attributes",
        "\u{600}<a href=\"x\">y</a>",
        &["\u{600}", "<a href=\"x\">", "y", "</a>"],
    ),
    (
        "Prepend before a named entity",
        "\u{600}&amp;",
        &["\u{600}", "&amp;"],
    ),
    (
        "Prepend before a numeric entity",
        "\u{600}&#65;",
        &["\u{600}", "&#65;"],
    ),
    (
        "Prepend before a bare less-than",
        "\u{600}<x no tag",
        &["\u{600}<", "x", " ", "n", "o", " ", "t", "a", "g"],
    ),
    (
        "Prepend before a bare ampersand",
        "\u{600}&notanentity",
        &[
            "\u{600}&", "n", "o", "t", "a", "n", "e", "n", "t", "i", "t", "y",
        ],
    ),
    (
        "Malayalam Prepend before a tag",
        "\u{D4E}<b>x",
        &["\u{D4E}", "<b>", "x"],
    ),
];

#[test]
fn splits_a_character_the_way_the_client_does() {
    assert_eq!(CASES.len(), 39);
    for (name, text, expected) in CASES {
        let text = Str::from(*text);
        let atoms = atomize(&text, true);
        let want: Vec<Str> = expected.iter().map(|atom| Str::from(*atom)).collect();
        assert_eq!(atoms, want, "{name}");
        let joined: Vec<u16> = atoms.iter().flat_map(|atom| atom.iter().copied()).collect();
        assert_eq!(joined, text.0, "{name}");
    }
}

// 16000 pairs fit the 32768-unit HTML cap.
#[test]
fn a_long_conjunct_run_diffs_in_linear_time() {
    let run = Str::from("\u{915}\u{94D}".repeat(16000));
    let started = Instant::now();
    let mut with_ka = run.clone();
    with_ka.push(0x0915);
    let atoms = atomize(&with_ka, true);
    let mut inserted = run.clone();
    inserted.insert(16000, u16::from(b'x'));
    let edits = diff(&run, &inserted, true);
    let elapsed = started.elapsed();
    assert!(elapsed.as_secs_f64() < 1.0, "{elapsed:?}");
    assert_eq!(atoms.len(), 1);
    assert!(!edits.is_empty());
}

#[test]
fn keeps_a_lone_surrogate_as_its_own_atom() {
    let text = Str::from(vec![u16::from(b'a'), 0xD83D, u16::from(b'b')]);
    assert_eq!(
        atomize(&text, true),
        vec![Str::from("a"), Str::from(vec![0xD83D]), Str::from("b")]
    );
}

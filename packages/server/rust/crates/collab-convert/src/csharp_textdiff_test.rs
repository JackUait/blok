use blok_jsjson::Str;

use crate::textdiff::{MAX_DIFF_DISTANCE, TextEdit, atomize, diff};

// Twins of C# TextDiffTests; C# Diff defaults to markup on.

fn s(text: &str) -> Str {
    Str::from(text)
}

fn d(before: &str, after: &str) -> Vec<TextEdit> {
    diff(&s(before), &s(after), true)
}

fn edit(index: usize, remove: usize, insert: &str) -> TextEdit {
    TextEdit {
        index,
        remove,
        insert: s(insert),
    }
}

// Applies edits the way EditText does: back to front.
fn apply(before: &Str, edits: &[TextEdit]) -> Str {
    let mut text = before.0.clone();
    for edit in edits.iter().rev() {
        text.splice(
            edit.index..edit.index + edit.remove,
            edit.insert.iter().copied(),
        );
    }
    Str::from(text)
}

fn contains(haystack: &[u16], needle: &str) -> bool {
    let needle = s(needle);
    haystack
        .windows(needle.len())
        .any(|window| window == &needle[..])
}

#[test]
fn wrapping_a_phrase_is_two_inserts_and_touches_nothing_else() {
    assert_eq!(
        d("the quick brown fox", "the <b>quick brown</b> fox"),
        vec![edit(4, 0, "<b>"), edit(15, 0, "</b>")]
    );
}

#[test]
fn edits_come_back_in_ascending_index_order() {
    let edits = d("one two three four", "one TWO three FOUR");
    let mut sorted = edits.clone();
    sorted.sort_by_key(|edit| edit.index);
    assert_eq!(sorted, edits);
    assert!(edits.len() > 1, "two separate changes should be two edits");
    assert_eq!(
        apply(&s("one two three four"), &edits),
        s("one TWO three FOUR")
    );
}

#[test]
fn an_edit_after_an_emoji_is_indexed_in_code_units() {
    assert_eq!(d("\u{1F44D}ab", "\u{1F44D}axb"), vec![edit(3, 0, "x")]);
}

#[test]
fn swapping_an_emoji_moves_whole_code_points() {
    let edits = d("a\u{1F44D}b", "a\u{1F44E}b");
    assert_eq!(edits, vec![edit(1, 2, "\u{1F44E}")]);
    assert_eq!(apply(&s("a\u{1F44D}b"), &edits), s("a\u{1F44E}b"));
}

#[test]
fn a_lone_surrogate_is_carried_through() {
    let a = u16::from(b'a');
    let b = u16::from(b'b');
    let c = u16::from(b'c');
    let before = Str::from(vec![a, 0xD83D, b]);
    let after = Str::from(vec![a, 0xD83D, b, c]);
    let edits = diff(&before, &after, true);
    assert_eq!(apply(&before, &edits), after);
}

#[test]
fn an_edit_distance_of_exactly_the_cap_is_still_minimal() {
    let before = s(&"a".repeat(MAX_DIFF_DISTANCE));
    let after = s(&"ab".repeat(MAX_DIFF_DISTANCE));
    let edits = diff(&before, &after, true);
    assert_eq!(edits.len(), MAX_DIFF_DISTANCE);
    assert_eq!(apply(&before, &edits), after);
}

#[test]
fn past_the_character_cap_the_search_runs_over_words() {
    let words: Vec<String> = (0..40).map(|index| format!("word{index}")).collect();
    let before = s(&words.join(" "));
    let mut rewritten = words.clone();
    rewritten[5] = "replacement-of-considerable-length-five".into();
    rewritten[20] = "replacement-of-considerable-length-twenty".into();
    let after = s(&rewritten.join(" "));
    let edits = diff(&before, &after, true);
    assert!(
        edits.len() > 1,
        "two separate word changes should not collapse into one rewritten region"
    );
    assert_eq!(apply(&before, &edits), after);
    for edit in &edits {
        assert!(!contains(&edit.insert, "word0"));
    }
}

#[test]
fn past_the_cap_each_gap_is_answered_on_its_own() {
    let join = |prefix: &str| {
        (0..60)
            .map(|index| format!("{prefix}{index}"))
            .collect::<Vec<_>>()
            .join(" ")
    };
    let before = s(&join("before"));
    let after = s(&join("after"));
    let edits = diff(&before, &after, true);
    assert_eq!(edits[0], edit(0, 7, "after0"));
    assert!(
        edits.len() > 50,
        "a per-gap answer, not one region: {} edits",
        edits.len()
    );
    assert_eq!(apply(&before, &edits), after);
}

#[test]
fn with_no_anchors_the_single_region_answer_still_stands() {
    assert_eq!(
        d(&"a".repeat(200), &"b".repeat(200)),
        vec![edit(0, 200, &"b".repeat(200))]
    );
}

#[test]
fn a_tag_is_one_unit_and_never_shares_a_character_with_content() {
    assert_eq!(
        d("hello", "<b>hello</b>"),
        vec![edit(0, 0, "<b>"), edit(5, 0, "</b>")]
    );
    assert_eq!(d("<b>x</b>", "<b>y</b>"), vec![edit(3, 1, "y")]);
}

#[test]
fn a_quoted_angle_bracket_does_not_end_a_tag() {
    assert_eq!(
        d("<a title=\"a>b\">x</a>", "<a title=\"a>b\">y</a>"),
        vec![edit(15, 1, "y")]
    );
}

#[test]
fn malformed_markup_stays_ordinary_text() {
    assert_eq!(d("<b", "<b>"), vec![edit(0, 2, "<b>")]);
    assert_eq!(d("a < b", "a > b"), vec![edit(2, 1, ">")]);
    assert_eq!(d("<<<", ">>>"), vec![edit(0, 3, ">>>")]);
}

#[test]
fn markup_off_diffs_tag_and_entity_shaped_text_as_characters() {
    assert_eq!(
        diff(&s("x <b> &lt;"), &s("x <bQ> &lQt;"), false),
        vec![edit(4, 0, "Q"), edit(8, 0, "Q")]
    );
    assert_eq!(
        atomize(&s("<b>\u{1F44D}\u{1F3FD}"), false),
        vec![s("<"), s("b"), s(">"), s("\u{1F44D}\u{1F3FD}")]
    );
}

#[test]
fn an_entity_is_one_unit() {
    assert_eq!(d("&", "&amp;"), vec![edit(0, 1, "&amp;")]);
    assert_eq!(d("&amp;", "&"), vec![edit(0, 5, "&")]);
}

#[test]
fn deleting_a_duplicated_half_past_the_cap_still_deletes_it() {
    let once = "lorem ipsum dolor sit amet ".repeat(4);
    let twice = s(&once.repeat(2));
    let edits = diff(&twice, &s(&once), true);
    assert!(!edits.is_empty());
    assert_eq!(apply(&twice, &edits), s(&once));
}

#[test]
fn a_zero_width_no_break_space_separates_words_as_it_does_on_the_client() {
    let filler = "filler word here ".repeat(8);
    let before = s(&format!("{filler}keepthisword\u{feff}changethisword"));
    let after = s(&format!(
        "{}keepthisword\u{feff}CHANGED",
        filler.replace("filler", "FILLER")
    ));
    let edits = diff(&before, &after, true);
    for edit in &edits {
        assert!(!contains(&edit.insert, "keepthisword"));
    }
    assert_eq!(apply(&before, &edits), after);
}

#[test]
fn a_whole_string_rewrite_still_produces_the_right_text() {
    let before = s(&"a".repeat(200));
    let after = s(&"b".repeat(200));
    assert_eq!(apply(&before, &diff(&before, &after, true)), after);
}

#[test]
fn equal_texts_diff_to_nothing() {
    assert!(d("same", "same").is_empty());
    assert!(d("", "").is_empty());
}

#[test]
fn typing_a_word_is_a_single_insert() {
    assert_eq!(d("hello", "hello world"), vec![edit(5, 0, " world")]);
}

#[test]
fn clearing_the_text_is_one_delete() {
    assert_eq!(d("hello", ""), vec![edit(0, 5, "")]);
}

#[test]
fn filling_empty_text_is_one_insert() {
    assert_eq!(d("", "hello"), vec![edit(0, 0, "hello")]);
}

#[test]
#[ignore = "captures .NET's own Grapheme_Cluster_Break table through reflection; the_grapheme_table_is_the_capture checks the Rust table against that capture"]
fn the_grapheme_table_matches_the_runtime() {}

#[test]
#[ignore = "regenerates cases.json from C# TextDiff; diffs_like_csharp and atomizes_like_csharp check Rust against that capture"]
fn the_cases_match_the_diff() {}

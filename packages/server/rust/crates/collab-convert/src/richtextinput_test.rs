use std::collections::HashMap;

use blok_jsjson::{Str, Value};

use crate::export::RichTextHtml;
use crate::fields::RichTextFields;
use crate::richtextinput::RichTextInput;

fn s(text: &str) -> Str {
    Str::from(text)
}

#[test]
fn an_empty_string_needs_no_runtime() {
    let fields = RichTextFields::built_in();
    let mut input = RichTextInput::refusing(&fields);
    assert_eq!(
        input.segments(&s("paragraph"), &s("text"), &s("")),
        Ok(Vec::new())
    );
}

#[test]
fn collecting_records_each_html_once_in_the_order_met() {
    let fields = RichTextFields::built_in();
    let mut input = RichTextInput::collecting(&fields);
    for html in ["<b>a</b>", "b", "<b>a</b>"] {
        assert_eq!(
            input.segments(&s("paragraph"), &s("text"), &s(html)),
            Ok(Vec::new())
        );
    }
    assert_eq!(
        input.found(),
        [
            RichTextHtml {
                kind: s("paragraph"),
                field: s("text"),
                html: s("<b>a</b>"),
            },
            RichTextHtml {
                kind: s("paragraph"),
                field: s("text"),
                html: s("b"),
            },
        ]
    );
}

#[test]
fn converting_answers_by_the_exact_string_and_refuses_the_rest() {
    let fields = RichTextFields::built_in();
    let answer = vec![Value::String(s("x"))];
    let mut input =
        RichTextInput::converting(&fields, HashMap::from([(s("<i>x</i>"), answer.clone())]));
    assert_eq!(
        input.segments(&s("quote"), &s("text"), &s("<i>x</i>")),
        Ok(answer)
    );
    let err = input
        .segments(&s("quote"), &s("text"), &s("<i>x</i> "))
        .unwrap_err();
    assert_eq!(
        err.to_string(),
        "collab: rich text field \"quote.text\" holds HTML that was not converted to segments."
    );
    assert!(input.found().is_empty());
}

#[test]
fn refusing_refuses_any_html() {
    let fields = RichTextFields::built_in();
    let mut input = RichTextInput::refusing(&fields);
    let err = input
        .segments(&s("header"), &s("text"), &s("a"))
        .unwrap_err();
    assert_eq!(
        err.to_string(),
        "collab: rich text field \"header.text\" holds HTML that was not converted to segments."
    );
}

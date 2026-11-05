use std::future::Future;
use std::sync::Mutex;
use std::task::{Context, Poll, Waker};
use std::time::Duration;

use blok_jsjson::{Object, Str, Value};
use blok_jsruntime::InvokeError;

use crate::export::RichTextHtml;
use crate::htmlreader::{
    HtmlReader, Invoker, MAX_CALL_CHARS, MAX_EDIT_HTML_CHARS, RuntimeHtmlReader,
};

// The echo runtime is always ready, so one poll finishes every read.
fn block_on<F: Future>(future: F) -> F::Output {
    let mut future = std::pin::pin!(future);
    match future
        .as_mut()
        .poll(&mut Context::from_waker(Waker::noop()))
    {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("the echo runtime never waits"),
    }
}

/// Answers each field with one segment holding its HTML.
#[derive(Default)]
struct EchoRuntime {
    calls: Mutex<Vec<Vec<Str>>>,
    timeouts: Mutex<Vec<Option<Duration>>>,
}

impl EchoRuntime {
    fn answer(&self, op: &str, input: &str, timeout: Option<Duration>) -> String {
        self.timeouts.lock().unwrap().push(timeout);
        assert_eq!(op, "htmlFieldsToSegments");
        let Value::Array(entries) = blok_jsjson::parse(input.as_bytes()).unwrap() else {
            panic!("not an array");
        };
        let mut call = Vec::new();
        let mut answer = Vec::new();
        for entry in entries {
            let Value::Object(entry) = entry else {
                panic!("not an object");
            };
            let Some(Value::String(html)) = entry.get(&Str::from("html")) else {
                panic!("no html");
            };
            call.push(html.clone());
            let mut segment = Object::new();
            segment.set(Str::from("text"), Value::String(html.clone()));
            let mut answered = Object::new();
            answered.set(
                Str::from("segments"),
                Value::Array(vec![Value::Object(segment)]),
            );
            answer.push(Value::Object(answered));
        }
        self.calls.lock().unwrap().push(call);
        blok_jsjson::stringify(&Value::Array(answer)).unwrap()
    }

    fn calls(&self) -> Vec<Vec<Str>> {
        self.calls.lock().unwrap().clone()
    }
}

impl Invoker for EchoRuntime {
    fn invoke(
        &self,
        op: &str,
        input: &str,
        timeout: Option<Duration>,
    ) -> impl Future<Output = Result<String, InvokeError>> + Send {
        std::future::ready(Ok(self.answer(op, input, timeout)))
    }
}

fn html(texts: &[String]) -> Vec<RichTextHtml> {
    texts
        .iter()
        .map(|text| RichTextHtml {
            kind: Str::from("paragraph"),
            field: Str::from("text"),
            html: Str::from(text.as_str()),
        })
        .collect()
}

fn first_texts(read: &[Vec<Value>]) -> Vec<String> {
    read.iter()
        .map(|segments| match &segments[0] {
            Value::Object(segment) => match segment.get(&Str::from("text")) {
                Some(Value::String(text)) => text.to_string(),
                other => panic!("{other:?}"),
            },
            other => panic!("{other:?}"),
        })
        .collect()
}

// Twins of RuntimeRichTextHtmlReaderTests.
#[test]
fn reads_a_large_batch_in_bounded_calls_and_keeps_the_order() {
    let reader = RuntimeHtmlReader {
        runtime: EchoRuntime::default(),
    };
    let body = "x".repeat(MAX_CALL_CHARS / 4);
    let texts: Vec<String> = (0..10).map(|i| format!("{i}:{body}")).collect();
    let read = block_on(reader.read(&html(&texts), None)).unwrap();
    let calls = reader.runtime.calls();
    assert_eq!(calls.len(), 4, "{} calls", calls.len());
    for call in &calls {
        let total: usize = call.iter().map(|field| field.len()).sum();
        assert!(total <= MAX_CALL_CHARS, "a call carried {total}");
    }
    assert_eq!(first_texts(&read), texts, "order lost");
}

#[test]
fn two_fields_at_the_edit_cap_go_in_two_calls() {
    let reader = RuntimeHtmlReader {
        runtime: EchoRuntime::default(),
    };
    let body = "x".repeat(MAX_EDIT_HTML_CHARS - 1);
    block_on(reader.read(&html(&[format!("a{body}"), format!("b{body}")]), None)).unwrap();
    assert_eq!(reader.runtime.calls().len(), 2);
}

#[test]
fn passes_the_callers_budget_to_every_call() {
    let reader = RuntimeHtmlReader {
        runtime: EchoRuntime::default(),
    };
    let body = "x".repeat(MAX_CALL_CHARS);
    let minute = Duration::from_secs(60);
    block_on(reader.read(&html(&[body.clone(), body]), Some(minute))).unwrap();
    block_on(reader.read(&html(&["a".to_owned()]), None)).unwrap();
    assert_eq!(
        *reader.runtime.timeouts.lock().unwrap(),
        vec![Some(minute), Some(minute), None]
    );
}

#[test]
fn reads_an_oversized_field_in_a_call_of_its_own() {
    let reader = RuntimeHtmlReader {
        runtime: EchoRuntime::default(),
    };
    let huge = "h".repeat(MAX_CALL_CHARS + 1);
    let texts = ["a".to_owned(), huge.clone(), "b".to_owned()];
    let read = block_on(reader.read(&html(&texts), None)).unwrap();
    let calls = reader.runtime.calls();
    assert_eq!(calls.len(), 3, "{} calls", calls.len());
    assert_eq!(calls[1][0], Str::from(huge.as_str()));
    assert_eq!(first_texts(&read), texts);
}

// A field's length is UTF-16 units: an astral character costs two.
#[test]
fn the_call_cap_counts_utf16_units() {
    let reader = RuntimeHtmlReader {
        runtime: EchoRuntime::default(),
    };
    let half = "😀".repeat(MAX_CALL_CHARS / 4);
    block_on(reader.read(&html(&[half.clone(), half, "x".to_owned()]), None)).unwrap();
    assert_eq!(reader.runtime.calls().len(), 2);
}

#[test]
fn fields_that_exactly_fill_a_call_share_it() {
    let reader = RuntimeHtmlReader {
        runtime: EchoRuntime::default(),
    };
    let half = "x".repeat(MAX_CALL_CHARS / 2);
    block_on(reader.read(&html(&[half.clone(), half]), None)).unwrap();
    assert_eq!(reader.runtime.calls().len(), 1);
}

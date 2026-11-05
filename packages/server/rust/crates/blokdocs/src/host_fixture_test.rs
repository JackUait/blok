use std::sync::Mutex;
use std::time::Duration;

use blok_jsruntime::{Error as RuntimeError, Failure, InvokeError, Kind};

use crate::test_json::{self, Json, Map};
use crate::{Degradation, Error, InvokeFuture, PageIcon, PageInfo, Pages, Runtime, new_on_runtime};

pub(crate) fn read_fixture(name: &str) -> Json {
    let path = format!(
        "{}/../../../../../test/unit/server-conformance/fixtures/documents/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    test_json::parse(&std::fs::read_to_string(&path).unwrap_or_else(|err| panic!("{path}: {err}")))
}

/// Answers one call from the fixture and records the request.
struct Fake {
    answer: Option<String>,
    failure: Option<String>,
    requests: std::sync::Arc<Mutex<Vec<(String, String)>>>,
}

impl Runtime for Fake {
    fn invoke<'a>(&'a self, op: &'a str, input: &'a str, _: Option<Duration>) -> InvokeFuture<'a> {
        self.requests
            .lock()
            .expect("lock")
            .push((op.to_owned(), input.to_owned()));
        let outcome = match &self.failure {
            Some(failure) => {
                let kind = match failure.as_str() {
                    "Unknown" => Kind::Unknown,
                    "InvalidDocument" => Kind::InvalidDocument,
                    "TimedOut" => Kind::TimedOut,
                    "DocumentTooLarge" => Kind::DocumentTooLarge,
                    other => panic!("unknown failure {other}"),
                };
                Err(InvokeError::Failure(Failure {
                    kind,
                    err: RuntimeError::Engine("fake runtime failure".to_owned()),
                }))
            }
            None => Ok(self.answer.clone().expect("an answer")),
        };
        Box::pin(async move { outcome })
    }
}

fn object(members: Vec<(&str, Json)>) -> Json {
    Json::Object(
        members
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect::<Map>(),
    )
}

fn string(text: &str) -> Json {
    Json::String(text.to_owned())
}

fn optional(text: &Option<String>) -> Json {
    text.as_deref().map_or(Json::Null, string)
}

fn number(value: i32) -> Json {
    Json::Number(f64::from(value))
}

fn strings(list: &[String]) -> Json {
    Json::Array(list.iter().map(|text| string(text)).collect())
}

fn degradations(list: &[Degradation]) -> Json {
    Json::Array(
        list.iter()
            .map(|d| {
                object(vec![
                    ("construct", string(&d.construct)),
                    ("action", string(&d.action)),
                    ("detail", string(&d.detail)),
                ])
            })
            .collect(),
    )
}

fn args(case: &Json) -> &Map {
    match case.get("args") {
        Json::Object(map) => map,
        other => panic!("args is {other:?}"),
    }
}

fn arg_str(case: &Json, name: &str) -> String {
    match args(case).get(name) {
        None | Some(Json::Null) => String::new(),
        Some(value) => value.str().to_owned(),
    }
}

fn arg_bool(case: &Json, name: &str) -> bool {
    args(case).get(name).is_some_and(Json::bool)
}

fn arg_map(case: &Json, name: &str) -> Option<crate::IdMap> {
    match args(case).get(name) {
        None | Some(Json::Null) => None,
        Some(Json::Object(map)) => Some(
            map.iter()
                .map(|(key, value)| (key.clone(), value.str().to_owned()))
                .collect(),
        ),
        Some(other) => panic!("{name} is {other:?}"),
    }
}

fn fixture_pages(case: &Json) -> Option<Pages> {
    let Some(Json::Object(raw)) = args(case).get("pages") else {
        return None;
    };
    Some(
        raw.iter()
            .map(|(id, page)| {
                let Json::Object(page) = page else {
                    return (id.clone(), None);
                };
                let icon = match page.get("icon") {
                    Some(Json::Object(icon)) => Some(match icon.get("emoji") {
                        Some(Json::String(emoji)) => PageIcon::Emoji(emoji.clone()),
                        _ => PageIcon::Image(icon.get("image").expect("image").str().to_owned()),
                    }),
                    _ => None,
                };
                let info = PageInfo {
                    title: page.get("title").and_then(Json::opt_str).map(str::to_owned),
                    icon,
                    no_access: page.get("noAccess").is_some_and(Json::bool),
                };
                (id.clone(), Some(info))
            })
            .collect(),
    )
}

async fn call(
    case: &Json,
    converter: &crate::Converter,
    href_calls: &Mutex<Vec<String>>,
) -> Result<Json, Error> {
    let document = arg_str(case, "document");
    let hidden = arg_bool(case, "includeHiddenText");
    let code = arg_bool(case, "includeCode");
    let hrefs = arg_map(case, "pageHrefs");
    let href = |id: &str| {
        href_calls.lock().expect("lock").push(id.to_owned());
        hrefs
            .as_ref()
            .and_then(|table| table.iter().find(|(key, _)| key == id))
            .map(|(_, href)| href.clone())
            .unwrap_or_default()
    };
    let href: Option<crate::PageHref<'_>> = hrefs.as_ref().map(|_| &href as crate::PageHref<'_>);
    let pages = fixture_pages(case);
    let pages = pages.as_ref();
    let markdown = |m: crate::MarkdownConversion| {
        object(vec![
            ("markdown", string(&m.markdown)),
            ("warnings", degradations(&m.warnings)),
        ])
    };
    let imported = |r: crate::ImportConversion| {
        object(vec![
            ("document", string(&r.document_json)),
            ("warnings", degradations(&r.warnings)),
        ])
    };
    let method = case.get("method").str();
    Ok(match method {
        "ToMarkdown" => markdown(converter.to_markdown(&document).await?),
        "ToMarkdownWithPages" => markdown(
            converter
                .to_markdown_with_pages(&document, pages, href)
                .await?,
        ),
        "ToMarkdownWithTitle" => markdown(converter.to_markdown_with_title(&document).await?),
        "ToMarkdownWithTitleAndPages" => markdown(
            converter
                .to_markdown_with_title_and_pages(&document, pages, href)
                .await?,
        ),
        "ToHtml" => string(&converter.to_html(&document).await?),
        "ToHtmlWithPages" => string(&converter.to_html_with_pages(&document, pages, href).await?),
        "ToHtmlWithTitle" => string(&converter.to_html_with_title(&document).await?),
        "ToHtmlWithTitleAndPages" => string(
            &converter
                .to_html_with_title_and_pages(&document, pages, href)
                .await?,
        ),
        "ToPlainText" => string(&converter.to_plain_text(&document, hidden).await?),
        "ToPlainTextWithTitle" => string(
            &converter
                .to_plain_text_with_title(&document, hidden)
                .await?,
        ),
        "ToPlainTextWithReport" => {
            let report = converter
                .to_plain_text_with_report(&document, hidden)
                .await?;
            object(vec![
                ("text", string(&report.text)),
                ("warnings", degradations(&report.warnings)),
            ])
        }
        "ExtractTexts" => strings(&converter.extract_texts(&document, code).await?),
        "InjectTexts" => {
            let texts: Option<Vec<String>> = match args(case).get("texts") {
                None | Some(Json::Null) => None,
                Some(list) => Some(list.array().iter().map(|t| t.str().to_owned()).collect()),
            };
            string(
                &converter
                    .inject_texts(&document, texts.as_deref(), code)
                    .await?,
            )
        }
        "PageIndex" => {
            let index = converter.page_index(&document).await?;
            object(vec![
                (
                    "owners",
                    Json::Array(
                        index
                            .owners
                            .iter()
                            .map(|o| {
                                object(vec![
                                    ("pageId", string(&o.page_id)),
                                    ("sourceBlockId", string(&o.source_block_id)),
                                    ("order", number(o.order)),
                                ])
                            })
                            .collect(),
                    ),
                ),
                (
                    "text",
                    Json::Array(
                        index
                            .text
                            .iter()
                            .map(|t| {
                                object(vec![
                                    ("blockId", optional(&t.block_id)),
                                    ("order", number(t.order)),
                                    ("text", string(&t.text)),
                                ])
                            })
                            .collect(),
                    ),
                ),
                (
                    "references",
                    Json::Array(
                        index
                            .references
                            .iter()
                            .map(|r| {
                                object(vec![
                                    ("pageId", string(&r.page_id)),
                                    ("sourceBlockId", optional(&r.source_block_id)),
                                    ("order", number(r.order)),
                                ])
                            })
                            .collect(),
                    ),
                ),
            ])
        }
        "RemapPageDocument" => string(
            &converter
                .remap_page_document(
                    &document,
                    arg_map(case, "blockIds").as_ref(),
                    arg_map(case, "pageIds").as_ref(),
                )
                .await?,
        ),
        "Validate" => {
            let v = converter.validate(&document).await?;
            object(vec![
                ("isDocument", Json::Bool(v.is_document)),
                ("isEmpty", Json::Bool(v.is_empty)),
                ("blockCount", number(v.block_count)),
                ("malformedBlockCount", number(v.malformed_block_count)),
                (
                    "unrecognizedBlockTypes",
                    strings(&v.unrecognized_block_types),
                ),
                (
                    "failure",
                    v.failure
                        .map_or(Json::Null, |reason| string(&reason.to_string())),
                ),
                ("isFullyUnderstood", Json::Bool(v.is_fully_understood())),
            ])
        }
        "FromMarkdown" => imported(converter.from_markdown(&arg_str(case, "text")).await?),
        "FromHtml" => imported(converter.from_html(&arg_str(case, "text")).await?),
        other => panic!("unknown method {other}"),
    })
}

/// Names an error the way the fixture does.
fn error_shape(err: &Error) -> Json {
    match err {
        Error::Conversion(conversion) => object(vec![
            ("kind", string("conversion")),
            ("reason", string(&conversion.reason.to_string())),
            ("message", string(&conversion.to_string())),
        ]),
        Error::Answer(answer) if answer.not_json => object(vec![("kind", string("json"))]),
        Error::Answer(answer) => object(vec![
            ("kind", string("invalidOperation")),
            ("message", string(&answer.message)),
        ]),
        argument if argument.param().is_some() => object(vec![
            ("kind", string("argument")),
            ("param", string(argument.param().unwrap_or_default())),
            ("message", string(&argument.to_string())),
        ]),
        other => object(vec![
            ("kind", string("unexpected")),
            ("message", string(&other.to_string())),
        ]),
    }
}

// Captured from C# (HostEnvelopeFixtureTests), which reads the same file.
#[tokio::test]
async fn matches_the_c_sharp_host_on_the_shared_fixture() {
    let cases = read_fixture("host.json");
    assert!(
        cases.array().len() >= 50,
        "only {} host cases",
        cases.array().len()
    );
    let mut failures = Vec::new();
    for case in cases.array() {
        let name = case.get("name").str();
        let runtime = case.get("runtime");
        let requests = std::sync::Arc::new(Mutex::new(Vec::new()));
        let fake = Fake {
            answer: match runtime {
                Json::Object(map) => map.get("answer").and_then(Json::opt_str).map(str::to_owned),
                _ => None,
            },
            failure: match runtime {
                Json::Object(map) => map.get("error").and_then(Json::opt_str).map(str::to_owned),
                _ => None,
            },
            requests: requests.clone(),
        };
        let converter = new_on_runtime(fake);
        let href_calls = Mutex::new(Vec::new());
        let outcome = call(case, &converter, &href_calls).await;

        let sent = requests.lock().expect("lock").clone();
        if sent.len() > 1 {
            failures.push(format!("{name}: runtime called {} times", sent.len()));
        }
        let got_request = sent
            .first()
            .map(|(op, input)| object(vec![("op", string(op)), ("input", string(input))]))
            .unwrap_or(Json::Null);
        let Json::Object(map) = case else {
            unreachable!()
        };
        let want_request = map.get("request").cloned().unwrap_or(Json::Null);
        if got_request != want_request {
            failures.push(format!(
                "{name}: request\n got {got_request:?}\nwant {want_request:?}"
            ));
        }
        let want_hrefs: Vec<String> = match map.get("hrefCalls") {
            Some(Json::Array(list)) => list.iter().map(|id| id.str().to_owned()).collect(),
            _ => Vec::new(),
        };
        let got_hrefs = href_calls.lock().expect("lock").clone();
        if got_hrefs != want_hrefs {
            failures.push(format!(
                "{name}: href calls {got_hrefs:?}, want {want_hrefs:?}"
            ));
        }
        let got = match outcome {
            Ok(result) => object(vec![("result", result)]),
            Err(err) => object(vec![("error", error_shape(&err))]),
        };
        let want = case.get("expect");
        if &got != want {
            failures.push(format!("{name}: outcome\n got {got:?}\nwant {want:?}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

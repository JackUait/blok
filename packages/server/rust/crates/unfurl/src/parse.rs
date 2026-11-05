use blok_dotnet::{Uri, parse_absolute_uri, resolve_uri};
use blok_jsjson::Str;
use html5ever::interface::TreeSink;
use html5ever::tendril::StrTendril;
use std::cell::RefCell;

use html5ever::tokenizer::{
    BufferQueue, CharacterTokens, EOFToken, EndTag, NullCharacterToken, StartTag, TagToken, Token,
    TokenSink, TokenSinkResult, Tokenizer, TokenizerOpts,
};
use html5ever::tree_builder::{TreeBuilder, TreeBuilderOpts};
use html5ever::{QualName, TokenizerResult, ns};

use crate::dom::{DOCUMENT, Kind, Node, Sink};

const MAX_OPEN_ELEMENT_DEPTH: usize = 512;

/// UnfurlMetadata. Empty fields are absent.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Metadata {
    pub title: String,
    pub description: String,
    pub image: String,
    pub favicon: String,
    pub domain: String,
    /// The first JSON oEmbed discovery link, resolved.
    pub oembed: String,
}

#[derive(Default)]
struct Found {
    title: String,
    og_title: String,
    twitter_title: String,
    og_description: String,
    twitter_description: String,
    description: String,
    og_image: String,
    twitter_image: String,
    icon: String,
    apple_icon: String,
    oembed: String,
}

/// Reads `body` as UTF-8, whatever charset the page names.
pub fn parse(body: &[u8], final_url: &str) -> Metadata {
    let base = parse_absolute_uri(final_url).filter(|base| !base.host.is_empty());
    let base = base.as_ref();
    // .NET decodes invalid UTF-8 to U+FFFD, one per maximal bad sequence.
    let text = Str::from_utf8(body).to_string();
    let nodes = build_tree(text);
    let mut found = Found::default();
    let mut stack = vec![(DOCUMENT, 0usize)];
    while let Some((index, depth)) = stack.pop() {
        let node = &nodes[index];
        if let Kind::Element { name, attrs, .. } = &node.kind {
            if depth > MAX_OPEN_ELEMENT_DEPTH {
                return build(base, Found::default());
            }
            let attribute = |key: &str| {
                attrs
                    .iter()
                    .find(|a| a.name.ns == ns!() && &*a.name.local == key)
                    .map(|a| a.value.trim().to_owned())
                    .unwrap_or_default()
            };
            match &*name.local {
                "title" if name.ns == ns!(html) => {
                    let first = node.children.first();
                    keep_first(
                        &mut found.title,
                        &first.map(|&c| text_content(&nodes, c)).unwrap_or_default(),
                    );
                }
                "meta" => {
                    let (property, name, content) = (
                        attribute("property"),
                        attribute("name"),
                        attribute("content"),
                    );
                    let slot = if property == "og:title" {
                        Some(&mut found.og_title)
                    } else if name == "twitter:title" {
                        Some(&mut found.twitter_title)
                    } else if property == "og:description" {
                        Some(&mut found.og_description)
                    } else if name == "twitter:description" {
                        Some(&mut found.twitter_description)
                    } else if name == "description" {
                        Some(&mut found.description)
                    } else if property == "og:image" {
                        Some(&mut found.og_image)
                    } else if name == "twitter:image" {
                        Some(&mut found.twitter_image)
                    } else {
                        None
                    };
                    if let Some(slot) = slot {
                        keep_first(slot, &content);
                    }
                }
                "link" => {
                    let href = attribute("href");
                    if !href.is_empty() {
                        for relation in attribute("rel").split(char::is_whitespace) {
                            if relation.is_empty() {
                                continue;
                            }
                            let relation = relation.to_ascii_lowercase();
                            // oEmbed JSON discovery only; XML discovery is ignored.
                            if relation == "alternate"
                                && attribute("type").eq_ignore_ascii_case("application/json+oembed")
                            {
                                keep_first(&mut found.oembed, &href);
                            }
                            if relation == "icon" {
                                keep_first(&mut found.icon, &href);
                            } else if relation.starts_with("apple-touch-icon") {
                                keep_first(&mut found.apple_icon, &href);
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        for &child in node.children.iter().rev() {
            stack.push((child, depth + 1));
        }
    }
    build(base, found)
}

/// AngleSharp 1.9.0's "in select" mode drops a start tag only when the
/// current node is the select itself; inside an option, optgroup or button
/// it builds normally. html5ever's drops them, as the older spec says, a
/// button too. So a dropped meta, link or title there is built back, at the
/// current node a probe comment finds, and a dropped button is built and
/// stands in for that node until its end tag. A rescued title holds what
/// follows, markup included (no RCDATA), until its end tag or the select
/// ends. Comments change no insertion mode. unfurl-html.json pins the
/// cases.
struct Rescue {
    builder: TreeBuilder<usize, Sink>,
    /// Rescued buttons still open, innermost last.
    buttons: RefCell<Vec<usize>>,
    /// A rescued title and the elements open inside it, innermost last.
    title: RefCell<Vec<usize>>,
}

/// Elements with no end tag.
fn is_void(name: &str) -> bool {
    matches!(
        name,
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "keygen"
            | "link"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
    )
}

/// Tags that end the select in AngleSharp's "in select" mode.
fn ends_select(tag: &html5ever::tokenizer::Tag) -> bool {
    match tag.kind {
        EndTag => &*tag.name == "select",
        StartTag => matches!(&*tag.name, "select" | "input" | "keygen" | "textarea"),
    }
}

impl Rescue {
    /// Builds what a rescued title holds. False when the token ends it and
    /// goes on to html5ever.
    fn inside_title(&self, token: &Token) -> bool {
        let sink = &self.builder.sink;
        let mut open = self.title.borrow_mut();
        let Some(&top) = open.last() else {
            return false;
        };
        match token {
            CharacterTokens(text) => sink.rescue_text(top, text.clone()),
            NullCharacterToken => sink.rescue_text(top, StrTendril::from("\u{FFFD}")),
            TagToken(tag) if ends_select(tag) => {
                open.clear();
                return false;
            }
            TagToken(tag) if tag.kind == StartTag => {
                let name = QualName::new(None, ns!(html), tag.name.clone());
                let element = sink.rescue(top, name, tag.attrs.clone());
                if !tag.self_closing && !is_void(&tag.name) {
                    open.push(element);
                }
            }
            TagToken(tag) => {
                let names = sink.local_names(&open);
                if let Some(at) = names.iter().rposition(|name| *name == tag.name) {
                    open.truncate(at);
                }
            }
            EOFToken => {
                open.clear();
                return false;
            }
            _ => {}
        }
        true
    }
}

impl TokenSink for Rescue {
    type Handle = usize;

    fn process_token(&self, token: Token, line_number: u64) -> TokenSinkResult<usize> {
        if self.inside_title(&token) {
            return TokenSinkResult::Continue;
        }
        let sink = &self.builder.sink;
        let TagToken(tag) = &token else {
            return self.builder.process_token(token, line_number);
        };
        if ends_select(tag) {
            self.buttons.borrow_mut().clear();
        } else if tag.kind == EndTag && &*tag.name == "button" {
            self.buttons.borrow_mut().pop();
        }
        if tag.kind != StartTag || !matches!(&*tag.name, "meta" | "link" | "title" | "button") {
            return self.builder.process_token(token, line_number);
        }
        sink.probing.set(true);
        sink.probe_parent.set(None);
        let _ = self
            .builder
            .process_token(Token::CommentToken(StrTendril::new()), line_number);
        sink.probing.set(false);
        let current = sink.probe_parent.get();
        let (local, attrs) = (tag.name.clone(), tag.attrs.clone());
        let created = sink.created.get();
        let result = self.builder.process_token(token, line_number);
        let Some(current) = current.filter(|_| sink.created.get() == created) else {
            return result;
        };
        let open_button = self.buttons.borrow().last().copied();
        let parent = match open_button {
            Some(button) => button,
            None if sink.in_select_option(current) => current,
            None if &*local == "button" && sink.is_select(current) => current,
            None => return result,
        };
        let element = sink.rescue(parent, QualName::new(None, ns!(html), local.clone()), attrs);
        match &*local {
            "button" => self.buttons.borrow_mut().push(element),
            "title" => self.title.borrow_mut().push(element),
            _ => {}
        }
        result
    }

    fn end(&self) {
        self.builder.end();
    }

    fn adjusted_current_node_present_but_not_in_html_namespace(&self) -> bool {
        self.builder
            .adjusted_current_node_present_but_not_in_html_namespace()
    }
}

fn build_tree(text: String) -> Vec<Node> {
    // AngleSharp parses with scripting off, so <noscript> holds markup.
    let options = TreeBuilderOpts {
        scripting_enabled: false,
        ..TreeBuilderOpts::default()
    };
    let tokenizer = Tokenizer::new(
        Rescue {
            builder: TreeBuilder::new(Sink::new(), options),
            buttons: RefCell::new(Vec::new()),
            title: RefCell::new(Vec::new()),
        },
        TokenizerOpts::default(),
    );
    let input = BufferQueue::default();
    input.push_back(StrTendril::from(text));
    while let TokenizerResult::Script(_) = tokenizer.feed(&input) {}
    tokenizer.end();
    tokenizer.sink.builder.sink.finish()
}

/// Keeps the first image and favicon a browser may load
/// (`browser_url`), so an http og:image gives way to an https
/// twitter:image. With a base, /favicon.ico is the last favicon to try.
fn build(base: Option<&Uri>, found: Found) -> Metadata {
    let mut favicons = vec![found.icon, found.apple_icon];
    let mut domain = String::new();
    if let Some(base) = base {
        let host = base.idn_host.to_lowercase();
        domain = host.strip_prefix("www.").unwrap_or(&host).to_owned();
        favicons.push("/favicon.ico".to_owned());
    }
    Metadata {
        title: first_non_empty([found.og_title, found.twitter_title, found.title]),
        description: first_non_empty([
            found.og_description,
            found.twitter_description,
            found.description,
        ]),
        image: first_browser_url(base, &[found.og_image, found.twitter_image]),
        favicon: first_browser_url(base, &favicons),
        domain,
        oembed: resolve_url(base, &found.oembed),
    }
}

fn first_browser_url(base: Option<&Uri>, references: &[String]) -> String {
    references
        .iter()
        .filter(|r| !r.is_empty())
        .map(|r| blok_outbound::browser_url(base, r))
        .find(|url| !url.is_empty())
        .unwrap_or_default()
}

fn resolve_url(base: Option<&Uri>, reference: &str) -> String {
    if reference.is_empty() {
        return String::new();
    }
    let resolved = match base {
        None => parse_absolute_uri(reference),
        Some(base) => resolve_uri(base, reference),
    };
    match resolved {
        Some(url) if url.is_http() && !url.host.is_empty() => url.absolute_uri,
        _ => String::new(),
    }
}

fn keep_first(destination: &mut String, value: &str) {
    if destination.is_empty() {
        *destination = value.trim().to_owned();
    }
}

fn first_non_empty<const N: usize>(values: [String; N]) -> String {
    values
        .into_iter()
        .find(|v| !v.is_empty())
        .unwrap_or_default()
}

fn text_content(nodes: &[Node], start: usize) -> String {
    let mut out = String::new();
    let mut stack = vec![start];
    while let Some(index) = stack.pop() {
        if let Kind::Text(text) = &nodes[index].kind {
            out.push_str(text);
        }
        stack.extend(nodes[index].children.iter().rev());
    }
    out
}

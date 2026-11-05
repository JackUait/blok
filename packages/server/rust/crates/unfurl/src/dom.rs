use std::borrow::Cow;
use std::cell::{Cell, Ref, RefCell};

use html5ever::interface::{ElementFlags, NodeOrText, QualName, QuirksMode, TreeSink};
use html5ever::tendril::StrTendril;
use html5ever::{Attribute, local_name, ns};

/// An arena, not an Rc tree: a deep page would overflow the stack when an
/// Rc tree drops itself recursively.
pub enum Kind {
    Document,
    Element {
        name: QualName,
        attrs: Vec<Attribute>,
        /// The template's content fragment, kept apart from its children as
        /// AngleSharp keeps it.
        contents: Option<usize>,
    },
    Text(String),
    Other,
}

pub struct Node {
    pub kind: Kind,
    pub parent: Option<usize>,
    pub children: Vec<usize>,
}

#[derive(Default)]
pub struct Sink {
    nodes: RefCell<Vec<Node>>,
    /// Elements made so far; a start tag that adds none was dropped.
    pub created: Cell<usize>,
    /// The next comment made is a probe; `probe_parent` gets the node it
    /// is appended to, which is the tree builder's current node.
    pub probing: Cell<bool>,
    probe: Cell<Option<usize>>,
    pub probe_parent: Cell<Option<usize>>,
}

pub const DOCUMENT: usize = 0;

static NO_NAME: std::sync::LazyLock<QualName> =
    std::sync::LazyLock::new(|| QualName::new(None, ns!(), local_name!("")));

impl Sink {
    pub fn new() -> Sink {
        let sink = Sink::default();
        sink.add(Kind::Document);
        sink
    }

    fn add(&self, kind: Kind) -> usize {
        let mut nodes = self.nodes.borrow_mut();
        nodes.push(Node {
            kind,
            parent: None,
            children: Vec::new(),
        });
        nodes.len() - 1
    }

    fn detach(nodes: &mut [Node], child: usize) {
        if let Some(parent) = nodes[child].parent.take() {
            nodes[parent].children.retain(|&c| c != child);
        }
    }

    /// Inserts at `index` in `parent`, merging text into a text neighbour
    /// before it, as the DOM's "insert a character" does.
    fn insert(&self, parent: usize, index: usize, child: NodeOrText<usize>) {
        let mut nodes = self.nodes.borrow_mut();
        let child = match child {
            NodeOrText::AppendText(text) => {
                if index > 0 {
                    let previous = nodes[parent].children[index - 1];
                    if let Kind::Text(existing) = &mut nodes[previous].kind {
                        existing.push_str(&text);
                        return;
                    }
                }
                nodes.push(Node {
                    kind: Kind::Text(text.to_string()),
                    parent: None,
                    children: Vec::new(),
                });
                nodes.len() - 1
            }
            NodeOrText::AppendNode(node) => {
                Self::detach(&mut nodes, node);
                if self.probe.get() == Some(node) {
                    self.probe.set(None);
                    self.probe_parent.set(Some(parent));
                }
                node
            }
        };
        let index = index.min(nodes[parent].children.len());
        nodes[parent].children.insert(index, child);
        nodes[child].parent = Some(parent);
    }
}

impl Sink {
    /// Whether `node` is an option or optgroup inside a select.
    pub fn in_select_option(&self, node: usize) -> bool {
        let nodes = self.nodes.borrow();
        let is_html = |index: usize, local: &str| {
            matches!(&nodes[index].kind, Kind::Element { name, .. }
                if name.ns == ns!(html) && &*name.local == local)
        };
        if !is_html(node, "option") && !is_html(node, "optgroup") {
            return false;
        }
        let mut at = nodes[node].parent;
        while let Some(index) = at {
            if is_html(index, "select") {
                return true;
            }
            at = nodes[index].parent;
        }
        false
    }

    /// Whether `node` is an html select.
    pub fn is_select(&self, node: usize) -> bool {
        matches!(&self.nodes.borrow()[node].kind, Kind::Element { name, .. }
            if name.ns == ns!(html) && &*name.local == "select")
    }

    /// Builds an element html5ever dropped, as a last child of `parent`.
    pub fn rescue(&self, parent: usize, name: QualName, attrs: Vec<Attribute>) -> usize {
        let element = self.add(Kind::Element {
            name,
            attrs,
            contents: None,
        });
        self.insert(parent, usize::MAX, NodeOrText::AppendNode(element));
        element
    }

    /// The local names of `elements`.
    pub fn local_names(&self, elements: &[usize]) -> Vec<html5ever::LocalName> {
        let nodes = self.nodes.borrow();
        elements
            .iter()
            .map(|&at| match &nodes[at].kind {
                Kind::Element { name, .. } => name.local.clone(),
                _ => html5ever::LocalName::from(""),
            })
            .collect()
    }

    /// Appends text to a rescued element.
    pub fn rescue_text(&self, parent: usize, text: StrTendril) {
        let end = self.nodes.borrow()[parent].children.len();
        self.insert(parent, end, NodeOrText::AppendText(text));
    }
}

impl TreeSink for Sink {
    type Handle = usize;
    type Output = Vec<Node>;
    type ElemName<'a> = Ref<'a, QualName>;

    fn finish(self) -> Vec<Node> {
        self.nodes.into_inner()
    }

    fn parse_error(&self, _msg: Cow<'static, str>) {}

    fn get_document(&self) -> usize {
        DOCUMENT
    }

    fn elem_name<'a>(&'a self, target: &'a usize) -> Ref<'a, QualName> {
        Ref::map(self.nodes.borrow(), |nodes| match &nodes[*target].kind {
            Kind::Element { name, .. } => name,
            _ => &NO_NAME,
        })
    }

    fn create_element(&self, name: QualName, attrs: Vec<Attribute>, flags: ElementFlags) -> usize {
        self.created.set(self.created.get() + 1);
        let contents = flags.template.then(|| self.add(Kind::Document));
        self.add(Kind::Element {
            name,
            attrs,
            contents,
        })
    }

    fn create_comment(&self, _text: StrTendril) -> usize {
        let comment = self.add(Kind::Other);
        if self.probing.replace(false) {
            self.probe.set(Some(comment));
        }
        comment
    }

    fn create_pi(&self, _target: StrTendril, _data: StrTendril) -> usize {
        self.add(Kind::Other)
    }

    fn append(&self, parent: &usize, child: NodeOrText<usize>) {
        let end = self.nodes.borrow()[*parent].children.len();
        self.insert(*parent, end, child);
    }

    fn append_based_on_parent_node(
        &self,
        element: &usize,
        prev_element: &usize,
        child: NodeOrText<usize>,
    ) {
        let has_parent = self.nodes.borrow()[*element].parent.is_some();
        if has_parent {
            self.append_before_sibling(element, child);
        } else {
            self.append(prev_element, child);
        }
    }

    fn append_doctype_to_document(&self, _: StrTendril, _: StrTendril, _: StrTendril) {}

    fn get_template_contents(&self, target: &usize) -> usize {
        match &self.nodes.borrow()[*target].kind {
            Kind::Element {
                contents: Some(contents),
                ..
            } => *contents,
            _ => *target,
        }
    }

    fn same_node(&self, x: &usize, y: &usize) -> bool {
        x == y
    }

    fn set_quirks_mode(&self, _mode: QuirksMode) {}

    fn append_before_sibling(&self, sibling: &usize, new_node: NodeOrText<usize>) {
        let (parent, index) = {
            let nodes = self.nodes.borrow();
            let Some(parent) = nodes[*sibling].parent else {
                return;
            };
            let index = nodes[parent]
                .children
                .iter()
                .position(|c| c == sibling)
                .unwrap_or(0);
            (parent, index)
        };
        // A moved node taken from before the sibling shifts it left.
        if let NodeOrText::AppendNode(node) = &new_node {
            let nodes = self.nodes.borrow();
            if nodes[*node].parent == Some(parent) {
                drop(nodes);
                let mut nodes = self.nodes.borrow_mut();
                Self::detach(&mut nodes, *node);
                let index = nodes[parent]
                    .children
                    .iter()
                    .position(|c| c == sibling)
                    .unwrap_or(0);
                drop(nodes);
                self.insert(parent, index, new_node);
                return;
            }
        }
        self.insert(parent, index, new_node);
    }

    fn add_attrs_if_missing(&self, target: &usize, attrs: Vec<Attribute>) {
        let mut nodes = self.nodes.borrow_mut();
        if let Kind::Element {
            attrs: existing, ..
        } = &mut nodes[*target].kind
        {
            for attr in attrs {
                if !existing.iter().any(|a| a.name == attr.name) {
                    existing.push(attr);
                }
            }
        }
    }

    fn remove_from_parent(&self, target: &usize) {
        Self::detach(&mut self.nodes.borrow_mut(), *target);
    }

    fn reparent_children(&self, node: &usize, new_parent: &usize) {
        let mut nodes = self.nodes.borrow_mut();
        let children = std::mem::take(&mut nodes[*node].children);
        for &child in &children {
            nodes[child].parent = Some(*new_parent);
        }
        nodes[*new_parent].children.extend(children);
    }
}

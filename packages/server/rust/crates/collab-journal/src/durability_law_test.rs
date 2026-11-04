//! The durability law: twin of C# CollabDurabilityArchitectureTests and Go's
//! durability_law_test.go. A flushed write and an unflushed one read back
//! the same until power is lost, so deleting a flush leaves every
//! behavioural test green. These scans pin that the calls are written, in
//! the right place and order; not that the kernel honoured them. Go walks
//! its AST; this walks the Rust text, with comments and literals blanked.

use std::collections::BTreeMap;
use std::ops::Range;

const LAW_FILES: [&str; 4] = ["store.rs", "files.rs", "ledger.rs", "lock.rs"];

// Every boundary where a completion means durable: (function, handle, the
// call the flush must follow).
const LAW_BOUNDARIES: [(&str, &str, &str); 6] = [
    ("Session.append", "journal", "write_all_at"),
    ("publish", "manifest_file", "write_all_at"),
    ("write_sealed", "file", "write_all"),
    ("Session.reset", "swapped", "set_len"),
    ("Inner.import_working_set", "journal", "set_len"),
    ("append_ledger_entry", "file", "write_all"),
];

// Each function must call these in this source order. A presence law, not a
// control-flow one: an early return between two steps stays green.
const LAW_ORDERS: [(&str, &[&str]); 6] = [
    (
        "Session.write_checkpoint",
        &["write_sealed", "sync_directory", "republish"],
    ),
    (
        "Session.reset",
        &["write_sealed", "sync_directory", "republish"],
    ),
    // The import publishes directly, so it re-checks the fence itself:
    // sealing a whole document is long enough for a new holder to take it.
    (
        "Inner.import_working_set",
        &["write_sealed", "sync_directory", "require_fence", "publish"],
    ),
    (
        "Store.purge",
        &["sync_all", "sync_directory", "remove_file"],
    ),
    ("Session.republish", &["require_fence", "publish"]),
    // The second fence check: the first one and the write are not one step.
    (
        "Session.append",
        &[
            "require_fence",
            "write_all_at",
            "sync_journal",
            "require_fence",
        ],
    ),
];

// Every function allowed to shorten or remove a file, and whether the cut
// must follow a fence check. An exemption must say why.
const LAW_SHORTENINGS: [(&str, bool, &str); 11] = [
    (
        "open_manifest",
        false,
        "Only grows a manifest short of its two slots, behind a size check; such a manifest holds no history.",
    ),
    (
        "Store.purge",
        false,
        "The exclusive lock refuses live sessions, and the synced purge marker fences stale ones before any payload goes; LAW_ORDERS pins that order.",
    ),
    (
        "Session.write_checkpoint",
        false,
        "Sweeps, after its publication, only checkpoint names ending in this session's own fence; two holders never share a fence.",
    ),
    (
        "write_sealed",
        false,
        "truncate can only empty a name this session already abandoned: every baseline and checkpoint name carries the writer's fence.",
    ),
    (
        "Store.delete_lineage",
        false,
        "Deletes only a superseded generation named by the ledger, under the ledger gate, and refuses a purged document and the current generation.",
    ),
    (
        "open_file",
        false,
        "The truncate primitive: it empties only after the lock is held, and every caller asking for truncate is checked here.",
    ),
    (
        "remove_file",
        false,
        "The File.Delete primitive; its callers are checked here and pinned by LAW_REMOVE_CALLERS.",
    ),
    ("Session.reset", true, ""),
    ("scan_forward", true, ""),
    ("Session.roll_back", true, ""),
    ("Inner.import_working_set", true, ""),
];

// The only callers of remove_file. A new one would make an exemption's
// reason false while every other law stays green.
const LAW_REMOVE_CALLERS: [&str; 3] = [
    "Session.write_checkpoint",
    "Store.delete_lineage",
    "Store.purge",
];

struct Func {
    name: String,
    // The text between the body's braces.
    body: Range<usize>,
}

struct Call {
    name: String,
    receiver: String,
    // From the receiver's start to the closing parenthesis.
    span: Range<usize>,
    args: String,
    // Called through a path, like fs::remove_file.
    is_path: bool,
}

struct Law {
    text: Vec<u8>,
    funcs: Vec<Func>,
}

fn is_ident(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}

// Blanks comments and the insides of string and char literals, keeping
// every offset, so braces and calls in them are not read as code.
fn sanitize(source: &str) -> Vec<u8> {
    let b = source.as_bytes();
    let mut out = b.to_vec();
    let mut i = 0;
    while i < b.len() {
        if b[i..].starts_with(b"//") {
            while i < b.len() && b[i] != b'\n' {
                out[i] = b' ';
                i += 1;
            }
        } else if b[i..].starts_with(b"/*") {
            while i < b.len() && !b[i..].starts_with(b"*/") {
                out[i] = b' ';
                i += 1;
            }
            out[i..(i + 2).min(b.len())].fill(b' ');
            i += 2;
        } else if b[i] == b'"' {
            let raw = i > 0 && b[i - 1] == b'r';
            i += 1;
            while i < b.len() && b[i] != b'"' {
                if b[i] == b'\\' && !raw {
                    out[i] = b' ';
                    i += 1;
                }
                if i < b.len() {
                    out[i] = b' ';
                    i += 1;
                }
            }
            i += 1;
        } else if b[i] == b'\'' && i + 2 < b.len() && (b[i + 1] == b'\\' || b[i + 2] == b'\'') {
            // A char literal, not a lifetime.
            let end = if b[i + 1] == b'\\' {
                b[i + 3..]
                    .iter()
                    .position(|&c| c == b'\'')
                    .map_or(b.len() - 1, |p| i + 3 + p)
            } else {
                i + 2
            };
            out[i + 1..end].fill(b' ');
            i = end + 1;
        } else {
            i += 1;
        }
    }
    out
}

fn matching(text: &[u8], open: usize) -> usize {
    let (o, c) = match text[open] {
        b'(' => (b'(', b')'),
        b'[' => (b'[', b']'),
        _ => (b'{', b'}'),
    };
    let mut depth = 0;
    for (i, &ch) in text.iter().enumerate().skip(open) {
        if ch == o {
            depth += 1;
        } else if ch == c {
            depth -= 1;
            if depth == 0 {
                return i;
            }
        }
    }
    text.len()
}

fn word_at(text: &[u8], at: usize, word: &str) -> bool {
    text[at..].starts_with(word.as_bytes())
        && (at == 0 || !is_ident(text[at - 1]))
        && text.get(at + word.len()).is_none_or(|&c| !is_ident(c))
}

fn skip_space(text: &[u8], mut at: usize) -> usize {
    while at < text.len() && text[at].is_ascii_whitespace() {
        at += 1;
    }
    at
}

fn ident_at(text: &[u8], at: usize) -> String {
    let end = (at..text.len())
        .find(|&i| !is_ident(text[i]))
        .unwrap_or(text.len());
    String::from_utf8_lossy(&text[at..end]).into_owned()
}

impl Law {
    fn parse(sources: &[(&str, &str)]) -> Law {
        let mut text = Vec::new();
        for (_, source) in sources {
            text.extend_from_slice(&sanitize(source));
            text.push(b'\n');
        }
        let mut funcs = Vec::new();
        // (closing brace offset, impl type) of each open impl block.
        let mut impls: Vec<(usize, String)> = Vec::new();
        let mut i = 0;
        while i < text.len() {
            impls.retain(|(end, _)| *end > i);
            if word_at(&text, i, "impl") {
                let open = (i..text.len())
                    .find(|&j| text[j] == b'{')
                    .unwrap_or(text.len());
                let header = String::from_utf8_lossy(&text[i + 4..open]).into_owned();
                let header = header.split(" for ").last().unwrap_or("").trim().to_owned();
                let name: String = header
                    .trim_start_matches('<')
                    .split(|c: char| !(c.is_alphanumeric() || c == '_' || c == ':'))
                    .find(|w| !w.is_empty())
                    .unwrap_or("")
                    .rsplit("::")
                    .next()
                    .unwrap_or("")
                    .to_owned();
                impls.push((matching(&text, open), name));
                i = open + 1;
                continue;
            }
            if word_at(&text, i, "fn") {
                let name_at = skip_space(&text, i + 2);
                let name = ident_at(&text, name_at);
                let mut j = name_at + name.len();
                let mut depth = 0i32;
                while j < text.len() {
                    match text[j] {
                        b'(' | b'<' | b'[' => depth += 1,
                        b')' | b']' => depth -= 1,
                        b'>' if text[j - 1] != b'-' => depth -= 1,
                        b';' if depth == 0 => break,
                        b'{' if depth == 0 => break,
                        _ => {}
                    }
                    j += 1;
                }
                if j < text.len() && text[j] == b'{' {
                    let close = matching(&text, j);
                    let qualified = match impls.last() {
                        Some((_, owner)) => format!("{owner}.{name}"),
                        None => name,
                    };
                    funcs.push(Func {
                        name: qualified,
                        body: j + 1..close,
                    });
                    i = close + 1;
                    continue;
                }
                i = j + 1;
                continue;
            }
            i += 1;
        }
        Law { text, funcs }
    }

    fn read() -> Law {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src/");
        let sources: Vec<(String, String)> = LAW_FILES
            .iter()
            .map(|name| {
                (
                    name.to_string(),
                    std::fs::read_to_string(format!("{dir}{name}")).unwrap(),
                )
            })
            .collect();
        let refs: Vec<(&str, &str)> = sources
            .iter()
            .map(|(n, s)| (n.as_str(), s.as_str()))
            .collect();
        Law::parse(&refs)
    }

    fn of(body: &str) -> Law {
        Law::parse(&[("x.rs", body)])
    }

    fn calls(&self, range: &Range<usize>) -> Vec<Call> {
        let t = &self.text;
        let mut found = Vec::new();
        let mut i = range.start;
        while i < range.end {
            if !(is_ident(t[i]) && (i == 0 || !is_ident(t[i - 1]))) {
                i += 1;
                continue;
            }
            let name = ident_at(t, i);
            let after = i + name.len();
            let open = skip_space(t, after);
            let keyword = matches!(
                name.as_str(),
                "if" | "while" | "match" | "for" | "fn" | "return" | "loop" | "in"
            );
            if open < range.end
                && t[open] == b'('
                && !keyword
                && !name.as_bytes()[0].is_ascii_digit()
            {
                let close = matching(t, open);
                let is_path = i >= 2 && &t[i - 2..i] == b"::";
                let mut start = i;
                let mut receiver = String::new();
                if i > 0 && t[i - 1] == b'.' {
                    let mut k = i - 1;
                    while k > range.start {
                        let c = t[k - 1];
                        if is_ident(c)
                            || c.is_ascii_whitespace()
                            || c == b'.'
                            || c == b':'
                            || c == b'?'
                        {
                            k -= 1;
                        } else if c == b')' {
                            let mut depth = 0;
                            while k > range.start {
                                k -= 1;
                                match t[k] {
                                    b')' => depth += 1,
                                    b'(' => {
                                        depth -= 1;
                                        if depth == 0 {
                                            break;
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        } else {
                            break;
                        }
                    }
                    let k = skip_space(t, k);
                    start = k;
                    receiver = String::from_utf8_lossy(&t[k..i - 1])
                        .chars()
                        .filter(|c| !c.is_whitespace())
                        .collect();
                }
                found.push(Call {
                    name,
                    receiver,
                    span: start..close + 1,
                    args: String::from_utf8_lossy(&t[open + 1..close])
                        .trim()
                        .to_owned(),
                    is_path,
                });
            }
            i = after;
        }
        found
    }

    fn single(&self, name: &str) -> Result<&Func, String> {
        let matches: Vec<&Func> = self.funcs.iter().filter(|f| f.name == name).collect();
        match matches.as_slice() {
            [one] => Ok(one),
            _ => Err(format!("there is no single {name} to check")),
        }
    }

    fn owner_of(&self, at: usize) -> &Func {
        self.funcs
            .iter()
            .find(|f| f.body.contains(&at))
            .expect("a call sits in a function")
    }

    // The statements of the innermost block holding `at`, and the index of
    // the one holding it. A statement ends at a `;`, or at a block's `}`
    // when no method, `?`, `else` or `;` follows it.
    fn statements_around(&self, at: usize) -> (Vec<Range<usize>>, usize) {
        let t = &self.text;
        let func = self.owner_of(at);
        let mut open = func.body.start - 1;
        let mut k = at;
        while k > func.body.start {
            k -= 1;
            if t[k] == b'{' && matching(t, k) > at {
                open = k;
                break;
            }
        }
        let close = matching(t, open);
        let mut statements = Vec::new();
        let mut start = open + 1;
        let mut i = open + 1;
        while i < close {
            match t[i] {
                b'(' | b'[' => i = matching(t, i),
                b'{' => {
                    i = matching(t, i);
                    let next = skip_space(t, i + 1);
                    let continues = next < close
                        && (matches!(t[next], b'.' | b'?' | b';' | b')' | b',')
                            || word_at(t, next, "else"));
                    if !continues {
                        statements.push(start..i + 1);
                        start = i + 1;
                    }
                }
                b';' => {
                    statements.push(start..i + 1);
                    start = i + 1;
                }
                _ => {}
            }
            i += 1;
        }
        if !String::from_utf8_lossy(&t[start..close]).trim().is_empty() {
            statements.push(start..close);
        }
        let index = statements.iter().position(|s| s.contains(&at)).unwrap_or(0);
        (statements, index)
    }

    fn statement_text(&self, range: &Range<usize>) -> String {
        String::from_utf8_lossy(&self.text[range.clone()])
            .trim()
            .trim_end_matches(';')
            .trim()
            .to_owned()
    }

    // Whether a call's Result is kept: propagated, bound to a name, or
    // part of a bigger expression. A bare call statement and `let _ =` drop it.
    fn result_used(&self, call: &Call) -> bool {
        let (statements, index) = self.statements_around(call.span.start);
        let raw = String::from_utf8_lossy(&self.text[statements[index].clone()]).into_owned();
        if index == statements.len() - 1 && !raw.trim_end().ends_with(';') {
            return true;
        }
        let statement = self.statement_text(&statements[index]);
        let call_text = String::from_utf8_lossy(&self.text[call.span.clone()])
            .trim()
            .to_owned();
        !(statement == call_text
            || statement.starts_with("let _ ")
            || statement.starts_with("let _=")
            || statement.starts_with("let _:"))
    }

    // Whether the Result leaves the function: `?`, a returned or tail
    // expression.
    fn result_propagated(&self, call: &Call) -> bool {
        let next = skip_space(&self.text, call.span.end);
        if self.text.get(next) == Some(&b'?') {
            return true;
        }
        let (statements, index) = self.statements_around(call.span.start);
        let raw = String::from_utf8_lossy(&self.text[statements[index].clone()]).into_owned();
        let tail = index == statements.len() - 1 && !raw.trim_end().ends_with(';');
        let statement = self.statement_text(&statements[index]);
        tail || statement.starts_with("return ")
    }

    fn flush_violations(&self, function: &str, handle: &str, after: &str) -> Vec<String> {
        let func = match self.single(function) {
            Ok(func) => func,
            Err(missing) => return vec![missing],
        };
        let calls = self.calls(&func.body);
        let Some(write) = calls
            .iter()
            .find(|c| c.name == after && c.receiver == handle)
        else {
            return vec![format!("{function} no longer calls {handle}.{after}")];
        };
        let flushed = calls.iter().any(|c| {
            let flush = (c.name == "sync_all" && c.receiver == handle)
                || (c.name == "sync_journal" && c.args == handle);
            flush && c.span.start > write.span.start && self.result_used(c)
        });
        if flushed {
            return Vec::new();
        }
        vec![format!(
            "{function} must call {handle}.sync_all() after its {handle}.{after} and keep its result"
        )]
    }

    fn order_violations(&self, function: &str, steps: &[&str]) -> Vec<String> {
        let func = match self.single(function) {
            Ok(func) => func,
            Err(missing) => return vec![missing],
        };
        let calls = self.calls(&func.body);
        let mut previous = None;
        for step in steps {
            let Some(call) = calls
                .iter()
                .find(|c| c.name == *step && previous.is_none_or(|p| c.span.start > p))
            else {
                return vec![format!(
                    "{function} must call {} ; {step} is missing or out of order",
                    steps.join(" then ")
                )];
            };
            previous = Some(call.span.start);
        }
        Vec::new()
    }

    // A statement that takes a fence check's error and stops on it, at its
    // own level: a check inside an `if` block guards only that block.
    fn is_fence_check(&self, statement: &Range<usize>) -> bool {
        let depth_at = |at: usize| {
            self.text[statement.start..at].iter().fold(0i32, |d, &c| {
                d + i32::from(c == b'{') - i32::from(c == b'}')
            })
        };
        self.calls(statement).iter().any(|c| {
            depth_at(c.span.start) == 0
                && c.name.contains("fence")
                && self.text.get(skip_space(&self.text, c.span.end)) == Some(&b'?')
        })
    }

    // Whether the fence check is the statement right before the cut, in the
    // same block. A method's entry check is not enough: the fence can move
    // after it.
    fn guarded(&self, at: usize) -> bool {
        let (statements, index) = self.statements_around(at);
        index > 0 && self.is_fence_check(&statements[index - 1])
    }

    fn truncation_violations(&self) -> Vec<String> {
        let needs: BTreeMap<&str, bool> =
            LAW_SHORTENINGS.iter().map(|(f, n, _)| (*f, *n)).collect();
        let mut violations = Vec::new();
        for func in &self.funcs {
            let mut cuts: Vec<(String, usize, bool)> = self
                .calls(&func.body)
                .into_iter()
                .filter(|c| {
                    matches!(
                        c.name.as_str(),
                        "set_len" | "remove_file" | "remove_dir" | "remove_dir_all"
                    )
                })
                .map(|c| (c.name, c.span.start, true))
                .collect();
            let body = String::from_utf8_lossy(&self.text[func.body.clone()]).into_owned();
            let compact: String = body.chars().filter(|c| !c.is_whitespace()).collect();
            if compact.contains("truncate:true") {
                cuts.push(("truncate: true".to_owned(), func.body.start, false));
            }
            for (operation, at, guardable) in cuts {
                match needs.get(func.name.as_str()) {
                    None => violations.push(format!(
                        "{} destroys data ({operation}), which only the LAW_SHORTENINGS functions may do",
                        func.name
                    )),
                    Some(true) if guardable && !self.guarded(at) => violations.push(format!(
                        "{} must check the fence in the statement right before its {operation}",
                        func.name
                    )),
                    _ => {}
                }
            }
        }
        violations
    }

    fn directory_sync_violations(&self) -> Vec<String> {
        let func = match self.single("sync_directory") {
            Ok(func) => func,
            Err(missing) => return vec![missing],
        };
        let ok = self
            .calls(&func.body)
            .iter()
            .any(|c| c.name == "sync_all" && self.result_propagated(c));
        if ok {
            Vec::new()
        } else {
            vec!["sync_directory must return the result of its sync_all".to_owned()]
        }
    }

    // Call sites that drop sync_directory's error.
    fn discarded_directory_syncs(&self) -> Vec<String> {
        let mut violations = Vec::new();
        for func in &self.funcs {
            for call in self.calls(&func.body) {
                if call.name == "sync_directory" && !self.result_used(&call) {
                    violations.push(format!("{} drops the result of sync_directory", func.name));
                }
            }
        }
        violations
    }

    fn remove_callers(&self) -> Vec<String> {
        let mut callers: Vec<String> = Vec::new();
        for func in &self.funcs {
            let calls = self.calls(&func.body);
            if calls.iter().any(|c| c.name == "remove_file" && !c.is_path)
                && !callers.contains(&func.name)
            {
                callers.push(func.name.clone());
            }
        }
        callers.sort();
        callers
    }
}

#[test]
fn every_durability_boundary_flushes_to_disk() {
    let law = Law::read();
    let violations: Vec<String> = LAW_BOUNDARIES
        .iter()
        .flat_map(|(f, h, a)| law.flush_violations(f, h, a))
        .collect();
    assert!(violations.is_empty(), "{violations:#?}");
}

#[test]
fn every_truncation_of_a_live_journal_checks_the_fence_first() {
    let violations = Law::read().truncation_violations();
    assert!(violations.is_empty(), "{violations:#?}");
}

#[test]
fn the_directory_sync_checks_its_result() {
    let law = Law::read();
    let mut violations = law.directory_sync_violations();
    violations.extend(law.discarded_directory_syncs());
    assert!(violations.is_empty(), "{violations:#?}");
}

#[test]
fn every_publication_calls_its_durable_steps_in_order() {
    let law = Law::read();
    let violations: Vec<String> = LAW_ORDERS
        .iter()
        .flat_map(|(f, steps)| law.order_violations(f, steps))
        .collect();
    assert!(violations.is_empty(), "{violations:#?}");
}

#[test]
fn the_only_remover_callers_are_the_exempt_ones() {
    assert_eq!(Law::read().remove_callers(), LAW_REMOVE_CALLERS);
}

#[test]
fn every_exemption_carries_a_reason() {
    for (function, needs_fence, reason) in LAW_SHORTENINGS {
        assert!(
            needs_fence || !reason.trim().is_empty(),
            "{function} is exempt from the fence check with no reason"
        );
    }
}

// The detectors, on small sources, so a law that can no longer fail is caught.

#[test]
fn the_law_detects_a_missing_durable_step() {
    let law =
        Law::of("impl Session { fn reset(&mut self) { write_sealed(p)?; self.republish(n)?; } }");
    let got = law.order_violations(
        "Session.reset",
        &["write_sealed", "sync_directory", "republish"],
    );
    assert!(
        got.len() == 1 && got[0].contains("sync_directory"),
        "{got:?}"
    );
}

#[test]
fn the_law_detects_durable_steps_out_of_order() {
    let law = Law::of(
        "impl Session { fn reset(&mut self) { write_sealed(p)?; self.republish(n)?; sync_directory(d)?; } }",
    );
    let got = law.order_violations(
        "Session.reset",
        &["write_sealed", "sync_directory", "republish"],
    );
    assert_eq!(got.len(), 1, "{got:?}");
}

#[test]
fn the_law_detects_a_remove_in_a_function_that_may_not_destroy_data() {
    let law = Law::of("impl Session { fn write_checkpoint_later(&self) { remove_file(p)?; } }");
    let got = law.truncation_violations();
    assert!(
        got.len() == 1 && got[0].contains("write_checkpoint_later"),
        "{got:?}"
    );
}

#[test]
fn the_law_detects_a_truncating_open_in_a_function_that_may_not_shorten() {
    let law = Law::of(
        "fn read_baseline() { open_file(p, Flags { write: true, truncate: true, ..Flags::default() }, false)?; }",
    );
    let got = law.truncation_violations();
    assert!(
        got.len() == 1 && got[0].contains("truncate: true"),
        "{got:?}"
    );
}

#[test]
fn the_law_detects_an_unguarded_cut() {
    for body in [
        "impl Session { fn roll_back(&mut self) { self.journal.set_len(0)?; } }",
        "impl Session { fn roll_back(&mut self) { self.journal.set_len(0)?; self.require_fence()?; } }",
        "impl Session { fn roll_back(&mut self) { self.require_fence()?; x(); self.journal.set_len(0)?; } }",
        "impl Session { fn roll_back(&mut self) { let _ = self.require_fence(); self.journal.set_len(0)?; } }",
        "impl Session { fn roll_back(&mut self) { self.require_fence()?; if ok { self.journal.set_len(0)?; } } }",
        "impl Session { fn roll_back(&mut self) { if fast { self.require_fence()?; } self.journal.set_len(0)?; } }",
    ] {
        let got = Law::of(body).truncation_violations();
        assert_eq!(got.len(), 1, "{body}: {got:?}");
    }
}

#[test]
fn the_law_accepts_a_guarded_cut() {
    for body in [
        "impl Session { fn roll_back(&mut self) { self.require_fence()?; self.journal.set_len(0)?; } }",
        "impl Session { fn roll_back(&mut self) { let undo = || { self.require_fence()?; journal.set_len(0)?; Ok(()) }; } }",
        "fn scan_forward() { if let Some(confirm_fence) = c { confirm_fence()?; journal.set_len(0)?; } }",
    ] {
        let got = Law::of(body).truncation_violations();
        assert!(got.is_empty(), "{body}: {got:?}");
    }
}

#[test]
fn the_law_detects_a_missing_or_misplaced_flush() {
    for body in [
        "fn publish() { manifest_file.write_all_at(b, 0)?; }",
        "fn publish() { manifest_file.sync_all()?; manifest_file.write_all_at(b, 0)?; }",
        "fn publish() { manifest_file.write_all_at(b, 0)?; other.sync_all()?; }",
        "fn publish() { manifest_file.write_all_at(b, 0)?; manifest_file.sync_all(); }",
        "fn publish() { manifest_file.write_all_at(b, 0)?; let _ = manifest_file.sync_all(); }",
    ] {
        let got = Law::of(body).flush_violations("publish", "manifest_file", "write_all_at");
        assert_eq!(got.len(), 1, "{body}: {got:?}");
    }
    let good = Law::of(
        "fn publish() -> io::Result<()> { manifest_file.write_all_at(b, 0)?; manifest_file.sync_all() }",
    );
    let got = good.flush_violations("publish", "manifest_file", "write_all_at");
    assert!(got.is_empty(), "{got:?}");
}

#[test]
fn the_law_detects_a_directory_sync_that_drops_its_result() {
    for body in [
        "fn sync_directory(p: &Path) -> io::Result<()> { dir.sync_all(); Ok(()) }",
        "fn sync_directory(p: &Path) -> io::Result<()> { if let Err(err) = dir.sync_all() { log(err); } Ok(()) }",
        "fn sync_directory(p: &Path) -> io::Result<()> { Ok(()) }",
    ] {
        let got = Law::of(body).directory_sync_violations();
        assert_eq!(got.len(), 1, "{body}: {got:?}");
    }
    let got = Law::of("impl Session { fn reset(&mut self) { sync_directory(d); } }")
        .discarded_directory_syncs();
    assert_eq!(got.len(), 1, "{got:?}");
}

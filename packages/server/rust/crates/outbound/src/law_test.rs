use std::collections::BTreeMap;
use std::path::Path;

// The analogue of OutboundClientArchitectureTests and Go's law_test.go:
// outbound connections may only be opened by the guarded fetcher, which
// reaches callers' URLs, and the operator client, which reaches only the S3
// endpoint and the doc endpoint. Each of those builds exactly one operator
// client.

/// Code that opens a connection, or names a type whose only use is to.
const RESTRICTED: &[&str] = &[
    "TcpStream::connect",
    "TcpStream::connect_timeout",
    "TcpStream::from_std",
    "UnixStream::connect",
    "TcpSocket",
    "UdpSocket",
    "TlsConnector",
];

/// The files that may open connections, and how many dials each holds.
const DIAL_OWNERS: &[(&str, usize)] = &[
    ("outbound/src/fetcher.rs", 1),
    ("outbound/src/operator.rs", 1),
];

/// The files that may build an operator client, and how many times.
const CLIENT_OWNERS: &[(&str, usize)] = &[
    ("outbound/src/operator.rs", 1),
    ("blob/src/s3.rs", 1),
    ("collab-docendpoint/src/client.rs", 1),
];

/// `code` with comments, string and char literals blanked, newlines kept.
fn strip(source: &str) -> String {
    let b: Vec<char> = source.chars().collect();
    let mut out = String::with_capacity(source.len());
    let blank = |c: char| if c == '\n' { '\n' } else { ' ' };
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c == '/' && b.get(i + 1) == Some(&'/') {
            while i < b.len() && b[i] != '\n' {
                out.push(' ');
                i += 1;
            }
        } else if c == '/' && b.get(i + 1) == Some(&'*') {
            let mut depth = 0;
            loop {
                if i >= b.len() {
                    break;
                }
                if b[i] == '/' && b.get(i + 1) == Some(&'*') {
                    depth += 1;
                    out.push_str("  ");
                    i += 2;
                } else if b[i] == '*' && b.get(i + 1) == Some(&'/') {
                    depth -= 1;
                    out.push_str("  ");
                    i += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    out.push(blank(b[i]));
                    i += 1;
                }
            }
        } else if c == 'r'
            && matches!(b.get(i + 1), Some('"' | '#'))
            && (i == 0 || !(b[i - 1].is_alphanumeric() || b[i - 1] == '_'))
        {
            let mut j = i + 1;
            let mut hashes = 0;
            while b.get(j) == Some(&'#') {
                hashes += 1;
                j += 1;
            }
            if b.get(j) != Some(&'"') {
                // A raw identifier, as in r#TcpSocket: keep the name.
                out.push_str(&" ".repeat(j - i));
                i = j;
                continue;
            }
            j += 1;
            let close: String = std::iter::once('"')
                .chain(std::iter::repeat_n('#', hashes))
                .collect();
            let close: Vec<char> = close.chars().collect();
            while j < b.len() && b[j..].iter().take(close.len()).ne(close.iter()) {
                j += 1;
            }
            j = (j + close.len()).min(b.len());
            for &x in &b[i..j] {
                out.push(blank(x));
            }
            i = j;
        } else if c == '"' {
            out.push(' ');
            i += 1;
            while i < b.len() && b[i] != '"' {
                if b[i] == '\\' {
                    out.push(' ');
                    i += 1;
                }
                if i < b.len() {
                    out.push(blank(b[i]));
                    i += 1;
                }
            }
            out.push(' ');
            i += 1;
        } else if c == '\'' && (b.get(i + 2) == Some(&'\'') || b.get(i + 1) == Some(&'\\')) {
            let mut j = i + 1;
            if b.get(j) == Some(&'\\') {
                j += 1;
            }
            while j < b.len() && b[j] != '\'' {
                j += 1;
            }
            for _ in i..=j.min(b.len() - 1) {
                out.push(' ');
            }
            i = j + 1;
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

/// Blanks every item behind #[cfg(test)]: test code may dial anything.
fn without_tests(code: &str) -> String {
    let mut out = code.to_owned();
    let mut from = 0;
    while let Some(at) = out[from..].find("#[cfg(test)]").map(|i| i + from) {
        let rest = &out[at..];
        let end = match (rest.find(';'), rest.find('{')) {
            (Some(semi), Some(brace)) if semi < brace => at + semi + 1,
            (_, Some(brace)) => {
                let mut depth = 0;
                let mut end = at + brace;
                for (k, ch) in out[at + brace..].char_indices() {
                    match ch {
                        '{' => depth += 1,
                        '}' => {
                            depth -= 1;
                            if depth == 0 {
                                end = at + brace + k + 1;
                                break;
                            }
                        }
                        _ => {}
                    }
                }
                end
            }
            (Some(semi), None) => at + semi + 1,
            (None, None) => out.len(),
        };
        let blanked: String = out[at..end]
            .chars()
            .map(|c| if c == '\n' { '\n' } else { ' ' })
            .collect();
        out.replace_range(at..end, &blanked);
        from = end;
    }
    out
}

fn is_ident(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Every whole-word use of `needle` in `code`, as line numbers.
fn uses(code: &str, needle: &str) -> Vec<usize> {
    let mut lines = Vec::new();
    let mut from = 0;
    while let Some(at) = code[from..].find(needle).map(|i| i + from) {
        let before = code[..at].chars().next_back();
        let after = code[at + needle.len()..].chars().next();
        if !before.is_some_and(is_ident) && !after.is_some_and(is_ident) {
            lines.push(code[..at].matches('\n').count() + 1);
        }
        from = at + needle.len();
    }
    lines
}

/// Operator client constructions: a struct literal or `::new(`, not the
/// type's definition, an impl or a return type.
fn client_constructions(code: &str) -> Vec<usize> {
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(at) = code[from..].find("OperatorClient").map(|i| i + from) {
        from = at + "OperatorClient".len();
        let before = code[..at].trim_end();
        let after = code[from..].trim_start();
        let whole = !code[..at].chars().next_back().is_some_and(is_ident)
            && !code[from..].chars().next().is_some_and(is_ident);
        let declared = ["struct", "->", "impl", "for"]
            .iter()
            .any(|w| before.ends_with(w));
        let literal = after.starts_with('{') && !declared;
        if whole && (literal || after.starts_with("::new")) {
            found.push(code[..at].matches('\n').count() + 1);
        }
    }
    found
}

/// What breaks the law in `sources` (relative path to text).
fn violations(sources: &BTreeMap<String, String>) -> Vec<String> {
    let mut found = Vec::new();
    for (path, source) in sources {
        let code = without_tests(&strip(source));
        for (alias, line) in aliases(&code) {
            found.push(format!("{path}:{line} renames {alias}"));
        }
        let mut dials = 0;
        for name in RESTRICTED {
            for line in uses(&code, name) {
                if name.starts_with("Tcp") && name.contains("::") || name.starts_with("Unix") {
                    dials += 1;
                }
                if !DIAL_OWNERS.iter().any(|(owner, _)| owner == path) {
                    found.push(format!("{path}:{line} uses {name}"));
                }
            }
        }
        if let Some((_, allowed)) = DIAL_OWNERS.iter().find(|(owner, _)| owner == path)
            && dials > *allowed
        {
            found.push(format!("{path} dials {dials} times, {allowed} allowed"));
        }
        let built = client_constructions(&code);
        let allowed = CLIENT_OWNERS
            .iter()
            .find(|(owner, _)| owner == path)
            .map_or(0, |(_, n)| *n);
        for line in built.iter().skip(allowed) {
            found.push(format!("{path}:{line} builds an operator client"));
        }
    }
    found
}

/// `use ... as X` of a restricted or owner type hides it from the scan.
fn aliases(code: &str) -> Vec<(String, usize)> {
    let mut found = Vec::new();
    for name in [
        "TcpStream",
        "UnixStream",
        "TcpSocket",
        "UdpSocket",
        "TlsConnector",
        "OperatorClient",
    ] {
        for line in uses(code, name) {
            let text = code.lines().nth(line - 1).unwrap_or_default();
            if text.contains(&format!("{name} as ")) {
                found.push((name.to_owned(), line));
            }
        }
    }
    found
}

fn workspace_sources() -> BTreeMap<String, String> {
    let crates = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut sources = BTreeMap::new();
    let mut stack = vec![crates.clone()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            if path.is_dir() {
                if name != "tests" && name != "target" && name != "benches" {
                    stack.push(path);
                }
            } else if name.ends_with(".rs") && !name.ends_with("_test.rs") {
                let relative = path
                    .strip_prefix(&crates)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                sources.insert(relative, std::fs::read_to_string(&path).unwrap());
            }
        }
    }
    // A file declared behind #[cfg(test)] is test code, whatever its name.
    let mut test_files = Vec::new();
    for (path, source) in &sources {
        let dir = path.rsplit_once('/').map_or("", |(d, _)| d);
        for (at, _) in source.match_indices("#[cfg(test)]") {
            let item = &source[at + "#[cfg(test)]".len()..];
            let end = item.find(['{', ';']).unwrap_or(item.len());
            if !item[end..].starts_with(';') {
                continue;
            }
            let declaration = &item[..end];
            let words: Vec<&str> = declaration.split_whitespace().collect();
            let Some(index) = words.iter().position(|w| *w == "mod") else {
                continue;
            };
            let file = match declaration.split_once("#[path = \"") {
                Some((_, rest)) => rest.split('"').next().unwrap_or_default().to_owned(),
                None => format!("{}.rs", words.get(index + 1).unwrap_or(&"")),
            };
            test_files.push(format!("{dir}/{file}"));
        }
    }
    for file in test_files {
        sources.remove(&file);
    }
    sources
}

#[test]
fn only_the_guarded_fetcher_owns_outbound_clients() {
    let sources = workspace_sources();
    for (owner, _) in DIAL_OWNERS.iter().chain(CLIENT_OWNERS) {
        assert!(
            sources.contains_key(*owner),
            "{owner} moved: update the law"
        );
    }
    let found = violations(&sources);
    assert!(
        found.is_empty(),
        "outbound connections may only be opened by the guarded fetcher or the operator client:\n{}",
        found.join("\n")
    );
}

#[test]
fn the_law_catches_planted_violations() {
    let cases = [
        (
            "a raw dial",
            "x/src/x.rs",
            "async fn f() { tokio::net::TcpStream::connect(\"x\").await; }",
        ),
        (
            "a std dial",
            "x/src/x.rs",
            "fn f() { std::net::TcpStream::connect(\"x\"); }",
        ),
        (
            "a socket",
            "x/src/x.rs",
            "fn f() { let s = tokio::net::TcpSocket::new_v4(); }",
        ),
        ("a TLS connector", "x/src/x.rs", "fn f(c: TlsConnector) {}"),
        (
            "an aliased stream",
            "x/src/x.rs",
            "use tokio::net::TcpStream as T;\nfn f() { T::connect(a); }",
        ),
        (
            "a raw identifier",
            "x/src/x.rs",
            "fn f() { let s = r#TcpSocket::new_v4(); }",
        ),
        (
            "a second operator client in S3",
            "blob/src/s3.rs",
            "fn a() { OperatorClient::new(a, b); OperatorClient::new(a, b); }",
        ),
        (
            "a second doc endpoint client",
            "collab-docendpoint/src/client.rs",
            "fn a() { let x = OperatorClient { a }; let y = OperatorClient { b }; }",
        ),
        (
            "an operator client in a new place",
            "x/src/x.rs",
            "fn a() { OperatorClient::new(a, b); }",
        ),
        (
            "a second dial in the fetcher",
            "outbound/src/fetcher.rs",
            "fn a() { TcpStream::connect(a); TcpStream::connect(b); }",
        ),
    ];
    for (name, path, source) in cases {
        let sources = BTreeMap::from([(path.to_owned(), source.to_owned())]);
        assert!(!violations(&sources).is_empty(), "{name}: not caught");
    }
    // Names in comments, strings and test code are not code.
    let clean = "// TcpStream::connect\n/* TlsConnector */\nfn f() { let s = \"UdpSocket\"; let r = r#\"TcpSocket\"#; }\n#[cfg(test)]\nmod t { fn g() { TcpStream::connect(a); } }\n";
    let sources = BTreeMap::from([("x/src/x.rs".to_owned(), clean.to_owned())]);
    assert_eq!(violations(&sources), Vec::<String>::new());
}

fn one(path: &str, source: &str) -> Vec<String> {
    violations(&BTreeMap::from([(path.to_owned(), source.to_owned())]))
}

// An owner's one allowed client does not make a dial beside it allowed.
#[test]
fn an_owner_keeps_only_its_client_site() {
    for path in ["blob/src/s3.rs", "collab-docendpoint/src/client.rs"] {
        let got = one(
            path,
            "fn a() { OperatorClient::new(a, b); TcpStream::connect(x); }",
        );
        assert_eq!(got.len(), 1, "{path}: {got:?}");
        assert!(got[0].contains("TcpStream"), "{path}: {got:?}");
        assert!(!got[0].contains("operator client"), "{path}: {got:?}");
    }
}

#[test]
fn a_dial_is_restricted_even_inside_a_client_owner() {
    for path in [
        "x/src/x.rs",
        "blob/src/s3.rs",
        "collab-docendpoint/src/client.rs",
    ] {
        let got = one(path, "fn f() { TcpStream::connect(a); }");
        assert!(
            got.len() == 1 && got[0].contains("TcpStream"),
            "{path}: {got:?}"
        );
    }
}

#[test]
fn an_alias_declared_by_an_allowed_owner_is_caught() {
    let sources = BTreeMap::from([
        (
            "outbound/src/fetcher.rs".to_owned(),
            "pub use tokio::net::TcpStream as Outbound;".to_owned(),
        ),
        (
            "x/src/x.rs".to_owned(),
            "fn f() { Outbound::connect(a); }".to_owned(),
        ),
    ]);
    let got = violations(&sources);
    assert!(
        got.iter()
            .any(|v| v.starts_with("outbound/src/fetcher.rs") && v.contains("renames TcpStream")),
        "{got:?}"
    );
}

// The body is read into one buffer and handed back by move. A copy of it
// would double the peak memory of every capped fetch.
#[test]
fn the_guarded_fetcher_does_not_copy_the_finished_body() {
    let source = strip(include_str!("body.rs"));
    let start = source
        .find("async fn read_bounded")
        .expect("body.rs has read_bounded");
    let open = start + source[start..].find('{').expect("a body");
    let mut depth = 0;
    let mut end = open;
    for (i, c) in source[open..].char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    end = open + i;
                    break;
                }
            }
            _ => {}
        }
    }
    let body = &source[open..end];
    for copy in [".to_vec()", ".clone()", ".to_owned()", "Vec::from("] {
        assert!(!body.contains(copy), "read_bounded calls {copy}");
    }
}

/// WebSocket client crates. C# bans ClientWebSocket everywhere, and Go bans
/// the x/net client: none may open a connection past the guarded fetcher.
/// crates/ws (blok-ws) is the server side, and allowed.
const WEBSOCKET_CLIENTS: &[&str] = &[
    "tungstenite",
    "tokio-tungstenite",
    "async-tungstenite",
    "async-tungstenite-wasm",
    "websocket",
    "websocket-lite",
    "tokio-websockets",
    "fastwebsockets",
    "soketto",
    "ws",
    "ezsockets",
    "reqwest-websocket",
    "awc",
];

/// Every WebSocket client named by `lock` (Cargo.lock) or by a dependency
/// table of a manifest (relative path to Cargo.toml text).
fn websocket_clients(lock: &str, manifests: &BTreeMap<String, String>) -> Vec<String> {
    let banned = |name: &str| WEBSOCKET_CLIENTS.contains(&name);
    let quoted = |value: &str| value.trim().trim_matches('"').to_owned();
    let mut found = Vec::new();
    let mut in_package = false;
    for (line, text) in lock.lines().enumerate() {
        let text = text.trim();
        if text.starts_with('[') {
            in_package = text == "[[package]]";
        } else if in_package
            && let Some(name) = text.strip_prefix("name =").map(quoted)
            && banned(&name)
        {
            found.push(format!("Cargo.lock:{} locks {name}", line + 1));
        }
    }
    for (path, manifest) in manifests {
        // The table a line sits in; [dependencies.x] names x itself.
        let mut table = String::new();
        for (line, text) in manifest.lines().enumerate() {
            let text = text.split('#').next().unwrap_or_default().trim();
            if let Some(header) = text.strip_prefix('[') {
                table = header.trim_matches(|c| c == '[' || c == ']').to_owned();
                if let Some((_, name)) = table.rsplit_once("dependencies.")
                    && banned(name)
                {
                    found.push(format!("{path}:{} depends on {name}", line + 1));
                }
                continue;
            }
            if !table.ends_with("dependencies") {
                continue;
            }
            let Some((key, value)) = text.split_once('=') else {
                continue;
            };
            let key = quoted(key);
            let renamed = value
                .split_once("package")
                .and_then(|(_, rest)| rest.trim_start().strip_prefix('='))
                .map(|rest| quoted(rest.split([',', '}']).next().unwrap_or_default()));
            for name in std::iter::once(key).chain(renamed) {
                if banned(&name) {
                    found.push(format!("{path}:{} depends on {name}", line + 1));
                }
            }
        }
    }
    found
}

fn workspace_manifests() -> (String, BTreeMap<String, String>) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let lock = std::fs::read_to_string(root.join("Cargo.lock")).unwrap();
    let mut manifests = BTreeMap::from([(
        "Cargo.toml".to_owned(),
        std::fs::read_to_string(root.join("Cargo.toml")).unwrap(),
    )]);
    for entry in std::fs::read_dir(root.join("crates")).unwrap() {
        let path = entry.unwrap().path().join("Cargo.toml");
        if let Ok(text) = std::fs::read_to_string(&path) {
            let relative = path
                .strip_prefix(&root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            manifests.insert(relative, text);
        }
    }
    (lock, manifests)
}

#[test]
fn no_crate_depends_on_a_websocket_client() {
    let (lock, manifests) = workspace_manifests();
    assert!(manifests.len() > 10, "{} manifests read", manifests.len());
    let found = websocket_clients(&lock, &manifests);
    assert!(
        found.is_empty(),
        "a WebSocket client is a way out past the guarded fetcher:\n{}",
        found.join("\n")
    );
}

#[test]
fn the_websocket_law_catches_planted_clients() {
    let lockfile = "[[package]]\nname = \"tungstenite\"\nversion = \"0.24.0\"\n";
    assert!(
        !websocket_clients(lockfile, &BTreeMap::new()).is_empty(),
        "a locked client: not caught"
    );
    for (name, manifest) in [
        (
            "a dependency",
            "[dependencies]\ntokio-tungstenite = \"0.24\"\n",
        ),
        (
            "a dev dependency",
            "[dev-dependencies]\nfastwebsockets = { version = \"0.8\" }\n",
        ),
        (
            "a renamed one",
            "[dependencies]\nsocket = { package = \"tungstenite\", version = \"0.24\" }\n",
        ),
        ("a table", "[dependencies.soketto]\nversion = \"0.8\"\n"),
        (
            "a target one",
            "[target.'cfg(unix)'.dependencies]\nwebsocket = \"0.27\"\n",
        ),
        (
            "a workspace one",
            "[workspace.dependencies]\nws = \"0.9\"\n",
        ),
    ] {
        let manifests = BTreeMap::from([("crates/x/Cargo.toml".to_owned(), manifest.to_owned())]);
        assert!(
            !websocket_clients("", &manifests).is_empty(),
            "{name}: not caught"
        );
    }
    // Our own server side, a package's own name and other tables are not clients.
    let clean = "[package]\nname = \"ws\"\n\n[dependencies]\nblok-ws = { path = \"../ws\" }\n\n[features]\nws = []\n";
    let manifests = BTreeMap::from([("crates/x/Cargo.toml".to_owned(), clean.to_owned())]);
    assert_eq!(
        websocket_clients("[[package]]\nname = \"blok-ws\"\n", &manifests),
        Vec::<String>::new()
    );
}

use blok_dotnet::equals_ordinal_ignore_case;

/// What `embedder` reads from a frame-check request.
#[derive(Debug, Clone, Default)]
pub struct Request {
    /// The Origin header; `has_origin` says whether one was sent.
    pub origin: String,
    pub has_origin: bool,
    /// The Sec-Fetch-Site header, or "".
    pub sec_fetch_site: String,
    /// The embedder query value, or "".
    pub embedder: String,
    /// scheme://Host of the request, or "" with no Host.
    pub self_origin: String,
}

/// C#'s FrameCheckEmbedder.Choose: the origin to rate a page for, or ""
/// for none. A sent Origin decides alone. Without one, the embedder query
/// value counts when the browser says the request is same-origin and the
/// value is this server's own origin, or when it is an allowed origin.
/// Never trust the value alone: any page could then learn framing policies
/// for any site.
pub fn embedder(r: &Request, allowed: impl Fn(&str) -> bool) -> String {
    if r.has_origin {
        return if allowed(&r.origin) {
            r.origin.clone()
        } else {
            String::new()
        };
    }
    // Pages cannot set Sec-Fetch-Site, so a browser page reaches this only
    // from the server's own origin.
    if !r.self_origin.is_empty()
        && equals_ordinal_ignore_case(r.sec_fetch_site.as_bytes(), b"same-origin")
        && equals_ordinal_ignore_case(r.embedder.as_bytes(), r.self_origin.as_bytes())
    {
        return r.embedder.clone();
    }
    if allowed(&r.embedder) {
        return r.embedder.clone();
    }
    String::new()
}

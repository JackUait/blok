//! The server: its route table, the guard, CORS, and the rate limit.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use blok_auth::User;
use blok_blob::Store;
use blok_dotnet::equals_ordinal_ignore_case;
use blok_http::{Request, ResponseWriter, is_field_value};
use blok_jsjson::append_quoted;
use blok_route::{Router, method_not_allowed, start_stream};

use crate::options::{Clock, Options, OptionsError};

/// A configured Blok server. Build it with [`Server::new`].
#[derive(Clone)]
pub struct Server {
    pub(crate) inner: Arc<Inner>,
}

pub(crate) struct Inner {
    pub options: Options,
    pub public_path: String,
    pub limiter: RateLimiter,
    pub clock: Clock,
    store: OnceLock<Result<Arc<dyn Store>, String>>,
    #[cfg_attr(not(feature = "conformance"), allow(dead_code))]
    pub conformance: Mutex<Conformance>,
}

/// What the conformance build's flags switched on.
#[derive(Clone, Debug, Default)]
pub struct Conformance {
    /// The one origin outbound fetches may reach, and its port.
    pub origin: Option<(String, u16)>,
    /// The built-in journal behind collaboration without CollabJournal.
    pub journal: bool,
}

/// The rate-limit key the guard charged, for outbound hops to charge too.
#[derive(Clone, Debug)]
pub struct RateKey(pub String);

impl Server {
    /// Validates options and returns a server. Like AddBlokServer, nothing
    /// heavy is built until a request needs it. The server keeps its own
    /// copy of the options.
    pub fn new(options: Options) -> Result<Self, OptionsError> {
        let public_path = options.validate_path()?;
        let clock: Clock = options
            .clock
            .clone()
            .unwrap_or_else(|| Arc::new(SystemTime::now));
        let limiter = RateLimiter::new(options.rate_limit_per_minute, Arc::clone(&clock));
        Ok(Self {
            inner: Arc::new(Inner {
                options,
                public_path,
                limiter,
                clock,
                store: OnceLock::new(),
                conformance: Mutex::new(Conformance::default()),
            }),
        })
    }

    pub fn options(&self) -> &Options {
        &self.inner.options
    }

    /// Stops the server's long-lived work before the HTTP server shuts
    /// down. Without collaboration there is none.
    pub async fn drain(&self, _grace: Duration) -> Result<(), String> {
        Ok(())
    }

    /// MapBlokServer: the routes the options switch on under prefix ("" for
    /// the root), every other path answered 404, and local files served at
    /// the public URL path, outside the prefix.
    ///
    /// Not mapped until their crates are plugged in, so they answer as the
    /// feature switched off does (404): GET /unfurl, GET /frame-check, POST
    /// /upload-by-url (outbound) and the /sync routes (collab).
    pub fn handler(&self, prefix: &str) -> Router {
        let prefix = prefix.trim_end_matches('/');
        let mut router = Router::new();
        let o = &self.inner.options;

        if !o.storage_directory.is_empty()
            && o.s3_bucket.is_empty()
            && !self.inner.public_path.is_empty()
        {
            let pattern = if self.inner.public_path == "/" {
                "/{fileName}".to_owned()
            } else {
                format!("{}/{{fileName}}", self.inner.public_path)
            };
            let inner = Arc::clone(&self.inner);
            router.handle(
                &pattern,
                Some(&["GET", "HEAD"]),
                move |request, response| {
                    crate::localfile::serve_local_file(Arc::clone(&inner), request, response)
                },
            );
        }

        let inner = Arc::clone(&self.inner);
        router.handle(
            &format!("{prefix}/health"),
            Some(&["GET", "HEAD"]),
            move |request, response| health(Arc::clone(&inner), request, response),
        );
        router.handle(
            &format!("{prefix}/health"),
            None,
            method_not_allowed("GET, HEAD"),
        );
        if o.has_storage() {
            self.shell(
                &mut router,
                &format!("{prefix}/upload"),
                "POST",
                crate::upload::upload,
            );
            self.shell(
                &mut router,
                &format!("{prefix}/delete"),
                "POST",
                crate::handlers::delete,
            );
        }
        router
    }

    /// Maps one guarded route with its preflight and its 405 answer.
    fn shell<F, Fut>(&self, router: &mut Router, pattern: &str, method: &'static str, handler: F)
    where
        F: Fn(Arc<Inner>, Request, ResponseWriter) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let require_write = method != "GET";
        let handler = Arc::new(handler);
        let inner = Arc::clone(&self.inner);
        router.handle(
            pattern,
            Some(&[method]),
            move |mut request: Request, mut response: ResponseWriter| {
                let inner = Arc::clone(&inner);
                let handler = Arc::clone(&handler);
                async move {
                    if guard(&inner, &mut request, &mut response, require_write).await {
                        handler(inner, request, response).await;
                    }
                }
            },
        );
        let inner = Arc::clone(&self.inner);
        router.handle(
            pattern,
            Some(&["OPTIONS"]),
            move |request: Request, response: ResponseWriter| {
                let inner = Arc::clone(&inner);
                async move { preflight(&inner, &request, response, method).await }
            },
        );
        let allow = match method {
            "POST" => "OPTIONS, POST".to_owned(),
            "GET" if pattern.contains("/sync/") => "GET, OPTIONS".to_owned(),
            "GET" => "GET, HEAD, OPTIONS".to_owned(),
            _ => format!("{method}, OPTIONS"),
        };
        router.handle(pattern, None, method_not_allowed(allow));
    }
}

#[cfg(feature = "conformance")]
impl Server {
    /// Lets outbound fetches reach origin only, so the conformance suite can
    /// unfurl from a loopback fixture. The outbound crate reads it once it
    /// is plugged in.
    pub fn use_conformance_origin(&self, origin: &str, port: u16) {
        lock(&self.inner.conformance).origin = Some((origin.to_owned(), port));
    }

    /// Puts the built-in journal behind collaboration without
    /// CollabJournal. Call it before the first request.
    pub fn use_conformance_journal(&self) {
        lock(&self.inner.conformance).journal = true;
    }
}

#[cfg(test)]
#[path = "server_test.rs"]
mod tests;

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl Inner {
    /// The lazily built store: S3 when a bucket is set, else local.
    pub fn blob_store(&self) -> Result<Arc<dyn Store>, String> {
        self.store
            .get_or_init(|| {
                if !self.options.s3_bucket.is_empty() {
                    return Err("blob: the S3 store is not built into this server yet".to_owned());
                }
                Ok(Arc::new(blok_blob::Local::new(
                    &self.options.storage_directory,
                    &self.options.public_url,
                )) as Arc<dyn Store>)
            })
            .clone()
    }

    /// BlokServerCors.IsAllowed: an exact, case-insensitive match against a
    /// trimmed candidate. An empty origin never matches.
    pub fn origin_allowed(&self, origin: &str) -> bool {
        !origin.is_empty()
            && self.options.allowed_origins.iter().any(|candidate| {
                equals_ordinal_ignore_case(candidate.trim().as_bytes(), origin.as_bytes())
            })
    }
}

async fn health(inner: Arc<Inner>, request: Request, mut response: ResponseWriter) {
    response
        .headers_mut()
        .set("Content-Type", "application/json");
    if request.method().eq_ignore_ascii_case("HEAD") {
        return;
    }
    let mut body = br#"{"status":"ok","version":"#.to_vec();
    let version: Vec<u16> = inner.options.version.encode_utf16().collect();
    append_quoted(&mut body, &version);
    body.extend_from_slice(b"}\n");
    write_body(&mut response, 200, &body).await;
}

/// The first value under name, "" when there is none.
pub(crate) fn first_value<'a>(request: &'a Request, name: &str) -> &'a str {
    request.headers().get(name).unwrap_or("")
}

async fn preflight(inner: &Inner, request: &Request, mut response: ResponseWriter, method: &str) {
    let origin = first_value(request, "Origin");
    if !inner.origin_allowed(origin) {
        write_text(&mut response, 403, "origin not allowed\n").await;
        return;
    }
    let requested = first_value(request, "Access-Control-Request-Headers");
    if !is_field_value(origin) || !is_field_value(requested) {
        header_value_refused(&mut response).await;
        return;
    }
    let headers = response.headers_mut();
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", format!("{method}, OPTIONS"));
    if !requested.is_empty() {
        headers.set("Access-Control-Allow-Headers", requested);
        headers.add("Vary", "Access-Control-Request-Headers");
    }
    headers.set("Access-Control-Max-Age", "600");
    headers.add("Vary", "Origin");
    response.set_status(204);
}

/// What Kestrel answers when setting a response header throws: the handler
/// stops, and an empty 500 goes out.
pub(crate) async fn header_value_refused(response: &mut ResponseWriter) {
    let headers = response.headers_mut();
    headers.clear();
    headers.set("Content-Length", "0");
    let _ = response.start(500).await;
}

/// BlokServerRequestGuard: origin, then ticket, then rate limit. CORS
/// headers go on before the ticket and limiter checks so their refusals stay
/// readable to the page. On a pass the request carries the [`RateKey`] and,
/// in ticket mode, the [`User`].
pub(crate) async fn guard(
    inner: &Inner,
    request: &mut Request,
    response: &mut ResponseWriter,
    require_write: bool,
) -> bool {
    let origin = first_value(request, "Origin").to_owned();
    let allowed = inner.origin_allowed(&origin);
    let has_origin = request.headers().contains("Origin");
    let required = inner.options.auth == "ticket"
        || has_origin
        || equals_ordinal_ignore_case(
            first_value(request, "Sec-Fetch-Site").as_bytes(),
            b"cross-site",
        );
    if required && !allowed {
        write_text(response, 403, "origin not allowed\n").await;
        return false;
    }
    if allowed {
        if !is_field_value(&origin) {
            header_value_refused(response).await;
            return false;
        }
        response
            .headers_mut()
            .set("Access-Control-Allow-Origin", &*origin);
        response.headers_mut().add("Vary", "Origin");
    }
    let mut key = format!("addr:{}", request.remote_addr().ip());
    if inner.options.auth == "ticket" {
        let authorization = first_value(request, "Authorization");
        let pass = authorization
            .strip_prefix("Bearer ")
            .unwrap_or(authorization);
        if pass.is_empty() {
            write_text(response, 401, "missing pass\n").await;
            return false;
        }
        let Some(claims) = blok_ticket::verify(&inner.options.secret, pass, (inner.clock)()) else {
            write_text(response, 401, "invalid pass\n").await;
            return false;
        };
        if require_write && !claims.write {
            write_text(response, 403, "write access required\n").await;
            return false;
        }
        if !claims.user.is_empty() {
            key = format!("user:{}", claims.user);
        }
        request.extensions.insert(User {
            id: claims.user.clone(),
            name: claims.user,
            doc: claims.doc,
            write: claims.write,
            authenticated: true,
        });
    }
    if !inner.limiter.allow(&key) {
        write_text(response, 429, "rate limit exceeded\n").await;
        return false;
    }
    request.extensions.insert(RateKey(key));
    true
}

/// The user the request carries. In ticket mode the guard sets it from the
/// verified pass.
pub fn user_from(request: &Request) -> Option<&User> {
    request.extensions.get::<User>()
}

/// The C# error wire: text/plain, streamed, no nosniff header.
pub(crate) async fn write_text(response: &mut ResponseWriter, status: u16, body: &str) {
    response
        .headers_mut()
        .set("Content-Type", "text/plain; charset=utf-8");
    write_body(response, status, body.as_bytes()).await;
}

pub(crate) async fn write_json(response: &mut ResponseWriter, status: u16, body: &[u8]) {
    response
        .headers_mut()
        .set("Content-Type", "application/json");
    write_body(response, status, body).await;
}

/// Streams like Kestrel's WriteAsync: no Content-Length.
pub(crate) async fn write_body(response: &mut ResponseWriter, status: u16, body: &[u8]) {
    start_stream(response, status).await;
    let _ = response.write(body).await;
}

/// UploadWire's {"url","fileName"?,"size"?,"mimeType"?}.
pub(crate) async fn upload_response(
    response: &mut ResponseWriter,
    url: &str,
    file_name: &str,
    size: i64,
    mime_type: &str,
) {
    let units = |s: &str| s.encode_utf16().collect::<Vec<u16>>();
    let mut body = br#"{"url":"#.to_vec();
    append_quoted(&mut body, &units(url));
    if !file_name.is_empty() {
        body.extend_from_slice(br#","fileName":"#);
        append_quoted(&mut body, &units(file_name));
    }
    if size != 0 {
        body.extend_from_slice(format!(r#","size":{size}"#).as_bytes());
    }
    if !mime_type.is_empty() {
        body.extend_from_slice(br#","mimeType":"#);
        append_quoted(&mut body, &units(mime_type));
    }
    body.extend_from_slice(b"}\n");
    write_json(response, 200, &body).await;
}

/// FixedWindowRateLimiter: a one-minute window from the first hit per key,
/// swept at most once a minute. A limit of 0 or less is off.
pub(crate) struct RateLimiter {
    limit: i64,
    now: Clock,
    state: Mutex<Windows>,
}

struct Windows {
    windows: HashMap<String, (SystemTime, i64)>,
    last_sweep: SystemTime,
}

/// now - start >= a minute; a clock that went back reads as not yet.
fn minute_passed(now: SystemTime, start: SystemTime) -> bool {
    now.duration_since(start)
        .is_ok_and(|elapsed| elapsed >= Duration::from_secs(60))
}

impl RateLimiter {
    fn new(limit: i64, now: Clock) -> Self {
        let last_sweep = now();
        Self {
            limit,
            now,
            state: Mutex::new(Windows {
                windows: HashMap::new(),
                last_sweep,
            }),
        }
    }

    pub fn allow(&self, key: &str) -> bool {
        if self.limit <= 0 {
            return true;
        }
        let mut state = lock(&self.state);
        let now = (self.now)();
        if minute_passed(now, state.last_sweep) {
            state.last_sweep = now;
            state
                .windows
                .retain(|_, (start, _)| !minute_passed(now, *start));
        }
        match state.windows.get_mut(key) {
            Some((start, count)) if !minute_passed(now, *start) => {
                if *count >= self.limit {
                    return false;
                }
                *count += 1;
                true
            }
            _ => {
                state.windows.insert(key.to_owned(), (now, 1));
                true
            }
        }
    }
}

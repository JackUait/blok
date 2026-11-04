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

use blok_collab_synchttp::ConnectionTable;

use crate::collab::{CollabRooms, LazyRooms, LazyRuntime, runtime_options};
use crate::options::{Clock, Options, OptionsError};

/// One collab route behind the guard.
#[derive(Clone, Copy)]
enum CollabRoute {
    Reset,
    Edit,
    State,
    HistoryList,
    HistoryRead,
    HistoryDelete,
    HistoryRestore,
    HistoryChanges,
}

impl CollabRoute {
    async fn serve(
        self,
        routes: &blok_collab_collabhttp::Handlers,
        request: Request,
        response: ResponseWriter,
    ) {
        match self {
            CollabRoute::Reset => routes.reset(request, response).await,
            CollabRoute::Edit => routes.edit(request, response).await,
            CollabRoute::State => routes.state(request, response).await,
            CollabRoute::HistoryList => routes.history_list(request, response).await,
            CollabRoute::HistoryRead => routes.history_read(request, response).await,
            CollabRoute::HistoryDelete => routes.history_delete(request, response).await,
            CollabRoute::HistoryRestore => routes.history_restore(request, response).await,
            CollabRoute::HistoryChanges => routes.history_changes(request, response).await,
        }
    }
}

/// Converts a long article in the background, so the first request does
/// not pay for cold paths: a failed or slow warm-up never fails or delays
/// `new`, as C#'s BlokDocumentWarmUp.
fn warm_up_in_background(
    converter: blok_blokdocs::Converter,
) -> tokio::sync::watch::Receiver<bool> {
    let (done, warmed) = tokio::sync::watch::channel(false);
    let task = async move {
        let _ = converter.warm_up().await;
        let _ = done.send(true);
    };
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => {
            handle.spawn(task);
        }
        Err(_) => {
            std::thread::spawn(move || {
                if let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    runtime.block_on(task);
                }
            });
        }
    }
    warmed
}

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
    pub(crate) store: OnceLock<Result<Arc<dyn Store>, String>>,
    fetcher: Mutex<blok_outbound::Fetcher>,
    #[cfg_attr(not(feature = "conformance"), allow(dead_code))]
    pub conformance: Mutex<Conformance>,
    /// Set when collaboration is on; /sync is mapped only with it.
    pub(crate) collab: Option<CollabRooms>,
    /// The engine pool the rooms and the document converter share, built on
    /// first use.
    pub(crate) runtime: Arc<LazyRuntime>,
    pub(crate) documents: OnceLock<blok_blokdocs::Converter>,
    /// Turns true when the warm-up `new` started has finished.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) warmed: Option<tokio::sync::watch::Receiver<bool>>,
    pub(crate) connections: Arc<ConnectionTable>,
    pub(crate) upgrades: Mutex<Option<Arc<blok_collab_synchttp::UpgradeLimit>>>,
    /// Stands in for the room manager at the sync door.
    #[cfg(test)]
    pub(crate) rooms_override: Mutex<Option<Arc<dyn blok_collab::Rooms>>>,
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
        Self::build(options, None)
    }

    /// `new` with the engine pool built by `builder`, so a test can count
    /// the builds the warm-up makes.
    #[cfg(test)]
    pub(crate) fn new_with_runtime_builder(
        options: Options,
        builder: crate::collab::Builder,
    ) -> Result<Self, OptionsError> {
        Self::build(options, Some(builder))
    }

    fn build(
        options: Options,
        builder: Option<crate::collab::Builder>,
    ) -> Result<Self, OptionsError> {
        let public_path = options.validate_path()?;
        let clock: Clock = options
            .clock
            .clone()
            .unwrap_or_else(|| Arc::new(SystemTime::now));
        let limiter = RateLimiter::new(options.rate_limit_per_minute, Arc::clone(&clock));
        let runtime = LazyRuntime::new(runtime_options(&options));
        if let Some(builder) = builder {
            *lock(&runtime.build) = builder;
        }
        let runtime = Arc::new(runtime);
        let connections = Arc::new(ConnectionTable::new(
            options.collab_max_connections,
            options.collab_max_connections_per_user_per_doc,
        ));
        let collab = options.collab_enabled.then(CollabRooms::default);
        let warm_up = options.documents.warm_up;
        let mut inner = Inner {
            options,
            public_path,
            limiter,
            clock,
            store: OnceLock::new(),
            fetcher: Mutex::new(blok_outbound::Fetcher::new(Arc::new(
                blok_outbound::DefaultPolicy,
            ))),
            conformance: Mutex::new(Conformance::default()),
            collab,
            runtime,
            documents: OnceLock::new(),
            warmed: None,
            connections,
            upgrades: Mutex::new(None),
            #[cfg(test)]
            rooms_override: Mutex::new(None),
        };
        if warm_up {
            inner.warmed = Some(warm_up_in_background(inner.document_converter()));
        }
        Ok(Self {
            inner: Arc::new(inner),
        })
    }

    pub fn options(&self) -> &Options {
        &self.inner.options
    }

    /// Stops the server's long-lived work before the HTTP server shuts
    /// down: new upgrades get 503, every room flushes, members close 1001.
    /// Without collaboration there is none. Grace bounds the whole drain.
    pub async fn drain(&self, grace: Duration) -> Result<(), String> {
        let Some(collab) = &self.inner.collab else {
            return Ok(());
        };
        let deadline = tokio::time::Instant::now() + grace;
        let manager = collab.get(&self.inner)?;
        match tokio::time::timeout_at(deadline, manager.drain()).await {
            Err(_) => return Err("context deadline exceeded".to_owned()),
            Ok(Err(err)) => return Err(err.to_string()),
            Ok(Ok(())) => {}
        }
        // A hijacked socket outlives the HTTP shutdown, and each member's
        // close is only queued: wait for the sockets, as Kestrel waits for
        // upgraded connections, until the grace ends.
        while self.inner.connections.live() > 0 {
            if tokio::time::Instant::now() >= deadline {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        Ok(())
    }

    /// MapBlokServer: the routes the options switch on under prefix ("" for
    /// the root), every other path answered 404, and local files served at
    /// the public URL path, outside the prefix.
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
        if o.unfurl_enabled {
            self.shell(
                &mut router,
                &format!("{prefix}/unfurl"),
                "GET",
                crate::outbound::unfurl,
            );
            self.shell(
                &mut router,
                &format!("{prefix}/frame-check"),
                "GET",
                crate::outbound::frame_check,
            );
        }
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
            if o.unfurl_enabled {
                self.shell(
                    &mut router,
                    &format!("{prefix}/upload-by-url"),
                    "POST",
                    crate::outbound::upload_by_url,
                );
            }
        }
        if o.collab_enabled && self.inner.collab.is_some() {
            self.map_collab(&mut router, prefix);
        }
        router
    }

    fn map_collab(&self, router: &mut Router, prefix: &str) {
        let o = &self.inner.options;
        // Not behind the guard: the handshake is its own door, and a live
        // socket outlasts any request deadline.
        let endpoint = self.sync_endpoint();
        router.handle(
            &format!("{prefix}/sync/{{doc}}"),
            Some(&["GET"]),
            move |request: Request, response: ResponseWriter| {
                let endpoint = endpoint.clone();
                async move {
                    request.lift_timeout();
                    blok_http::Handler::serve(&endpoint, request, response).await;
                }
            },
        );
        router.handle(
            &format!("{prefix}/sync/{{doc}}"),
            None,
            method_not_allowed("GET"),
        );
        let rooms = Arc::clone(&self.inner);
        let corrupt = Arc::clone(&self.inner);
        let routes = blok_collab_collabhttp::Handlers::new(blok_collab_collabhttp::Config {
            ticket_mode: o.auth == "ticket",
            authorization: o.authorization.clone(),
            rooms: Arc::new(move || rooms.rooms()),
            max_message_bytes: usize::try_from(o.collab_max_message_bytes).unwrap_or(0),
            corrupt_log: Some(Arc::new(move |doc: &str| corrupt.corrupt_log(doc))),
        });
        for (path, method, route) in [
            ("/reset", "POST", CollabRoute::Reset),
            ("/edit", "POST", CollabRoute::Edit),
            ("/state", "GET", CollabRoute::State),
            ("/history", "GET", CollabRoute::HistoryList),
            (
                "/history/{lineage}/{sequence}",
                "GET",
                CollabRoute::HistoryRead,
            ),
            ("/history/{lineage}", "DELETE", CollabRoute::HistoryDelete),
            (
                "/history/{lineage}/{sequence}/restore",
                "POST",
                CollabRoute::HistoryRestore,
            ),
            (
                "/history/{lineage}/{sequence}/changes",
                "GET",
                CollabRoute::HistoryChanges,
            ),
        ] {
            let routes = routes.clone();
            self.shell(
                router,
                &format!("{prefix}/sync/{{doc}}{path}"),
                method,
                move |_inner, request, response| {
                    let routes = routes.clone();
                    async move { route.serve(&routes, request, response).await }
                },
            );
        }
        if o.auth == "none" && o.authorization.is_none() {
            self.inner.warn_open_sync_routes(prefix);
        }
    }

    fn sync_endpoint(&self) -> blok_collab_synchttp::Endpoint {
        let o = &self.inner.options;
        let origins = Arc::clone(&self.inner);
        let limiter = Arc::clone(&self.inner);
        let clock = Arc::clone(&self.inner.clock);
        #[cfg(test)]
        let rooms: Arc<dyn blok_collab::Rooms> = lock(&self.inner.rooms_override)
            .clone()
            .unwrap_or_else(|| Arc::new(LazyRooms(Arc::clone(&self.inner))));
        #[cfg(not(test))]
        let rooms: Arc<dyn blok_collab::Rooms> = Arc::new(LazyRooms(Arc::clone(&self.inner)));
        blok_collab_synchttp::Endpoint::new(blok_collab_synchttp::Config {
            auth: o.auth.clone(),
            secret: o.secret.clone(),
            origin_allowed: Arc::new(move |origin: &str| origins.origin_allowed(origin)),
            rate_limit: Arc::new(move |key: &str| limiter.limiter.allow(key)),
            clock: Arc::new(move || clock()),
            authorization: o.authorization.clone(),
            rooms,
            has_operation_store: self.inner.has_journal(),
            max_message_bytes: usize::try_from(o.collab_max_message_bytes).unwrap_or(0),
            keep_alive_interval: Duration::from_nanos(
                u64::try_from(o.collab_keep_alive_interval_nanos).unwrap_or(0),
            ),
            connections: Arc::clone(&self.inner.connections),
            budget: blok_collab_synchttp::BudgetOptions {
                frames_per_second: o.collab_inbound_frames_per_second,
                burst_frames: o.collab_inbound_burst_frames,
                resyncs_per_minute: o.collab_inbound_resyncs_per_minute,
                awareness_bytes_per_second: o.collab_inbound_awareness_bytes_per_second,
            },
            budget_clock: None,
            upgrades: lock(&self.inner.upgrades).clone(),
        })
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
    /// unfurl from a loopback fixture.
    pub fn use_conformance_origin(&self, origin: &str, port: u16) {
        lock(&self.inner.conformance).origin = Some((origin.to_owned(), port));
        self.inner
            .set_policy(Arc::new(blok_outbound::ExactOriginPolicy {
                origin: origin.to_owned(),
                port,
            }));
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

/// The S3 store's settings: the spool is capped at MaxUploadBytes, in the
/// system temp directory.
pub(crate) fn s3_options(o: &Options) -> blok_blob::S3Options {
    blok_blob::S3Options {
        endpoint: o.s3_endpoint.clone(),
        region: o.s3_region.clone(),
        bucket: o.s3_bucket.clone(),
        access_key: o.s3_access_key.clone(),
        secret_key: o.s3_secret_key.clone(),
        public_url: o.s3_bucket_url.clone(),
        addressing: o.s3_addressing.clone(),
        max_spool_bytes: u64::try_from(o.max_upload_bytes).unwrap_or(0),
        temp_dir: None,
    }
}

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
                let o = &self.options;
                if !o.s3_bucket.is_empty() {
                    let store = blok_blob::S3::new(s3_options(o))
                        .map_err(|e| e.to_string())?
                        .with_clock(Arc::clone(&self.clock));
                    return Ok(Arc::new(store) as Arc<dyn Store>);
                }
                Ok(Arc::new(blok_blob::Local::new(
                    &self.options.storage_directory,
                    &self.options.public_url,
                )) as Arc<dyn Store>)
            })
            .clone()
    }

    /// The guarded fetcher. Clones share its four slots.
    pub fn fetcher(&self) -> blok_outbound::Fetcher {
        lock(&self.fetcher).clone()
    }

    /// Swaps the outbound policy. Call it before the first request.
    #[cfg_attr(not(any(test, feature = "conformance")), allow(dead_code))]
    pub fn set_policy(&self, policy: Arc<dyn blok_outbound::Policy>) {
        *lock(&self.fetcher) = blok_outbound::Fetcher::new(policy);
    }

    /// BlokServerCors.IsAllowed: an exact, case-insensitive match against a
    /// trimmed candidate. An empty origin never matches.
    /// Nor one Kestrel could not echo: a browser writes a non-ASCII host in
    /// punycode.
    pub fn origin_allowed(&self, origin: &str) -> bool {
        !origin.is_empty()
            && is_field_value(origin)
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
    if !is_field_value(requested) {
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

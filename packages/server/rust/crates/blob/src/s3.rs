use std::io::SeekFrom;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use blok_dotnet::{Uri, parse_absolute_uri, unescape_data_string};
use blok_outbound::EnvironmentProxy;
use blok_outbound::operator::{OperatorClient, OperatorError, Request, RequestBody};
use blok_outbound::wire::Source;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use crate::blob::{
    Body, BoxFuture, Cancelled, Error, Store, key_from_public_url, new_key, random_hex,
    until_cancelled,
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const RESPONSE_HEADER_TIMEOUT: Duration = Duration::from_secs(60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const ERROR_BODY_LIMIT: usize = 512;

/// S3BlobStoreOptions.
#[derive(Debug, Clone, Default)]
pub struct S3Options {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub access_key: String,
    pub secret_key: String,
    pub public_url: String,
    /// "path", "virtual", or "" to choose automatically.
    pub addressing: String,
    /// Caps a body that has to be spooled to learn its length.
    pub max_spool_bytes: u64,
    /// Where spools go; the system temp directory when None.
    pub temp_dir: Option<PathBuf>,
}

/// The timeouts and proxy S3BlobStore's handler uses; tests shorten them.
#[derive(Debug, Clone)]
pub(crate) struct Settings {
    pub request_timeout: Duration,
    pub header_timeout: Duration,
    pub connect_timeout: Duration,
    pub proxy: Option<EnvironmentProxy>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            request_timeout: REQUEST_TIMEOUT,
            header_timeout: RESPONSE_HEADER_TIMEOUT,
            connect_timeout: CONNECT_TIMEOUT,
            proxy: EnvironmentProxy::from_env(),
        }
    }
}

/// What a test transport sees of one request.
#[cfg(test)]
#[derive(Debug, Clone)]
pub(crate) struct Recorded {
    pub method: String,
    pub path: String,
    pub host: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[cfg(test)]
impl Recorded {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

#[cfg(test)]
pub(crate) type Fake = std::sync::Arc<dyn Fn(Recorded) -> (u16, Vec<u8>) + Send + Sync>;

enum Transport {
    Operator(Box<OperatorClient>),
    #[cfg(test)]
    Fake(Fake),
}

/// S3BlobStore: SigV4-signed requests to the operator's endpoint, the one
/// client besides the doc endpoint exempt from the outbound guard, because it
/// reaches only the configured endpoint, never a URL a caller chose.
pub struct S3 {
    pub options: S3Options,
    pub(crate) settings: Settings,
    /// The signing clock: the host's TimeProvider, or the system clock.
    pub(crate) now: Arc<dyn Fn() -> SystemTime + Send + Sync>,
    transport: Transport,
}

impl S3 {
    /// Checks the target the way S3TargetResolver does and builds the client.
    pub fn new(options: S3Options) -> Result<S3, Error> {
        S3::build(options, Settings::default())
    }

    /// Signs with clock instead of the system clock, as Go's blob.S3 Now.
    pub fn with_clock(mut self, clock: Arc<dyn Fn() -> SystemTime + Send + Sync>) -> S3 {
        self.now = clock;
        self
    }

    pub(crate) fn build(options: S3Options, settings: Settings) -> Result<S3, Error> {
        target(&options, "validation")?;
        let client = OperatorClient {
            connect_timeout: settings.connect_timeout,
            header_timeout: Some(settings.header_timeout),
            proxy: settings.proxy.clone(),
            roots: None,
        };
        Ok(S3 {
            options,
            settings,
            now: Arc::new(SystemTime::now),
            transport: Transport::Operator(Box::new(client)),
        })
    }

    #[cfg(test)]
    pub(crate) fn with_fake(mut self, fake: Fake) -> S3 {
        self.transport = Transport::Fake(fake);
        self
    }

    fn public(&self, key: &str) -> String {
        format!("{}/{key}", self.options.public_url.trim_end_matches('/'))
    }

    /// Reads a raw key for the collab working set. A 404 is None; a 403
    /// stays an error, since S3 answers 403 for a missing key when the
    /// credentials cannot list the bucket.
    pub async fn get_object(&self, key: &str) -> Result<Option<Vec<u8>>, Error> {
        refuse_empty(key)?;
        self.send(
            "GET",
            key,
            "",
            RequestBody::Bytes(&[]),
            &empty_hash(),
            true,
            true,
        )
        .await
    }

    /// Writes a raw key as application/octet-stream.
    pub async fn put_object(&self, key: &str, content: &[u8]) -> Result<(), Error> {
        refuse_empty(key)?;
        let hash = hex(&Sha256::digest(content));
        let body = RequestBody::Bytes(content);
        self.send(
            "PUT",
            key,
            "application/octet-stream",
            body,
            &hash,
            false,
            false,
        )
        .await?;
        Ok(())
    }

    /// Removes a raw key; a 404 is success.
    pub async fn delete_object(&self, key: &str) -> Result<(), Error> {
        refuse_empty(key)?;
        self.send(
            "DELETE",
            key,
            "",
            RequestBody::Bytes(&[]),
            &empty_hash(),
            false,
            true,
        )
        .await?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn send(
        &self,
        method: &str,
        key: &str,
        mime_type: &str,
        body: RequestBody<'_>,
        hash: &str,
        read_body: bool,
        allow_not_found: bool,
    ) -> Result<Option<Vec<u8>>, Error> {
        let (url, host) = target(&self.options, key)?;
        let mut headers = Vec::new();
        if method == "PUT" {
            headers.push(("Content-Disposition".to_owned(), "attachment".to_owned()));
        }
        if !mime_type.is_empty() {
            headers.push(("Content-Type".to_owned(), mime_type.to_owned()));
        }
        headers.extend(sign(
            method,
            &url.absolute_path,
            &host,
            &self.options,
            mime_type,
            hash,
            (self.now)(),
        ));
        let request = Request {
            method,
            url: &url,
            host: &host,
            headers,
            body,
        };
        tokio::time::timeout(
            self.settings.request_timeout,
            self.exchange(request, read_body, allow_not_found),
        )
        .await
        .map_err(|_| Error::DeadlineExceeded)?
    }

    async fn exchange(
        &self,
        request: Request<'_, '_>,
        read_body: bool,
        allow_not_found: bool,
    ) -> Result<Option<Vec<u8>>, Error> {
        let method = request.method.to_owned();
        let (status, mut body): (u16, Answer) = match &self.transport {
            Transport::Operator(client) => {
                let response = client.send(request).await.map_err(transport_error)?;
                (response.status, Answer::Wire(response.body))
            }
            #[cfg(test)]
            Transport::Fake(fake) => {
                let mut sent = Vec::new();
                match request.body {
                    RequestBody::Bytes(bytes) => sent.extend_from_slice(bytes),
                    RequestBody::Reader(reader, length) => {
                        reader.take(length).read_to_end(&mut sent).await?;
                    }
                }
                let mut headers = request.headers;
                headers.push(("Content-Length".to_owned(), sent.len().to_string()));
                let (status, answer) = fake(Recorded {
                    method: method.clone(),
                    path: request.url.absolute_path.clone(),
                    host: request.host.to_owned(),
                    headers,
                    body: sent,
                });
                (status, Answer::Canned(answer))
            }
        };
        if (200..=299).contains(&status) {
            if read_body {
                return Ok(Some(body.read_to_end(usize::MAX).await?));
            }
            return Ok(Some(Vec::new()));
        }
        if allow_not_found && status == 404 {
            return Ok(None);
        }
        let prefix = body.read_to_end(ERROR_BODY_LIMIT).await.unwrap_or_default();
        Err(Error::Message(format!(
            "blobstore: s3 {method} returned {status}: {}",
            String::from_utf8_lossy(&prefix).trim()
        )))
    }

    async fn put_seekable<'b>(
        &self,
        key: &str,
        mime: &str,
        mut body: Box<dyn crate::blob::Seekable + 'b>,
    ) -> Result<Option<Box<dyn crate::blob::Seekable + 'b>>, Error> {
        let Ok(start) = body.stream_position().await else {
            return Ok(Some(body));
        };
        let end = body.seek(SeekFrom::End(0)).await?;
        body.seek(SeekFrom::Start(start)).await?;
        if end < start {
            return Err(Error::Message(
                "blobstore: s3 payload ends before its current position".to_owned(),
            ));
        }
        let mut hasher = Sha256::new();
        let mut chunk = vec![0u8; 64 << 10];
        loop {
            let n = body.read(&mut chunk).await?;
            if n == 0 {
                break;
            }
            hasher.update(&chunk[..n]);
        }
        body.seek(SeekFrom::Start(start)).await?;
        let hash = hex(&hasher.finalize());
        let length = end - start;
        self.send(
            "PUT",
            key,
            mime,
            RequestBody::Reader(&mut body, length),
            &hash,
            false,
            false,
        )
        .await?;
        Ok(None)
    }

    async fn put_spooled(
        &self,
        key: &str,
        mime: &str,
        content: Box<dyn AsyncRead + Send + Unpin + '_>,
    ) -> Result<(), Error> {
        let dir = self
            .options
            .temp_dir
            .clone()
            .unwrap_or_else(std::env::temp_dir);
        tokio::fs::create_dir_all(&dir).await?;
        let path = dir.join(format!("blok-s3-{}.tmp", random_hex()));
        // Opened in place so a dropped put cannot miss the file it made.
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)?;
        let _spool = Spool(path);
        let mut file = tokio::fs::File::from_std(file);
        let mut hasher = Sha256::new();
        let mut limited = content.take(self.options.max_spool_bytes + 1);
        let mut chunk = vec![0u8; 64 << 10];
        let mut length = 0u64;
        loop {
            let n = limited.read(&mut chunk).await?;
            if n == 0 {
                break;
            }
            hasher.update(&chunk[..n]);
            file.write_all(&chunk[..n]).await?;
            length += n as u64;
        }
        if length > self.options.max_spool_bytes {
            return Err(Error::Message(
                "blobstore: s3 upload body is over the spool cap".to_owned(),
            ));
        }
        file.flush().await?;
        file.seek(SeekFrom::Start(0)).await?;
        let hash = hex(&hasher.finalize());
        self.send(
            "PUT",
            key,
            mime,
            RequestBody::Reader(&mut file, length),
            &hash,
            false,
            false,
        )
        .await?;
        Ok(())
    }
}

/// Removes the spool when the put ends, however it ends.
struct Spool(PathBuf);

impl Drop for Spool {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

enum Answer {
    Wire(blok_outbound::wire::Body<tokio::io::BufReader<Box<dyn blok_outbound::operator::Stream>>>),
    #[cfg(test)]
    Canned(Vec<u8>),
}

impl Answer {
    async fn read_to_end(&mut self, limit: usize) -> std::io::Result<Vec<u8>> {
        match self {
            #[cfg(test)]
            Answer::Canned(bytes) => Ok(bytes[..bytes.len().min(limit)].to_vec()),
            Answer::Wire(body) => {
                let mut out = Vec::new();
                let mut chunk = vec![0u8; 64 << 10];
                while out.len() < limit {
                    let want = chunk.len().min(limit - out.len());
                    let n = body.read(&mut chunk[..want]).await?;
                    if n == 0 {
                        break;
                    }
                    out.extend_from_slice(&chunk[..n]);
                }
                Ok(out)
            }
        }
    }
}

fn transport_error(err: OperatorError) -> Error {
    match err {
        OperatorError::Io(err) => Error::Io(err),
        other => Error::Message(other.to_string()),
    }
}

fn refuse_empty(key: &str) -> Result<(), Error> {
    if key.is_empty() {
        return Err(Error::Message("blobstore: s3 key is empty".to_owned()));
    }
    Ok(())
}

impl Store for S3 {
    /// Learns the body's length and hash, then PUTs it. Like C#'s
    /// PreparedPayload, a seekable body is hashed in place, with no spool
    /// cap; any other body is spooled.
    fn put<'a>(
        &'a self,
        extension: &'a str,
        mime_type: &'a str,
        content: Body<'a>,
        cancelled: Cancelled<'a>,
    ) -> BoxFuture<'a, Result<String, Error>> {
        Box::pin(until_cancelled(cancelled, async move {
            let key = new_key(extension);
            let mime = sanitize_s3_media_type(mime_type);
            match content {
                Body::Seekable(body) => {
                    if let Some(unseekable) = self.put_seekable(&key, &mime, body).await? {
                        self.put_spooled(&key, &mime, Box::new(unseekable)).await?;
                    }
                }
                Body::Stream(body) => self.put_spooled(&key, &mime, body).await?,
            }
            Ok(self.public(&key))
        }))
    }

    /// Removes the object behind a URL this store issued.
    fn delete<'a>(
        &'a self,
        url: &'a str,
        cancelled: Cancelled<'a>,
    ) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(until_cancelled(cancelled, async move {
            let key = key_from_public_url(&self.options.public_url, url).ok_or(Error::Foreign)?;
            self.send(
                "DELETE",
                &key,
                "",
                RequestBody::Bytes(&[]),
                &empty_hash(),
                false,
                false,
            )
            .await?;
            Ok(())
        }))
    }
}

fn workingset_error(err: Error) -> blok_collab_workingset::Error {
    match err {
        Error::DeadlineExceeded => blok_collab_workingset::Error::DeadlineExceeded,
        Error::Io(err) => blok_collab_workingset::Error::Io(err),
        other => blok_collab_workingset::Error::Other(Box::new(other)),
    }
}

impl blok_collab_workingset::ObjectStore for S3 {
    async fn get_object(
        &self,
        key: &str,
    ) -> Result<Option<Vec<u8>>, blok_collab_workingset::Error> {
        S3::get_object(self, key).await.map_err(workingset_error)
    }

    async fn put_object(
        &self,
        key: &str,
        content: &[u8],
    ) -> Result<(), blok_collab_workingset::Error> {
        S3::put_object(self, key, content)
            .await
            .map_err(workingset_error)
    }

    async fn delete_object(&self, key: &str) -> Result<(), blok_collab_workingset::Error> {
        S3::delete_object(self, key).await.map_err(workingset_error)
    }
}

fn message(text: String) -> Error {
    Error::Message(text)
}

/// S3TargetResolver.Resolve: the object URL and the Host value.
pub(crate) fn target(o: &S3Options, key: &str) -> Result<(Uri, String), Error> {
    if o.bucket.is_empty() {
        return Err(message("blobstore: s3 needs a bucket".to_owned()));
    }
    if !o
        .bucket
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || b"-._".contains(&c))
    {
        return Err(message(format!(
            "blobstore: s3 bucket {:?} may only contain letters, digits, dots, dashes and underscores",
            o.bucket
        )));
    }
    if !matches!(o.addressing.as_str(), "" | "path" | "virtual") {
        return Err(message(format!(
            "blobstore: s3 addressing style must be \"path\" or \"virtual\" (got {:?})",
            o.addressing
        )));
    }
    if o.addressing == "virtual" && !dns_compatible_bucket(&o.bucket) {
        return Err(message(format!(
            "blobstore: s3 bucket {:?} is not valid for virtual-hosted addressing",
            o.bucket
        )));
    }
    let no_host = || {
        message(format!(
            "blobstore: s3 endpoint {:?} has no usable host",
            o.endpoint
        ))
    };
    let endpoint = parse_absolute_uri(&o.endpoint)
        .filter(|e| e.is_http() && !e.host.is_empty())
        .ok_or_else(no_host)?;
    let authority_start = o.endpoint.find("://").map(|i| i + 3).ok_or_else(no_host)?;
    let mut authority = &o.endpoint[authority_start..];
    if let Some(end) = authority.find(['/', '?', '#']) {
        authority = &authority[..end];
    }
    if let Some(at) = authority.rfind('@') {
        authority = &authority[at + 1..];
    }
    if !authority.bytes().all(|c| (0x20..=0x7e).contains(&c)) {
        return Err(message(format!(
            "blobstore: s3 endpoint host {:?} must be ASCII",
            endpoint.host
        )));
    }
    let path = endpoint_path(&o.endpoint[authority_start..]);
    if !unescape_data_string(path).trim_matches('/').is_empty() {
        return Err(message(format!(
            "blobstore: s3 endpoint {:?} must have no path",
            o.endpoint
        )));
    }
    // UriBuilder.Path escapes these; joined raw they start a query or a
    // fragment and address another object.
    let key = key.replace('?', "%3F").replace('#', "%23");
    let (host, path) = if virtual_addressing(o, &endpoint.host) {
        (format!("{}.{}", o.bucket, endpoint.host), format!("/{key}"))
    } else {
        (endpoint.host.clone(), format!("/{}/{key}", o.bucket))
    };
    let default_port = endpoint.scheme == "http" && endpoint.port == 80
        || endpoint.scheme == "https" && endpoint.port == 443;
    let authority = if default_port {
        host
    } else {
        format!("{host}:{}", endpoint.port)
    };
    let url = parse_absolute_uri(&format!("{}://{authority}{path}", endpoint.scheme))
        .ok_or_else(no_host)?;
    Ok((url, authority))
}

fn endpoint_path(rest: &str) -> &str {
    let suffix = rest.find(['?', '#']);
    let Some(slash) = rest.find('/') else {
        return "";
    };
    if suffix.is_some_and(|s| slash > s) {
        return "";
    }
    let path = &rest[slash..];
    match path.find(['?', '#']) {
        Some(end) => &path[..end],
        None => path,
    }
}

fn virtual_addressing(o: &S3Options, host: &str) -> bool {
    match o.addressing.as_str() {
        "path" => false,
        "virtual" => true,
        _ => {
            let lower = host.to_ascii_lowercase();
            (lower == "amazonaws.com" || lower.ends_with(".amazonaws.com"))
                && !o.bucket.contains('.')
                && dns_compatible_bucket(&o.bucket)
        }
    }
}

fn dns_compatible_bucket(bucket: &str) -> bool {
    let b = bucket.as_bytes();
    if b.len() < 3 || b.len() > 63 {
        return false;
    }
    for (i, &c) in b.iter().enumerate() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            continue;
        }
        if c == b'.' && i > 0 && i < b.len() - 1 && b[i - 1] != b'.' {
            continue;
        }
        if c != b'-' || i == 0 || i == b.len() - 1 || b[i - 1] == b'.' || b[i + 1] == b'.' {
            return false;
        }
    }
    true
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn empty_hash() -> String {
    hex(&Sha256::digest([]))
}

fn hmac_sha256(key: &[u8], data: &str) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("any key length");
    mac.update(data.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

/// UTC as (yyyyMMdd, yyyyMMddTHHmmssZ).
fn amz_dates(at: SystemTime) -> (String, String) {
    let seconds = at.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs()) as i64;
    let days = seconds.div_euclid(86_400);
    let rem = seconds.rem_euclid(86_400);
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    let date = format!("{year:04}{month:02}{day:02}");
    let stamp = format!(
        "{date}T{:02}{:02}{:02}Z",
        rem / 3600,
        rem / 60 % 60,
        rem % 60
    );
    (date, stamp)
}

/// S3RequestSigner.Sign: SigV4 over [content-type;]host;
/// x-amz-content-sha256;x-amz-date, an empty query, and the escaped path.
/// Returns the headers to add.
pub(crate) fn sign(
    method: &str,
    path: &str,
    host: &str,
    o: &S3Options,
    content_type: &str,
    hash: &str,
    at: SystemTime,
) -> Vec<(String, String)> {
    let (date, stamp) = amz_dates(at);
    let mut signed: Vec<(&str, &str)> = Vec::new();
    if !content_type.is_empty() {
        signed.push(("content-type", content_type));
    }
    signed.extend([
        ("host", host),
        ("x-amz-content-sha256", hash),
        ("x-amz-date", &stamp),
    ]);
    let canonical: String = signed
        .iter()
        .map(|(name, value)| {
            format!(
                "{name}:{}\n",
                value.split_whitespace().collect::<Vec<_>>().join(" ")
            )
        })
        .collect();
    let names: Vec<&str> = signed.iter().map(|(name, _)| *name).collect();
    let names = names.join(";");
    let request = [method, path, "", &canonical, &names, hash].join("\n");
    let scope = format!("{date}/{}/s3/aws4_request", o.region);
    let string_to_sign = [
        "AWS4-HMAC-SHA256",
        &stamp,
        &scope,
        &hex(&Sha256::digest(request.as_bytes())),
    ]
    .join("\n");
    let mut key = hmac_sha256(format!("AWS4{}", o.secret_key).as_bytes(), &date);
    for part in [o.region.as_str(), "s3", "aws4_request"] {
        key = hmac_sha256(&key, part);
    }
    let signature = hex(&hmac_sha256(&key, &string_to_sign));
    vec![
        ("X-Amz-Content-Sha256".to_owned(), hash.to_owned()),
        ("X-Amz-Date".to_owned(), stamp),
        (
            "Authorization".to_owned(),
            format!(
                "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={names}, Signature={signature}",
                o.access_key
            ),
        ),
    ]
}

/// The wire rule plus printable ASCII only.
pub(crate) fn sanitize_s3_media_type(value: &str) -> String {
    let value = value.trim();
    if !value.bytes().all(|c| (0x20..=0x7e).contains(&c)) {
        return String::new();
    }
    blok_mediatype::sanitize_wire(value)
}

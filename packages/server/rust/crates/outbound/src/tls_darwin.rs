//! The macOS roots: the trust settings' anchors for an SSL server check, as
//! trustd decides them for C#'s SecTrust (trustsettings.rs). Go reads the
//! same exports. Verification stays rustls's own over this set.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use rustls::pki_types::CertificateDer;
use rustls::pki_types::pem::PemObject;
use sha1::{Digest, Sha1};

use crate::trustsettings::{parse_trust_list, trusted_anchors};

pub(crate) const SECURITY_TOOL: &str = "/usr/bin/security";
/// The fallback when any trust read fails.
pub(crate) const MACOS_BUNDLE: &str = "/etc/ssl/cert.pem";

/// The export flags for the user, admin and system domains, in the order
/// they override each other.
const TRUST_DOMAINS: [&str; 3] = ["", "-d", "-s"];

const KEYCHAINS: [&str; 3] = [
    "~/Library/Keychains/login.keychain-db",
    "/Library/Keychains/System.keychain",
    "/System/Library/Keychains/SystemRootCertificates.keychain",
];

/// The anchors, or the bundle when any read fails: a set read in part would
/// drop a keychain's roots or a domain's denials.
pub(crate) fn load_roots(tool: &Path) -> Vec<CertificateDer<'static>> {
    match load_trust_settings_anchors(tool) {
        Ok(anchors) => anchors.into_iter().map(CertificateDer::from).collect(),
        Err(_) => bundle(),
    }
}

/// Empty when nothing loads: every https fetch then fails closed.
pub(crate) fn bundle() -> Vec<CertificateDer<'static>> {
    match CertificateDer::pem_file_iter(MACOS_BUNDLE) {
        Ok(certs) => certs.filter_map(Result::ok).collect(),
        Err(_) => Vec::new(),
    }
}

pub(crate) fn load_trust_settings_anchors(tool: &Path) -> Result<Vec<Vec<u8>>, String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let home = std::env::var("HOME").unwrap_or_default();
    let mut certs = HashMap::new();
    for keychain in KEYCHAINS {
        let keychain = keychain.replacen('~', &home, 1);
        let out = run(tool, &["find-certificate", "-a", "-p", &keychain], deadline)?;
        for cert in CertificateDer::pem_slice_iter(&out) {
            let der = cert.map_err(|e| e.to_string())?.to_vec();
            certs.insert(upper_hex(&Sha1::digest(&der)), der);
        }
    }
    let directory = TempDir::new()?;
    let mut domains = Vec::with_capacity(TRUST_DOMAINS.len());
    for (index, flag) in TRUST_DOMAINS.iter().enumerate() {
        let path = directory.0.join(format!("domain{index}.plist"));
        let path_text = path.to_str().ok_or("a temp path that is not UTF-8")?;
        let mut args = vec!["trust-settings-export"];
        if !flag.is_empty() {
            args.push(flag);
        }
        args.push(path_text);
        run(tool, &args, deadline)?;
        let data = std::fs::read(&path).map_err(|e| e.to_string())?;
        domains.push(parse_trust_list(&data)?);
    }
    Ok(trusted_anchors(&domains, &certs))
}

fn upper_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect()
}

/// Runs the tool to its end or the deadline; any exit but 0 is a failure.
fn run(tool: &Path, args: &[&str], deadline: Instant) -> Result<Vec<u8>, String> {
    let mut child = Command::new(tool)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    // Read on a thread: a full pipe would stall the tool.
    let mut stdout = child.stdout.take().ok_or("no stdout")?;
    let reader = std::thread::spawn(move || {
        let mut out = Vec::new();
        stdout.read_to_end(&mut out).map(|_| out)
    });
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let out = reader
                .join()
                .map_err(|_| "the reader panicked")?
                .map_err(|e| e.to_string())?;
            return if status.success() {
                Ok(out)
            } else {
                Err(format!("{status}"))
            };
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("the trust read timed out".into());
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Result<TempDir, String> {
        static COUNT: AtomicU64 = AtomicU64::new(0);
        let name = format!(
            "blok-trust-{}-{}",
            std::process::id(),
            COUNT.fetch_add(1, Ordering::Relaxed)
        );
        let path = std::env::temp_dir().join(name);
        std::fs::create_dir(&path).map_err(|e| e.to_string())?;
        Ok(TempDir(path))
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

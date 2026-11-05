//! The macOS roots: the anchors trustd would use for C#'s SecTrust
//! (trustsettings.rs): Apple's roots, the user and admin trust settings, and
//! the self-signed certs of the system root keychain of trustd's trust
//! store. Go reads the same. Verification stays rustls's own over this set.

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use rustls::pki_types::CertificateDer;
use rustls::pki_types::pem::PemObject;
use sha1::{Digest, Sha1};
use sha2::Sha256;

use crate::selfsigned::self_signed;
use crate::trustsettings::{
    APPLE_ROOTS, Value, denied_certs, parse_trust_list, read_plist_dict, trusted_anchors,
};

pub(crate) const SECURITY_TOOL: &str = "/usr/bin/security";
/// The fallback when any trust read fails.
pub(crate) const MACOS_BUNDLE: &str = "/etc/ssl/cert.pem";

/// The export flags for the user and admin domains. trustd reads no
/// system-domain trust settings: its system anchors are its own store.
const TRUST_DOMAINS: [&str; 2] = ["", "-d"];

/// The keychains that hold the certs the trust settings name. The system
/// roots come from `system_roots_keychain`.
const KEYCHAINS: [&str; 2] = [
    "~/Library/Keychains/login.keychain-db",
    "/Library/Keychains/System.keychain",
];

const SYSTEM_ROOTS: &str = "/System/Library/Keychains/SystemRootCertificates.keychain";
const PLUTIL_TOOL: &str = "/usr/bin/plutil";

/// trustd's trust store: the PKI asset named by AutoAsset.plist when its
/// VersionNumber is above the system bundle's (apple-oss-distributions/
/// Security db15acbe6a7f, trust/trustd/OTATrustUtilities.m:1101-1114,
/// kOTATrustStoreContentVersionKey at :194).
pub(crate) struct TrustStore {
    pub(crate) auto_asset: PathBuf,
    pub(crate) system_version: PathBuf,
}

impl TrustStore {
    pub(crate) fn system() -> TrustStore {
        TrustStore {
            auto_asset: PathBuf::from("/private/var/protected/trustd/AutoAsset.plist"),
            system_version: PathBuf::from(
                "/System/Library/Security/Certificates.bundle/Contents/Resources/AssetVersion.plist",
            ),
        }
    }

    /// The SystemRootCertificates keychain of the store trustd uses; it holds
    /// the certs of that store's certsTable.data. Any asset read that fails
    /// leaves the bundle, as trustd reads a missing version as 0.
    pub(crate) fn system_roots_keychain(&self, deadline: Instant) -> PathBuf {
        let asset = std::fs::read(&self.auto_asset)
            .ok()
            .and_then(|data| read_plist_dict(&data).ok())
            .and_then(|mut dict| match dict.remove("AssetPath") {
                Some(Value::Text(path)) if !path.is_empty() => Some(PathBuf::from(path)),
                _ => None,
            });
        if let Some(asset) = asset
            && plist_version(&asset.join("AssetVersion.plist"), deadline)
                > plist_version(&self.system_version, deadline)
        {
            return asset.join("SystemRootCertificates.keychain");
        }
        PathBuf::from(SYSTEM_ROOTS)
    }
}

/// A plist's VersionNumber, or 0. plutil reads the binary form the asset
/// ships.
fn plist_version(path: &Path, deadline: Instant) -> i64 {
    let Some(path) = path.to_str() else {
        return 0;
    };
    let Ok(out) = run(
        Path::new(PLUTIL_TOOL),
        &["-convert", "xml1", "-o", "-", path],
        deadline,
    ) else {
        return 0;
    };
    match read_plist_dict(&out).map(|mut dict| dict.remove("VersionNumber")) {
        Ok(Some(Value::Integer(version))) => version,
        _ => 0,
    }
}

/// One of Apple's own roots, which no trust setting overrides: trustd checks
/// them first, with no constraints.
fn apple_root(der: &[u8]) -> bool {
    let digest: [u8; 32] = Sha256::digest(der).into();
    APPLE_ROOTS.contains(&digest)
}

/// The anchors, or the bundle when any read fails: a set read in part would
/// drop a keychain's roots or a domain's denials.
pub(crate) fn load_roots(tool: &Path) -> (Vec<CertificateDer<'static>>, HashSet<String>) {
    match load_trust_settings_anchors(tool, &TrustStore::system()) {
        Ok((anchors, denied)) => (
            anchors.into_iter().map(CertificateDer::from).collect(),
            denied,
        ),
        Err(_) => (bundle(), HashSet::new()),
    }
}

/// Empty when nothing loads: every https fetch then fails closed.
pub(crate) fn bundle() -> Vec<CertificateDer<'static>> {
    match CertificateDer::pem_file_iter(MACOS_BUNDLE) {
        Ok(certs) => certs.filter_map(Result::ok).collect(),
        Err(_) => Vec::new(),
    }
}

pub(crate) fn load_trust_settings_anchors(
    tool: &Path,
    store: &TrustStore,
) -> Result<(Vec<Vec<u8>>, HashSet<String>), String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let home = std::env::var("HOME").unwrap_or_default();
    let system_keychain = store.system_roots_keychain(deadline);
    let system_keychain = system_keychain
        .to_str()
        .ok_or("a keychain path that is not UTF-8")?
        .to_string();
    let mut keychains: Vec<String> = KEYCHAINS
        .iter()
        .map(|keychain| keychain.replacen('~', &home, 1))
        .collect();
    keychains.push(system_keychain);
    let mut certs = HashMap::new();
    let mut system = HashSet::new();
    for (index, keychain) in keychains.iter().enumerate() {
        let out = run(tool, &["find-certificate", "-a", "-p", keychain], deadline)?;
        for cert in CertificateDer::pem_slice_iter(&out) {
            let der = cert.map_err(|e| e.to_string())?.to_vec();
            let hash = upper_hex(&Sha1::digest(&der));
            if index == keychains.len() - 1 {
                system.insert(hash.clone());
            }
            certs.insert(hash, der);
        }
    }
    // The tool exits 0 even for a keychain it cannot open.
    if system.is_empty() {
        return Err("no system root certificates".into());
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
    let [user, admin] = <[_; 2]>::try_from(domains).map_err(|_| "two domains")?;
    let anchors = trusted_anchors(&user, &admin, &system, &certs, self_signed, apple_root);
    Ok((anchors, denied_certs(&user, &admin, &certs, apple_root)))
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

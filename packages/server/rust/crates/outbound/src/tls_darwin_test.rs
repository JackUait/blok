use std::path::{Path, PathBuf};

use rustls::pki_types::CertificateDer;

use super::tls_darwin::{SECURITY_TOOL, bundle, load_roots, load_trust_settings_anchors};

fn sorted(mut certs: Vec<CertificateDer<'static>>) -> Vec<Vec<u8>> {
    let mut out: Vec<Vec<u8>> = certs.drain(..).map(|c| c.to_vec()).collect();
    out.sort();
    out.dedup();
    out
}

// The roots are read from the trust settings, so a root added only to the
// Keychain is trusted as in C# and Go.
#[test]
fn the_mac_os_roots_come_from_the_trust_settings() {
    let anchors = load_trust_settings_anchors(Path::new(SECURITY_TOOL)).unwrap();
    assert!(!anchors.is_empty(), "no roots");
}

/// /usr/bin/security, except that a call naming `fail` exits 1.
fn failing_tool(directory: &Path, fail: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = directory.join("security");
    let script = format!(
        "#!/bin/sh\ncase \"$*\" in *'{fail}'*) exit 1;; esac\nexec {SECURITY_TOOL} \"$@\"\n"
    );
    std::fs::write(&path, script).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

// A root set read in part would trust too little or too much: any failed
// read falls back to the macOS bundle.
#[test]
fn any_failed_trust_read_falls_back_to_the_bundle() {
    let want = sorted(bundle());
    assert!(!want.is_empty(), "no bundle");
    let cases = [
        "SystemRootCertificates.keychain",
        "System.keychain",
        "login.keychain",
        "domain0",
        "export -d ",
        "export -s ",
        "",
    ];
    for (index, fail) in cases.into_iter().enumerate() {
        let directory =
            std::env::temp_dir().join(format!("blok-failing-tool-{}-{index}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let got = sorted(load_roots(&failing_tool(&directory, fail)));
        let _ = std::fs::remove_dir_all(&directory);
        assert!(got == want, "{fail:?} failed: the roots are not the bundle");
    }
}

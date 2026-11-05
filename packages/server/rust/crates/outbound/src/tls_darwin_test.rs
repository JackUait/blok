use std::path::{Path, PathBuf};

use rustls::pki_types::CertificateDer;
use rustls::pki_types::pem::PemObject;

use super::selfsigned::self_signed;
use super::tls_darwin::{SECURITY_TOOL, TrustStore, load_roots, load_trust_settings_anchors};

// The roots are read from the trust settings, so a root added only to the
// Keychain is trusted as in C# and Go.
#[test]
fn the_mac_os_roots_come_from_the_trust_settings() {
    let (anchors, _) =
        load_trust_settings_anchors(Path::new(SECURITY_TOOL), &TrustStore::system()).unwrap();
    assert!(!anchors.is_empty(), "no roots");
}

/// /usr/bin/security, except that a call naming `fail` runs `action`.
fn failing_tool(directory: &Path, fail: &str, action: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    std::fs::create_dir_all(directory).unwrap();
    let path = directory.join("security");
    let script = format!(
        "#!/bin/sh\ncase \"$*\" in *'{fail}'*) {action};; esac\nexec {SECURITY_TOOL} \"$@\"\n"
    );
    std::fs::write(&path, script).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

// A root set read in part would trust too little or too much, and a bundle
// would pass a cert the user marked "Never Trust", which C#'s SecTrust
// refuses. So any failed read leaves no roots: the verifier is then trustd
// itself, with issuer fetching off (tls_darwin::PlatformVerifier). The tool
// exits 0 for a keychain it cannot read, so an empty system root keychain
// counts as failed too.
#[test]
fn any_failed_trust_read_leaves_the_platform_verifier() {
    let cases = [
        ("SystemRootCertificates.keychain", "exit 1"),
        ("System.keychain", "exit 1"),
        ("login.keychain", "exit 1"),
        ("domain0", "exit 1"),
        ("export -d ", "exit 1"),
        ("", "exit 1"),
        ("SystemRootCertificates.keychain", "exit 0"),
    ];
    for (index, (fail, action)) in cases.into_iter().enumerate() {
        let directory =
            std::env::temp_dir().join(format!("blok-failing-tool-{}-{index}", std::process::id()));
        let got = load_roots(&failing_tool(&directory, fail, action));
        let _ = std::fs::remove_dir_all(&directory);
        assert!(got.is_none(), "{fail:?} ({action}): some roots were kept");
    }
    assert!(load_roots(Path::new(SECURITY_TOOL)).is_some());
}

// The analogue of SslStreamStillLeaksAnIssuerFetchOnMacOs for the fallback:
// trustd with network fetch off never asks the caIssuers URL, which the
// guard never vetted. C#'s MacOsCertificateTrust sets the same flag.
#[tokio::test]
async fn the_platform_verifier_never_fetches_an_issuer() {
    let (origin, issuer, _) = crate::tls_test::aia_setup(false).await;
    let tcp = tokio::net::TcpStream::connect(("127.0.0.1", origin.port))
        .await
        .unwrap();
    let name = rustls::pki_types::ServerName::try_from("aia.example").unwrap();
    let got = crate::fetcher::tls_connector(crate::fetcher::Trust::platform())
        .connect(name, tcp)
        .await;
    assert!(got.is_err(), "an untrusted chain verified");
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    assert_eq!(issuer.count(), 0, "trustd fetched the issuer");
}

// _SecCertificateIsSelfSigned (SecCertificate.c:6192-6222): issuer equals
// subject, the authority key ID (when present) equals the subject key ID,
// and the cert's own key verifies it. The certs are Go's
// TestSelfSignedIsApplesRule cases, made once with crypto/x509.
#[test]
fn self_signed_is_apples_rule() {
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD;
    let cases = [
        (
            "self-signed",
            "MIIBKzCB0qADAgECAgEBMAoGCCqGSM49BAMCMA8xDTALBgNVBAMTBHJvb3QwHhcNMjYwMTAxMDAwMDAwWhcNNDYwMTAxMDAwMDAwWjAPMQ0wCwYDVQQDEwRyb290MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEflbCeBBZYbP56jLWL/gnlZau9DIcPbiZXqgsIGd7Jf0R5+isWZZHv40yJVDWFZ8sOP8sce4Gqk1PdTpTqJuv+KMfMB0wDwYDVR0TAQH/BAUwAwEB/zAKBgNVHQ4EAwQBATAKBggqhkjOPQQDAgNIADBFAiB8IBaF4SPUL3HmVt6ZpKH/byMaZuAG6BG4zDxFTpI55gIhAJu96maUynDfdd5HgCK2rkUjt+sqVdfmG+bbZ2Hh5Jsb",
            true,
        ),
        (
            "signed by another key",
            "MIIBKzCB0qADAgECAgEBMAoGCCqGSM49BAMCMA8xDTALBgNVBAMTBHJvb3QwHhcNMjYwMTAxMDAwMDAwWhcNNDYwMTAxMDAwMDAwWjAPMQ0wCwYDVQQDEwRyb290MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEflbCeBBZYbP56jLWL/gnlZau9DIcPbiZXqgsIGd7Jf0R5+isWZZHv40yJVDWFZ8sOP8sce4Gqk1PdTpTqJuv+KMfMB0wDwYDVR0TAQH/BAUwAwEB/zAKBgNVHQ4EAwQBATAKBggqhkjOPQQDAgNIADBFAiAEyyP5X3sUrUVEJnABh2kQIrwwWXybEmea84kVOfw02QIhAMKm0IIinDe8O+D780672o1hqkbYwRQstVXjXRBRrpmf",
            false,
        ),
        (
            "issued by another name",
            "MIIBGzCBw6ADAgECAgECMAoGCCqGSM49BAMCMA8xDTALBgNVBAMTBHJvb3QwHhcNMjYwMTAxMDAwMDAwWhcNNDYwMTAxMDAwMDAwWjAPMQ0wCwYDVQQDEwRsZWFmMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEflbCeBBZYbP56jLWL/gnlZau9DIcPbiZXqgsIGd7Jf0R5+isWZZHv40yJVDWFZ8sOP8sce4Gqk1PdTpTqJuv+KMQMA4wDAYDVR0jBAUwA4ABATAKBggqhkjOPQQDAgNHADBEAiA93W3GICVmFt2upZ6dvvast8P3Etjj7C7HOjWSANwE/QIgcYImUgyotZyWBlfQ90hriD+uEAaeHMKi7+5F6KeivlA=",
            false,
        ),
        (
            "another authority key ID",
            "MIIBKDCBz6ADAgECAgEDMAoGCCqGSM49BAMCMA8xDTALBgNVBAMTBHJvb3QwHhcNMjYwMTAxMDAwMDAwWhcNNDYwMTAxMDAwMDAwWjAPMQ0wCwYDVQQDEwRyb290MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEflbCeBBZYbP56jLWL/gnlZau9DIcPbiZXqgsIGd7Jf0R5+isWZZHv40yJVDWFZ8sOP8sce4Gqk1PdTpTqJuv+KMcMBowCgYDVR0OBAMEAQEwDAYDVR0jBAUwA4ABAjAKBggqhkjOPQQDAgNIADBFAiBYdBHng80XIAxSxSu8ipzzaQSfYjhOt7w9zkNuS4bH6AIhAOJzTQq9lhdixeXkvIr9ZrA4iQamPoWlDN0vQCG3DcUa",
            false,
        ),
    ];
    for (name, der, want) in cases {
        assert_eq!(self_signed(&STANDARD.decode(der).unwrap()), want, "{name}");
    }
    // Every system root but the Developer ID intermediate is self-signed,
    // as Go finds with crypto/x509 (here: Security.framework).
    let out = std::process::Command::new(SECURITY_TOOL)
        .args([
            "find-certificate",
            "-a",
            "-p",
            "/System/Library/Keychains/SystemRootCertificates.keychain",
        ])
        .output()
        .unwrap();
    let not_self_signed: Vec<Vec<u8>> = CertificateDer::pem_slice_iter(&out.stdout)
        .map(|cert| cert.unwrap().to_vec())
        .filter(|der| !self_signed(der))
        .collect();
    let intermediate = b"Developer ID Certification Authority";
    for der in &not_self_signed {
        assert!(
            der.windows(intermediate.len()).any(|w| w == intermediate),
            "a system root is not self-signed"
        );
    }
}

// trustd's system anchors are the PKI trust store asset when its
// VersionNumber is above the system bundle's, else the bundle
// (OTATrustUtilities.m:1101-1114).
#[test]
fn the_system_roots_come_from_the_newer_trust_store() {
    let system_keychain =
        PathBuf::from("/System/Library/Keychains/SystemRootCertificates.keychain");
    let directory = std::env::temp_dir().join(format!("blok-trust-store-{}", std::process::id()));
    let asset = directory.join("asset");
    std::fs::create_dir_all(&asset).unwrap();
    let write = |path: &Path, body: &str| {
        let plist = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>{body}</dict></plist>"#
        );
        std::fs::write(path, plist).unwrap();
    };
    let auto_asset = directory.join("AutoAsset.plist");
    write(
        &auto_asset,
        &format!("<key>AssetPath</key><string>{}</string>", asset.display()),
    );
    let system_version = directory.join("SystemAssetVersion.plist");
    write(
        &system_version,
        "<key>VersionNumber</key><integer>2025082000</integer>",
    );
    let store = TrustStore {
        auto_asset,
        system_version,
    };
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    for (version, want) in [
        (2026091601, asset.join("SystemRootCertificates.keychain")),
        (2025082000, system_keychain.clone()),
        (2024010100, system_keychain.clone()),
    ] {
        write(
            &asset.join("AssetVersion.plist"),
            &format!("<key>VersionNumber</key><integer>{version}</integer>"),
        );
        assert_eq!(
            store.system_roots_keychain(deadline),
            want,
            "asset {version}"
        );
    }
    let none = TrustStore {
        auto_asset: directory.join("none.plist"),
        system_version: store.system_version.clone(),
    };
    assert_eq!(
        none.system_roots_keychain(deadline),
        system_keychain,
        "no asset"
    );
    let _ = std::fs::remove_dir_all(&directory);
}

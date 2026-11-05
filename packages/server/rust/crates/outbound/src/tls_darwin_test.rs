use crate::fetcher::{Check, tls_connector};

// The analogue of SslStreamStillLeaksAnIssuerFetchOnMacOs: trustd with
// network fetch off never asks the caIssuers URL, which the guard never
// vetted. C#'s MacOsCertificateTrust sets the same flag.
#[tokio::test]
async fn the_fetcher_never_lets_trustd_fetch_an_issuer() {
    let (origin, issuer, _) = crate::tls_test::aia_setup(false).await;
    let tcp = tokio::net::TcpStream::connect(("127.0.0.1", origin.port))
        .await
        .unwrap();
    let name = rustls::pki_types::ServerName::try_from("aia.example").unwrap();
    let got = tls_connector(&None, Check::Guarded)
        .connect(name, tcp)
        .await;
    assert!(got.is_err(), "an untrusted chain verified");
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    assert_eq!(issuer.count(), 0, "trustd fetched the issuer");
}

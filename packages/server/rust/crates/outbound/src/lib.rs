//! The only way the server fetches a URL a caller chose. It ports C#'s
//! GuardedOutboundPolicy and GuardedOutboundFetcher: the URL rules, the
//! forbidden address ranges, a dial pinned to the vetted addresses, and the
//! redirect, size and encoding limits.

mod body;
mod bodytext;
mod browserurl;
mod decode;
mod digest;
mod fetcher;
mod lanes;
#[cfg(target_os = "macos")]
mod names;
mod ntlm;
pub mod operator;
mod policy;
mod proxy;
#[cfg(target_os = "macos")]
mod sectrust;
mod socks;
pub mod wire;

pub use browserurl::browser_url;
pub use fetcher::{Fetcher, Limits, Resolver, Response, Roots, USER_AGENT};
pub use policy::{
    DefaultPolicy, Error, ExactOriginPolicy, Failure, Policy, Target, has_control, is_failure,
};
pub use proxy::{EnvironmentProxy, ProxyUrl};

#[cfg(test)]
mod browserurl_test;
#[cfg(test)]
mod csharp_fetcher_test;
#[cfg(test)]
mod csharp_policy_test;
#[cfg(test)]
mod encodings_test;
#[cfg(test)]
mod fetcher_test;
#[cfg(test)]
mod fixtures_test;
#[cfg(all(test, target_os = "macos"))]
mod handshake_darwin_test;
#[cfg(test)]
mod law_test;
#[cfg(test)]
mod ntlm_test;
#[cfg(test)]
mod origin_test;
#[cfg(test)]
mod pki_test;
#[cfg(test)]
mod policy_test;
#[cfg(test)]
mod proxy_test;
#[cfg(test)]
mod socks_test;
#[cfg(test)]
mod test_json;
#[cfg(all(test, target_os = "macos"))]
mod tls_darwin_test;
#[cfg(test)]
mod tls_test;
#[cfg(all(test, target_os = "macos"))]
mod trust_chains_test;
#[cfg(test)]
mod tunnel_test;
#[cfg(test)]
mod wire_test;

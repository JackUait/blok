//! The only way the server fetches a URL a caller chose. It ports C#'s
//! GuardedOutboundPolicy and GuardedOutboundFetcher: the URL rules, the
//! forbidden address ranges, a dial pinned to the vetted addresses, and the
//! redirect, size and encoding limits.

mod body;
mod browserurl;
mod decode;
mod fetcher;
mod policy;
pub mod wire;

pub use browserurl::browser_url;
pub use fetcher::{Fetcher, Limits, Resolver, Response, USER_AGENT};
pub use policy::{
    DefaultPolicy, Error, ExactOriginPolicy, Failure, Policy, Target, has_control, is_failure,
};

#[cfg(test)]
mod browserurl_test;
#[cfg(test)]
mod csharp_policy_test;
#[cfg(test)]
mod encodings_test;
#[cfg(test)]
mod fetcher_test;
#[cfg(test)]
mod origin_test;
#[cfg(test)]
mod policy_test;
#[cfg(test)]
mod test_json;

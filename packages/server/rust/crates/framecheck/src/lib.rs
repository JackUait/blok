//! Whether a page would let an editor frame it, from the page's final
//! response headers. It follows CSP3 frame-ancestors and the HTML
//! X-Frame-Options processing model, with the editor as the only ancestor.
//! C#'s FrameCheckVerdict is the twin; the shared fixture
//! frame-check-verdicts.json pins both.

mod embedder;
mod oembed;
mod verdict;

pub use embedder::{Request, embedder};
pub use oembed::{OEmbed, parse_oembed};
pub use verdict::{ALLOWED, BLOCKED, Header, INSECURE, UNKNOWN, verdict};

#[cfg(test)]
mod embedder_test;
#[cfg(test)]
mod oembed_test;
#[cfg(test)]
mod test_json;
#[cfg(test)]
mod verdict_test;

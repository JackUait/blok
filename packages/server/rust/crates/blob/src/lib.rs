//! Stores uploaded files: in a local directory or in S3. Keys are 32 random
//! lowercase hex digits plus a normalized extension, as in C#'s BlobKey.

mod blob;
mod local;

pub use blob::{
    Body, Error, Seekable, Store, extension, is_generated, key_from_public_url, new_key,
    normalize_extension,
};
pub use local::Local;

#[cfg(test)]
mod csharp_local_test;
#[cfg(test)]
mod local_test;

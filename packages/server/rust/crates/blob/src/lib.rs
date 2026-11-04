//! Stores uploaded files: in a local directory or in S3. Keys are 32 random
//! lowercase hex digits plus a normalized extension, as in C#'s BlobKey.

mod blob;
mod local;
mod s3;

pub use blob::{
    Body, Error, Seekable, Store, extension, is_generated, key_from_public_url, new_key,
    normalize_extension,
};
pub use local::Local;
pub use s3::{S3, S3Options};

#[cfg(test)]
mod csharp_local_test;
#[cfg(test)]
mod csharp_s3_test;
#[cfg(test)]
mod local_test;
#[cfg(test)]
mod s3_proxy_test;
#[cfg(test)]
mod s3_test;
#[cfg(test)]
mod s3_wire_test;
#[cfg(test)]
mod test_json;

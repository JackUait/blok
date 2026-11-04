mod client;

pub use client::{
    Client, DEFAULT_MAX_RESPONSE_BYTES, Error, JSON_MAX_DEPTH, LINEAGE_HEADER, Loaded, Options,
    Projection, SEQUENCE_HEADER, VERSION_HEADER, serialize,
};

#[cfg(test)]
mod client_test;
#[cfg(test)]
mod connect_timeout_test;
#[cfg(test)]
mod csharp_client_test;

use super::*;

struct Tally {
    data: Vec<u8>,
    read: usize,
}

impl Source for Tally {
    fn read<'a>(&'a mut self, buf: &'a mut [u8]) -> BoxFuture<'a, Result<usize, BodyError>> {
        Box::pin(async move {
            let n = buf.len().min(self.data.len() - self.read);
            buf[..n].copy_from_slice(&self.data[self.read..self.read + n]);
            self.read += n;
            Ok(n)
        })
    }
}

// The C# routes read at most 8 KiB + 1 into a fixed buffer
// (DeleteEndpoint.cs:36, UploadByUrlEndpoint.cs:38), so an oversized body
// is refused without being read whole. Both routes read it through
// read_envelope.
#[tokio::test]
async fn envelope_read_stops_after_the_bound() {
    let mut body = Tally {
        data: format!("{{\"url\":\"{}\"}}", "a".repeat(1 << 20)).into_bytes(),
        read: 0,
    };
    assert_eq!(read_envelope(&mut body).await, None);
    assert!(
        body.read <= MAX_ENVELOPE_BYTES + 1,
        "read {} bytes, want at most {}",
        body.read,
        MAX_ENVELOPE_BYTES + 1
    );
}

#[tokio::test]
async fn envelope_reads_the_last_url_in_any_case() {
    let mut body = Tally {
        data: br#"{"url":"a","URL":"b","Url":null} "#.to_vec(),
        read: 0,
    };
    assert_eq!(read_envelope(&mut body).await.as_deref(), Some("b"));
}

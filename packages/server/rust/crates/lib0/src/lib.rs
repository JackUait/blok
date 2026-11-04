//! The lib0 binary codec yjs speaks, ported from Go `internal/lib0` (and C#
//! Blok.Server/Yjs Lib0Reader.cs, Lib0Writer.cs, AnyCodec.cs).
//!
//! An Any value is a [`blok_jsjson::Value`]; `BigInt` and `Bytes` are the two
//! kinds JSON has no form for.

mod any;

use std::fmt;

use blok_jsjson::Str;

pub use any::{MAX_ANY_DEPTH, read_any, write_any};

/// A malformed or truncated input (Lib0FormatException), with its reason.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatError {
    pub reason: String,
}

impl FormatError {
    /// Go's `lib0.Errorf`.
    pub fn new(reason: impl Into<String>) -> FormatError {
        FormatError {
            reason: reason.into(),
        }
    }
}

impl fmt::Display for FormatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.reason)
    }
}

impl std::error::Error for FormatError {}

pub type Result<T> = std::result::Result<T, FormatError>;

/// 2^53-1, the largest varuint/varint lib0 reads.
pub const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

// 2^53-1 needs 8 varuint bytes (8*7 = 56 bits) and 8 varint bytes
// (6 + 7*7 = 55). A ninth byte can only carry an out-of-range value or zero
// padding, which no lib0 encoder writes.
const MAX_VAR_UINT_BYTES: usize = 8;
const MAX_VAR_INT_BYTES: usize = 8;

/// Reads lib0 values from a byte slice.
#[derive(Debug, Clone)]
pub struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    /// Reads `data` from the start.
    pub fn new(data: &'a [u8]) -> Reader<'a> {
        Reader { data, pos: 0 }
    }

    /// The read position.
    pub fn pos(&self) -> usize {
        self.pos
    }

    /// The whole buffer's length.
    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    /// Every byte was read.
    pub fn at_end(&self) -> bool {
        self.pos >= self.data.len()
    }

    fn take(&mut self, count: usize) -> Result<&'a [u8]> {
        let remain = self.data.len() - self.pos;
        if count > remain {
            return Err(FormatError::new(format!(
                "lib0: {count} bytes were read at {}, {remain} remain.",
                self.pos
            )));
        }
        let slice = &self.data[self.pos..self.pos + count];
        self.pos += count;
        Ok(slice)
    }

    pub fn read_uint8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }

    /// LEB128, refusing anything above 2^53-1.
    pub fn read_var_uint(&mut self) -> Result<u64> {
        let mut value: u64 = 0;
        let mut shift = 0;
        for _ in 0..MAX_VAR_UINT_BYTES {
            let current = self.read_uint8()?;
            value |= u64::from(current & 0x7f) << shift;
            if current & 0x80 == 0 {
                if value > MAX_SAFE_INTEGER {
                    break;
                }
                return Ok(value);
            }
            shift += 7;
        }
        Err(FormatError::new(format!(
            "lib0: the varuint at {} is above 2^53-1.",
            self.pos
        )))
    }

    /// lib0's signed varint: the sign in bit 0x40 of the first byte. An f64,
    /// so -0 survives.
    pub fn read_var_int(&mut self) -> Result<f64> {
        let too_big =
            |pos: usize| FormatError::new(format!("lib0: the varint at {pos} is above 2^53-1."));
        let first = self.read_uint8()?;
        let mut value = u64::from(first & 0x3f);
        let negative = first & 0x40 != 0;
        let mut shift = 6;
        if first & 0x80 != 0 {
            let mut read = 1;
            loop {
                if read >= MAX_VAR_INT_BYTES {
                    return Err(too_big(self.pos));
                }
                let current = self.read_uint8()?;
                value |= u64::from(current & 0x7f) << shift;
                shift += 7;
                read += 1;
                if current & 0x80 == 0 {
                    break;
                }
            }
        }
        if value > MAX_SAFE_INTEGER {
            return Err(too_big(self.pos));
        }
        Ok(if negative {
            -(value as f64)
        } else {
            value as f64
        })
    }

    /// Length-prefixed strict UTF-8.
    pub fn read_var_string(&mut self) -> Result<Str> {
        let bytes = self.read_var_bytes()?;
        match std::str::from_utf8(bytes) {
            Ok(text) => Ok(Str::from(text)),
            Err(_) => Err(FormatError::new(format!(
                "lib0: the varstring ending at {} is not UTF-8.",
                self.pos
            ))),
        }
    }

    /// Length-prefixed bytes, borrowed from the buffer.
    pub fn read_var_bytes(&mut self) -> Result<&'a [u8]> {
        let length = self.read_var_uint()?;
        let remain = self.data.len() - self.pos;
        if length > remain as u64 {
            return Err(FormatError::new(format!(
                "lib0: {length} bytes were announced at {}, {remain} remain.",
                self.pos
            )));
        }
        self.take(length as usize)
    }

    /// A big-endian IEEE single.
    pub fn read_float32(&mut self) -> Result<f32> {
        let b = self.take(4)?;
        Ok(f32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }

    /// A big-endian IEEE double.
    pub fn read_float64(&mut self) -> Result<f64> {
        let b = self.take(8)?;
        Ok(f64::from_be_bytes(b.try_into().expect("8 bytes")))
    }

    /// A big-endian int64.
    pub fn read_big_int64(&mut self) -> Result<i64> {
        let b = self.take(8)?;
        Ok(i64::from_be_bytes(b.try_into().expect("8 bytes")))
    }
}

/// Collects lib0 bytes.
#[derive(Debug, Clone, Default)]
pub struct Writer {
    buf: Vec<u8>,
}

impl Writer {
    pub fn new() -> Writer {
        Writer::default()
    }

    /// What was written so far.
    pub fn bytes(&self) -> &[u8] {
        &self.buf
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.buf
    }

    /// The number of bytes written.
    pub fn len(&self) -> usize {
        self.buf.len()
    }

    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }

    pub fn write_uint8(&mut self, b: u8) {
        self.buf.push(b);
    }

    /// LEB128, low 7 bits first.
    pub fn write_var_uint(&mut self, mut value: u64) {
        while value > 0x7f {
            self.buf.push(0x80 | (value & 0x7f) as u8);
            value >>= 7;
        }
        self.buf.push(value as u8);
    }

    /// lib0's signed varint. Panics on a non-integer or a magnitude above
    /// 2^53-1 (ArgumentOutOfRangeException in C#). -0 writes 0x40.
    pub fn write_var_int(&mut self, integral: f64) {
        if integral != integral.trunc()
            || integral.is_infinite()
            || integral.abs() > MAX_SAFE_INTEGER as f64
        {
            panic!("lib0: a varint is an integer no larger than 2^53-1, not {integral}.");
        }
        let negative = integral.is_sign_negative();
        let mut magnitude = integral.abs() as u64;
        let mut first = (magnitude & 0x3f) as u8;
        if magnitude > 0x3f {
            first |= 0x80;
        }
        if negative {
            first |= 0x40;
        }
        self.buf.push(first);
        magnitude >>= 6;
        while magnitude > 0 {
            let mut next = (magnitude & 0x7f) as u8;
            if magnitude > 0x7f {
                next |= 0x80;
            }
            self.buf.push(next);
            magnitude >>= 7;
        }
    }

    /// Length-prefixed UTF-8. A lone surrogate becomes U+FFFD, as
    /// TextEncoder writes it.
    pub fn write_var_string(&mut self, value: &[u16]) {
        let text = blok_jsjson::to_string_lossy(value);
        self.write_var_uint(text.len() as u64);
        self.buf.extend_from_slice(text.as_bytes());
    }

    /// Length-prefixed bytes.
    pub fn write_var_bytes(&mut self, value: &[u8]) {
        self.write_var_uint(value.len() as u64);
        self.buf.extend_from_slice(value);
    }

    /// A big-endian IEEE single.
    pub fn write_float32(&mut self, value: f32) {
        self.buf.extend_from_slice(&value.to_be_bytes());
    }

    /// A big-endian IEEE double.
    pub fn write_float64(&mut self, value: f64) {
        self.buf.extend_from_slice(&value.to_be_bytes());
    }

    /// A big-endian int64.
    pub fn write_big_int64(&mut self, value: i64) {
        self.buf.extend_from_slice(&value.to_be_bytes());
    }
}

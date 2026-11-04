use brotli::{BrotliDecompressStream, BrotliResult, BrotliState, HeapAlloc};
use flate2::{Crc, Decompress, FlushDecompress, Status};

// .NET decodes without strict validation (the UseStrictValidation switch is
// off): a body cut short ends quietly with what was decoded so far. A bad
// header or checksum still fails. outbound-encodings.json pins the cases.

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum DecodeError {
    /// The body is not valid in its encoding.
    Bad,
    /// The decoded body passed the cap.
    TooLarge,
}

/// Where decoded bytes go: at most `max`, then either an error or, when
/// `truncate`, a quiet stop.
pub(crate) struct Output {
    pub bytes: Vec<u8>,
    max: usize,
    truncate: bool,
}

impl Output {
    pub fn new(max: usize, truncate: bool) -> Output {
        Output {
            bytes: Vec::new(),
            max,
            truncate,
        }
    }

    /// Whether more output is wanted.
    pub fn open(&self) -> bool {
        !(self.truncate && self.bytes.len() >= self.max)
    }

    fn push(&mut self, data: &[u8]) -> Result<(), DecodeError> {
        let room = self.max - self.bytes.len().min(self.max);
        if data.len() > room {
            if !self.truncate {
                return Err(DecodeError::TooLarge);
            }
            self.bytes.extend_from_slice(&data[..room]);
            return Ok(());
        }
        self.bytes.extend_from_slice(data);
        Ok(())
    }
}

/// The decoder for one Content-Encoding, already lower case.
pub(crate) fn decoder(encoding: &str) -> Option<Decoder> {
    match encoding {
        "gzip" => Some(Decoder::Gzip(Gzip::default())),
        "deflate" => Some(Decoder::Zlib(Zlib::default())),
        "br" => Some(Decoder::Brotli(Box::new(Brotli::new()))),
        _ => None,
    }
}

pub(crate) enum Decoder {
    Gzip(Gzip),
    Zlib(Zlib),
    Brotli(Box<Brotli>),
}

impl Decoder {
    /// Decodes `input`, the next raw bytes. Bytes past the end of the
    /// stream are ignored.
    pub fn feed(&mut self, input: &[u8], out: &mut Output) -> Result<(), DecodeError> {
        match self {
            Decoder::Gzip(g) => g.feed(input, out),
            Decoder::Zlib(z) => z.feed(input, out),
            Decoder::Brotli(b) => b.feed(input, out),
        }
    }

    /// The raw body ended. A cut-short stream ends quietly, so only a gzip
    /// member's header wait can still fail here.
    pub fn finish(&mut self, out: &mut Output) -> Result<(), DecodeError> {
        match self {
            Decoder::Gzip(g) => g.finish(out),
            Decoder::Zlib(_) | Decoder::Brotli(_) => Ok(()),
        }
    }
}

const SCRATCH: usize = 32 << 10;

/// Inflates `input` into `out`; true when the deflate stream ended, with
/// `used` raw bytes taken.
fn inflate(
    inflater: &mut Decompress,
    mut input: &[u8],
    out: &mut Output,
    mut seen: impl FnMut(&[u8]),
) -> Result<(bool, usize), DecodeError> {
    let mut scratch = vec![0u8; SCRATCH];
    let mut used = 0;
    loop {
        if !out.open() {
            return Ok((false, used));
        }
        let (before_in, before_out) = (inflater.total_in(), inflater.total_out());
        let status = inflater
            .decompress(input, &mut scratch, FlushDecompress::None)
            .map_err(|_| DecodeError::Bad)?;
        let taken = (inflater.total_in() - before_in) as usize;
        let made = (inflater.total_out() - before_out) as usize;
        input = &input[taken..];
        used += taken;
        seen(&scratch[..made]);
        out.push(&scratch[..made])?;
        match status {
            Status::StreamEnd => return Ok((true, used)),
            _ if taken == 0 && made == 0 => return Ok((false, used)),
            _ => {}
        }
    }
}

#[derive(Default)]
enum GzipPhase {
    #[default]
    Header,
    Body,
    Trailer,
    /// Between members: another starts only on 1f 8b.
    Magic,
    Done,
}

/// GZipStream. After a member, .NET's Inflater starts another only if the
/// leftover bytes begin 1f 8b (ResetStreamForLeftoverInput), so zero
/// padding or other trailing bytes end the body and are ignored.
#[derive(Default)]
pub(crate) struct Gzip {
    phase: GzipPhase,
    pending: Vec<u8>,
    inflater: Option<Decompress>,
    crc: Crc,
}

impl Gzip {
    fn feed(&mut self, input: &[u8], out: &mut Output) -> Result<(), DecodeError> {
        self.pending.extend_from_slice(input);
        loop {
            match self.phase {
                GzipPhase::Done => {
                    self.pending.clear();
                    return Ok(());
                }
                GzipPhase::Magic => {
                    if self.pending.len() < 2 {
                        return Ok(());
                    }
                    if self.pending[..2] != [0x1f, 0x8b] {
                        self.phase = GzipPhase::Done;
                        continue;
                    }
                    self.phase = GzipPhase::Header;
                }
                GzipPhase::Header => {
                    check_gzip_header(&self.pending)?;
                    let Some(length) = gzip_header_length(&self.pending)? else {
                        return Ok(());
                    };
                    self.pending.drain(..length);
                    self.inflater = Some(Decompress::new(false));
                    self.crc = Crc::new();
                    self.phase = GzipPhase::Body;
                }
                GzipPhase::Body => {
                    let inflater = self.inflater.as_mut().expect("a member");
                    let crc = &mut self.crc;
                    let (ended, used) = inflate(inflater, &self.pending, out, |b| crc.update(b))?;
                    self.pending.drain(..used);
                    if !ended {
                        if !out.open() {
                            self.phase = GzipPhase::Done;
                            continue;
                        }
                        return Ok(());
                    }
                    self.phase = GzipPhase::Trailer;
                }
                GzipPhase::Trailer => {
                    if self.pending.len() < 8 {
                        return Ok(());
                    }
                    let crc = u32::from_le_bytes(self.pending[..4].try_into().unwrap());
                    let size = u32::from_le_bytes(self.pending[4..8].try_into().unwrap());
                    if crc != self.crc.sum() || size != self.crc.amount() {
                        return Err(DecodeError::Bad);
                    }
                    self.pending.drain(..8);
                    self.phase = GzipPhase::Magic;
                }
            }
        }
    }

    fn finish(&mut self, out: &mut Output) -> Result<(), DecodeError> {
        // A lone trailing byte cannot start a member.
        if matches!(self.phase, GzipPhase::Magic) {
            self.phase = GzipPhase::Done;
        }
        self.feed(&[], out)
    }
}

/// Fails on the header bytes zlib's inflate rejects as soon as it sees
/// them; a short header that is good so far is a quiet end.
fn check_gzip_header(b: &[u8]) -> Result<(), DecodeError> {
    if !b.is_empty() && b[0] != 0x1f
        || b.len() > 1 && b[1] != 0x8b
        || b.len() > 2 && b[2] != 8
        || b.len() > 3 && b[3] & 0xe0 != 0
    {
        return Err(DecodeError::Bad);
    }
    Ok(())
}

/// The whole header's length once it has all arrived. FHCRC is checked.
fn gzip_header_length(b: &[u8]) -> Result<Option<usize>, DecodeError> {
    if b.len() < 10 {
        return Ok(None);
    }
    let flags = b[3];
    let mut at = 10;
    if flags & 0x04 != 0 {
        if b.len() < at + 2 {
            return Ok(None);
        }
        at += 2 + usize::from(u16::from_le_bytes([b[at], b[at + 1]]));
    }
    for flag in [0x08, 0x10] {
        if flags & flag != 0 {
            match b
                .get(at..)
                .and_then(|rest| rest.iter().position(|&c| c == 0))
            {
                Some(end) => at += end + 1,
                None => return Ok(None),
            }
        }
    }
    if flags & 0x02 != 0 {
        if b.len() < at + 2 {
            return Ok(None);
        }
        let mut crc = Crc::new();
        crc.update(&b[..at]);
        if u16::from_le_bytes([b[at], b[at + 1]]) != crc.sum() as u16 {
            return Err(DecodeError::Bad);
        }
        at += 2;
    }
    if b.len() < at {
        return Ok(None);
    }
    Ok(Some(at))
}

#[derive(Default)]
enum ZlibPhase {
    #[default]
    Header,
    Body,
    Trailer,
    Done,
}

/// ZLibStream: an empty body is an empty result.
#[derive(Default)]
pub(crate) struct Zlib {
    phase: ZlibPhase,
    pending: Vec<u8>,
    inflater: Option<Decompress>,
    adler: Adler32,
}

impl Zlib {
    fn feed(&mut self, input: &[u8], out: &mut Output) -> Result<(), DecodeError> {
        self.pending.extend_from_slice(input);
        loop {
            match self.phase {
                ZlibPhase::Done => {
                    self.pending.clear();
                    return Ok(());
                }
                ZlibPhase::Header => {
                    if self.pending.len() < 2 {
                        return Ok(());
                    }
                    let (cmf, flg) = (self.pending[0], self.pending[1]);
                    // A preset dictionary is refused, as Go's zlib refuses it.
                    if (u16::from(cmf) << 8 | u16::from(flg)) % 31 != 0
                        || cmf & 0x0f != 8
                        || flg & 0x20 != 0
                    {
                        return Err(DecodeError::Bad);
                    }
                    self.pending.drain(..2);
                    self.inflater = Some(Decompress::new(false));
                    self.phase = ZlibPhase::Body;
                }
                ZlibPhase::Body => {
                    let inflater = self.inflater.as_mut().expect("a stream");
                    let adler = &mut self.adler;
                    let (ended, used) = inflate(inflater, &self.pending, out, |b| adler.update(b))?;
                    self.pending.drain(..used);
                    if !ended {
                        if !out.open() {
                            self.phase = ZlibPhase::Done;
                            continue;
                        }
                        return Ok(());
                    }
                    self.phase = ZlibPhase::Trailer;
                }
                ZlibPhase::Trailer => {
                    if self.pending.len() < 4 {
                        return Ok(());
                    }
                    let sum = u32::from_be_bytes(self.pending[..4].try_into().unwrap());
                    if sum != self.adler.sum() {
                        return Err(DecodeError::Bad);
                    }
                    self.phase = ZlibPhase::Done;
                }
            }
        }
    }
}

struct Adler32 {
    a: u32,
    b: u32,
}

impl Default for Adler32 {
    fn default() -> Self {
        Adler32 { a: 1, b: 0 }
    }
}

impl Adler32 {
    fn update(&mut self, data: &[u8]) {
        for chunk in data.chunks(5552) {
            for &byte in chunk {
                self.a += u32::from(byte);
                self.b += self.a;
            }
            self.a %= 65521;
            self.b %= 65521;
        }
    }

    fn sum(&self) -> u32 {
        self.b << 16 | self.a
    }
}

/// BrotliStream, which ignores bytes after the stream ends.
pub(crate) struct Brotli {
    state: BrotliState<HeapAlloc<u8>, HeapAlloc<u32>, HeapAlloc<brotli::HuffmanCode>>,
    done: bool,
}

impl Brotli {
    fn new() -> Brotli {
        Brotli {
            state: BrotliState::new(
                HeapAlloc::default(),
                HeapAlloc::default(),
                HeapAlloc::default(),
            ),
            done: false,
        }
    }

    fn feed(&mut self, input: &[u8], out: &mut Output) -> Result<(), DecodeError> {
        let mut scratch = vec![0u8; SCRATCH];
        let (mut available_in, mut input_offset) = (input.len(), 0);
        while !self.done && out.open() {
            let (mut available_out, mut output_offset, mut total) = (SCRATCH, 0, 0);
            let result = BrotliDecompressStream(
                &mut available_in,
                &mut input_offset,
                input,
                &mut available_out,
                &mut output_offset,
                &mut scratch,
                &mut total,
                &mut self.state,
            );
            out.push(&scratch[..output_offset])?;
            match result {
                BrotliResult::ResultSuccess => self.done = true,
                BrotliResult::NeedsMoreOutput => {}
                BrotliResult::NeedsMoreInput => return Ok(()),
                BrotliResult::ResultFailure => return Err(DecodeError::Bad),
            }
        }
        Ok(())
    }
}

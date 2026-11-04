//! CollabStandardErrorLoggerProvider: only the room category, Warning and
//! above, one "warning: ..." or "error: ..." line each. Every other category
//! stays silent, as the C# host clears its providers.

use std::io::Write;
use std::sync::{Arc, Mutex};

use blok_blokserver::{COLLAB_LOG_CATEGORY, Level, Logger};

/// Where the host writes its lines; shared with the room logger.
pub type Stderr = Arc<Mutex<dyn Write + Send>>;

pub struct CollabStderr {
    pub out: Stderr,
}

impl Logger for CollabStderr {
    fn log(&self, level: Level, category: &str, message: &str) {
        if category != COLLAB_LOG_CATEGORY || level < Level::Warn {
            return;
        }
        let kind = if level >= Level::Error {
            "error"
        } else {
            "warning"
        };
        let _ = write_log_line(&self.out, kind, message);
    }
}

/// Writes "<kind>: <message>\n" with the message on one line. Messages
/// carry doc ids from the URL, so a raw newline could forge a record. \n, \r
/// and \t become those two-character escapes; every other C0 control, DEL,
/// C1 control (U+0080-U+009F), U+2028 and U+2029 becomes \uXXXX in upper
/// hex. Backslashes stay as they are. HostCollab.cs follows the same rule
/// (fixture host-log-lines.json).
pub fn write_log_line(out: &Stderr, kind: &str, message: &str) -> std::io::Result<()> {
    let mut line = format!("{kind}: ");
    for c in message.chars() {
        match c {
            '\n' => line.push_str("\\n"),
            '\r' => line.push_str("\\r"),
            '\t' => line.push_str("\\t"),
            c if (c as u32) < 0x20
                || (0x7f..=0x9f).contains(&(c as u32))
                || c == '\u{2028}'
                || c == '\u{2029}' =>
            {
                line.push_str(&format!("\\u{:04X}", c as u32));
            }
            c => line.push(c),
        }
    }
    line.push('\n');
    let mut out = out
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    out.write_all(line.as_bytes())?;
    out.flush()
}

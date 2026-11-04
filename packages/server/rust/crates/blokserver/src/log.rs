//! The server's log seam: slog in the Go build, ILogger in C#.

/// The category every room warning carries, as C#'s ILogger category. A
/// host filters on it.
pub const COLLAB_LOG_CATEGORY: &str = "Blok.Server.Collab";

/// The host category, for warnings the standalone host never prints.
pub const HOST_LOG_CATEGORY: &str = "Blok.Server.AspNetCore";

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Info,
    Warn,
    Error,
}

/// Receives the server's log records. category is "" when a record has none.
pub trait Logger: Send + Sync {
    fn log(&self, level: Level, category: &str, message: &str);
}

//! Opens files the way .NET's FileStream does on Unix: after the open it
//! takes flock(2), exclusive for FileShare.None and shared for any other
//! share, never waiting. Go probed this on macOS with .NET 10: a C# store
//! and a Go store on one directory refuse each other's live hold because
//! both use flock. std's try_lock is flock on Unix; the cross-process and
//! in-process store tests pin that. lock_windows.rs is the Windows build of
//! this module and must keep the same functions.

use std::fs::{self, DirBuilder, File, OpenOptions, TryLockError};
use std::io::{self, Read};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::Path;

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Flags {
    pub write: bool,
    pub read: bool,
    pub create: bool,
    pub truncate: bool,
    pub append: bool,
}

pub(crate) const READ_ONLY: Flags = Flags {
    read: true,
    write: false,
    create: false,
    truncate: false,
    append: false,
};

/// A refused lock: another holder has it.
pub(crate) fn would_block(path: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::WouldBlock,
        format!("flock {}: resource temporarily unavailable", path.display()),
    )
}

pub(crate) fn open_file(path: &Path, flags: Flags, exclusive: bool) -> io::Result<File> {
    // .NET truncates only once the lock is held, so a refused open never
    // empties a file somebody else holds: no O_TRUNC here.
    let file = OpenOptions::new()
        .read(flags.read)
        .write(flags.write || flags.append)
        .append(flags.append)
        .create(flags.create)
        .mode(0o600)
        .open(path)?;
    let locked = if exclusive {
        file.try_lock()
    } else {
        file.try_lock_shared()
    };
    match locked {
        Ok(()) => {}
        Err(TryLockError::WouldBlock) => return Err(would_block(path)),
        Err(TryLockError::Error(err)) => return Err(err),
    }
    if flags.truncate {
        file.set_len(0)?;
    }
    Ok(file)
}

/// The lock was refused because another holder has it.
pub(crate) fn is_held_elsewhere(err: &io::Error) -> bool {
    err.kind() == io::ErrorKind::WouldBlock
}

/// Makes new directory entries durable. Its failure is returned, because it
/// runs where a completion means durable.
pub(crate) fn sync_directory(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}

/// File.Delete: a missing file is fine, a directory is an error.
pub(crate) fn remove_file(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

/// File.ReadAllBytes: the whole file, under a shared lock.
pub(crate) fn read_shared(path: &Path) -> io::Result<Vec<u8>> {
    let mut file = open_file(path, READ_ONLY, false)?;
    let mut data = Vec::new();
    file.read_to_end(&mut data)?;
    Ok(data)
}

/// Reads and writes at an offset without moving the cursor.
pub(crate) trait FileAt {
    fn write_all_at(&self, buf: &[u8], offset: u64) -> io::Result<()>;
    fn read_exact_at(&self, buf: &mut [u8], offset: u64) -> io::Result<()>;
}

impl FileAt for File {
    fn write_all_at(&self, buf: &[u8], offset: u64) -> io::Result<()> {
        std::os::unix::fs::FileExt::write_all_at(self, buf, offset)
    }

    fn read_exact_at(&self, buf: &mut [u8], offset: u64) -> io::Result<()> {
        std::os::unix::fs::FileExt::read_exact_at(self, buf, offset)
    }
}

/// A directory only its owner may enter.
pub(crate) fn private_dir_builder() -> DirBuilder {
    let mut builder = DirBuilder::new();
    builder.mode(0o700);
    builder
}

//! The Windows build of lock.rs, Go's lock_windows.go: the hold is the share
//! mode of the open itself, as .NET's FileStream takes it. It must keep the
//! same functions as lock.rs.

use std::fs::{self, DirBuilder, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom};
use std::os::windows::fs::{FileExt, OpenOptionsExt};
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

/// FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE.
const SHARE_ALL: u32 = 0x1 | 0x2 | 0x4;

/// No share for FileShare.None; read, write and delete otherwise. An append
/// opens for plain writing and seeks to the end, as Go does, rather than
/// taking FILE_APPEND_DATA.
pub(crate) fn open_file(path: &Path, flags: Flags, exclusive: bool) -> io::Result<File> {
    let mut file = OpenOptions::new()
        .read(flags.read)
        .write(flags.write || flags.append)
        .create(flags.create)
        .share_mode(if exclusive { 0 } else { SHARE_ALL })
        .open(path)?;
    if flags.truncate {
        file.set_len(0)?;
    }
    if flags.append {
        file.seek(SeekFrom::End(0))?;
    }
    Ok(file)
}

/// ERROR_SHARING_VIOLATION (32) or ERROR_LOCK_VIOLATION (33).
pub(crate) fn is_held_elsewhere(err: &io::Error) -> bool {
    matches!(err.raw_os_error(), Some(32 | 33))
}

/// Windows has no directory sync, as in C#.
pub(crate) fn sync_directory(_path: &Path) -> io::Result<()> {
    Ok(())
}

/// File.Delete: a missing file is fine, a directory is ERROR_ACCESS_DENIED.
pub(crate) fn remove_file(path: &Path) -> io::Result<()> {
    if fs::symlink_metadata(path).is_ok_and(|info| info.is_dir()) {
        return Err(io::Error::from_raw_os_error(5));
    }
    match fs::remove_file(path) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

/// File.ReadAllBytes: the whole file, opened shared.
pub(crate) fn read_shared(path: &Path) -> io::Result<Vec<u8>> {
    let mut file = open_file(path, READ_ONLY, false)?;
    let mut data = Vec::new();
    file.read_to_end(&mut data)?;
    Ok(data)
}

/// Reads and writes at an offset. seek_read and seek_write move the
/// cursor, which no caller relies on: each passes its own offset.
pub(crate) trait FileAt {
    fn write_all_at(&self, buf: &[u8], offset: u64) -> io::Result<()>;
    fn read_exact_at(&self, buf: &mut [u8], offset: u64) -> io::Result<()>;
}

impl FileAt for File {
    fn write_all_at(&self, mut buf: &[u8], mut offset: u64) -> io::Result<()> {
        while !buf.is_empty() {
            match self.seek_write(buf, offset) {
                Ok(0) => return Err(io::ErrorKind::WriteZero.into()),
                Ok(n) => {
                    buf = &buf[n..];
                    offset += n as u64;
                }
                Err(err) if err.kind() == io::ErrorKind::Interrupted => {}
                Err(err) => return Err(err),
            }
        }
        Ok(())
    }

    fn read_exact_at(&self, mut buf: &mut [u8], mut offset: u64) -> io::Result<()> {
        while !buf.is_empty() {
            match self.seek_read(buf, offset) {
                Ok(0) => return Err(io::ErrorKind::UnexpectedEof.into()),
                Ok(n) => {
                    buf = &mut buf[n..];
                    offset += n as u64;
                }
                Err(err) if err.kind() == io::ErrorKind::Interrupted => {}
                Err(err) => return Err(err),
            }
        }
        Ok(())
    }
}

/// Windows has no mode bits: Go's MkdirAll ignores the 0700 there too.
pub(crate) fn private_dir_builder() -> DirBuilder {
    DirBuilder::new()
}

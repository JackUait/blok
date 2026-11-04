use std::io;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};

use crate::blob::{
    Body, BoxFuture, Cancelled, Error, Store, key_from_public_url, new_key, random_hex,
};

/// LocalBlobStore: files in one directory, served under `public_url`.
pub struct Local {
    pub directory: PathBuf,
    pub public_url: String,
    /// std::fs::hard_link; a seam for tests.
    pub(crate) link: fn(&Path, &Path) -> io::Result<()>,
}

/// Removes the temporary file unless the put committed, also when the put
/// future is dropped mid-copy.
struct Temporary(Option<PathBuf>);

impl Drop for Temporary {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            let _ = std::fs::remove_file(path);
        }
    }
}

impl Local {
    pub fn new(directory: impl Into<PathBuf>, public_url: impl Into<String>) -> Local {
        Local {
            directory: directory.into(),
            public_url: public_url.into(),
            link: |from, to| std::fs::hard_link(from, to),
        }
    }

    async fn store(
        &self,
        key: &str,
        mut content: Box<dyn AsyncRead + Send + Unpin + '_>,
        cancelled: Cancelled<'_>,
    ) -> Result<(), Error> {
        tokio::fs::create_dir_all(&self.directory).await?;
        let final_path = self.directory.join(key);
        let temporary_path = self
            .directory
            .join(format!(".blok-upload-{}", random_hex()));
        // Opened in place, not on a blocking thread: a put dropped mid-open
        // would leave a file the guard never saw.
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary_path)?;
        let mut temporary = Temporary(Some(temporary_path.clone()));
        let mut file = tokio::fs::File::from_std(file);
        let mut buffer = vec![0u8; 32 << 10];
        loop {
            if cancelled() {
                return Err(Error::Cancelled);
            }
            let n = content.read(&mut buffer).await?;
            if n == 0 {
                break;
            }
            file.write_all(&buffer[..n]).await?;
        }
        file.flush().await?;
        file.sync_all().await?;
        if cancelled() {
            return Err(Error::Cancelled);
        }
        tokio::fs::set_permissions(&temporary_path, std::fs::Permissions::from_mode(0o644)).await?;
        drop(file);
        // File.Move refuses to overwrite; a hard link does too. Where
        // linking fails (FAT, some network mounts) File.Move still succeeds,
        // so fall back to a rename after checking the key is free.
        match (self.link)(&temporary_path, &final_path) {
            Ok(()) => {}
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => return Err(err.into()),
            Err(_) => {
                if !matches!(std::fs::symlink_metadata(&final_path), Err(e) if e.kind() == io::ErrorKind::NotFound)
                {
                    return Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        format!("move {}: file already exists", final_path.display()),
                    )
                    .into());
                }
                tokio::fs::rename(&temporary_path, &final_path).await?;
                temporary.0 = None;
            }
        }
        Ok(())
    }
}

impl Store for Local {
    /// Writes to a 0600 temporary file in the directory, syncs it, makes it
    /// 0644 and renames it into place, never over an existing file.
    fn put<'a>(
        &'a self,
        extension: &'a str,
        _mime_type: &'a str,
        content: Body<'a>,
        cancelled: Cancelled<'a>,
    ) -> BoxFuture<'a, Result<String, Error>> {
        Box::pin(async move {
            let key = new_key(extension);
            let reader: Box<dyn AsyncRead + Send + Unpin + 'a> = match content {
                Body::Seekable(body) => Box::new(body),
                Body::Stream(body) => body,
            };
            self.store(&key, reader, cancelled).await?;
            Ok(format!("{}/{key}", self.public_url.trim_end_matches('/')))
        })
    }

    fn delete<'a>(
        &'a self,
        url: &'a str,
        cancelled: Cancelled<'a>,
    ) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(self.remove(url, cancelled))
    }
}

impl Local {
    /// A missing file is fine; a missing directory is an error, as
    /// File.Delete throws DirectoryNotFoundException.
    async fn remove(&self, url: &str, cancelled: Cancelled<'_>) -> Result<(), Error> {
        if cancelled() {
            return Err(Error::Cancelled);
        }
        let key = key_from_public_url(&self.public_url, url).ok_or(Error::Foreign)?;
        let path = self.directory.join(key);
        // File.Delete never removes a directory.
        if let Ok(info) = tokio::fs::symlink_metadata(&path).await
            && info.is_dir()
        {
            return Err(io::Error::new(
                io::ErrorKind::IsADirectory,
                format!("remove {}: is a directory", path.display()),
            )
            .into());
        }
        match tokio::fs::remove_file(&path).await {
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                tokio::fs::metadata(&self.directory).await?;
                Ok(())
            }
            other => Ok(other?),
        }
    }
}

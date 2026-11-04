use std::io;
use std::path::{Path, PathBuf};

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};

use crate::{BoxFuture, Cancelled, Error, Store, key_from_public_url, new_key};

/// LocalBlobStore: files in one directory, served under the public URL.
pub struct Local {
    pub directory: PathBuf,
    pub public_url: String,
    // A seam for tests.
    pub(crate) link: fn(&Path, &Path) -> io::Result<()>,
}

impl Local {
    pub fn new(directory: impl Into<PathBuf>, public_url: impl Into<String>) -> Self {
        Self {
            directory: directory.into(),
            public_url: public_url.into(),
            link: |from, to| std::fs::hard_link(from, to),
        }
    }

    async fn put_inner(
        &self,
        extension: &str,
        content: &mut (dyn AsyncRead + Unpin + Send),
        cancelled: Cancelled<'_>,
    ) -> Result<String, Error> {
        tokio::fs::create_dir_all(&self.directory).await?;
        let key = new_key(extension);
        let final_path = self.directory.join(&key);
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(|e| io::Error::other(e.to_string()))?;
        let hex: String = random.iter().map(|b| format!("{b:02x}")).collect();
        let temporary_path = self.directory.join(format!(".blok-upload-{hex}"));
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary_path)
            .await?;
        let result = self
            .commit(&mut file, &temporary_path, &final_path, content, cancelled)
            .await;
        if result.is_err() {
            drop(file);
            let _ = tokio::fs::remove_file(&temporary_path).await;
        }
        result?;
        Ok(format!("{}/{key}", self.public_url.trim_end_matches('/')))
    }

    async fn commit(
        &self,
        file: &mut tokio::fs::File,
        temporary_path: &Path,
        final_path: &Path,
        content: &mut (dyn AsyncRead + Unpin + Send),
        cancelled: Cancelled<'_>,
    ) -> Result<(), Error> {
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
        file.sync_all().await?;
        if cancelled() {
            return Err(Error::Cancelled);
        }
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(temporary_path, std::fs::Permissions::from_mode(0o644)).await?;
        // File.Move refuses to overwrite; a hard link does too. Where linking
        // fails (FAT, some network mounts) File.Move still succeeds, so fall
        // back to a rename after checking the key is free.
        match (self.link)(temporary_path, final_path) {
            Ok(()) => {
                let _ = tokio::fs::remove_file(temporary_path).await;
                Ok(())
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Err(error.into()),
            Err(_) => {
                match tokio::fs::symlink_metadata(final_path).await {
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    _ => {
                        return Err(io::Error::new(
                            io::ErrorKind::AlreadyExists,
                            format!("move {}: file already exists", final_path.display()),
                        )
                        .into());
                    }
                }
                tokio::fs::rename(temporary_path, final_path).await?;
                Ok(())
            }
        }
    }

    async fn delete_inner(&self, url: &str, cancelled: Cancelled<'_>) -> Result<(), Error> {
        if cancelled() {
            return Err(Error::Cancelled);
        }
        let key = key_from_public_url(&self.public_url, url).ok_or(Error::Foreign)?;
        let path = self.directory.join(key);
        // File.Delete never removes a directory.
        if let Ok(info) = tokio::fs::symlink_metadata(&path).await
            && info.is_dir()
        {
            return Err(
                io::Error::other(format!("remove {}: is a directory", path.display())).into(),
            );
        }
        match tokio::fs::remove_file(&path).await {
            // A missing file is fine; a missing directory is an error, as
            // File.Delete throws DirectoryNotFoundException.
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                tokio::fs::metadata(&self.directory).await?;
                Ok(())
            }
            other => Ok(other?),
        }
    }
}

impl Store for Local {
    /// Writes content to a 0600 temporary file in the directory, syncs it,
    /// makes it 0644 and moves it into place, never over an existing file.
    fn put<'a>(
        &'a self,
        extension: &'a str,
        _mime_type: &'a str,
        content: &'a mut (dyn AsyncRead + Unpin + Send),
        cancelled: Cancelled<'a>,
    ) -> BoxFuture<'a, Result<String, Error>> {
        Box::pin(self.put_inner(extension, content, cancelled))
    }

    fn delete<'a>(
        &'a self,
        url: &'a str,
        cancelled: Cancelled<'a>,
    ) -> BoxFuture<'a, Result<(), Error>> {
        Box::pin(self.delete_inner(url, cancelled))
    }
}

#[cfg(test)]
#[path = "local_test.rs"]
mod tests;

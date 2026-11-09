//! The caller identity the request guard sets and the handlers read. It is
//! its own crate so blokserver and the collab handlers share one type;
//! blokserver re-exports it.

use std::future::Future;
use std::pin::Pin;

pub use blok_http::Extensions;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub type Error = Box<dyn std::error::Error + Send + Sync>;

/// The caller of one request. In ticket mode the guard builds it from the
/// verified pass; a host's own middleware may set it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct User {
    pub id: String,
    pub name: String,
    /// The one document the pass names, "" when it names none.
    pub doc: String,
    pub write: bool,
    pub authenticated: bool,
}

/// Narrows document access: IBlokAuthorization. It is consulted on the
/// document routes only, never on upload, unfurl or delete.
///
/// `request` is the request's extensions, so a policy can decide on
/// anything the host's middleware attached, as a C# policy reads any claim
/// of the principal. The sync recheck gets the upgrade request's.
pub trait Authorization: Send + Sync {
    fn can_read_document<'a>(
        &'a self,
        user: &'a User,
        document_id: &'a str,
        request: &'a Extensions,
    ) -> BoxFuture<'a, Result<bool, Error>>;
    fn can_write_document<'a>(
        &'a self,
        user: &'a User,
        document_id: &'a str,
        request: &'a Extensions,
    ) -> BoxFuture<'a, Result<bool, Error>>;

    /// May this caller read the document's version history? Asked on the
    /// history list, a version read, its changes, history/at,
    /// history/changes and restore/preview, only after can_read_document
    /// (and can_write_document on preview) said yes. A restore or a delete
    /// is decided by the write gate. The default is yes.
    fn can_read_history<'a>(
        &'a self,
        _user: &'a User,
        _document_id: &'a str,
        _request: &'a Extensions,
    ) -> BoxFuture<'a, Result<bool, Error>> {
        Box::pin(async { Ok(true) })
    }

    /// How far back this caller may see the document's history; None (the
    /// default) is all of it. A point older than now minus the window is
    /// hidden, never deleted: reading it, its changes, history/at resolving
    /// to it, a before naming it, a restore to it and its preview answer 404
    /// {"reason":"retention"}; the list and the range leave it out. Not
    /// asked on delete.
    fn history_window<'a>(
        &'a self,
        _user: &'a User,
        _document_id: &'a str,
        _request: &'a Extensions,
    ) -> BoxFuture<'a, Result<Option<std::time::Duration>, Error>> {
        Box::pin(async { Ok(None) })
    }

    /// Is this lineage held, so that DELETE /sync/{doc}/history/{lineage}
    /// answers 409 {"reason":"held"}? Asked before anything else about the
    /// lineage. Blok stores no bookmarks: a host that keeps named versions
    /// as (lineage, sequence) pairs holds their lineages here. A document
    /// purge does not ask. The default holds nothing.
    fn is_history_held<'a>(
        &'a self,
        _document_id: &'a str,
        _lineage: &'a str,
        _request: &'a Extensions,
    ) -> BoxFuture<'a, Result<bool, Error>> {
        Box::pin(async { Ok(false) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_default_user_is_anonymous_and_read_only() {
        let user = User::default();
        assert!(!user.authenticated);
        assert!(!user.write);
        assert_eq!(user.doc, "");
    }

    struct OnlyDocA;

    impl Authorization for OnlyDocA {
        fn can_read_document<'a>(
            &'a self,
            _user: &'a User,
            document_id: &'a str,
            _request: &'a Extensions,
        ) -> BoxFuture<'a, Result<bool, Error>> {
            Box::pin(async move { Ok(document_id == "a") })
        }
        fn can_write_document<'a>(
            &'a self,
            user: &'a User,
            _document_id: &'a str,
            _request: &'a Extensions,
        ) -> BoxFuture<'a, Result<bool, Error>> {
            Box::pin(async move { Ok(user.write) })
        }
    }

    #[test]
    fn an_authorization_is_usable_as_a_shared_trait_object() {
        let authorization: std::sync::Arc<dyn Authorization> = std::sync::Arc::new(OnlyDocA);
        let user = User::default();
        let writer = User {
            write: true,
            ..User::default()
        };
        let none = Extensions::default();
        assert!(poll_once(
            authorization.can_read_document(&user, "a", &none)
        ));
        assert!(!poll_once(
            authorization.can_read_document(&user, "b", &none)
        ));
        assert!(!poll_once(
            authorization.can_write_document(&user, "a", &none)
        ));
        assert!(poll_once(
            authorization.can_write_document(&writer, "a", &none)
        ));
    }

    fn poll_once(mut future: BoxFuture<'_, Result<bool, Error>>) -> bool {
        let mut context = std::task::Context::from_waker(std::task::Waker::noop());
        match future.as_mut().poll(&mut context) {
            std::task::Poll::Ready(Ok(answer)) => answer,
            _ => panic!("not ready"),
        }
    }
}

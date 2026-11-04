use blok_collab_wire::Message;
use blok_jsjson::{Object, Str, Value};
use blok_yjs::Doc;

use crate::test_support::*;
use crate::*;

// Go convert/structure.go PlainPageMaps panics on a page-map value with
// no JSON form, and ReadVersion has no recover, so the HTTP host drops the
// connection. C# (YDocConverter.PlainPageMaps -> RichText.ToJsonNode)
// throws InvalidDataException, which ReadVersionAsync lets through: the
// read is an error, never a crash.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn read_version_refuses_a_page_map_value_with_no_json_form() {
    let (journal, _dir) = open_journal();
    let (manager, _, _) = test_manager(Options::default(), Some(journal));
    let writer = FakeMember::v1(true);
    let membership = join(&manager, "doc", &writer).await;
    let lineage = control_tag(&writer).lineage;
    let client = Doc::new(blok_yjs::Options {
        client_id: Some(4242),
        no_gc: false,
    });
    let values = client.get_map("values").expect("a map root");
    let mut nested = Object::new();
    nested.set(Str::from("n"), Value::BigInt(1));
    let update = client
        .transact(|txn| values.set(txn, "x", Value::Object(nested)))
        .expect("a write")
        .expect("an update");
    receive(&membership, Message::SyncUpdate { update }).await;

    let err = manager
        .read_version("doc", &lineage, 1)
        .await
        .expect_err("a nested bigint has no JSON form");
    assert!(
        matches!(err, Error::Convert(blok_collab_convert::Error::Data(_))),
        "want C#'s InvalidDataException, got {err:?}"
    );
    assert_eq!(
        err.to_string(),
        "collab: unsupported value BigInteger in rich text."
    );
}

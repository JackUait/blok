use blok_collab_wire::Message;
use blok_jsjson::{Object, Str, Value};
use blok_yjs::Doc;

use crate::test_support::*;
use crate::*;

// C# HistoryEndpointTests.AReadLeavesOutAPageMapValueHoldingAPeerBigint:
// a value JSON cannot hold is left out of the read, never an error.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_read_leaves_out_a_page_map_value_holding_a_peer_bigint() {
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
        .transact(|txn| {
            values.set(txn, "x", Value::Object(nested))?;
            values.set(txn, "kept", Value::String("plain".into()))
        })
        .expect("a write")
        .expect("an update");
    receive(&membership, Message::SyncUpdate { update }).await;

    let read = manager
        .read_version("doc", &lineage, 1)
        .await
        .expect("a value with no JSON form does not fail the read");

    assert_eq!(read.status, HistoryStatus::Ready);
    let json = String::from_utf8(read.json).expect("utf-8");
    assert!(json.ends_with(r#","values":{"kept":"plain"}}"#), "{json}");
}

use std::sync::{Arc, Mutex};

use crate::retry_test::custom_insert;
use crate::test_support::*;
use crate::*;

// G5: DocumentReplaced fires on a reset, an applied restore and a purge
// (CollabRoomManager.cs:333,832,1088), and not on a restore that finds no
// point. The agent drops its cached plans on it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn document_replaced_fires_on_reset_applied_restore_and_purge() {
    let (journal, _dir) = open_journal();
    let (manager, _, _) = test_manager(Options::default(), Some(journal));
    let fired = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen = fired.clone();
    manager.on_document_replaced(move |doc| lock(&seen).push(doc.to_owned()));
    let count = || lock(&fired).len();
    let mut lineage = String::new();
    for i in 1..=2 {
        let result = manager
            .edit(
                "doc",
                custom_insert(&format!("b{i}")),
                &format!("0000000000000000000000000000000{i}"),
                &[0; 32],
                "",
                None,
            )
            .await
            .expect("edit");
        assert_eq!(result.status, EditStatus::Applied, "{:?}", result.err);
        lineage = result.receipt.expect("a receipt").tag.lineage;
    }
    assert_eq!(count(), 0, "an edit fired DocumentReplaced");

    let (status, _) = manager
        .restore(
            "doc",
            &lineage,
            9,
            "000000000000000000000000000000a0",
            "",
            None,
        )
        .await
        .expect("restore");
    assert_eq!(status, HistoryStatus::NotFound, "a missing point");
    assert_eq!(
        count(),
        0,
        "a restore that found no point fired DocumentReplaced"
    );
    let stale = Precondition {
        lineage: lineage.clone(),
        sequence: 1,
    };
    let (_, refused) = manager
        .restore(
            "doc",
            &lineage,
            1,
            "000000000000000000000000000000a2",
            "",
            Some(stale),
        )
        .await
        .expect("restore");
    assert_eq!(
        refused.map(|r| r.status),
        Some(EditStatus::PreconditionFailed),
        "a stale restore"
    );
    assert_eq!(count(), 0, "a refused restore fired DocumentReplaced");
    let (status, edit) = manager
        .restore(
            "doc",
            &lineage,
            1,
            "000000000000000000000000000000a1",
            "",
            None,
        )
        .await
        .expect("restore");
    assert_eq!(
        (status, edit.map(|e| e.status)),
        (HistoryStatus::Ready, Some(EditStatus::Applied))
    );
    assert_eq!(count(), 1, "fired after the restore");

    let reset = manager.reset("doc").await.expect("reset");
    assert_eq!(reset.status, ResetStatus::Done);
    manager
        .purge("doc", async { Ok(true) })
        .await
        .expect("purge");
    assert_eq!(*lock(&fired), ["doc", "doc", "doc"]);
}

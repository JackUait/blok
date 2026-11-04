// Twins of the C# FakeCollabOperationStoreTests.cs cases with no Go twin.

#[test]
#[ignore = "not ported yet"]
fn assigns_sequences_from_one_and_exposes_committed_records() {}

#[test]
#[ignore = "not ported yet"]
fn reports_whether_an_operation_id_is_already_committed() {}

#[test]
#[ignore = "not ported yet"]
fn deduplicates_a_retry_and_conflicts_on_a_different_digest() {}

#[test]
#[ignore = "not ported yet"]
fn fails_an_append_without_journalling_it() {}

#[test]
#[ignore = "not ported yet"]
fn keeps_an_unknown_outcome_durable_so_the_retry_reads_as_a_duplicate() {}

#[test]
#[ignore = "not ported yet"]
fn holds_an_append_until_the_store_is_released() {}

#[test]
#[ignore = "not ported yet"]
fn reports_a_second_open_as_held_elsewhere_until_the_first_is_disposed() {}

#[test]
#[ignore = "not ported yet"]
fn refuses_every_call_once_the_fence_is_lost() {}

#[test]
#[ignore = "not ported yet"]
fn opens_an_unseeded_document_with_no_head() {}

#[test]
#[ignore = "not ported yet"]
fn hands_the_checkpoint_and_the_tail_after_it_to_the_next_open() {}

#[test]
#[ignore = "not ported yet"]
fn refuses_a_checkpoint_past_the_committed_sequence() {}

#[test]
#[ignore = "not ported yet"]
fn accepts_a_republished_checkpoint_at_the_same_sequence() {}

#[test]
#[ignore = "not ported yet"]
fn forgets_operation_ids_from_a_superseded_lineage() {}

#[test]
#[ignore = "not ported yet"]
fn releases_nothing_on_dispose_once_the_fence_is_lost() {}

#[test]
#[ignore = "not ported yet"]
fn throws_object_disposed_on_every_call_after_disposal() {}

#[test]
#[ignore = "not ported yet"]
fn keeps_superseded_lineages_for_history() {}

#[test]
#[ignore = "not ported yet"]
fn deletes_only_a_superseded_lineage() {}

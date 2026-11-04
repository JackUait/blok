// Twins of the C# CollabRoomManagerTests.cs cases with no Go twin.

#[test]
#[ignore = "not ported yet"]
fn the_first_join_seeds_from_the_endpoint_exactly_once_even_under_concurrent_joins() {}

#[test]
#[ignore = "not ported yet"]
fn a_stored_working_set_hydrates_the_room_without_touching_the_endpoint() {}

#[test]
#[ignore = "not ported yet"]
fn an_empty_stored_log_after_a_reset_reseeds_under_the_stored_epoch() {}

#[test]
#[ignore = "not ported yet"]
fn a_null_document_seeds_an_empty_room_without_failing_and_without_a_converter_call() {}

#[test]
#[ignore = "not ported yet"]
fn a_re_seed_of_a_null_document_keeps_the_lineage_it_persisted() {}

#[test]
#[ignore = "not ported yet"]
fn every_doc_access_goes_through_one_lane() {}

#[test]
#[ignore = "not ported yet"]
fn the_last_leave_starts_a_linger_and_a_join_during_it_keeps_the_room() {}

#[test]
#[ignore = "not ported yet"]
fn a_cancelled_first_join_leaves_a_room_that_still_evicts() {}

#[test]
#[ignore = "not ported yet"]
fn a_cancelled_join_does_not_arm_the_linger_while_others_are_still_in_the_room() {}

#[test]
#[ignore = "not ported yet"]
fn the_linger_elapsing_compacts_exports_and_drops_the_room() {}

#[test]
#[ignore = "not ported yet"]
fn eviction_waits_for_an_in_flight_export_before_flushing() {}

#[test]
#[ignore = "not ported yet"]
fn membership_calls_stay_safe_after_leaving_and_after_the_room_closed() {}

#[test]
#[ignore = "not ported yet"]
fn a_headless_edit_is_in_the_blob_before_it_is_answered() {}

#[test]
#[ignore = "not ported yet"]
fn a_headless_edit_persists_exports_after_the_debounce_and_evicts_after_the_linger() {}

#[test]
#[ignore = "not ported yet"]
fn a_refused_edit_writes_nothing_and_the_room_still_evicts() {}

#[test]
#[ignore = "not ported yet"]
fn legacy_manager_cannot_silently_ignore_an_access_recheck() {}

#[test]
#[ignore = "not ported yet"]
fn recheck_expels_a_member_when_policy_and_logger_throw() {}

#[test]
#[ignore = "not ported yet"]
fn first_join_is_refused_when_policy_and_logger_throw() {}

#[test]
#[ignore = "not ported yet"]
fn cancelling_an_access_recheck_does_not_expel_an_allowed_member() {}

#[test]
#[ignore = "not ported yet"]
fn a_throwing_activity_drop_logger_does_not_strand_other_revoked_members() {}

#[test]
#[ignore = "not ported yet"]
fn recheck_keeps_queued_writes_out_of_the_journal_and_rejects_a_queued_join() {}

#[test]
#[ignore = "not ported yet"]
fn recheck_closes_a_join_that_passed_access_before_the_acl_changed() {}

#[test]
#[ignore = "not ported yet"]
fn reset_raises_the_epoch_closes_every_member_and_reseeds_on_the_next_join() {}

#[test]
#[ignore = "not ported yet"]
fn reset_without_a_live_room_still_raises_the_stored_epoch() {}

#[test]
#[ignore = "not ported yet"]
fn reset_waits_for_an_in_flight_blob_write_instead_of_racing_it() {}

#[test]
#[ignore = "not ported yet"]
fn a_stored_working_set_of_another_format_fails_the_join_closed() {}

#[test]
#[ignore = "not ported yet"]
fn a_store_blip_during_the_on_load_compaction_still_joins_and_retries_the_write() {}

#[test]
#[ignore = "not ported yet"]
fn a_request_abort_after_the_store_reset_landed_still_closes_the_room() {}

#[test]
#[ignore = "not ported yet"]
fn reset_abandons_an_in_flight_export_instead_of_letting_it_land_afterwards() {}

#[test]
#[ignore = "not ported yet"]
fn drain_flushes_every_room_closes_members_as_draining_and_refuses_new_joins() {}

#[test]
#[ignore = "not ported yet"]
fn a_re_seed_after_an_unreadable_blob_mints_a_new_lineage() {}

#[test]
#[ignore = "not ported yet"]
fn a_re_seed_after_a_blob_with_corrupt_frames_under_an_intact_header_still_joins() {}

#[test]
#[ignore = "not ported yet"]
fn a_re_seed_after_a_lost_blob_mints_a_new_lineage_under_the_same_epoch() {}

#[test]
#[ignore = "not ported yet"]
fn a_store_outage_keeps_the_room_loaded_until_the_working_set_catches_up() {}

#[test]
#[ignore = "not ported yet"]
fn an_endpoint_outage_at_eviction_keeps_the_room_loaded_until_the_export_lands() {}

#[test]
#[ignore = "not ported yet"]
fn drain_closes_a_room_whose_store_fails_and_still_drains_the_others() {}

#[test]
#[ignore = "not ported yet"]
fn purge_rejects_invalid_document_ids_before_authorization() {}

#[test]
#[ignore = "not ported yet"]
fn denied_purge_leaves_the_room_and_working_set_untouched() {}

#[test]
#[ignore = "not ported yet"]
fn a_journal_without_purge_support_fails_before_the_room_is_closed() {}

#[test]
#[ignore = "not ported yet"]
fn purge_closes_members_without_flushing_and_bars_every_entry_point() {}

#[test]
#[ignore = "not ported yet"]
fn purge_bars_admission_while_a_previous_blob_write_is_still_in_flight() {}

#[test]
#[ignore = "not ported yet"]
fn purge_waits_for_an_in_flight_export_but_starts_no_final_export() {}

#[test]
#[ignore = "not ported yet"]
fn a_remote_journal_hold_leaves_the_working_set_and_admission_gate_in_place() {}

#[test]
#[ignore = "not ported yet"]
fn a_journal_purge_failure_keeps_the_gate_and_retries_before_working_set_deletion() {}

#[test]
#[ignore = "not ported yet"]
fn a_working_set_delete_failure_keeps_the_journal_tombstone_and_retries() {}

#[test]
#[ignore = "not ported yet"]
fn a_journal_free_purge_needs_the_hosts_tombstone_on_another_manager() {}

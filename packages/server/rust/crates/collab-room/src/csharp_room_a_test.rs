// Twins of the C# CollabRoomTests.cs (first half of the untwinned cases) cases with no Go twin.

#[test]
#[ignore = "not ported yet"]
fn answers_sync_step1_with_the_diff_and_its_own_sync_step1() {}

#[test]
#[ignore = "not ported yet"]
fn applies_a_writer_update_appends_it_once_and_broadcasts_to_others_only() {}

#[test]
#[ignore = "not ported yet"]
fn applies_a_writer_sync_step2_for_a_late_joiner_with_offline_edits() {}

#[test]
#[ignore = "not ported yet"]
fn drops_sync_step2_and_updates_from_read_only_members_but_answers_their_sync_step1() {}

#[test]
#[ignore = "not ported yet"]
fn relays_awareness_and_query_awareness_to_others_even_from_read_only_members() {}

#[test]
#[ignore = "not ported yet"]
fn drops_a_malformed_awareness_frame_and_closes_the_sender_on_the_third() {}

#[test]
#[ignore = "not ported yet"]
fn drops_an_awareness_frame_that_claims_more_clients_than_the_room_relays() {}

#[test]
#[ignore = "not ported yet"]
fn relays_awareness_at_the_client_cap_and_drops_the_frame_above_it() {}

#[test]
#[ignore = "not ported yet"]
fn holds_a_read_only_members_presence_to_the_same_client_cap() {}

#[test]
#[ignore = "not ported yet"]
fn drops_an_awareness_frame_whose_client_count_cannot_be_read() {}

#[test]
#[ignore = "not ported yet"]
fn broadcasts_query_awareness_to_the_others_when_someone_joins() {}

#[test]
#[ignore = "not ported yet"]
fn sends_the_epoch_control_frame_first_only_to_members_that_negotiated_it() {}

#[test]
#[ignore = "not ported yet"]
fn announces_the_message_cap_right_after_the_control_frame() {}

#[test]
#[ignore = "not ported yet"]
fn ignores_malformed_frames_and_unusable_updates() {}

#[test]
#[ignore = "not ported yet"]
fn a_malformed_update_is_dropped_without_closing_the_member() {}

#[test]
#[ignore = "not ported yet"]
fn a_room_applies_a_nul_bearing_update_and_exports_it_intact() {}

#[test]
#[ignore = "not ported yet"]
fn exports_after_the_debounce_and_not_before() {}

#[test]
#[ignore = "not ported yet"]
fn exports_no_later_than_the_max_delay_under_continuous_edits() {}

#[test]
#[ignore = "not ported yet"]
fn retries_a_failed_export_on_the_next_tick_and_keeps_the_blob() {}

#[test]
#[ignore = "not ported yet"]
fn retries_an_export_the_converter_refused_with_backoff() {}

#[test]
#[ignore = "not ported yet"]
fn coalesces_edits_made_during_an_in_flight_export_into_the_next_one() {}

#[test]
#[ignore = "not ported yet"]
fn carries_the_version_each_save_answers_with_into_the_next_save() {}

#[test]
#[ignore = "not ported yet"]
fn seeds_every_room_under_its_own_random_client_id() {}

#[test]
#[ignore = "not ported yet"]
fn a_joiner_cancelling_mid_seed_does_not_poison_the_seed_for_the_others() {}

#[test]
#[ignore = "not ported yet"]
fn a_store_timeout_during_an_apply_is_logged_retried_and_still_exports() {}

#[test]
#[ignore = "not ported yet"]
fn a_slow_store_does_not_stall_the_lane() {}

#[test]
#[ignore = "not ported yet"]
fn no_write_carries_more_frames_than_the_compaction_threshold() {}

#[test]
#[ignore = "not ported yet"]
fn measures_the_log_without_its_compacted_base_when_deciding_to_compact() {}

#[test]
#[ignore = "not ported yet"]
fn compaction_keeps_an_update_that_is_still_pending() {}

#[test]
#[ignore = "not ported yet"]
fn does_not_ack_or_broadcast_before_append_completes() {}

#[test]
#[ignore = "not ported yet"]
fn acknowledges_and_broadcasts_to_every_v2_member_including_the_submitter_after_commit() {}

#[test]
#[ignore = "not ported yet"]
fn append_failure_closes_every_member_with_commit_unavailable() {}

#[test]
#[ignore = "not ported yet"]
fn append_failure_closes_and_discards_the_room_without_observation() {}

#[test]
#[ignore = "not ported yet"]
fn unknown_commit_outcome_closes_and_retry_resolves_by_id() {}

#[test]
#[ignore = "not ported yet"]
fn repeated_append_failure_does_not_reload_the_document_per_retry() {}

#[test]
#[ignore = "not ported yet"]
fn an_append_past_the_store_timeout_is_commit_unavailable() {}

#[test]
#[ignore = "not ported yet"]
fn open_elsewhere_refuses_the_join_as_unavailable() {}

#[test]
#[ignore = "not ported yet"]
fn lost_ack_retry_returns_the_same_commit_without_rebroadcast() {}

#[test]
#[ignore = "not ported yet"]
fn same_id_different_bytes_rejects_without_apply() {}

#[test]
#[ignore = "not ported yet"]
fn committed_operations_broadcast_in_server_sequence_order() {}

#[test]
#[ignore = "not ported yet"]
fn reload_replays_every_acknowledged_operation_after_the_checkpoint() {}

#[test]
#[ignore = "not ported yet"]
fn unjournalled_provisional_state_never_exports_or_checkpoints() {}

#[test]
#[ignore = "not ported yet"]
fn working_set_only_room_keeps_the_legacy_relay_path() {}

#[test]
#[ignore = "not ported yet"]
fn a_lookup_past_the_store_timeout_is_commit_unavailable() {}

#[test]
#[ignore = "not ported yet"]
fn resetting_an_operation_store_room_resets_the_journal_and_closes_members() {}

#[test]
#[ignore = "not ported yet"]
fn a_queued_old_lineage_receive_cannot_append_after_journal_reset() {}

#[test]
#[ignore = "not ported yet"]
fn resetting_a_new_operation_store_room_opens_the_journal_before_the_working_set() {}

#[test]
#[ignore = "not ported yet"]
fn a_journal_room_reset_does_not_write_the_working_set() {}

#[test]
#[ignore = "not ported yet"]
fn a_session_that_hangs_in_dispose_does_not_wedge_the_room() {}

#[test]
#[ignore = "not ported yet"]
fn an_operation_frame_from_av1_member_is_dropped_without_journalling() {}

#[test]
#[ignore = "not ported yet"]
fn a_raw_write_from_av2_member_is_dropped_and_the_member_is_closed() {}

#[test]
#[ignore = "not ported yet"]
fn a_raw_write_from_av1_member_is_still_applied_on_the_same_room() {}

#[test]
#[ignore = "not ported yet"]
fn an_operation_before_the_room_answered_sync_step1_is_rejected_as_not_synced() {}

#[test]
#[ignore = "not ported yet"]
fn a_sync_step1_the_room_could_not_answer_does_not_make_the_member_synced() {}

#[test]
#[ignore = "not ported yet"]
fn awareness_before_the_sync_exchange_is_still_relayed() {}

#[test]
#[ignore = "not ported yet"]
fn awareness_after_the_sync_exchange_is_still_relayed() {}

#[test]
#[ignore = "not ported yet"]
fn v1_update_is_journalled_before_broadcast_with_a_server_generated_id() {}

#[test]
#[ignore = "not ported yet"]
fn v1_duplicate_state_converges_but_has_no_client_receipt() {}

#[test]
#[ignore = "not ported yet"]
fn an_idle_v1_resync_is_not_journalled_even_with_deletion_history() {}

#[test]
#[ignore = "not ported yet"]
fn a_deletion_that_only_widens_parked_ranges_is_still_journalled() {}

#[test]
#[ignore = "not ported yet"]
fn an_idle_v1_resync_is_not_journalled_while_a_delete_is_parked() {}

#[test]
#[ignore = "not ported yet"]
fn av1_deletion_is_journalled_and_relayed() {}

#[test]
#[ignore = "not ported yet"]
fn av1_update_that_only_parks_pending_is_still_journalled() {}

#[test]
#[ignore = "not ported yet"]
fn a_read_only_v1_update_is_dropped_without_journalling() {}

#[test]
#[ignore = "not ported yet"]
fn a_failed_v1_append_discards_the_room_without_relaying_or_exporting() {}

#[test]
#[ignore = "not ported yet"]
fn consecutive_v1_updates_are_journalled_under_distinct_ids() {}

#[test]
#[ignore = "not ported yet"]
fn an_edit_is_refused_while_the_document_is_in_its_commit_cooldown() {}

#[test]
#[ignore = "not ported yet"]
fn a_post_apply_failure_closes_without_observation() {}

#[test]
#[ignore = "not ported yet"]
fn an_edit_that_moves_the_doc_without_a_local_update_closes_without_observation() {}

#[test]
#[ignore = "not ported yet"]
fn an_edit_that_writes_nothing_is_applied_without_an_append() {}

#[test]
#[ignore = "not ported yet"]
fn under_a_journal_a_respelled_paragraph_edit_is_applied_and_keeps_the_room() {}

#[test]
#[ignore = "not ported yet"]
fn an_edit_with_multiple_local_updates_closes_without_observation() {}

#[test]
#[ignore = "not ported yet"]
fn a_working_set_in_another_format_fails_the_open_and_is_kept() {}

#[test]
#[ignore = "not ported yet"]
fn a_failed_working_set_retire_still_opens_and_the_next_load_retries_it() {}

#[test]
#[ignore = "not ported yet"]
fn a_reset_of_a_headless_document_drops_its_working_set() {}

#[test]
#[ignore = "not ported yet"]
fn a_journal_room_never_writes_the_working_set() {}

#[test]
#[ignore = "not ported yet"]
fn state_is_the_live_export_and_the_head_it_reflects() {}

#[test]
#[ignore = "not ported yet"]
fn state_without_a_journal_has_no_head() {}

#[test]
#[ignore = "not ported yet"]
fn a_cold_room_loaded_by_state_is_evicted() {}

#[test]
#[ignore = "not ported yet"]
fn state_of_a_purged_document_is_refused() {}

#[test]
#[ignore = "not ported yet"]
fn state_is_refused_while_draining() {}

#[test]
#[ignore = "not ported yet"]
fn an_export_failure_is_reported_without_closing_the_room() {}

#[test]
#[ignore = "not ported yet"]
fn a_cold_room_loaded_by_a_committed_key_replay_is_still_evicted() {}

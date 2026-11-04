// Twins of the C# CollabRoomTests.cs (second half of the untwinned cases) cases with no Go twin.

#[test]
#[ignore = "not ported yet"]
fn a_cold_room_loaded_by_a_reused_key_conflict_is_still_evicted() {}

#[test]
#[ignore = "not ported yet"]
fn a_stale_edit_precondition_is_refused_with_the_head_and_nothing_applied() {}

#[test]
#[ignore = "not ported yet"]
fn a_matching_edit_precondition_applies_at_the_next_sequence() {}

#[test]
#[ignore = "not ported yet"]
fn a_committed_key_replays_its_receipt_even_when_its_precondition_is_now_stale() {}

#[test]
#[ignore = "not ported yet"]
fn an_edit_precondition_without_a_journal_is_refused_before_the_room_loads() {}

#[test]
#[ignore = "not ported yet"]
fn a_cold_room_loaded_by_a_failed_precondition_is_still_evicted() {}

#[test]
#[ignore = "not ported yet"]
fn an_edit_is_refused_while_another_process_holds_the_document() {}

#[test]
#[ignore = "not ported yet"]
fn a_read_only_members_operation_is_rejected_without_journalling() {}

#[test]
#[ignore = "not ported yet"]
fn an_operation_from_another_lineage_is_rejected_without_journalling() {}

#[test]
#[ignore = "not ported yet"]
fn an_unusable_operation_update_is_rejected_without_journalling() {}

#[test]
#[ignore = "not ported yet"]
fn operation_ack_does_not_wait_for_json_projection() {}

#[test]
#[ignore = "not ported yet"]
fn edits_do_not_schedule_a_whole_json_put_per_debounce_window() {}

#[test]
#[ignore = "not ported yet"]
fn published_checkpoint_schedules_one_projection() {}

#[test]
#[ignore = "not ported yet"]
fn a_reloaded_journal_room_still_serves_when_the_endpoint_is_down() {}

#[test]
#[ignore = "not ported yet"]
fn under_a_journal_a_null_seed_puts_nothing_and_its_reopen_puts_one_empty_document() {}

#[test]
#[ignore = "not ported yet"]
fn a_seed_reads_its_html_with_the_one_time_budget() {}

#[test]
#[ignore = "not ported yet"]
fn malformed_rich_text_from_the_host_or_a_peer_keeps_the_room_exportable() {}

#[test]
#[ignore = "not ported yet"]
fn under_a_journal_an_html_reader_failure_refuses_the_edit_and_keeps_the_room() {}

#[test]
#[ignore = "not ported yet"]
fn under_a_journal_an_html_read_past_the_runtimes_limits_is_overloaded_and_keeps_the_room() {}

#[test]
#[ignore = "not ported yet"]
fn on_a_working_copy_an_html_read_past_the_runtimes_limits_is_overloaded_and_keeps_the_room() {}

#[test]
#[ignore = "not ported yet"]
fn an_html_read_past_the_allocation_budget_is_too_large_and_keeps_the_room() {}

#[test]
#[ignore = "not ported yet"]
fn a_java_script_error_reading_an_edits_html_stays_a_refusal() {}

#[test]
#[ignore = "not ported yet"]
fn a_state_export_past_the_runtimes_limits_is_overloaded() {}

#[test]
#[ignore = "not ported yet"]
fn a_state_export_that_can_never_be_written_stays_export_failed() {}

#[test]
#[ignore = "not ported yet"]
fn under_a_journal_a_state_read_seeds_a_null_document_and_its_reopen_puts_once() {}

#[test]
#[ignore = "not ported yet"]
fn a_checkpoint_refused_by_a_corrupt_journal_closes_the_room() {}

#[test]
#[ignore = "not ported yet"]
fn a_checkpoint_sequence_the_store_refuses_closes_the_room() {}

#[test]
#[ignore = "not ported yet"]
fn a_transient_checkpoint_failure_keeps_the_room_and_is_retried() {}

#[test]
#[ignore = "not ported yet"]
fn a_checkpoint_that_lost_the_fence_closes_the_room() {}

#[test]
#[ignore = "not ported yet"]
fn a_reloaded_room_counts_the_tail_it_inherited_toward_the_threshold() {}

#[test]
#[ignore = "not ported yet"]
fn checkpoint_then_tail_replays_the_exact_document() {}

#[test]
#[ignore = "not ported yet"]
fn checkpoint_publication_does_not_delete_operation_history() {}

#[test]
#[ignore = "not ported yet"]
fn the_operation_that_trips_a_fatal_checkpoint_is_still_relayed_and_acknowledged() {}

#[test]
#[ignore = "not ported yet"]
fn resetting_a_journal_room_projects_committed_work_before_it_rebaselines() {}

#[test]
#[ignore = "not ported yet"]
fn a_client_disconnecting_mid_reset_does_not_cost_the_projection() {}

#[test]
#[ignore = "not ported yet"]
fn resetting_a_reloaded_room_projects_the_work_the_record_never_got() {}

#[test]
#[ignore = "not ported yet"]
fn resetting_a_cold_document_whose_journal_cannot_be_replayed_still_rebaselines() {}

#[test]
#[ignore = "not ported yet"]
fn resetting_a_cold_document_whose_journal_stops_replaying_still_rebaselines() {}

#[test]
#[ignore = "not ported yet"]
fn resetting_a_cold_journalled_document_projects_it_before_rebaselining() {}

#[test]
#[ignore = "not ported yet"]
fn an_edit_on_a_cold_journalled_document_does_not_wait_for_the_version_read() {}

#[test]
#[ignore = "not ported yet"]
fn a_version_read_that_lands_after_a_failed_projection_still_fills_the_handle() {}

#[test]
#[ignore = "not ported yet"]
fn a_reset_flush_carries_the_reloaded_version_and_yields_to_the_hosts_save() {}

#[test]
#[ignore = "not ported yet"]
fn a_reloaded_room_inherits_its_committed_sequence_from_the_head() {}

#[test]
#[ignore = "not ported yet"]
fn failed_projection_stays_dirty_and_retries() {}

#[test]
#[ignore = "not ported yet"]
fn eviction_and_drain_project_the_latest_committed_sequence() {}

#[test]
#[ignore = "not ported yet"]
fn eviction_waits_for_a_dirty_projection() {}

#[test]
#[ignore = "not ported yet"]
fn permanent_projection_failure_releases_the_hold_and_marks_the_document_unexportable() {}

#[test]
#[ignore = "not ported yet"]
fn a_transient_export_failure_is_retried_not_refused() {}

#[test]
#[ignore = "not ported yet"]
fn an_engine_pool_wait_never_gives_the_export_up() {}

#[test]
#[ignore = "not ported yet"]
fn on_a_working_copy_a_transient_export_failure_that_never_heals_is_given_up() {}

#[test]
#[ignore = "not ported yet"]
fn on_a_working_copy_a_given_up_export_lets_the_room_unload() {}

#[test]
#[ignore = "not ported yet"]
fn on_a_working_copy_an_engine_pool_wait_never_gives_the_export_up() {}

#[test]
#[ignore = "not ported yet"]
fn a_transient_flush_export_failure_is_not_a_refusal() {}

#[test]
#[ignore = "not ported yet"]
fn a_java_script_error_reading_export_html_is_a_refusal() {}

#[test]
#[ignore = "not ported yet"]
fn a_cancelled_export_is_retried_not_refused() {}

#[test]
#[ignore = "not ported yet"]
fn operation_store_room_never_writes_the_working_set_store() {}

#[test]
#[ignore = "not ported yet"]
fn operation_store_room_never_compacts() {}

#[test]
#[ignore = "not ported yet"]
fn operation_store_room_loads_baseline_and_tail_through_the_fenced_session() {}

#[test]
#[ignore = "not ported yet"]
fn operation_store_room_evicts_without_waiting_for_a_blob_write() {}

#[test]
#[ignore = "not ported yet"]
fn a_join_reports_the_actor_as_joined() {}

#[test]
#[ignore = "not ported yet"]
fn a_connection_with_no_verified_actor_is_never_reported() {}

#[test]
#[ignore = "not ported yet"]
fn an_activity_frame_reports_active_with_the_document_and_the_server_clock() {}

#[test]
#[ignore = "not ported yet"]
fn active_and_edited_share_one_minute_window_per_actor() {}

#[test]
#[ignore = "not ported yet"]
fn a_heartbeat_arriving_just_under_the_clients_minute_is_still_reported() {}

#[test]
#[ignore = "not ported yet"]
fn join_and_leave_are_never_suppressed() {}

#[test]
#[ignore = "not ported yet"]
fn a_reader_that_never_edits_is_reported_joined_then_left() {}

#[test]
#[ignore = "not ported yet"]
fn a_throwing_observer_is_logged_and_neither_closes_the_room_nor_stalls_it() {}

#[test]
#[ignore = "not ported yet"]
fn an_observer_still_inside_record_async_does_not_hold_the_lane() {}

#[test]
#[ignore = "not ported yet"]
fn a_drain_abandons_an_activity_observer_that_never_completes() {}

#[test]
#[ignore = "not ported yet"]
fn a_drain_already_cancelled_does_not_wait_out_the_activity_observer() {}

#[test]
#[ignore = "not ported yet"]
fn a_heartbeat_flood_is_dropped_before_a_session_boundary() {}

#[test]
#[ignore = "not ported yet"]
fn a_room_that_closes_on_a_commit_failure_reports_left_for_every_member() {}

#[test]
#[ignore = "not ported yet"]
fn a_drain_reports_left_for_every_verified_member_it_still_held() {}

#[test]
#[ignore = "not ported yet"]
fn a_member_that_left_is_not_reported_left_again_when_the_room_closes() {}

#[test]
#[ignore = "not ported yet"]
fn an_expelled_member_is_reported_left_exactly_once() {}

#[test]
#[ignore = "not ported yet"]
fn an_expelled_member_with_no_verified_actor_is_never_reported() {}

#[test]
#[ignore = "not ported yet"]
fn an_actor_inside_its_window_is_still_suppressed_after_a_sweep() {}

#[test]
#[ignore = "not ported yet"]
fn distinct_actors_across_two_windows_leave_the_stamp_map_bounded() {}

#[test]
#[ignore = "not ported yet"]
fn a_stamp_exactly_one_window_old_is_swept() {}

#[test]
#[ignore = "not ported yet"]
fn a_join_and_leave_after_the_limit_still_sweeps_the_inert_stamps() {}

#[test]
#[ignore = "not ported yet"]
fn with_no_observer_an_activity_frame_changes_nothing() {}

#[test]
#[ignore = "not ported yet"]
fn reset_settles_an_in_flight_write_so_it_cannot_overtake_the_reset() {}

#[test]
#[ignore = "not ported yet"]
fn dispose_is_idempotent() {}

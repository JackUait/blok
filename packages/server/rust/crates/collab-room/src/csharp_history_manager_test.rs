// Twins of the C# CollabHistoryManagerTests.cs cases with no Go twin.

#[test]
#[ignore = "not ported yet"]
fn without_a_history_store_every_method_answers_no_history() {}

#[test]
#[ignore = "not ported yet"]
fn the_list_groups_every_lineage_newest_first() {}

#[test]
#[ignore = "not ported yet"]
fn a_group_window_replaces_the_default_grouping() {}

#[test]
#[ignore = "not ported yet"]
fn a_read_answers_the_export_at_that_point_with_its_time() {}

#[test]
#[ignore = "not ported yet"]
fn changes_list_each_record_after_since_through_the_point_oldest_first() {}

#[test]
#[ignore = "not ported yet"]
fn changes_of_an_empty_range_are_empty() {}

#[test]
#[ignore = "not ported yet"]
fn changes_past_the_cap_are_the_newest_and_say_so() {}

#[test]
#[ignore = "not ported yet"]
fn changes_past_the_byte_budget_are_the_newest_and_say_so() {}

#[test]
#[ignore = "not ported yet"]
fn changes_of_an_unknown_point_are_not_found() {}

#[test]
#[ignore = "not ported yet"]
fn a_baseline_with_an_unknown_created_at_has_no_time() {}

#[test]
#[ignore = "not ported yet"]
fn a_version_read_carries_the_page_maps_and_omits_empty_ones() {}

#[test]
#[ignore = "not ported yet"]
fn a_version_read_skips_an_icon_that_is_not_json() {}

#[test]
#[ignore = "not ported yet"]
fn an_unknown_point_is_not_found() {}

#[test]
#[ignore = "not ported yet"]
fn a_purged_document_answers_purged_from_every_method() {}

#[test]
#[ignore = "not ported yet"]
fn a_fresh_manager_sees_a_purge_from_an_earlier_process() {}

#[test]
#[ignore = "not ported yet"]
fn an_unreadable_lineage_list_is_corrupt() {}

#[test]
#[ignore = "not ported yet"]
fn a_corrupt_record_is_corrupt() {}

#[test]
#[ignore = "not ported yet"]
fn a_restore_makes_the_live_document_equal_the_point_as_one_journalled_edit() {}

#[test]
#[ignore = "not ported yet"]
fn a_restore_reaches_a_lineage_a_reset_replaced() {}

#[test]
#[ignore = "not ported yet"]
fn a_retried_restore_gets_the_first_receipt() {}

#[test]
#[ignore = "not ported yet"]
fn a_retry_after_its_lineage_was_deleted_gets_the_first_receipt() {}

#[test]
#[ignore = "not ported yet"]
fn the_gate_measures_the_frame_the_live_apply_broadcasts() {}

#[test]
#[ignore = "not ported yet"]
fn document_replaced_fires_on_a_reset_an_applied_restore_and_a_purge_only() {}

#[test]
#[ignore = "not ported yet"]
fn a_stale_precondition_refuses_the_restore() {}

#[test]
#[ignore = "not ported yet"]
fn a_stale_precondition_wins_over_a_missing_point() {}

#[test]
#[ignore = "not ported yet"]
fn a_restore_too_large_for_one_frame_changes_nothing() {}

#[test]
#[ignore = "not ported yet"]
fn a_restore_past_the_store_limit_but_under_the_message_limit_is_refused_and_the_room_stays_open() {
}

#[test]
#[ignore = "not ported yet"]
fn a_restore_just_under_the_frame_limit_is_applied() {}

#[test]
#[ignore = "not ported yet"]
fn a_restore_of_the_current_point_writes_nothing() {}

#[test]
#[ignore = "not ported yet"]
fn a_restore_brings_back_the_title_with_the_blocks_in_one_record() {}

#[test]
#[ignore = "not ported yet"]
fn a_restore_whose_title_is_too_large_for_one_frame_changes_nothing() {}

#[test]
#[ignore = "not ported yet"]
fn a_delete_refuses_the_current_lineage_and_removes_an_old_one() {}

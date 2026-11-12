fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&[
                "close_editor_window", "load_cloud_session", "save_cloud_session", "load_workspace_file", "save_workspace_file", "workspace_data_directory",
                "agent_provider_status", "agent_ask", "agent_cancel",
                "ai_local_status", "ai_local_save", "ai_local_delete", "ai_local_models", "ai_local_respond", "ai_local_cancel",
            ])),
    )
    .expect("failed to run tauri build script");
}

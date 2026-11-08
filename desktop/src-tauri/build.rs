fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&[
                "close_editor_window", "load_workspace_file", "save_workspace_file", "workspace_data_directory",
                "agent_provider_status", "agent_ask",
            ])),
    )
    .expect("failed to run tauri build script");
}

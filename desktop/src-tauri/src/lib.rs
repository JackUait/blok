use tauri::menu::{
    HELP_SUBMENU_ID, Menu, MenuItem, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID,
};
use tauri::{Manager, Runtime};
use std::path::PathBuf;
use std::io::Write;
use std::process::{Command, Stdio};

fn workspace_file(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    if !name.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-') || name.is_empty() {
        return Err("Invalid document id".into());
    }
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?.join("workspace");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(format!("{name}.json")))
}

#[tauri::command]
fn load_workspace_file(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let path = workspace_file(&app, &name)?;
    match std::fs::read_to_string(path) {
        Ok(data) => Ok(Some(data)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn save_workspace_file(app: tauri::AppHandle, name: String, data: String) -> Result<(), String> {
    let path = workspace_file(&app, &name)?;
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, data).map_err(|error| error.to_string())?;
    std::fs::rename(temp, path).map_err(|error| error.to_string())
}

#[tauri::command]
fn workspace_data_directory(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?.join("workspace");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

fn agent_binary(provider: &str) -> Result<PathBuf, String> {
    if provider != "codex" && provider != "claude" {
        return Err("Unknown AI provider".into());
    }
    let mut directories: Vec<PathBuf> = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    if let Some(home) = std::env::var_os("HOME") {
        directories.push(PathBuf::from(home).join(".asdf/shims"));
    }
    directories.extend([PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")]);
    directories.into_iter().map(|dir| dir.join(provider)).find(|path| path.is_file())
        .ok_or_else(|| format!("{provider} is not installed"))
}

fn agent_command(binary: &PathBuf) -> Command {
    let mut command = Command::new(binary);
    let mut paths: Vec<PathBuf> = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    paths.extend([PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin"), PathBuf::from("/usr/bin"), PathBuf::from("/bin")]);
    if let Some(home) = std::env::var_os("HOME") {
        paths.push(PathBuf::from(home).join(".asdf/shims"));
    }
    if let Ok(value) = std::env::join_paths(paths) {
        command.env("PATH", value);
    }
    command
}

#[derive(serde::Serialize)]
struct AgentProviderStatus {
    provider: String,
    installed: bool,
    connected: bool,
    version: String,
}

#[tauri::command]
async fn agent_provider_status(provider: String) -> Result<AgentProviderStatus, String> {
    tauri::async_runtime::spawn_blocking(move || provider_status_blocking(provider))
        .await.map_err(|error| error.to_string())?
}

fn provider_status_blocking(provider: String) -> Result<AgentProviderStatus, String> {
    let binary = match agent_binary(&provider) {
        Ok(path) => path,
        Err(_) if provider == "codex" || provider == "claude" => return Ok(AgentProviderStatus {
            provider, installed: false, connected: false, version: String::new(),
        }),
        Err(error) => return Err(error),
    };
    let version = agent_command(&binary).arg("--version").output().map_err(|error| error.to_string())?;
    let version = String::from_utf8_lossy(&version.stdout).trim().to_string();
    let args: &[&str] = if provider == "codex" { &["login", "status"] } else { &["auth", "status", "--json"] };
    let login = agent_command(&binary).args(args).output().map_err(|error| error.to_string())?;
    let output = format!("{}{}", String::from_utf8_lossy(&login.stdout), String::from_utf8_lossy(&login.stderr));
    let connected = login.status.success() && if provider == "codex" {
        output.to_ascii_lowercase().contains("logged in") && !output.to_ascii_lowercase().contains("not logged in")
    } else {
        output.contains("\"loggedIn\": true") || output.contains("\"loggedIn\":true")
    };
    Ok(AgentProviderStatus { provider, installed: true, connected, version })
}

#[tauri::command]
async fn agent_ask(provider: String, question: String, page_text: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || ask_blocking(provider, question, page_text))
        .await.map_err(|error| error.to_string())?
}

fn ask_blocking(provider: String, question: String, page_text: String) -> Result<String, String> {
    if question.trim().is_empty() { return Err("Question vide".into()); }
    if question.len() > 20_000 || page_text.len() > 100_000 { return Err("Texte trop long".into()); }
    let status = provider_status_blocking(provider.clone())?;
    if !status.connected { return Err(format!("{provider} n’est pas connecté")); }
    let binary = agent_binary(&provider)?;
    let prompt = format!("You are the writing assistant beside a Blok page. Reply in the user's language, in plain text. Do not claim to have edited the page.\n\nPage content:\n<page>\n{page_text}\n</page>\n\nUser request:\n{question}");
    let temp = std::env::temp_dir().join(format!("blok-agent-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|error| error.to_string())?.as_nanos()));
    std::fs::create_dir(&temp).map_err(|error| error.to_string())?;
    let response = (|| -> Result<String, String> {
        let mut command = agent_command(&binary);
        if provider == "codex" {
            command.args(["exec", "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check", "-C"])
                .arg(&temp).arg("--output-last-message").arg(temp.join("answer.txt")).arg("-");
        } else {
            command.args(["--print", "--tools", "", "--permission-mode", "dontAsk", "--no-session-persistence", "--output-format", "json"]);
        }
        let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .spawn().map_err(|error| error.to_string())?;
        child.stdin.take().ok_or("AI input unavailable")?.write_all(prompt.as_bytes()).map_err(|error| error.to_string())?;
        let output = child.wait_with_output().map_err(|error| error.to_string())?;
        if !output.status.success() { return Err("L’agent IA n’a pas pu répondre. Vérifie sa connexion dans les réglages.".into()); }
        if provider == "codex" {
            return std::fs::read_to_string(temp.join("answer.txt")).map_err(|error| error.to_string());
        }
        let value: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
        value.get("result").and_then(|result| result.as_str()).map(str::to_owned).ok_or("Réponse vide".into())
    })();
    let _ = std::fs::remove_dir_all(temp);
    response
}

#[tauri::command]
fn close_editor_window(window: tauri::WebviewWindow) {
    let _ = window.close();
}

fn editor_menu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let new_tab = MenuItem::with_id(app, "new-tab", "New Tab", true, Some("CmdOrCtrl+T"))?;
    let close_tab = MenuItem::with_id(app, "close-tab", "Close Tab", true, Some("CmdOrCtrl+W"))?;
    let file = Submenu::with_items(app, "File", true, &[&new_tab, &close_tab])?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window_menu = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
        ],
    )?;
    let help = Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "Help", true, &[])?;

    #[cfg(target_os = "macos")]
    {
        use tauri::menu::AboutMetadata;
        let pkg = app.package_info();
        let config = app.config();
        let about = AboutMetadata {
            name: Some(pkg.name.clone()),
            version: Some(pkg.version.to_string()),
            copyright: config.bundle.copyright.clone(),
            authors: config
                .bundle
                .publisher
                .clone()
                .map(|publisher| vec![publisher]),
            ..Default::default()
        };
        let app_menu = Submenu::with_items(
            app,
            pkg.name.clone(),
            true,
            &[
                &PredefinedMenuItem::about(app, None, Some(about))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?;
        let view = Submenu::with_items(
            app,
            "View",
            true,
            &[&PredefinedMenuItem::fullscreen(app, None)?],
        )?;
        return Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window_menu, &help]);
    }

    #[cfg(not(target_os = "macos"))]
    Menu::with_items(app, &[&file, &edit, &window_menu, &help])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(|app| editor_menu(app))
        .on_menu_event(|app, event| {
            let script = match event.id().as_ref() {
                "new-tab" => "window.dispatchEvent(new Event('blok:desktop-new-tab'))",
                "close-tab" => "window.dispatchEvent(new Event('blok:desktop-close-tab'))",
                _ => return,
            };
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval(script);
            }
        })
        .invoke_handler(tauri::generate_handler![close_editor_window, load_workspace_file, save_workspace_file, workspace_data_directory, agent_provider_status, agent_ask])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

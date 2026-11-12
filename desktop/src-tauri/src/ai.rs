//! Personal OpenAI credentials for local workspaces. No cloud credential fallback.
//! The selected model and key share a separate OS-secret-store entry; IPC never returns the key.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeSet, HashMap},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::oneshot;

const KEYCHAIN_SERVICE: &str = "dev.notiooon.blok.ai";
const KEYCHAIN_ACCOUNT: &str = "openai-personal";
const MODELS_URL: &str = "https://api.openai.com/v1/models";
const RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const MAX_INPUT: usize = 64 * 1024;
const MAX_SYSTEM: usize = 16 * 1024;
const MAX_MESSAGES: usize = 32;
const MAX_BODY: usize = 2 * 1024 * 1024;
const MAX_TEXT: usize = 64 * 1024;
const MAX_OUTPUT_TOKENS: usize = 4096;
const MAX_CONCURRENT: usize = 2;
const MAX_PER_MINUTE: usize = 30;

#[derive(Default, Deserialize, Serialize)]
struct Credential {
    api_key: String,
    model: String,
}
#[derive(Serialize)]
pub struct AiStatus {
    configured: bool,
    model: String,
}
#[derive(Deserialize)]
pub struct AiMessage {
    role: String,
    content: String,
}
#[derive(Serialize)]
pub struct AiModel {
    id: String,
}
#[derive(Serialize)]
pub struct AiModels {
    models: Vec<AiModel>,
}
#[derive(Serialize)]
pub struct AiResponse {
    text: String,
    model: String,
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|_| "Le trousseau système est indisponible.".into())
}
fn credential() -> Result<Credential, String> {
    match entry()?.get_password() {
        Ok(value) => serde_json::from_str(&value).map_err(|_| {
            "La configuration OpenAI locale est illisible. Supprimez-la puis ajoutez votre clé."
                .into()
        }),
        Err(keyring::Error::NoEntry) => Ok(Credential::default()),
        Err(_) => Err("Le trousseau système est verrouillé ou inaccessible.".into()),
    }
}
fn model_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-._:/".contains(&b))
}
/// Same conservative text-model filter as the cloud API; inventory always comes from /models.
fn text_model(value: &str) -> bool {
    if !model_id(value) {
        return false;
    }
    let id = value.to_ascii_lowercase();
    if [
        "embedding",
        "tts",
        "audio",
        "whisper",
        "image",
        "dall-e",
        "realtime",
        "transcrib",
        "transcrip",
        "moderation",
        "sora",
    ]
    .iter()
    .any(|part| id.contains(part))
    {
        return false;
    }
    let base = id.strip_prefix("ft:").unwrap_or(&id);
    base.starts_with("gpt-")
        || (base.starts_with('o')
            && base
                .as_bytes()
                .get(1)
                .is_some_and(|b| matches!(b, b'1'..=b'9')))
}
fn update_credential(
    mut current: Credential,
    api_key: Option<String>,
    model: Option<String>,
) -> Result<Credential, String> {
    if let Some(key) = api_key {
        let key = key.trim();
        // Empty password fields mean "keep the existing key"; deletion is explicit.
        if !key.is_empty() {
            if key.len() < 16 || key.len() > 4096 || !key.bytes().all(|b| b.is_ascii_graphic()) {
                return Err("La clé API n’est pas valide.".into());
            }
            current.api_key = key.to_owned();
        }
    }
    if let Some(model) = model {
        let model = model.trim();
        if !model.is_empty() && !text_model(model) {
            return Err("Choisissez un modèle de texte disponible dans votre compte.".into());
        }
        current.model = model.to_owned();
    }
    if current.api_key.is_empty() {
        return Err("Ajoutez d’abord votre clé API OpenAI.".into());
    }
    Ok(current)
}
#[tauri::command]
pub fn ai_local_status() -> Result<AiStatus, String> {
    let config = credential()?;
    Ok(AiStatus {
        configured: !config.api_key.is_empty(),
        model: config.model,
    })
}
#[tauri::command]
pub fn ai_local_save(api_key: Option<String>, model: Option<String>) -> Result<(), String> {
    let config = update_credential(credential()?, api_key, model)?;
    let encoded = serde_json::to_string(&config)
        .map_err(|_| "Impossible de préparer la configuration OpenAI.")?;
    entry()?
        .set_password(&encoded)
        .map_err(|_| "Impossible d’enregistrer la clé dans le trousseau système.".into())
}
#[tauri::command]
pub fn ai_local_delete() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Impossible de supprimer la clé du trousseau système.".into()),
    }
}
fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .user_agent("BlokDesktop")
        .build()
        .map_err(|_| "Impossible d’initialiser la connexion OpenAI.".into())
}
fn status_error(status: u16) -> String {
    match status {
        401 => "La clé API OpenAI est refusée. Vérifiez-la dans les paramètres.",
        403 => "Ce compte OpenAI n’a pas accès à cette demande.",
        404 => "Ce modèle OpenAI n’est pas disponible pour ce compte.",
        400 | 422 => "OpenAI refuse cette demande. Vérifiez le modèle choisi et réduisez le contexte si nécessaire.",
        429 => "Le quota ou la limite de débit OpenAI est atteint. Vérifiez votre compte puis réessayez.",
        500..=599 => "OpenAI est temporairement indisponible. Réessayez plus tard.",
        _ => "La demande OpenAI n’a pas pu aboutir.",
    }.into()
}
async fn bounded_json(mut response: reqwest::Response) -> Result<Value, String> {
    if !response.status().is_success() {
        return Err(status_error(response.status().as_u16()));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_BODY as u64)
    {
        return Err("La réponse OpenAI dépasse la taille autorisée.".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "La connexion OpenAI a été interrompue.")?
    {
        if body.len().saturating_add(chunk.len()) > MAX_BODY {
            return Err("La réponse OpenAI dépasse la taille autorisée.".into());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| "OpenAI a renvoyé une réponse illisible.".into())
}
fn parse_models(data: &Value) -> Result<AiModels, String> {
    let rows = data
        .get("data")
        .and_then(Value::as_array)
        .ok_or("OpenAI a renvoyé une liste de modèles illisible.")?;
    let mut ids = BTreeSet::new();
    for row in rows {
        if let Some(id) = row
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| text_model(id))
        {
            ids.insert(id.to_owned());
        }
    }
    Ok(AiModels {
        models: ids
            .into_iter()
            .take(1000)
            .map(|id| AiModel { id })
            .collect(),
    })
}
#[tauri::command]
pub async fn ai_local_models(state: tauri::State<'_, LocalAiRuns>) -> Result<AiModels, String> {
    let config = credential()?;
    if config.api_key.is_empty() {
        return Err("Ajoutez d’abord votre clé API OpenAI.".into());
    }
    state.charge()?;
    let response = http_client()?
        .get(MODELS_URL)
        .bearer_auth(&config.api_key)
        .send()
        .await
        .map_err(|_| "Impossible de joindre OpenAI. Vérifiez votre connexion.")?;
    parse_models(&bounded_json(response).await?)
}
fn request_body(model: &str, system: &str, messages: &[AiMessage]) -> Result<Value, String> {
    if !text_model(model) {
        return Err("Choisissez un modèle de texte disponible dans votre compte.".into());
    }
    if system.len() > MAX_SYSTEM || messages.is_empty() || messages.len() > MAX_MESSAGES {
        return Err("Le contexte est trop volumineux pour cette demande OpenAI.".into());
    }
    let mut total = system.len();
    for item in messages {
        if !matches!(item.role.as_str(), "user" | "assistant") {
            return Err("Le format de la conversation n’est pas valide.".into());
        }
        total = total.saturating_add(item.content.len());
        if total > MAX_INPUT {
            return Err("Le contexte est trop volumineux pour cette demande OpenAI.".into());
        }
    }
    if !messages
        .iter()
        .any(|item| item.role == "user" && !item.content.trim().is_empty())
    {
        return Err("Saisissez une demande avant de lancer l’assistant.".into());
    }
    let input: Vec<Value> = messages
        .iter()
        .map(|item| json!({"role":item.role,"content":item.content}))
        .collect();
    Ok(
        json!({"model":model,"instructions":system,"input":input,"store":false,"stream":false,"max_output_tokens":MAX_OUTPUT_TOKENS}),
    )
}
fn local_request(
    config: &Credential,
    model: &str,
    system: &str,
    messages: &[AiMessage],
) -> Result<Value, String> {
    let body = request_body(model, system, messages)?;
    if config.api_key.is_empty() {
        return Err("Ajoutez d’abord votre clé API OpenAI.".into());
    }
    // The saved model is a UI default, never a restriction on an explicit picker choice.
    Ok(body)
}
fn parse_response(data: &Value) -> Result<AiResponse, String> {
    if data.get("status").and_then(Value::as_str) != Some("completed") {
        return Err("La réponse OpenAI est incomplète. Réduisez la demande puis réessayez.".into());
    }
    let model = data
        .get("model")
        .and_then(Value::as_str)
        .filter(|id| model_id(id))
        .ok_or("Le modèle de la réponse OpenAI est illisible.")?;
    let output = data
        .get("output")
        .and_then(Value::as_array)
        .ok_or("La réponse OpenAI ne contient pas de texte.")?;
    let mut texts = Vec::new();
    let mut length: usize = 0;
    for item in output {
        if item.get("type").and_then(Value::as_str) != Some("message")
            || item.get("role").and_then(Value::as_str) != Some("assistant")
        {
            continue;
        }
        if let Some(content) = item.get("content").and_then(Value::as_array) {
            for part in content {
                if part.get("type").and_then(Value::as_str) != Some("output_text") {
                    continue;
                }
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    length = length.saturating_add(text.len()).saturating_add(1);
                    if length > MAX_TEXT {
                        return Err("Le texte OpenAI dépasse la taille autorisée.".into());
                    }
                    texts.push(text.to_owned());
                }
            }
        }
    }
    let text = texts.join("\n");
    if text.trim().is_empty() {
        return Err("La réponse OpenAI ne contient pas de texte.".into());
    }
    Ok(AiResponse {
        text,
        model: model.to_owned(),
    })
}
#[derive(Default)]
struct RunState {
    active: HashMap<String, Option<oneshot::Sender<()>>>,
    recent: Vec<Instant>,
    early_cancellations: HashMap<String, Instant>,
}
#[derive(Clone, Default)]
pub struct LocalAiRuns(Arc<Mutex<RunState>>);
struct RunGuard {
    state: LocalAiRuns,
    id: String,
}
impl Drop for RunGuard {
    fn drop(&mut self) {
        if let Ok(mut state) = self.state.0.lock() {
            state.active.remove(&self.id);
        }
    }
}
fn run_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
}
fn charge_budget(state: &mut RunState) -> Result<(), String> {
    state
        .recent
        .retain(|time| time.elapsed() < Duration::from_secs(60));
    if state.recent.len() >= MAX_PER_MINUTE {
        return Err(
            "La limite locale de demandes OpenAI est atteinte. Réessayez dans une minute.".into(),
        );
    }
    state.recent.push(Instant::now());
    Ok(())
}
impl LocalAiRuns {
    fn charge(&self) -> Result<(), String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "L’assistant local est indisponible.")?;
        charge_budget(&mut state)
    }
    fn register(&self, id: String) -> Result<(oneshot::Receiver<()>, RunGuard), String> {
        if !run_id(&id) {
            return Err("L’identifiant de demande n’est pas valide.".into());
        }
        let mut state = self
            .0
            .lock()
            .map_err(|_| "L’assistant local est indisponible.")?;
        state
            .early_cancellations
            .retain(|_, time| time.elapsed() < Duration::from_secs(60));
        if state.early_cancellations.remove(&id).is_some() {
            return Err("Demande OpenAI annulée.".into());
        }
        if state.active.contains_key(&id) {
            return Err("Cette demande est déjà en cours.".into());
        }
        if state.active.len() >= MAX_CONCURRENT {
            return Err(
                "Deux demandes OpenAI sont déjà en cours. Attendez ou annulez-en une.".into(),
            );
        }
        charge_budget(&mut state)?;
        let (send, receive) = oneshot::channel();
        state.active.insert(id.clone(), Some(send));
        Ok((
            receive,
            RunGuard {
                state: self.clone(),
                id,
            },
        ))
    }
    fn cancel(&self, id: &str) -> Result<(), String> {
        if !run_id(id) {
            return Err("L’identifiant de demande n’est pas valide.".into());
        }
        let mut state = self
            .0
            .lock()
            .map_err(|_| "L’assistant local est indisponible.")?;
        if let Some(slot) = state.active.get_mut(id) {
            if let Some(sender) = slot.take() {
                let _ = sender.send(());
            }
        } else {
            state
                .early_cancellations
                .retain(|_, time| time.elapsed() < Duration::from_secs(60));
            if state.early_cancellations.len() >= 256 {
                if let Some(oldest) = state
                    .early_cancellations
                    .iter()
                    .min_by_key(|(_, time)| *time)
                    .map(|(id, _)| id.clone())
                {
                    state.early_cancellations.remove(&oldest);
                }
            }
            state
                .early_cancellations
                .insert(id.to_owned(), Instant::now());
        }
        Ok(())
    }
}
#[tauri::command]
pub fn ai_local_cancel(run_id: String, state: tauri::State<'_, LocalAiRuns>) -> Result<(), String> {
    state.cancel(&run_id)
}
#[tauri::command]
pub async fn ai_local_respond(
    model: String,
    system: String,
    messages: Vec<AiMessage>,
    run_id: String,
    state: tauri::State<'_, LocalAiRuns>,
) -> Result<AiResponse, String> {
    let config = credential()?;
    let body = local_request(&config, &model, &system, &messages)?;
    let (cancelled, _guard) = state.register(run_id)?;
    let client = http_client()?;
    // Cancellation drops the HTTP future and connection; store:false is set in the payload.
    tokio::select! {
        biased;
        _ = cancelled => Err("Demande OpenAI annulée.".into()),
        result = async {
            let response = client.post(RESPONSES_URL).bearer_auth(&config.api_key).json(&body).send().await
                .map_err(|_| "Impossible de joindre OpenAI ou délai de réponse dépassé.")?;
            parse_response(&bounded_json(response).await?)
        } => result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> Vec<AiMessage> {
        vec![AiMessage {
            role: "user".into(),
            content: "Bonjour".into(),
        }]
    }
    #[test]
    fn payload_is_stateless_bounded_and_keeps_roles() {
        let body = request_body("gpt-example", "Instructions", &sample()).unwrap();
        assert_eq!(body["store"], false);
        assert_eq!(body["stream"], false);
        assert_eq!(body["max_output_tokens"], 4096);
        assert_eq!(body["instructions"], "Instructions");
        assert_eq!(body["input"][0]["role"], "user");
        assert!(body.get("api_key").is_none());
    }
    #[test]
    fn explicit_picker_model_overrides_saved_default_without_changing_it() {
        let config = Credential {
            api_key: "example-test-secret".into(),
            model: "gpt-saved".into(),
        };
        let body = local_request(&config, "o3-picked", "", &sample()).unwrap();
        assert_eq!(body["model"], "o3-picked");
        assert_eq!(config.model, "gpt-saved");
        assert!(local_request(&config, "", "", &sample()).is_err());
        assert!(local_request(&Credential::default(), "gpt-picked", "", &sample()).is_err());
    }
    #[test]
    fn input_bounds_and_untrusted_roles_are_rejected() {
        assert!(request_body("gpt-example", &"x".repeat(MAX_SYSTEM + 1), &sample()).is_err());
        assert!(
            request_body(
                "gpt-example",
                "",
                &[AiMessage {
                    role: "system".into(),
                    content: "x".into()
                }]
            )
            .is_err()
        );
        assert!(
            request_body(
                "gpt-example",
                "",
                &[AiMessage {
                    role: "user".into(),
                    content: "x".repeat(MAX_INPUT + 1)
                }]
            )
            .is_err()
        );
        assert!(request_body("", "", &sample()).is_err());
    }
    #[test]
    fn models_are_real_inventory_sorted_and_text_filtered() {
        let models = parse_models(&json!({"data":[{"id":"gpt-example-b"},{"id":"o3-example"},{"id":"gpt-example-b"},{"id":"text-embedding-example"},{"id":"gpt-audio-example"},{"id":"gpt-image-example"},{"id":"gpt-transcription-example"}]})).unwrap();
        assert_eq!(
            models
                .models
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["gpt-example-b", "o3-example"]
        );
    }
    #[test]
    fn response_reads_only_assistant_output_text() {
        let response = parse_response(&json!({"status":"completed","model":"gpt-example","output":[{"type":"reasoning","content":[{"type":"output_text","text":"hidden"}]},{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Bonjour"},{"type":"refusal","refusal":"ignore"},{"type":"output_text","text":"Suite"}]}]})).unwrap();
        assert_eq!(response.text, "Bonjour\nSuite");
        assert_eq!(response.model, "gpt-example");
        assert!(
            parse_response(&json!({"status":"incomplete","model":"gpt-example","output":[]}))
                .is_err()
        );
    }
    #[test]
    fn storage_and_status_do_not_expose_keys_or_share_cloud_scope() {
        assert_ne!(KEYCHAIN_SERVICE, "dev.notiooon.blok.cloud");
        let config = update_credential(
            Credential {
                api_key: "example-test-secret".into(),
                model: "gpt-example".into(),
            },
            Some("".into()),
            Some("o3-example".into()),
        )
        .unwrap();
        assert_eq!(config.api_key, "example-test-secret");
        let status = serde_json::to_string(&AiStatus {
            configured: true,
            model: config.model,
        })
        .unwrap();
        assert!(!status.contains("secret"));
        assert!(!status.contains("api_key"));
        assert!(
            update_credential(Credential::default(), None, Some("gpt-example".into())).is_err()
        );
    }
    #[tokio::test]
    async fn cancellation_is_idempotent_reserved_until_run_finishes_and_cleans_up() {
        let state = LocalAiRuns::default();
        let (receive, guard) = state.register("test-run".into()).unwrap();
        state.cancel("test-run").unwrap();
        state.cancel("test-run").unwrap();
        assert!(receive.await.is_ok());
        assert!(state.register("test-run".into()).is_err());
        drop(guard);
        assert!(state.register("test-run".into()).is_ok());
    }
    #[test]
    fn cancellation_before_registration_does_not_start_or_spend_a_request() {
        let state = LocalAiRuns::default();
        state.cancel("early").unwrap();
        assert!(state.register("early".into()).is_err());
        assert!(state.0.lock().unwrap().recent.is_empty());
        assert!(state.cancel(&"x".repeat(129)).is_err());
    }
    #[test]
    fn active_and_minute_budgets_are_bounded() {
        let state = LocalAiRuns::default();
        let (_a, ga) = state.register("a".into()).unwrap();
        let (_b, gb) = state.register("b".into()).unwrap();
        assert!(state.register("c".into()).is_err());
        drop(ga);
        drop(gb);
        state.0.lock().unwrap().recent = vec![Instant::now(); MAX_PER_MINUTE];
        assert!(state.register("next".into()).is_err());
    }
    #[test]
    fn upstream_errors_are_sanitized() {
        for code in [400, 401, 403, 404, 429, 500, 599] {
            let error = status_error(code);
            assert!(!error.contains("Bearer"));
            assert!(!error.contains("https://"));
        }
    }
}

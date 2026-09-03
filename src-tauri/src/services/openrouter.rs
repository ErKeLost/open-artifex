use reqwest::header::{HeaderMap, HeaderValue};
use serde::Deserialize;

use crate::types::{OpenRouterModel, OpenRouterModelReasoning};

const MODELS_URL: &str = "https://openrouter.ai/api/v1/models";

#[derive(Deserialize)]
struct ModelsResponse {
    #[serde(default)]
    data: Vec<ModelResponse>,
}

#[derive(Deserialize)]
struct ModelResponse {
    id: String,
    name: String,
    #[serde(default)]
    context_length: Option<u64>,
    #[serde(default)]
    architecture: ArchitectureResponse,
    #[serde(default)]
    supported_parameters: Vec<String>,
    reasoning: Option<ReasoningResponse>,
}

#[derive(Default, Deserialize)]
struct ArchitectureResponse {
    #[serde(default)]
    input_modalities: Vec<String>,
    #[serde(default)]
    output_modalities: Vec<String>,
}

#[derive(Deserialize)]
struct ReasoningResponse {
    #[serde(default)]
    mandatory: bool,
    #[serde(default)]
    supported_efforts: Vec<String>,
    default_effort: Option<String>,
}

/// Fetches the public OpenRouter directory. The optional bearer token lets
/// OpenRouter apply account-level availability while never exposing it to UI.
pub async fn models(api_key: Option<String>) -> Result<Vec<OpenRouterModel>, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "HTTP-Referer",
        HeaderValue::from_static("https://github.com/ErKeLost/open-artifex"),
    );
    headers.insert("X-Title", HeaderValue::from_static("Open Artifex"));

    let client = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|error| error.to_string())?;
    let request = client.get(MODELS_URL);
    let request = match api_key {
        Some(api_key) => request.bearer_auth(api_key),
        None => request,
    };
    let response = request.send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "OpenRouter model catalog request failed ({})",
            response.status()
        ));
    }

    let body = response.text().await.map_err(|error| error.to_string())?;
    let payload: ModelsResponse = serde_json::from_str(&body).map_err(|error| error.to_string())?;
    let mut models = payload
        .data
        .into_iter()
        .filter(|model| !model.id.trim().is_empty() && !model.name.trim().is_empty())
        .map(|model| OpenRouterModel {
            id: model.id,
            name: model.name,
            context_length: model.context_length,
            input_modalities: model.architecture.input_modalities,
            output_modalities: model.architecture.output_modalities,
            supported_parameters: model.supported_parameters,
            reasoning: model.reasoning.map(|reasoning| OpenRouterModelReasoning {
                mandatory: reasoning.mandatory,
                supported_efforts: reasoning.supported_efforts,
                default_effort: reasoning.default_effort,
            }),
        })
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(models)
}

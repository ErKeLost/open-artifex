/**
 * Public model metadata returned by OpenRouter. Credentials never cross this
 * boundary; the Tauri process fetches this catalog and exposes only metadata.
 */

export type OpenRouterReasoningEffort = string;

export interface OpenRouterModelReasoning {
  mandatory: boolean;
  supportedEfforts: OpenRouterReasoningEffort[];
  defaultEffort?: OpenRouterReasoningEffort;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength?: number;
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters: string[];
  reasoning?: OpenRouterModelReasoning;
}

export interface OpenRouterModelCatalog {
  models: OpenRouterModel[];
  fetchedAt: number;
}

/** Models that can receive text and return text, including vision/audio/file
 * capable variants. Image-only and other non-conversational models are left
 * out of the conversation model picker. */
export function supportsTextConversation(model: OpenRouterModel): boolean {
  const input = model.inputModalities.map((item) => item.toLocaleLowerCase());
  const output = model.outputModalities.map((item) => item.toLocaleLowerCase());
  return input.includes("text") && output.includes("text");
}

export function supportsMultimodalInput(model: OpenRouterModel): boolean {
  return model.inputModalities.some(
    (modality) => modality.toLocaleLowerCase() !== "text",
  );
}

export function supportsReasoningEffort(
  model: OpenRouterModel | undefined,
): model is OpenRouterModel & { reasoning: OpenRouterModelReasoning } {
  return Boolean(model?.reasoning?.supportedEfforts.length);
}

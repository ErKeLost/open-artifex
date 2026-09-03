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

export function supportsReasoningEffort(
  model: OpenRouterModel | undefined,
): model is OpenRouterModel & { reasoning: OpenRouterModelReasoning } {
  return Boolean(model?.reasoning?.supportedEfforts.length);
}

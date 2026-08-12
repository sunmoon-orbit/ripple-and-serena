export const DEFAULT_MAX_OUTPUT_TOKENS = 4096
export const MIN_MAX_OUTPUT_TOKENS = 256
export const MAX_MAX_OUTPUT_TOKENS = 32000

export function normalizeMaxOutputTokens(value, fallback = DEFAULT_MAX_OUTPUT_TOKENS) {
  const fallbackNumber = Number(fallback)
  const safeFallback = Number.isFinite(fallbackNumber) && fallbackNumber > 0
    ? Math.trunc(fallbackNumber)
    : DEFAULT_MAX_OUTPUT_TOKENS
  const parsed = Number(value)
  const requested = Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : safeFallback
  return Math.min(MAX_MAX_OUTPUT_TOKENS, Math.max(MIN_MAX_OUTPUT_TOKENS, requested))
}

export function normalizeGenerationConfig(config) {
  const source = config && typeof config === 'object' ? config : {}
  return { ...source, maxTokens: normalizeMaxOutputTokens(source.maxTokens) }
}

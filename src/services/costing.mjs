export const MODEL_PRICING_USD_PER_1M = {
  'gpt-5.5': { input: 5.00, cached_input: 0.50, output: 30.00 },
  'gpt-5.4': { input: 3.00, cached_input: 0.30, output: 15.00 },
  'gpt-5.4-mini': { input: 0.80, cached_input: 0.08, output: 4.00 },
  'gpt-5.3-codex': { input: 1.25, cached_input: 0.125, output: 10.00 },
  'gpt-5.3-codex-spark': { input: 0.25, cached_input: 0.025, output: 2.00 },
  'gpt-5.2': { input: 1.75, cached_input: 0.175, output: 14.00 },
  'claude-opus-4-7': { input: 15.00, cached_input: 1.50, output: 75.00 },
  'claude-sonnet-4-6': { input: 3.00, cached_input: 0.30, output: 15.00 },
  'claude-haiku-4-5': { input: 0.80, cached_input: 0.08, output: 4.00 },
};

export function defaultCostModel() { return process.env.BIXIAN_COST_MODEL || process.env.BIHUA_COST_MODEL || 'gpt-5.5'; }
export function normalizeModel(model) { return String(model || defaultCostModel()).trim() || defaultCostModel(); }
export function estimateEntryCost(entry) {
  const model = normalizeModel(entry.model);
  const pricing = MODEL_PRICING_USD_PER_1M[model];
  if (!pricing) return { ...entry, cost_model: model, cost_usd: null, pricing: null };
  const inputTokens = Number.parseInt(entry.tokens_in || 0, 10);
  const outputTokens = Number.parseInt(entry.tokens_out || 0, 10);
  const cachedTokens = Number.parseInt(entry.cached_in || 0, 10);
  const billableInput = Math.max(0, inputTokens - cachedTokens);
  const cost = (billableInput * pricing.input + cachedTokens * pricing.cached_input + outputTokens * pricing.output) / 1_000_000;
  return { ...entry, cost_model: model, cost_usd: Math.round(cost * 1e8) / 1e8, pricing };
}
export function usageSummary(entries) {
  const estimated = entries.map(estimateEntryCost);
  const sum = (key) => estimated.reduce((acc, e) => acc + Number.parseInt(e[key] || 0, 10), 0);
  const knownCost = estimated.filter((e) => e.cost_usd != null).reduce((acc, e) => acc + e.cost_usd, 0);
  const unknown = [...new Set(estimated.filter((e) => e.cost_usd == null && e.cost_model).map((e) => e.cost_model))].sort();
  const input = sum('tokens_in');
  const output = sum('tokens_out');
  return { input, output, cached_input: sum('cached_in'), reasoning_output: sum('reasoning_out'), total: input + output, calls: estimated.length, cost_usd: Math.round(knownCost * 1e6) / 1e6, unknown_cost_models: unknown, entries: estimated };
}

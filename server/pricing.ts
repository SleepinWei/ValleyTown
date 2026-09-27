import type { BudgetLimits, BudgetProvider } from '../shared/budget';
// Integer nano-yuan keep sub-fen calls from being rounded away.
export const MONEY_SCALE = 1_000_000_000;
export const DEFAULT_LIMITS: BudgetLimits = { DeepSeek: 10, Jev: 10 };
export interface CallPricing { version: string; input: number; cachedInput: number; output: number; usdCny?: number }
export function pricing(provider: BudgetProvider, usdCny: number): CallPricing {
  // Conservative peak prices, CNY / million tokens. Off-peak discounts are not assumed.
  // https://api-docs.deepseek.com/zh-cn/quick_start/pricing (2026-09-27)
  if (provider === 'DeepSeek') return { version: '2026-09-27-peak-estimate', input: 2, cachedInput: .04, output: 8 };
  // https://docs.typesafe.ai/models — Jev 1.13.0, USD / million input tokens; output free.
  return { version: '2026-09-27-jev-1.13.0', input: .042 * usdCny, cachedInput: .042 * usdCny, output: 0, usdCny };
}
export function costNano(rate: CallPricing, input: number, output: number, cachedInput = 0) {
  const amount = Math.ceil(((input - cachedInput) * rate.input + cachedInput * rate.cachedInput + output * rate.output) * 1000);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('费用超出可计量范围');
  return amount;
}
export function validateLimit(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) throw new Error('人民币上限须为 0–1,000,000 元，最多两位小数');
  return Math.round(value * 100) * 10_000_000;
}
export function budgetLimitsFromEnv(): BudgetLimits {
  const limits = { DeepSeek: Number(process.env.DEEPSEEK_BUDGET_CNY ?? 10), Jev: Number(process.env.JEV_BUDGET_CNY ?? 10) };
  for (const value of Object.values(limits)) validateLimit(value);
  return limits;
}

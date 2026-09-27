export const budgetProviders = ['DeepSeek', 'Jev'] as const;
export type BudgetProvider = typeof budgetProviders[number];
export interface BudgetLimits { DeepSeek: number; Jev: number }
export interface BudgetPool {
  limitCny: number;
  spentCny: number;
  reservedCny: number;
  remainingCny: number;
  legacyCalls: number;
}
export const money = (value: number) => `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
export const budgetPercent = (pool: BudgetPool) => pool.limitCny > 0 ? Math.min(100, (pool.spentCny + pool.reservedCny) / pool.limitCny * 100) : 100;

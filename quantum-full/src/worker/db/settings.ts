export interface CapitalSettings {
  budgetPerDraw: number;
  monthlyBudget: number;
  annualBudget: number;
}

export async function getSetting<T>(db: D1Database, key: string, fallback: T): Promise<T> {
  const row = await db.prepare('SELECT value_json FROM app_settings WHERE key = ?').bind(key).first<{ value_json: string }>();
  return row ? (JSON.parse(row.value_json) as T) : fallback;
}

export async function getAllSettings(db: D1Database): Promise<Record<string, { value: unknown; description: string | null; updatedBy: string; updatedAt: string }>> {
  const { results } = await db.prepare('SELECT * FROM app_settings ORDER BY key').all<{ key: string; value_json: string; description: string | null; updated_by: string; updated_at: string }>();
  return Object.fromEntries(results.map((r) => [r.key, { value: JSON.parse(r.value_json), description: r.description, updatedBy: r.updated_by, updatedAt: r.updated_at }]));
}

export async function getCapitalSettings(db: D1Database): Promise<CapitalSettings> {
  const s = await getAllSettings(db);
  return {
    budgetPerDraw: Number(s.budget_per_draw?.value ?? 100000),
    monthlyBudget: Number(s.monthly_budget?.value ?? 1000000),
    annualBudget: Number(s.annual_budget?.value ?? 12000000),
  };
}

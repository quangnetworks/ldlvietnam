import type { DrawRecord } from '../../engine/types';
import { datasetHash } from './draws';

export async function modelVersionId(db: D1Database, code: string): Promise<{ id: number; version: string }> {
  const r = await db.prepare("SELECT id, version FROM model_versions WHERE code = ? AND status = 'active' ORDER BY id DESC LIMIT 1").bind(code).first<{ id: number; version: string }>();
  if (!r) throw new Error(`Chưa đăng ký model version cho ${code}`);
  return r;
}

export interface ModelRunInput {
  modelCode: string;
  gameId: number;
  runType: 'analysis' | 'generate' | 'portfolio' | 'backtest' | 'montecarlo' | 'ml';
  params: unknown;
  seed: string | null;
  draws: DrawRecord[];
  output: unknown;
  durationMs: number;
  createdBy: string;
}

export async function insertModelRun(db: D1Database, r: ModelRunInput): Promise<{ id: number; version: string; datasetHash: string }> {
  const mv = await modelVersionId(db, r.modelCode);
  const hash = await datasetHash(r.draws);
  const row = await db
    .prepare(
      `INSERT INTO model_runs (model_version_id, game_id, run_type, params_json, seed, data_cutoff_at, data_draw_count, dataset_hash, output_summary_json, duration_ms, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(mv.id, r.gameId, r.runType, JSON.stringify(r.params ?? {}), r.seed, r.draws.length ? r.draws[r.draws.length - 1].drawAt : null, r.draws.length, hash, JSON.stringify(r.output ?? {}), r.durationMs, r.createdBy)
    .first<{ id: number }>();
  return { id: row!.id, version: mv.version, datasetHash: hash };
}

/** Trạng thái kiểm định của chiến lược dựa trên backtest hoàn tất gần nhất. */
export async function strategyValidationStatus(db: D1Database, gameId: number, strategy: string): Promise<{ status: string; backtestId: number | null }> {
  if (strategy === 'random_uniform') return { status: 'Baseline khoa học (đối chứng) — không tuyên bố lợi thế.', backtestId: null };
  const r = await db
    .prepare(
      `SELECT m.backtest_run_id AS id, m.metrics_json FROM backtest_metrics m JOIN backtest_runs b ON b.id = m.backtest_run_id
       WHERE b.game_id = ? AND b.status = 'completed' AND m.scope = 'summary' AND m.strategy_code = ? ORDER BY b.id DESC LIMIT 1`,
    )
    .bind(gameId, strategy)
    .first<{ id: number; metrics_json: string }>();
  if (!r) return { status: 'CHƯA KIỂM ĐỊNH — chưa có backtest hoàn tất cho chiến lược này.', backtestId: null };
  const m = JSON.parse(r.metrics_json) as { vsBaseline?: { significant?: boolean } | null };
  return m.vsBaseline?.significant
    ? { status: `Vượt baseline trong backtest #${r.id} (cần xác nhận trên dữ liệu mới).`, backtestId: r.id }
    : { status: `KHÔNG CÓ LỢI THẾ DỰ BÁO ĐƯỢC CHỨNG MINH (backtest #${r.id}).`, backtestId: r.id };
}

import { GameRulesSchema, type Game, type PrizeTier } from '../../shared/game';
import { notFound } from '../lib/http';

interface GameRow {
  id: number;
  code: string;
  name: string;
  main_min: number;
  main_max: number;
  main_picks: number;
  special_mode: Game['specialMode'];
  special_min: number | null;
  special_max: number | null;
  ticket_price: number;
  prize_tiers_json: string;
  schedule_note: string | null;
  rules_verification_status: Game['rulesVerificationStatus'];
  rules_source_url: string | null;
  rules_verified_at: string | null;
  rules_note: string | null;
  is_active: number;
}

export function mapGame(r: GameRow): Game {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    mainMin: r.main_min,
    mainMax: r.main_max,
    mainPicks: r.main_picks,
    specialMode: r.special_mode,
    specialMin: r.special_min,
    specialMax: r.special_max,
    ticketPrice: r.ticket_price,
    prizeTiers: JSON.parse(r.prize_tiers_json) as PrizeTier[],
    scheduleNote: r.schedule_note,
    rulesVerificationStatus: r.rules_verification_status,
    rulesSourceUrl: r.rules_source_url,
    rulesVerifiedAt: r.rules_verified_at,
    rulesNote: r.rules_note,
    isActive: r.is_active === 1,
  };
}

export async function listGames(db: D1Database): Promise<Game[]> {
  const { results } = await db.prepare('SELECT * FROM games ORDER BY id').all<GameRow>();
  return results.map(mapGame);
}

/** Tìm game theo mã (code) hoặc id. */
export async function getGame(db: D1Database, key: string | number): Promise<Game> {
  const row =
    typeof key === 'number' || /^\d+$/.test(key)
      ? await db.prepare('SELECT * FROM games WHERE id = ?').bind(Number(key)).first<GameRow>()
      : await db.prepare('SELECT * FROM games WHERE code = ?').bind(key).first<GameRow>();
  if (!row) throw notFound('Game');
  const g = mapGame(row);
  GameRulesSchema.parse(g); // bảo đảm cấu hình trong DB hợp lệ trước khi tính toán
  return g;
}

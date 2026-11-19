/**
 * Cấu hình trò chơi — dùng chung cho Worker, Engine và UI.
 * Mọi logic tính toán đọc từ cấu hình này; không hardcode riêng cho từng game.
 */
import { z } from 'zod';

/**
 * Cơ chế số đặc biệt:
 * - `none`: không có số đặc biệt.
 * - `separate_pool`: người chơi tự chọn số đặc biệt từ một nhóm riêng (vd Lotto 5/35: 01–12).
 * - `bonus_from_main`: hệ thống quay thêm 1 số từ các số chính còn lại; người chơi KHÔNG chọn riêng
 *   (vd Power 6/55: số đặc biệt quay từ 49 số còn lại, dùng để xét Jackpot 2).
 */
export const SpecialModeSchema = z.enum(['none', 'separate_pool', 'bonus_from_main']);
export type SpecialMode = z.infer<typeof SpecialModeSchema>;

export const PrizeTierSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  /** Số lượng số chính trùng khớp. */
  mainMatches: z.number().int().min(0).max(20),
  /**
   * Điều kiện số đặc biệt: true = phải trùng, false = phải KHÔNG trùng, null = không xét.
   */
  specialMatch: z.boolean().nullable(),
  /** fixed: giải cố định; jackpot: tích luỹ/biến động (amount = giá trị tối thiểu tham chiếu). */
  kind: z.enum(['fixed', 'jackpot']),
  /** Giá trị giải (VND) cho 1 lần dự thưởng mệnh giá vé cơ bản. Jackpot = giá trị khởi điểm tối thiểu. */
  amount: z.number().int().min(0),
  /** Giải có thể bị chia cho nhiều người trúng (pari-mutuel / chia giải). */
  shared: z.boolean().default(false),
});
export type PrizeTier = z.infer<typeof PrizeTierSchema>;

export const GameRulesSchema = z
  .object({
    mainMin: z.number().int().min(0),
    mainMax: z.number().int().min(1).max(99),
    mainPicks: z.number().int().min(1).max(20),
    specialMode: SpecialModeSchema,
    specialMin: z.number().int().min(0).nullable(),
    specialMax: z.number().int().min(0).nullable(),
    ticketPrice: z.number().int().min(1),
    prizeTiers: z.array(PrizeTierSchema),
  })
  .superRefine((g, ctx) => {
    if (g.mainMax - g.mainMin + 1 < g.mainPicks) {
      ctx.addIssue({ code: 'custom', message: 'Số lượng số chọn lớn hơn kích thước nhóm số chính' });
    }
    if (g.specialMode === 'separate_pool') {
      if (g.specialMin == null || g.specialMax == null || g.specialMax < g.specialMin) {
        ctx.addIssue({ code: 'custom', message: 'separate_pool yêu cầu specialMin/specialMax hợp lệ' });
      }
    }
    for (const t of g.prizeTiers) {
      if (t.mainMatches > g.mainPicks) {
        ctx.addIssue({ code: 'custom', message: `Hạng ${t.code}: mainMatches vượt số lượng số chọn` });
      }
      if (g.specialMode === 'none' && t.specialMatch !== null) {
        ctx.addIssue({ code: 'custom', message: `Hạng ${t.code}: game không có số đặc biệt` });
      }
    }
  });
export type GameRules = z.infer<typeof GameRulesSchema>;

export interface Game extends GameRules {
  id: number;
  code: string;
  name: string;
  scheduleNote: string | null;
  rulesVerificationStatus: 'unverified' | 'verified';
  rulesSourceUrl: string | null;
  rulesVerifiedAt: string | null;
  rulesNote: string | null;
  isActive: boolean;
}

export function mainPoolSize(g: Pick<GameRules, 'mainMin' | 'mainMax'>): number {
  return g.mainMax - g.mainMin + 1;
}

export function specialPoolSize(g: Pick<GameRules, 'specialMode' | 'specialMin' | 'specialMax'>): number {
  if (g.specialMode !== 'separate_pool' || g.specialMin == null || g.specialMax == null) return 0;
  return g.specialMax - g.specialMin + 1;
}

/** Người chơi có phải tự chọn số đặc biệt khi mua vé hay không. */
export function playerPicksSpecial(g: Pick<GameRules, 'specialMode'>): boolean {
  return g.specialMode === 'separate_pool';
}

/** Kết quả kỳ quay có số đặc biệt hay không. */
export function drawHasSpecial(g: Pick<GameRules, 'specialMode'>): boolean {
  return g.specialMode !== 'none';
}

export function formatNumber(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * BINGO18 — PHIÊN CHƠI TRỰC TIẾP (chốt từng kỳ 6 phút).
 *
 * Phương án cho kỳ kế tiếp KHÔNG dựa vào dự đoán kết quả (đã chứng minh vô ích) mà chỉ dựa vào
 * lãi/lỗ thực tế của phiên và các quy tắc dừng cứng:
 *  - còn kỳ mở bán hôm nay (06:00 đến 21:48, mỗi 6 phút, ngừng bán 1 phút trước giờ quay);
 *  - lượt kế tiếp không làm tổng lỗ của phiên vượt lỗ tối đa;
 *  - tổng chi Bingo18 trong ngày (sổ quỹ) không vượt hạn mức ngày;
 *  - chưa đạt chốt lời; chưa hết thời gian phiên.
 * Mức cược luôn là mức gốc: không bao giờ tăng sau khi thua.
 */
import { BINGO_STAKE, analyzeBet, betLabel, payout, validateBet, type BingoBet, type BingoResult } from './bingo18';

export const BINGO_FIRST_DRAW = 6 * 60; // 06:00
export const BINGO_LAST_DRAW = 21 * 60 + 53; // 21:53
export const BINGO_INTERVAL = 6;
/** Ngừng bán trước giờ quay (phút). */
export const BINGO_CUTOFF_MIN = 1;

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export interface BingoSchedule {
  date: string;
  /** Kỳ kế tiếp còn mở bán (HH:MM) hoặc null nếu hết kỳ hôm nay. */
  nextDrawAt: string | null;
  /** Kỳ vừa quay gần nhất (HH:MM) hoặc null nếu chưa có kỳ nào hôm nay. */
  lastDrawAt: string | null;
  secondsToCutoff: number | null;
  secondsToDraw: number | null;
  remaining: number;
  perDay: number;
}

export function bingoSchedule(nowIso: string): BingoSchedule {
  const t = new Date(new Date(nowIso).getTime() + 7 * 3600_000);
  const date = t.toISOString().slice(0, 10);
  const secOfDay = t.getUTCHours() * 3600 + t.getUTCMinutes() * 60 + t.getUTCSeconds();
  const perDay = Math.floor((BINGO_LAST_DRAW - BINGO_FIRST_DRAW) / BINGO_INTERVAL) + 1;
  let next: number | null = null;
  let last: number | null = null;
  let remaining = 0;
  for (let m = BINGO_FIRST_DRAW; m <= BINGO_LAST_DRAW; m += BINGO_INTERVAL) {
    if ((m - BINGO_CUTOFF_MIN) * 60 > secOfDay) {
      remaining++;
      if (next === null) next = m;
    }
    if (m * 60 <= secOfDay) last = m;
  }
  return {
    date,
    nextDrawAt: next === null ? null : hhmm(next),
    lastDrawAt: last === null ? null : hhmm(last),
    secondsToCutoff: next === null ? null : (next - BINGO_CUTOFF_MIN) * 60 - secOfDay,
    secondsToDraw: next === null ? null : next * 60 - secOfDay,
    remaining,
    perDay,
  };
}

/** Giờ quay hợp lệ theo lịch (HH:MM). */
export function isBingoDrawTime(time: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return false;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= BINGO_FIRST_DRAW && v <= BINGO_LAST_DRAW && (v - BINGO_FIRST_DRAW) % BINGO_INTERVAL === 0;
}

export interface LiveConfig {
  bet: BingoBet;
  baseUnits: number;
  /** Lỗ tối đa của phiên (VND). */
  budget: number;
  takeProfit: number | null;
  maxMinutes: number;
  startedAt: string;
}

export interface LiveRound {
  drawAt: string;
  stake: number;
  prize: number;
  result: number[] | null;
}

export interface LivePlan {
  action: 'play' | 'stop';
  headline: string;
  stake: number;
  betLabel: string;
  reasons: string[];
  net: number;
  staked: number;
  prizes: number;
  played: number;
  wins: number;
  minutesElapsed: number;
  minutesLeft: number;
  lossRoomLeft: number;
  dailyRoomLeft: number;
  expectedNetPerRound: number;
  schedule: BingoSchedule;
}

export function prizeFor(bet: BingoBet, stake: number, result: BingoResult): number {
  return Math.round((stake / BINGO_STAKE) * payout(bet, result));
}

export function livePlan(cfg: LiveConfig, rounds: LiveRound[], ctx: { now: string; spentToday: number; dailyLimit: number }): LivePlan {
  const err = validateBet(cfg.bet);
  if (err) throw new RangeError(err);
  const schedule = bingoSchedule(ctx.now);
  const stake = cfg.baseUnits * BINGO_STAKE;
  const staked = rounds.reduce((s, r) => s + r.stake, 0);
  const prizes = rounds.reduce((s, r) => s + r.prize, 0);
  const net = prizes - staked;
  const played = rounds.filter((r) => r.stake > 0).length;
  const wins = rounds.filter((r) => r.prize > r.stake && r.stake > 0).length;
  const minutesElapsed = Math.max(0, Math.floor((new Date(ctx.now).getTime() - new Date(cfg.startedAt).getTime()) / 60000));
  const minutesLeft = Math.max(0, cfg.maxMinutes - minutesElapsed);
  const lossRoomLeft = cfg.budget + net;
  const dailyRoomLeft = ctx.dailyLimit - ctx.spentToday;
  const a = analyzeBet(cfg.bet);
  const expectedNetPerRound = cfg.baseUnits * (a.expectedPayout - BINGO_STAKE);
  const label = betLabel(cfg.bet);
  const vnd = (x: number) => `${Math.round(x).toLocaleString('vi-VN')}đ`;
  const base = { stake: 0, betLabel: label, net, staked, prizes, played, wins, minutesElapsed, minutesLeft, lossRoomLeft, dailyRoomLeft, expectedNetPerRound, schedule };
  const summary = `Phiên: đã chơi ${played} kỳ, thắng ${wins}, lãi/lỗ ${net >= 0 ? '+' : ''}${vnd(net)}.`;
  const stop = (headline: string, why: string): LivePlan => ({ ...base, action: 'stop', headline, reasons: [why, summary, 'Dừng là quyết định đúng: kỳ vọng mỗi lượt luôn âm, chơi thêm chỉ làm khoản lỗ trung bình lớn hơn.'] });
  if (!schedule.nextDrawAt) return stop('DỪNG: HẾT KỲ QUAY HÔM NAY', 'Kỳ cuối lúc 21:48 đã ngừng bán.');
  if (cfg.takeProfit != null && net >= cfg.takeProfit) return stop('DỪNG: ĐÃ ĐẠT CHỐT LỜI, GIỮ LẠI PHẦN LÃI', `Lãi ${vnd(net)} đã đạt mức chốt ${vnd(cfg.takeProfit)}.`);
  if (stake > lossRoomLeft) return stop('DỪNG: CHẠM LỖ TỐI ĐA CỦA PHIÊN', `Lỗ tối đa ${vnd(cfg.budget)}; chỉ còn ${vnd(Math.max(0, lossRoomLeft))}, không đủ cho một lượt ${vnd(stake)}.`);
  if (stake > dailyRoomLeft) return stop('DỪNG: HẾT HẠN MỨC CHI BINGO18 HÔM NAY', `Đã chi ${vnd(ctx.spentToday)} trên hạn mức ${vnd(ctx.dailyLimit)}.`);
  if (minutesLeft <= 0) return stop('DỪNG: HẾT THỜI GIAN PHIÊN', `Phiên giới hạn ${cfg.maxMinutes} phút.`);
  return {
    ...base,
    action: 'play',
    stake,
    headline: `KỲ ${schedule.nextDrawAt}: CHƠI ${vnd(stake)} CỬA ${label.toUpperCase()}`,
    reasons: [
      `Mức gốc cố định ${vnd(stake)}; không tăng sau khi thua. Kỳ vọng mỗi lượt ${vnd(expectedNetPerRound)}.`,
      `Còn được lỗ thêm ${vnd(lossRoomLeft)} trước khi chạm lỗ tối đa; còn ${vnd(dailyRoomLeft)} hạn mức chi hôm nay.`,
      cfg.takeProfit != null ? `Dừng ngay khi lãi đạt ${vnd(cfg.takeProfit)} (còn thiếu ${vnd(Math.max(0, cfg.takeProfit - net))}).` : 'Chưa đặt chốt lời: nên đặt để giữ lại phần lãi khi có.',
      `Còn ${minutesLeft} phút trong phiên, ${schedule.remaining} kỳ mở bán hôm nay.`,
      summary,
    ],
  };
}

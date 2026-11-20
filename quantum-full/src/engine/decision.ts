/**
 * DAILY DECISION ENGINE — "Quyết định mua hôm nay".
 *
 * Không dự đoán số. Quyết định dựa trên:
 *  1) Lịch quay còn lại trong ngày (giờ Việt Nam, chừa thời gian mua vé).
 *  2) Kỳ vọng tiền thưởng / vé SAU THUẾ với giá trị Jackpot hiện tại (người dùng cập nhật từ vietlott.vn).
 *  3) Kỷ luật vốn: hạn mức mỗi kỳ, phần còn lại của tháng chia đều cho số ngày còn lại, hạn mức năm.
 *     Không Martingale: thua không làm tăng mức chi; ngân sách chưa dùng không dồn vượt hạn mức mỗi kỳ.
 */
import type { GameRules } from '../shared/game';
import { tierProbabilities } from './probability';
import { rToNumber } from './combinatorics';
import { breakEvenTickets, splitDrawEV, type SplitShares } from './splitDraw';

export interface DrawSchedule {
  /** Ngày trong tuần có quay (0 = Chủ nhật … 6 = Thứ bảy). Rỗng/thiếu = mọi ngày. */
  weekdays?: number[];
  /** Giờ quay HH:MM (giờ Việt Nam). */
  times: string[];
  /** Ngừng bán trước giờ quay (phút). */
  cutoffMinutes?: number;
}

export interface DecisionGame extends GameRules {
  code: string;
  name: string;
  schedule: DrawSchedule | null;
  /** Giá trị Jackpot hiện tại theo mã hạng (VND). Thiếu ⇒ dùng mức tối thiểu trong cấu hình. */
  jackpots: Record<string, number>;
  jackpotsUpdatedAt: string | null;
}

export type DecisionMode = 'discipline' | 'value' | 'minimal' | 'split_only';

/** Kỳ "Chia giải Độc đắc" đã được xác nhận (xem engine/splitDraw.ts). */
export interface SplitDrawInput {
  game: string;
  date: string;
  time: string;
  jackpot: number;
  shares: SplitShares;
  /** Ước lượng số lần dự thưởng của kỳ chia giải. */
  tickets: number;
  /** Ước lượng thận trọng (đã cộng mức tăng doanh số) — dùng để ra quyết định. */
  ticketsConservative: number;
}

export interface DecisionInput {
  /** Thời điểm hiện tại (ISO, UTC). */
  now: string;
  games: DecisionGame[];
  mode: DecisionMode;
  /** mode=value: chỉ mua khi tỷ lệ hoàn vốn kỳ vọng sau thuế ≥ ngưỡng (0..1). */
  valueThreshold: number;
  budgetPerDraw: number;
  monthRemaining: number;
  yearRemaining: number;
  /** Đã chi thực tế hôm nay (VND). */
  spentToday: number;
  /** Áp dụng thuế TNCN 10% trên phần vượt 10 triệu đồng mỗi giải. */
  applyTax: boolean;
  split?: SplitDrawInput | null;
}

export interface CandidateDraw {
  game: string;
  gameName: string;
  date: string;
  time: string;
  drawAtUtc: string;
  minutesUntilClose: number;
  ticketPrice: number;
  expectedPrize: number;
  expectedPrizeFixed: number;
  returnRatio: number;
  expectedLossPerTicket: number;
  breakEvenJackpot: number | null;
  jackpotUsed: number | null;
  jackpotIsMinimum: boolean;
  /** Khác null nếu đây là kỳ Chia giải Độc đắc; returnRatio của kỳ khi đó là ước lượng THẬN TRỌNG. */
  split: { jackpot: number; tickets: number; ticketsConservative: number; returnRatioEstimate: number; breakEvenTickets: number | null; pSplitHappens: number } | null;
}

export interface Decision {
  action: 'buy' | 'skip';
  headline: string;
  pick: CandidateDraw | null;
  tickets: number;
  cost: number;
  expectedReturn: number;
  expectedLoss: number;
  allowance: { budgetPerDraw: number; dailyFromMonth: number; yearRemaining: number; spentToday: number; available: number; daysLeftInMonth: number };
  candidates: CandidateDraw[];
  reasons: string[];
  principles: string[];
}

export const TAX_THRESHOLD = 10_000_000;
export const TAX_RATE = 0.1;

export function afterTax(amount: number, apply: boolean): number {
  if (!apply || amount <= TAX_THRESHOLD) return amount;
  return amount - TAX_RATE * (amount - TAX_THRESHOLD);
}

/** Kỳ vọng tiền thưởng/vé với Jackpot hiện tại, (tuỳ chọn) sau thuế. Không tính rủi ro chia giải Jackpot. */
export function evaluateTicketValue(g: DecisionGame, applyTax: boolean) {
  let ev = 0;
  let evFixed = 0;
  let pJackpotMain = 0;
  let mainJackpotCode: string | null = null;
  for (const tp of tierProbabilities(g)) {
    const p = rToNumber(tp.probability);
    const amount = tp.tier.kind === 'jackpot' ? (g.jackpots[tp.tier.code] ?? tp.tier.amount) : tp.tier.amount;
    const net = afterTax(amount, applyTax);
    ev += p * net;
    if (tp.tier.kind === 'fixed') evFixed += p * net;
    if (tp.tier.kind === 'jackpot' && !mainJackpotCode) {
      mainJackpotCode = tp.tier.code;
      pJackpotMain = p;
    }
  }
  // Jackpot hoà vốn: giá trị Jackpot chính (trước thuế) để EV sau thuế = giá vé, giữ nguyên các hạng khác.
  let breakEven: number | null = null;
  if (mainJackpotCode && pJackpotMain > 0) {
    const jp = g.jackpots[mainJackpotCode] ?? g.prizeTiers.find((t) => t.code === mainJackpotCode)!.amount;
    const others = ev - pJackpotMain * afterTax(jp, applyTax);
    const neededNet = (g.ticketPrice - others) / pJackpotMain;
    breakEven = applyTax ? TAX_THRESHOLD + (neededNet - TAX_THRESHOLD) / (1 - TAX_RATE) : neededNet;
  }
  const jp = mainJackpotCode ? (g.jackpots[mainJackpotCode] ?? null) : null;
  return { expectedPrize: ev, expectedPrizeFixed: evFixed, returnRatio: ev / g.ticketPrice, breakEvenJackpot: breakEven, jackpotUsed: jp ?? (mainJackpotCode ? g.prizeTiers.find((t) => t.code === mainJackpotCode)!.amount : null), jackpotIsMinimum: jp == null };
}

/** Ngày & giờ hiện tại theo giờ Việt Nam (UTC+7). */
export function vnClock(nowIso: string): { date: string; minutes: number; weekday: number } {
  const t = new Date(new Date(nowIso).getTime() + 7 * 3600_000);
  return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes(), weekday: t.getUTCDay() };
}

export function daysLeftInMonth(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return last - d + 1;
}

export function candidateDraws(input: Pick<DecisionInput, 'now' | 'games' | 'applyTax' | 'split'>): CandidateDraw[] {
  const clock = vnClock(input.now);
  const out: CandidateDraw[] = [];
  for (const g of input.games) {
    if (!g.schedule) continue;
    if (g.schedule.weekdays?.length && !g.schedule.weekdays.includes(clock.weekday)) continue;
    const v = evaluateTicketValue(g, input.applyTax);
    for (const time of g.schedule.times) {
      const [hh, mm] = time.split(':').map(Number);
      const closeAt = hh * 60 + mm - (g.schedule.cutoffMinutes ?? 15);
      if (closeAt <= clock.minutes) continue;
      const sp = input.split && input.split.game === g.code && input.split.date === clock.date && input.split.time === time ? input.split : null;
      if (sp) {
        const cons = splitDrawEV(g, sp.jackpot, sp.ticketsConservative, sp.shares, input.applyTax);
        const est = splitDrawEV(g, sp.jackpot, sp.tickets, sp.shares, input.applyTax);
        out.push({
          game: g.code,
          gameName: g.name,
          date: clock.date,
          time,
          drawAtUtc: new Date(`${clock.date}T${time}:00+07:00`).toISOString(),
          minutesUntilClose: closeAt - clock.minutes,
          ticketPrice: g.ticketPrice,
          expectedPrize: cons.expectedPrize,
          expectedPrizeFixed: v.expectedPrizeFixed,
          returnRatio: cons.returnRatio,
          expectedLossPerTicket: g.ticketPrice - cons.expectedPrize,
          breakEvenJackpot: null,
          jackpotUsed: sp.jackpot,
          jackpotIsMinimum: false,
          split: { jackpot: sp.jackpot, tickets: sp.tickets, ticketsConservative: sp.ticketsConservative, returnRatioEstimate: est.returnRatio, breakEvenTickets: breakEvenTickets(g, sp.jackpot, sp.shares, input.applyTax), pSplitHappens: cons.pSplitHappens },
        });
        continue;
      }
      out.push({
        game: g.code,
        gameName: g.name,
        date: clock.date,
        time,
        drawAtUtc: new Date(`${clock.date}T${time}:00+07:00`).toISOString(),
        minutesUntilClose: closeAt - clock.minutes,
        ticketPrice: g.ticketPrice,
        expectedPrize: v.expectedPrize,
        expectedPrizeFixed: v.expectedPrizeFixed,
        returnRatio: v.returnRatio,
        expectedLossPerTicket: g.ticketPrice - v.expectedPrize,
        breakEvenJackpot: v.breakEvenJackpot,
        jackpotUsed: v.jackpotUsed,
        jackpotIsMinimum: v.jackpotIsMinimum,
        split: null,
      });
    }
  }
  // Giá trị kỳ vọng cao nhất trước (lỗ kỳ vọng thấp nhất), rồi kỳ quay sớm hơn.
  return out.sort((a, b) => b.returnRatio - a.returnRatio || a.drawAtUtc.localeCompare(b.drawAtUtc));
}

export function decideToday(input: DecisionInput): Decision {
  const clock = vnClock(input.now);
  const candidates = candidateDraws(input);
  const daysLeft = daysLeftInMonth(clock.date);
  const dailyFromMonth = Math.floor(Math.max(0, input.monthRemaining) / daysLeft);
  const available = Math.max(0, Math.min(input.budgetPerDraw, dailyFromMonth, input.yearRemaining) - input.spentToday);
  const allowance = { budgetPerDraw: input.budgetPerDraw, dailyFromMonth, yearRemaining: input.yearRemaining, spentToday: input.spentToday, available, daysLeftInMonth: daysLeft };
  const principles = [
    'Mọi tổ hợp có xác suất trúng như nhau; quyết định chỉ chọn KỲ QUAY và SỐ TIỀN, không “đoán” số.',
    'Kỳ vọng mỗi vé là âm trong hầu hết trường hợp: đây là chi phí giải trí, không phải đầu tư.',
    'Không tăng tiền sau khi thua (không Martingale); không dồn ngân sách vượt hạn mức mỗi kỳ.',
    'Hệ thống không tự mua vé. Bạn quyết định và tự mua tại kênh chính thức.',
  ];
  const skip = (headline: string, reasons: string[]): Decision => ({ action: 'skip', headline, pick: null, tickets: 0, cost: 0, expectedReturn: 0, expectedLoss: 0, allowance, candidates, reasons, principles });
  const vnd = (x: number) => `${Math.round(x).toLocaleString('vi-VN')}đ`;
  const mil = (x: number) => `${(x / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} triệu`;
  if (input.mode === 'split_only') {
    principles.unshift('Chỉ mua ở kỳ Chia giải Độc đắc khi kỳ vọng THẬN TRỌNG vượt giá vé; các ngày khác để dành ngân sách.');
    const split = candidates.find((c) => c.split);
    if (!split || split.returnRatio < 1) {
      const reasons = [
        split
          ? `Kỳ chia giải ${split.time} có kỳ vọng thận trọng ${(split.returnRatio * 100).toFixed(0)}% (với ≈ ${mil(split.split!.ticketsConservative)} lần dự thưởng) — chưa vượt giá vé.`
          : 'Hôm nay không có kỳ Chia giải Độc đắc đã được xác nhận (cập nhật ở thẻ “Kỳ Chia giải Độc đắc”).',
        'Ngoài kỳ chia giải, mỗi vé chỉ hoàn lại khoảng 31–45% — không mua để dồn ngân sách cho kỳ có lợi thế.',
      ];
      return skip('KHÔNG MUA — CHỜ KỲ CHIA GIẢI CÓ LỢI THẾ', reasons);
    }
    // Ngân sách tích luỹ: không chia theo số ngày còn lại (đã để dành), vẫn giới hạn bởi hạn mức kỳ / tháng / năm.
    const avail = Math.max(0, Math.min(input.budgetPerDraw, input.monthRemaining, input.yearRemaining) - input.spentToday);
    const n = Math.floor(avail / split.ticketPrice);
    if (n < 1) return skip('KHÔNG MUA — HẾT HẠN MỨC', [`Hạn mức khả dụng cho kỳ chia giải: ${vnd(avail)}.`]);
    const s = split.split!;
    return {
      action: 'buy',
      headline: `MUA ${n} VÉ ${split.gameName.toUpperCase()} — KỲ CHIA GIẢI ${split.time}`,
      pick: split,
      tickets: n,
      cost: n * split.ticketPrice,
      expectedReturn: n * split.expectedPrize,
      expectedLoss: n * split.expectedLossPerTicket,
      allowance: { ...allowance, available: avail },
      candidates,
      reasons: [
        `Kỳ chia giải: toàn bộ Độc đắc ${(s.jackpot / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ được trả cho người chơi kỳ này (nếu không ai trúng Độc đắc thì chia cho các hạng Nhất–Năm).`,
        `Kỳ vọng mỗi vé: ${(s.returnRatioEstimate * 100).toFixed(0)}% với ≈ ${mil(s.tickets)} lần dự thưởng; thận trọng ${(split.returnRatio * 100).toFixed(0)}% với ≈ ${mil(s.ticketsConservative)}.`,
        s.breakEvenTickets ? `Còn có lợi khi tổng số lần dự thưởng dưới ≈ ${mil(s.breakEvenTickets)}.` : '',
        `Lợi thế chỉ thành hiện thực qua nhiều kỳ chia giải: mỗi vé chỉ ≈ 1,4% trúng từ hạng Năm trở lên — đa số kỳ sẽ không trúng gì.`,
        `Chọn số ít phổ biến (có số 32–35, tránh dãy ngày sinh) để ít người cùng chia trong mỗi hạng.`,
      ].filter(Boolean),
      principles,
    };
  }
  if (!candidates.length) return skip('KHÔNG MUA HÔM NAY', ['Không còn kỳ quay nào mở bán trong hôm nay (đã qua giờ ngừng bán hoặc không có lịch quay).']);
  const best = candidates[0];
  const maxTickets = Math.floor(available / best.ticketPrice);
  if (maxTickets < 1)
    return skip('KHÔNG MUA HÔM NAY', [
      available <= 0 && input.spentToday > 0 ? `Đã chi ${input.spentToday.toLocaleString('vi-VN')}đ hôm nay — đạt mức cho phép.` : 'Ngân sách khả dụng hôm nay không đủ cho 1 vé.',
      `Hạn mức tháng còn ${input.monthRemaining.toLocaleString('vi-VN')}đ cho ${daysLeft} ngày (≈ ${dailyFromMonth.toLocaleString('vi-VN')}đ/ngày).`,
    ]);
  if (input.mode === 'value' && best.returnRatio < input.valueThreshold)
    return skip('KHÔNG MUA — GIÁ TRỊ KỲ VỌNG THẤP', [
      `Tỷ lệ hoàn vốn kỳ vọng tốt nhất hôm nay là ${(best.returnRatio * 100).toFixed(1)}% (${best.gameName} ${best.time}), thấp hơn ngưỡng ${(input.valueThreshold * 100).toFixed(0)}% bạn đặt.`,
      best.breakEvenJackpot ? `Jackpot hoà vốn lý thuyết của ${best.gameName}: ≈ ${Math.round(best.breakEvenJackpot / 1e9).toLocaleString('vi-VN')} tỷ đồng (chưa tính rủi ro chia giải).` : '',
    ].filter(Boolean));
  const tickets = input.mode === 'minimal' ? 1 : maxTickets;
  const cost = tickets * best.ticketPrice;
  const reasons = [
    `${best.gameName} kỳ ${best.time} có tỷ lệ hoàn vốn kỳ vọng${input.applyTax ? ' sau thuế' : ''} cao nhất trong các kỳ còn mở bán hôm nay: ${(best.returnRatio * 100).toFixed(1)}%.`,
    best.jackpotIsMinimum ? 'Jackpot đang tính theo mức tối thiểu — hãy cập nhật giá trị hiện tại từ vietlott.vn để đánh giá chính xác hơn.' : `Jackpot dùng để tính: ${Math.round((best.jackpotUsed ?? 0) / 1e6).toLocaleString('vi-VN')} triệu đồng.`,
    `Ngân sách khả dụng hôm nay: ${available.toLocaleString('vi-VN')}đ = min(hạn mức/kỳ, hạn mức tháng còn lại ÷ ${daysLeft} ngày, hạn mức năm) − đã chi hôm nay.`,
    best.expectedLossPerTicket < 0
      ? `Kỳ vọng LÃI cho ${tickets} vé ≈ ${Math.round(-tickets * best.expectedLossPerTicket).toLocaleString('vi-VN')}đ (trung bình qua nhiều kỳ tương tự).`
      : `Kỳ vọng lỗ cho ${tickets} vé ≈ ${Math.round(tickets * best.expectedLossPerTicket).toLocaleString('vi-VN')}đ.`,
  ];
  if (best.split) reasons.unshift(`Đây là kỳ CHIA GIẢI ĐỘC ĐẮC: kỳ vọng thận trọng ${(best.returnRatio * 100).toFixed(0)}%. Chế độ “Chỉ mua kỳ Chia giải” cho phép dùng ngân sách đã để dành.`);
  if (candidates.length > 1) reasons.push(`Lựa chọn thay thế: ${candidates.slice(1, 3).map((c) => `${c.gameName} ${c.time} (${(c.returnRatio * 100).toFixed(1)}%)`).join(', ')}.`);
  return {
    action: 'buy',
    headline: `MUA ${tickets} VÉ ${best.gameName.toUpperCase()} — KỲ ${best.time}`,
    pick: best,
    tickets,
    cost,
    expectedReturn: tickets * best.expectedPrize,
    expectedLoss: tickets * best.expectedLossPerTicket,
    allowance,
    candidates,
    reasons,
    principles,
  };
}

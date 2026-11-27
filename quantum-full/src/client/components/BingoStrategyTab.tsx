import { useState } from 'react';
import { Play } from 'lucide-react';
import { useApi } from '../lib/hooks';
import { num, pct, vnd } from '../lib/format';
import { Badge, Button, Card, ErrorState, Field, Input, LoadingBlock, Notice, RecordLead, Select, Table, Td } from './ui';

const BETS: { value: string; label: string }[] = [
  ...[1, 2, 3, 4, 5, 6].map((v) => ({ value: `single:${v}`, label: `Chọn số ${v} (hoàn 56,9%)` })),
  { value: 'big', label: 'Lớn, tổng 12 đến 18 (hoàn 56,3%)' },
  { value: 'small', label: 'Nhỏ, tổng 3 đến 9 (hoàn 56,3%)' },
  { value: 'draw', label: 'Hoà, tổng 10 hoặc 11 (hoàn 50%)' },
  { value: 'sum:10', label: 'Tổng 10' },
];

/** Bingo18: chứng minh không có chiến thuật thắng chắc, và so sánh các cách tăng giảm tiền cược dưới cùng quy tắc dừng. */
export function BingoStrategyTab() {
  const [f, setF] = useState({ bet: 'single:1', base: '1', budget: '', takeProfit: '', rounds: '30' });
  const build = () => {
    const [type, value] = f.bet.split(':');
    const p = new URLSearchParams({ bet_type: type, base_units: f.base, rounds: f.rounds, sessions: '5000', seed: 'bingo-strategy' });
    if (value) p.set('bet_value', value);
    if (f.budget.trim()) p.set('budget', String(Math.round(Number(f.budget.replace(/[^\d]/g, '')))));
    if (f.takeProfit.trim()) p.set('take_profit', String(Math.round(Number(f.takeProfit.replace(/[^\d]/g, '')))));
    return `/bingo18/strategy?${p.toString()}`;
  };
  const [path, setPath] = useState(build);
  const q = useApi<any>(path);
  const d = q.data;
  return (
    <div className="space-y-5">
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {!d && !q.error && <LoadingBlock rows={6} />}
      {d && (
        <>
          <RecordLead
            badge={<Badge tone="bad">Không có chiến thuật thắng chắc</Badge>}
            headline="KHÔNG CÓ CHIẾN THUẬT NÀO BẢO ĐẢM KHÔNG LỖ"
            reasons={[
              `Đã xét đủ ${d.hedge.betsConsidered} cửa cược trên cả ${d.hedge.outcomes} kết quả có thể. Cửa tốt nhất (${d.hedge.bestBet.label}) chỉ hoàn lại ${pct(d.hedge.bestBet.returnRatio, 1)} tiền cược.`,
              'Mọi cách chia tiền giữa các cửa có lãi/lỗ tệ nhất không thể cao hơn kỳ vọng của nó, mà kỳ vọng luôn âm. Vì vậy không tổ hợp nào lãi ở mọi kết quả.',
              'Gấp thếp hay gấp khi thắng chỉ đổi cách phân bố lãi/lỗ giữa các ngày; mỗi lượt vẫn lỗ trung bình như nhau nên tổng thể vẫn lỗ.',
              'Điều duy nhất bảo đảm được là mức lỗ tối đa: không bao giờ đặt lượt nào làm tổng lỗ trong ngày vượt hạn mức.',
            ]}
            reading={{
              label: 'Lỗ chắc chắn tối thiểu mỗi 10.000đ, dù chia cược khéo nhất',
              value: vnd(d.hedge.hedge.guaranteed),
              tone: 'bad',
              note: `Tổ hợp phòng thủ tốt nhất: ${d.hedge.hedge.mix.map((m: any) => `${m.label} ${pct(m.weight, 1)}`).join('; ')}. Tệ nhất khi ra ${d.hedge.hedge.worstOutcome.join(', ')}.`,
            }}
          />

          <div className="space-y-5">
            <Card title="Thiết lập" subtitle={`Mô phỏng 5.000 ngày, cùng một chuỗi kết quả cho mọi chiến thuật để so sánh công bằng. Để trống lỗ tối đa thì dùng hạn mức Bingo18/ngày ${vnd(d.input.dailyLimit)}; để trống chốt lời thì không chốt.`}>
              <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto]">
                <Field label="Cửa cược">
                  <Select value={f.bet} onChange={(e) => setF({ ...f, bet: e.target.value })}>
                    {BETS.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Mức gốc (lần × 10.000đ)">
                  <Input type="number" min={1} max={100} value={f.base} onChange={(e) => setF({ ...f, base: e.target.value })} />
                </Field>
                <Field label="Số kỳ tối đa">
                  <Input type="number" min={1} max={160} value={f.rounds} onChange={(e) => setF({ ...f, rounds: e.target.value })} />
                </Field>
                <Field label="Lỗ tối đa hôm nay (đ)">
                  <Input inputMode="numeric" placeholder={String(d.input.dailyLimit)} value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />
                </Field>
                <Field label="Chốt lời khi lãi đạt (đ)">
                  <Input inputMode="numeric" placeholder="vd 50000" value={f.takeProfit} onChange={(e) => setF({ ...f, takeProfit: e.target.value })} />
                </Field>
                <Button variant="primary" className="w-full lg:w-auto" loading={q.loading} onClick={() => setPath(build())}>
                  <Play className="h-4 w-4" aria-hidden /> Mô phỏng
                </Button>
              </div>
            </Card>

            <Card
              title={`So sánh chiến thuật: ${d.input.betLabel}`}
              subtitle={`Lỗ tối đa ${vnd(d.input.budget)}${d.input.takeProfit != null ? `, chốt lời ${vnd(d.input.takeProfit)}` : ''}, tối đa ${num(d.input.maxRounds)} kỳ. Kỳ vọng mỗi lượt ở mức gốc: ${vnd(d.input.expectedNetPerRound)}.`}
            >
              <Table head={['Chiến thuật', 'Ngày có lãi', 'Trung bình', 'Lỗ / 10.000đ đã cược', 'Trung vị', '5% ngày tệ nhất', 'Tệ nhất', 'Chạm lỗ tối đa', 'Đạt chốt lời', 'Số kỳ TB']}>
                {d.strategies.map((s: any) => (
                  <tr key={s.code}>
                    <Td>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted">{s.description}</div>
                    </Td>
                    <Td className={`measured ${s.probabilityProfit >= 0.5 ? 'text-ok' : ''}`}>{pct(s.probabilityProfit, 1)}</Td>
                    <Td className="measured text-bad">{vnd(s.meanNet)}</Td>
                    <Td className="measured">{s.meanStaked > 0 ? vnd((s.meanNet / s.meanStaked) * 10000) : '0đ'}</Td>
                    <Td className="measured">{vnd(s.medianNet)}</Td>
                    <Td className="measured">{vnd(s.p5)}</Td>
                    <Td className="measured">{vnd(s.worst)}</Td>
                    <Td className="measured">{pct(s.probabilityHitStop, 1)}</Td>
                    <Td className="measured">{pct(s.probabilityTakeProfit, 1)}</Td>
                    <Td className="measured">{num(s.meanRounds, 1)}</Td>
                  </tr>
                ))}
              </Table>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                Hãy nhìn cột “Lỗ / 10.000đ đã cược”: mọi chiến thuật mất gần như cùng một tỷ lệ, vì mỗi lượt đều lỗ trung bình như nhau. Chiến thuật nào “lỗ ít hơn” trong cột Trung bình thường chỉ vì đặt cược lớn nên chạm lỗ tối đa sớm, chơi ít lượt hơn. Không ngày nào lỗ quá hạn mức đã đặt.
              </p>
            </Card>
          </div>

          <Card title="Điều bảo đảm được khi chơi Bingo18">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <div>
                <div className="text-xs font-medium text-muted">Lỗ tối đa hôm nay</div>
                <div className="reading mt-2 text-[clamp(2rem,4vw,2.75rem)]">{vnd(d.input.budget)}</div>
                <p className="mt-2 text-xs text-muted">Đặt ở Cài đặt, mục hạn mức Bingo18 mỗi ngày. Hết hạn mức thì dừng, không nạp thêm.</p>
              </div>
              <ul className="space-y-2 text-sm leading-relaxed text-ink-2">
                <li>Chọn cửa hoàn trả cao nhất (Chọn số, 56,9%) và cược mức gốc nhỏ nhất: mất chậm nhất cho cùng thời gian chơi.</li>
                <li>Không tăng tiền sau khi thua. Gấp thếp không gỡ được vì cửa Lớn/Nhỏ chỉ trả 1,5 lần tiền cược.</li>
                <li>Đặt chốt lời: khi đang lãi thì dừng và giữ lại phần lãi đó. Chốt lời không làm tăng kỳ vọng, chỉ giúp giữ khoản đã thắng.</li>
                <li>Giới hạn thời gian phiên. Bingo18 quay mỗi 6 phút nên rất dễ chơi quá mức.</li>
              </ul>
            </div>
            <div className="mt-4">
              <Notice tone="warn">Bingo18 là giải trí có chi phí. Nếu bạn muốn một kỳ có cơ hội lãi thật về toán học, đó là kỳ Chia giải Độc đắc của Lotto 5/35 (trang Quyết định hôm nay).</Notice>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGame } from '../lib/game';
import { useApi } from '../lib/hooks';
import { dateTime, num, pct, pv } from '../lib/format';
import { Badge, RecordLead, Card, ErrorState, Field, Kpi, LoadingBlock, Notice, PageHeader, Select, Table, Td } from '../components/ui';

const VERDICT_TONE: Record<string, 'good' | 'warn' | 'bad' | 'info'> = { random: 'good', anomaly: 'warn', exploitable: 'bad', insufficient: 'info' };
const VERDICT_LABEL: Record<string, string> = { random: 'Ngẫu nhiên', anomaly: 'Có độ lệch', exploitable: 'Cần kiểm chứng', insufficient: 'Chưa đủ dữ liệu' };

/** Thẻ tóm tắt phán quyết — dùng ở trang Quyết định hôm nay. */
export function PredictabilitySummary({ game }: { game: string }) {
  // Dữ liệu đồng bộ tự động mặc định ở trạng thái chưa xác minh ⇒ thẻ tóm tắt dùng toàn bộ dữ liệu và ghi rõ điều đó.
  const q = useApi<any>(`/predictability?game=${encodeURIComponent(game)}&include_unverified=true`);
  const d = q.data;
  return (
    <Card title={`Có đoán được số ${d?.gameName ?? ''} không?`} subtitle="Kiểm định tự động trên toàn bộ lịch sử quay, đã hiệu chỉnh đa kiểm định.">
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {!d && !q.error && <LoadingBlock rows={2} />}
      {d && (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={VERDICT_TONE[d.verdict]}>{VERDICT_LABEL[d.verdict]}</Badge>
            <span className="font-medium">{d.headline}</span>
          </div>
          <p className="text-xs text-ink-2">{d.explanation[0]}</p>
          <p className="text-xs text-muted">
            {num(d.draws)} kỳ · {q.meta?.dataNotice}
          </p>
          <Link to="/predictability" className="inline-block text-xs text-ink underline decoration-rule-2 underline-offset-4 transition-[color] duration-[var(--dur-micro)] hover:text-accent">
            Xem chi tiết kiểm định
          </Link>
        </div>
      )}
    </Card>
  );
}

export default function Predictability() {
  const { code } = useGame();
  const [unverified, setUnverified] = useState('');
  const [win, setWin] = useState('50');
  const q = useApi<any>(`/predictability?game=${code}&window=${win}${unverified ? `&include_unverified=${unverified}` : ''}`);
  const d = q.data;
  const best = d?.strategies?.length ? [...d.strategies].sort((a: any, b: any) => a.pValue - b.pValue)[0] : null;
  const minP = d?.tests?.length ? Math.min(...d.tests.map((t: any) => t.pValue), ...d.strategies.map((s: any) => s.pValue)) : null;
  return (
    <>
      <PageHeader
        title="Kiểm định dự đoán"
        description="Trả lời bằng số liệu: kết quả quay có quy luật nào khai thác được không? Mỗi kiểm định so với giả thuyết “mỗi kỳ độc lập và đồng đều”; mỗi chiến lược chọn số được chấm walk-forward (chỉ dùng dữ liệu trước kỳ đó)."
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:w-2/3">
        <Field label="Dữ liệu">
          <Select value={unverified} onChange={(e) => setUnverified(e.target.value)}>
            <option value="">Theo cài đặt hệ thống</option>
            <option value="false">Chỉ dữ liệu đã xác minh</option>
            <option value="true">Bao gồm chưa xác minh</option>
          </Select>
        </Field>
        <Field label="Cửa sổ số nóng / lạnh">
          <Select value={win} onChange={(e) => setWin(e.target.value)}>
            <option value="20">20 kỳ</option>
            <option value="50">50 kỳ</option>
            <option value="100">100 kỳ</option>
          </Select>
        </Field>
      </div>
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {!d && !q.error && <LoadingBlock rows={6} />}
      {d && (
        <div className="space-y-5">
          <RecordLead
            badge={<Badge tone={VERDICT_TONE[d.verdict]}>{VERDICT_LABEL[d.verdict]}</Badge>}
            headline={d.headline}
            meta={q.meta?.dataNotice}
            reasons={d.explanation}
            reading={{
              label: `Số kỳ ${d.gameName} đã kiểm định`,
              value: num(d.draws),
              note: d.firstDrawAt ? `Từ ${dateTime(d.firstDrawAt)} đến ${dateTime(d.lastDrawAt)}.` : 'Chưa có kỳ nào trong phạm vi dữ liệu đã chọn.',
            }}
          >
            {d.verdict === 'insufficient' && q.meta && !q.meta.includeUnverified && (
              <Notice tone="info">Dữ liệu đồng bộ tự động thường ở trạng thái “chưa xác minh”. Chọn “Bao gồm chưa xác minh” ở trên để kiểm định trên toàn bộ dữ liệu.</Notice>
            )}
          </RecordLead>

          {d.tests.length > 0 && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label="Số kỳ phân tích" value={num(d.draws)} hint={`Chấm điểm từ kỳ thứ ${num(d.warmup + 1)}`} />
                <Kpi label="Số giả thuyết kiểm tra" value={num(d.tests.length + d.strategies.length)} hint={`Mức ý nghĩa q < ${d.alpha}`} />
                <Kpi label="p nhỏ nhất (chưa hiệu chỉnh)" value={pv(minP)} hint="Với nhiều kiểm định, p nhỏ đơn lẻ là bình thường" />
                <Kpi label="Chiến lược tốt nhất" value={best ? (best.target === 'main' ? num(best.observed, 3) : pct(best.observed, 1)) : '—'} hint={best ? `${best.name} · lý thuyết ${best.target === 'main' ? num(best.expected, 3) : pct(best.expected, 1)}` : undefined} />
              </div>

              <Card title="Kiểm định tính ngẫu nhiên" subtitle="p: giá trị p của từng kiểm định · q: sau hiệu chỉnh Benjamini–Hochberg trên toàn bộ giả thuyết của trang.">
                <Table head={['Kiểm định', 'Thống kê', 'p', 'q', 'Kết luận']}>
                  {d.tests.map((t: any) => (
                    <tr key={t.code}>
                      <Td>
                        <div className="font-medium">{t.name}</div>
                        <div className="text-xs text-muted">{t.question}</div>
                        <div className="text-xs text-muted">{t.detail}</div>
                      </Td>
                      <Td className="measured whitespace-nowrap">
                        {num(t.statistic, 2)}
                        {t.df != null && <span className="text-xs text-muted"> (df {t.df})</span>}
                      </Td>
                      <Td className="measured">{pv(t.pValue)}</Td>
                      <Td className="measured">{pv(t.qValue)}</Td>
                      <Td>{t.significant ? <Badge tone="warn">Lệch</Badge> : <Badge tone="good">Khớp ngẫu nhiên</Badge>}</Td>
                    </tr>
                  ))}
                </Table>
              </Card>

              <Card title="Backtest các cách chọn số phổ biến" subtitle="Walk-forward: mỗi kỳ chỉ dùng dữ liệu các kỳ trước. p một phía: xác suất ngẫu nhiên đạt kết quả tốt như vậy.">
                <Table head={['Chiến lược', 'Số kỳ chấm', 'Quan sát', 'Lý thuyết', 'z', 'p', 'q', 'Vé trùng ≥ 3 số', 'Kết luận']}>
                  {d.strategies.map((s: any) => (
                    <tr key={s.code}>
                      <Td>{s.name}</Td>
                      <Td className="measured">{num(s.steps)}</Td>
                      <Td className="measured">{s.target === 'main' ? `${num(s.observed, 3)} số/vé` : pct(s.observed, 1)}</Td>
                      <Td className="measured">{s.target === 'main' ? num(s.expected, 3) : pct(s.expected, 1)}</Td>
                      <Td className="measured">{num(s.z, 2)}</Td>
                      <Td className="measured">{pv(s.pValue)}</Td>
                      <Td className="measured">{pv(s.qValue)}</Td>
                      <Td className="measured">{s.hits3Plus == null ? '—' : num(s.hits3Plus)}</Td>
                      <Td>{s.beatsRandom ? <Badge tone="bad">Vượt ngẫu nhiên</Badge> : <Badge tone="default">Không hơn ngẫu nhiên</Badge>}</Td>
                    </tr>
                  ))}
                </Table>
              </Card>
            </>
          )}

          <Card title="Toán học giúp được gì khi mua thật?">
            <ul className="list-disc space-y-2 pl-4 text-sm text-ink-2">
              <li>Không chọn được bộ số có xác suất trúng cao hơn: mọi tổ hợp đều như nhau.</li>
              <li>
                Khi mua nhiều vé cho cùng một kỳ, <b>phối hợp vé</b> (số đặc biệt khác nhau, số chính ít trùng nhau) làm tăng xác suất <b>có ít nhất một vé trúng</b> với cùng chi phí. Hệ thống tính chính xác con số này mỗi khi sinh bộ số.
              </li>
              <li>Giá trị kỳ vọng không đổi; lỗ kỳ vọng chỉ giảm bằng cách mua ít hơn hoặc chỉ mua khi Jackpot lớn (chế độ “Giá trị” ở trang Quyết định hôm nay).</li>
              <li>Bộ số ít người chọn không tăng xác suất trúng nhưng giảm khả năng phải chia Jackpot.</li>
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}

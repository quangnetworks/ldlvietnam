import { Link } from 'react-router-dom';
import { Database } from 'lucide-react';
import { useGame } from '../lib/game';
import { useApi } from '../lib/hooks';
import { dateOnly, dateTime, num, oneIn, pct, pv, vnd } from '../lib/format';
import { Badge, Balls, Button, Card, EmptyState, ErrorState, Kpi, LoadingBlock, Notice, PageHeader, Table, Td } from '../components/ui';
import { FrequencyHeatmap, ObservedExpectedBar, SumTrend } from '../components/charts';

const RUN_TYPE: Record<string, string> = { analysis: 'Phân tích', generate: 'Sinh bộ số', portfolio: 'Tối ưu danh mục', backtest: 'Backtest', montecarlo: 'Monte Carlo', ml: 'ML Research' };

export default function Overview() {
  const { code, game } = useGame();
  const q = useApi<any>(code ? `/dashboard?game=${code}` : null);
  const d = q.data;
  return (
    <>
      <PageHeader title="Tổng quan" description="Bảng điều khiển phân tích. Mọi số liệu được tính từ dữ liệu đã nhập; không có dữ liệu mẫu hay số liệu dựng sẵn." />
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {q.loading && !d && <LoadingBlock rows={8} />}
      {d && (
        <div className="space-y-5">
          {game?.rulesVerificationStatus !== 'verified' && (
            <Notice tone="warn">
              Cấu hình thể lệ & cơ cấu giải của {game?.name} đang ở trạng thái <b>chưa xác minh</b> với nguồn chính thức Vietlott. Xác suất trúng giải theo số trùng khớp là chính xác về mặt tổ hợp, nhưng tên hạng giải và giá trị
              giải cần được đối chiếu tại <Link className="underline" to="/settings">Cài đặt → Cấu hình game</Link>.
            </Notice>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Kỳ quay đã xác minh" value={num(d.verifiedDraws)} hint={`Chưa xác minh: ${num(d.drawCounts.unverified ?? 0)}`} />
            <Kpi label="Xác suất Jackpot / vé" value={oneIn(d.probability.jackpot.oneIn)} hint={`Tổng tổ hợp: ${Number(d.probability.totalOutcomes).toLocaleString('vi-VN')}`} />
            <Kpi label="Kỳ vọng hoàn vốn / vé" value={pct(d.probability.expectedValue.returnRatio, 1)} hint={`EV ròng ≈ ${vnd(d.probability.expectedValue.expectedNet)} / vé`} tone="warn" />
            <Kpi label="Kết quả ròng (thực tế)" value={vnd(d.capital.netResult)} hint={`Còn lại tháng này: ${vnd(d.capital.monthRemaining)}`} tone={d.capital.netResult >= 0 ? 'good' : 'bad'} />
          </div>
          {d.verifiedDraws === 0 ? (
            <Card title="Chưa có dữ liệu lịch sử đã xác minh">
              <EmptyState
                title="Hãy nhập kết quả quay chính thức"
                description="Hệ thống không tự tạo dữ liệu lịch sử. Nhập CSV/JSON từ nguồn chính thức Vietlott tại Data Center, sau đó xác minh để dùng cho thống kê và backtest."
                action={
                  <Link to="/data">
                    <Button variant="primary">
                      <Database className="h-4 w-4" aria-hidden /> Đến Data Center
                    </Button>
                  </Link>
                }
              />
            </Card>
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="Bản đồ nhiệt tần suất" subtitle={`${d.frequency.sample.draws} kỳ · χ² hiệu chỉnh p = ${pv(d.frequency.chiSquare.pValue)} · ${d.frequency.sample.note}`}>
                <FrequencyHeatmap numbers={d.frequency.numbers} />
              </Card>
              <Card title="Chẵn / lẻ: quan sát so với kỳ vọng" subtitle={`p = ${pv(d.oddEven.chiSquare.pValue)} — ${d.oddEven.chiSquare.conclusion}`}>
                <ObservedExpectedBar title="Biểu đồ chẵn lẻ" categories={d.oddEven.categories} />
              </Card>
              <Card title="Xu hướng tổng các số (100 kỳ gần nhất)" subtitle="Đường nét đứt: giá trị kỳ vọng lý thuyết">
                <SumTrend series={d.sumSeries} expectedMean={(game!.mainPicks * (game!.mainMin + game!.mainMax)) / 2} />
              </Card>
              <Card title="Thấp / cao" subtitle={`Thấp ≤ ${d.lowHigh.lowMax} · p = ${pv(d.lowHigh.chiSquare.pValue)}`}>
                <ObservedExpectedBar title="Biểu đồ phân phối thấp cao" categories={d.lowHigh.categories} />
              </Card>
            </div>
          )}
          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="Lịch sử kỳ quay" className="lg:col-span-2" actions={<Link className="text-xs text-primary hover:underline" to="/data">Xem tất cả</Link>}>
              {d.recentDraws.length === 0 ? (
                <EmptyState title="Chưa có kỳ quay nào" />
              ) : (
                <Table head={['Kỳ', 'Ngày', 'Kết quả', 'Trạng thái']}>
                  {d.recentDraws.map((r: any) => (
                    <tr key={r.id}>
                      <Td className="tabular text-muted">#{r.drawCode}</Td>
                      <Td className="whitespace-nowrap text-muted">
                        {dateOnly(r.drawDate)} {r.drawTime ?? ''}
                      </Td>
                      <Td>
                        <Balls main={r.main} special={r.special} size="sm" />
                      </Td>
                      <Td>{r.verificationStatus === 'verified' ? <Badge tone="good">Đã xác minh</Badge> : r.verificationStatus === 'rejected' ? <Badge tone="bad">Từ chối</Badge> : <Badge tone="warn">Chưa xác minh</Badge>}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <Card title="Ngân sách" actions={<Link className="text-xs text-primary hover:underline" to="/capital">Chi tiết</Link>}>
              <dl className="space-y-2 text-sm">
                {[
                  ['Ngân sách / kỳ', vnd(d.capital.budgetPerDraw)],
                  ['Đã chi tháng này', vnd(d.capital.monthSpent)],
                  ['Còn lại tháng', vnd(d.capital.monthRemaining)],
                  ['Đã chi năm nay', vnd(d.capital.yearSpent)],
                  ['ROI thực tế', d.capital.roi == null ? '—' : pct(d.capital.roi, 1)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-muted">{k}</dt>
                    <dd className="tabular font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2" aria-label="Tỷ lệ đã dùng hạn mức tháng">
                <div className="h-full bg-primary" style={{ width: `${Math.min(100, (100 * d.capital.monthSpent) / Math.max(1, d.capital.monthlyBudget))}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted">Danh mục: {num(d.portfolios?.total ?? 0)} · chờ kết quả {num(d.portfolios?.pending ?? 0)} · đã chấm {num(d.portfolios?.evaluated ?? 0)}</p>
            </Card>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Hiệu quả mô hình (backtest gần đây)" actions={<Link className="text-xs text-primary hover:underline" to="/backtesting">Backtesting</Link>}>
              {d.backtests.length === 0 ? (
                <EmptyState title="Chưa có phiên backtest" description="Chạy walk-forward backtest để đánh giá chiến lược so với baseline ngẫu nhiên." />
              ) : (
                <ul className="divide-y divide-line/60 text-sm">
                  {d.backtests.map((b: any) => (
                    <li key={b.id} className="flex items-center justify-between gap-2 py-2">
                      <Link to={`/backtesting?id=${b.id}`} className="hover:underline">
                        #{b.id} · {b.strategies.join(', ')}
                      </Link>
                      <Badge tone={b.status === 'completed' ? 'good' : b.status === 'failed' ? 'bad' : 'warn'}>{b.status === 'completed' ? 'Hoàn tất' : b.status === 'failed' ? 'Thất bại' : 'Đang chạy'}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Hoạt động gần đây">
              {d.activity.length === 0 ? (
                <EmptyState title="Chưa có hoạt động" />
              ) : (
                <ul className="divide-y divide-line/60 text-sm">
                  {d.activity.map((a: any) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        {RUN_TYPE[a.run_type] ?? a.run_type} · <span className="text-muted">{a.model_name} v{a.version}</span>
                      </span>
                      <span className="text-xs text-muted">{dateTime(a.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

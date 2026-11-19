import { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { apiFetch, ApiClientError } from '../lib/api';
import { useGame } from '../lib/game';
import { num, pct, pv, two, vnd } from '../lib/format';
import { Badge, Button, Card, EmptyState, Field, Input, Kpi, Notice, PageHeader, Select, Table, Tabs, Td } from '../components/ui';
import { Chart, CHART, axis } from '../components/Chart';
import { useToast } from '../components/toast';

type Model = 'bayesian_analysis' | 'markov' | 'monte_carlo' | 'ml_research' | 'behavior';

function useRunner() {
  const { code } = useGame();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any | null>(null);
  const run = async (model: Model, params: Record<string, unknown>, seed?: string, unverified?: boolean) => {
    setBusy(true);
    try {
      const r = await apiFetch('/models/run', { body: { game: code, model, params, seed: seed || null, include_unverified: unverified ?? false } });
      setRes(r.data);
    } catch (e) {
      toast('error', e instanceof ApiClientError ? e.message : 'Không chạy được mô hình');
    } finally {
      setBusy(false);
    }
  };
  return { busy, res, run };
}

function RunMeta({ res }: { res: any }) {
  return (
    <p className="mt-3 text-[11px] text-muted">
      Lần chạy #{res.modelRunId} · v{res.modelVersion} · seed {res.seed} · {res.dataDrawCount} kỳ dữ liệu · dataset <span className="font-mono">{res.datasetHash.slice(0, 12)}…</span>
    </p>
  );
}

function Bayes() {
  const { busy, res, run } = useRunner();
  const [prior, setPrior] = useState(100);
  const [level, setLevel] = useState(0.95);
  const r = res?.result;
  const opt = useMemo(
    () =>
      r && {
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: r.posteriors.map((p: any) => two(p.number)), ...axis({ axisLabel: { color: CHART.muted, fontSize: 9 } }) },
        yAxis: { type: 'value', scale: true, ...axis() },
        series: [
          { type: 'line', name: 'Cận dưới', data: r.posteriors.map((p: any) => p.low), lineStyle: { opacity: 0 }, stack: 'ci', symbol: 'none' },
          { type: 'line', name: 'Khoảng tin cậy', data: r.posteriors.map((p: any) => p.high - p.low), lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(59,130,246,0.25)' }, stack: 'ci', symbol: 'none' },
          { type: 'scatter', name: 'Trung bình posterior', data: r.posteriors.map((p: any) => p.mean), itemStyle: { color: CHART.primary }, symbolSize: 6 },
          { type: 'line', name: 'p₀ đồng đều', data: r.posteriors.map(() => r.uniformRate), lineStyle: { color: CHART.warn, type: 'dashed' }, symbol: 'none' },
        ],
      },
    [r],
  );
  return (
    <Card title="Bayesian Engine — Beta-Binomial & Dirichlet" subtitle="Prior neo tại xác suất đồng đều p₀ = K/N; độ mạnh prior = số kỳ quan sát giả định.">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Độ mạnh prior">
          <Input type="number" min={0.1} value={prior} onChange={(e) => setPrior(Number(e.target.value))} className="w-32" />
        </Field>
        <Field label="Mức tin cậy">
          <Select value={level} onChange={(e) => setLevel(Number(e.target.value))} className="w-32">
            <option value={0.9}>90%</option>
            <option value={0.95}>95%</option>
            <option value={0.99}>99%</option>
          </Select>
        </Field>
        <Button variant="primary" loading={busy} onClick={() => run('bayesian_analysis', { priorStrength: prior, credibleLevel: level })}>
          <Play className="h-4 w-4" aria-hidden /> Chạy
        </Button>
      </div>
      {r && (
        <div className="mt-4 space-y-4">
          <Notice tone="info">{r.interpretation}</Notice>
          <Chart option={opt} height={300} ariaLabel="Khoảng tin cậy posterior cho từng số" />
          <div>
            <div className="mb-2 text-xs font-medium text-muted">Độ nhạy prior: khoảng chênh posterior giữa các số</div>
            <Table head={['Độ mạnh prior', 'Min', 'Max', 'Chênh']}>
              {r.sensitivity.map((s: any) => (
                <tr key={s.priorStrength}>
                  <Td className="tabular">{s.priorStrength}</Td>
                  <Td className="tabular">{num(s.minMean, 5)}</Td>
                  <Td className="tabular">{num(s.maxMean, 5)}</Td>
                  <Td className="tabular">{num(s.spread, 5)}</Td>
                </tr>
              ))}
            </Table>
          </div>
          <RunMeta res={res} />
        </div>
      )}
    </Card>
  );
}

function Markov() {
  const { busy, res, run } = useRunner();
  const [lag, setLag] = useState(10);
  const r = res?.result;
  return (
    <Card title="Markov Analysis — kiểm định phụ thuộc chuỗi" subtitle="So sánh với H0: các kỳ quay độc lập. Không mặc định có tính Markov.">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Độ trễ tối đa">
          <Input type="number" min={1} max={30} value={lag} onChange={(e) => setLag(Number(e.target.value))} className="w-32" />
        </Field>
        <Button variant="primary" loading={busy} onClick={() => run('markov', { maxLag: lag })}>
          <Play className="h-4 w-4" aria-hidden /> Chạy
        </Button>
      </div>
      {r && (
        <div className="mt-4 space-y-4">
          <Notice tone={/Phát hiện/.test(r.conclusion) ? 'warn' : 'info'}>{r.conclusion}</Notice>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="P(xuất hiện | kỳ trước có)" value={pct(r.pooled.pRepeat, 2)} hint={`Đồng đều: ${pct(r.uniformRate, 2)}`} />
            <Kpi label="P(xuất hiện | kỳ trước không)" value={pct(r.pooled.pAfterAbsent, 2)} />
            <Kpi label="χ² chuyển trạng thái" value={pv(r.pooled.pValue)} hint="p-value (gộp)" />
            <Kpi label="Số trùng kỳ liền kề" value={num(r.overlap.observedMean, 3)} hint={`Kỳ vọng ${num(r.overlap.expectedMean, 3)} · p = ${pv(r.overlap.pValue)}`} />
          </div>
          <Table head={['Độ trễ', 'ACF chỉ báo TB', 'z', 'ACF tổng', 'p (tổng)']}>
            {r.lagCorrelation.map((l: any) => (
              <tr key={l.lag}>
                <Td>{l.lag}</Td>
                <Td className="tabular">{num(l.meanIndicatorAcf, 4)}</Td>
                <Td className="tabular">{num(l.zIndicator, 2)}</Td>
                <Td className="tabular">{num(l.sumAcf, 4)}</Td>
                <Td className="tabular">{pv(l.pSum)}</Td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-muted">Số lượng số có phụ thuộc lag-1 có ý nghĩa sau FDR 5%: {r.significantAfterFdr}.</p>
          <RunMeta res={res} />
        </div>
      )}
    </Card>
  );
}

function MonteCarlo() {
  const { busy, res, run } = useRunner();
  const [f, setF] = useState({ draws: 10000, tickets: 10, strategy: 'random_uniform', seed: '', recId: '' });
  const r = res?.result;
  return (
    <Card title="Monte Carlo Engine" subtitle="Mô phỏng kỳ quay đồng đều theo thể lệ với seed. Giới hạn 2.000.000 (vé × kỳ) mỗi lần chạy.">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Số kỳ mô phỏng">
          <Input type="number" min={1} value={f.draws} onChange={(e) => setF({ ...f, draws: Number(e.target.value) })} />
        </Field>
        <Field label="Số vé">
          <Input type="number" min={1} max={200} value={f.tickets} onChange={(e) => setF({ ...f, tickets: Number(e.target.value) })} />
        </Field>
        <Field label="Chiến lược sinh vé">
          <Select value={f.strategy} onChange={(e) => setF({ ...f, strategy: e.target.value })}>
            <option value="random_uniform">Ngẫu nhiên đồng đều</option>
            <option value="balanced">Cân bằng</option>
            <option value="portfolio_optimized">Tối ưu danh mục</option>
          </Select>
        </Field>
        <Field label="Hoặc dùng bộ số #">
          <Input inputMode="numeric" placeholder="ID bản ghi" value={f.recId} onChange={(e) => setF({ ...f, recId: e.target.value })} />
        </Field>
        <Field label="Seed">
          <Input value={f.seed} onChange={(e) => setF({ ...f, seed: e.target.value })} />
        </Field>
        <div className="flex items-end">
          <Button variant="primary" className="w-full" loading={busy} disabled={f.draws * f.tickets > 2_000_000} onClick={() => run('monte_carlo', { draws: f.draws, ticketCount: f.tickets, strategy: f.strategy, ...(f.recId ? { recommendationId: Number(f.recId) } : {}) }, f.seed)}>
            <Play className="h-4 w-4" aria-hidden /> Mô phỏng
          </Button>
        </div>
      </div>
      {r && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Kỳ có ≥1 vé trúng" value={pct(r.anyPrize.drawRate, 2)} hint={`KTC 95%: ${pct(r.anyPrize.ci95.low, 2)} – ${pct(r.anyPrize.ci95.high, 2)}`} />
            <Kpi label="Tổng chi phí mô phỏng" value={vnd(r.finance.totalCost)} />
            <Kpi label="Giải cố định nhận" value={vnd(r.finance.totalFixedPrizes)} hint={`Jackpot: ${r.finance.jackpotHits} lần`} />
            <Kpi label="ROI (giải cố định)" value={pct(r.finance.roiFixedOnly, 1)} tone={r.finance.roiFixedOnly < 0 ? 'bad' : 'good'} />
          </div>
          <Table head={['Hạng giải', 'Số lần', 'Tần suất mô phỏng', 'Lý thuyết', 'KTC 95%', 'Khớp lý thuyết']}>
            {r.tiers.map((t: any) => (
              <tr key={t.code}>
                <Td>{t.name}</Td>
                <Td className="tabular">{num(t.hits)}</Td>
                <Td className="tabular">{t.observedRate.toExponential(3)}</Td>
                <Td className="tabular">{t.theoreticalRate.toExponential(3)}</Td>
                <Td className="tabular text-xs text-muted">
                  {t.ci95.low.toExponential(2)} – {t.ci95.high.toExponential(2)}
                </Td>
                <Td>{t.consistent ? <Badge tone="good">Có</Badge> : <Badge tone="warn">Lệch</Badge>}</Td>
              </tr>
            ))}
          </Table>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
            {r.notes.map((n: string) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <RunMeta res={res} />
        </div>
      )}
    </Card>
  );
}

const ML_LABEL: Record<string, string> = { logistic_regression: 'Logistic Regression', random_forest: 'Random Forest', gradient_boosting: 'Gradient Boosting' };

function Ml() {
  const { busy, res, run } = useRunner();
  const [models, setModels] = useState(['logistic_regression', 'random_forest', 'gradient_boosting']);
  const [maxDraws, setMaxDraws] = useState(400);
  const [seed, setSeed] = useState('');
  const r = res?.result;
  return (
    <Card title="Machine Learning Research" subtitle="Dự báo xác suất mỗi số xuất hiện; chia train/test theo thời gian; luôn so với baseline đồng đều p = K/N.">
      <div className="flex flex-wrap items-end gap-3">
        {Object.entries(ML_LABEL).map(([k, v]) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-blue-500" checked={models.includes(k)} onChange={() => setModels((m) => (m.includes(k) ? m.filter((x) => x !== k) : [...m, k]))} />
            {v}
          </label>
        ))}
        <Field label="Số kỳ gần nhất (≤ 600)">
          <Input type="number" min={70} max={600} value={maxDraws} onChange={(e) => setMaxDraws(Number(e.target.value))} className="w-32" />
        </Field>
        <Field label="Seed">
          <Input value={seed} onChange={(e) => setSeed(e.target.value)} className="w-32" />
        </Field>
        <Button variant="primary" loading={busy} disabled={!models.length} onClick={() => run('ml_research', { models, maxDraws }, seed)}>
          <Play className="h-4 w-4" aria-hidden /> Huấn luyện & kiểm định
        </Button>
      </div>
      {r && (
        <div className="mt-4 space-y-4">
          <Notice tone={r.models.some((m: any) => m.beatsBaseline) ? 'warn' : 'info'}>{r.verdict}</Notice>
          <Table head={['Mô hình', 'Log loss', 'Baseline', 'Brier skill', 'AUC', 'Chênh log loss/kỳ (KTC 95%)', 'Kết luận', 'Đặc trưng quan trọng nhất']}>
            {r.models.map((m: any) => (
              <tr key={m.model}>
                <Td>{ML_LABEL[m.model]}</Td>
                <Td className="tabular">{num(m.test.logLoss, 5)}</Td>
                <Td className="tabular text-muted">{num(m.baseline.logLoss, 5)}</Td>
                <Td className="tabular">{pct(m.brierSkill, 3)}</Td>
                <Td className="tabular">{num(m.test.auc, 3)}</Td>
                <Td className="tabular whitespace-nowrap text-xs">
                  {num(m.logLossDiff.mean, 5)} [{num(m.logLossDiff.low, 5)}; {num(m.logLossDiff.high, 5)}]
                </Td>
                <Td>{m.beatsBaseline ? <Badge tone="warn">Vượt (cần xác nhận)</Badge> : <Badge>Không vượt</Badge>}</Td>
                <Td className="text-xs text-muted">{m.featureImportance[0]?.feature}</Td>
              </tr>
            ))}
          </Table>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
            {r.notes.map((n: string) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <RunMeta res={res} />
        </div>
      )}
    </Card>
  );
}

function Behavior() {
  const { game } = useGame();
  const { busy, res, run } = useRunner();
  const [nums, setNums] = useState('');
  const r = res?.result;
  return (
    <Card title="Human Behavior Analysis" subtitle="Ước lượng mức phổ biến của bộ số (heuristic). Không có dữ liệu bán vé — không biết chính xác số người cùng chọn.">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={`Bộ số chính (${game?.mainPicks} số)`}>
          <Input value={nums} onChange={(e) => setNums(e.target.value)} placeholder="vd 01 02 03 04 05" className="w-64" />
        </Field>
        <Button variant="primary" loading={busy} disabled={!nums.trim()} onClick={() => run('behavior', { numbers: nums.split(/[\s,;-]+/).filter(Boolean).map(Number) })}>
          <Play className="h-4 w-4" aria-hidden /> Phân tích
        </Button>
      </div>
      {r && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Kpi label="Điểm phổ biến" value={num(r.score, 1)} hint="0–100" />
            <Kpi label="Percentile so với bộ số ngẫu nhiên" value={`${num(r.percentile, 0)}%`} tone={r.percentile > 75 ? 'warn' : 'default'} />
            <Kpi label="Mức" value={r.level} />
          </div>
          <Table head={['Yếu tố', 'Giá trị', 'Trọng số', 'Đóng góp']}>
            {r.features.map((f: any) => (
              <tr key={f.key}>
                <Td>{f.label}</Td>
                <Td className="tabular">{num(f.value, 2)}</Td>
                <Td className="tabular text-muted">{f.weight}</Td>
                <Td className="tabular">{num(f.contribution, 2)}</Td>
              </tr>
            ))}
          </Table>
          <Notice tone="info">{r.disclaimer}</Notice>
        </div>
      )}
    </Card>
  );
}

export default function Research() {
  const [tab, setTab] = useState<Model>('bayesian_analysis');
  return (
    <>
      <PageHeader title="AI Research" description="Phòng thí nghiệm mô hình. Mỗi lần chạy được lưu (phiên bản, tham số, seed, mốc dữ liệu). Mô hình phải được so với baseline trước khi diễn giải." />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'bayesian_analysis', label: 'Bayes' },
          { value: 'markov', label: 'Markov' },
          { value: 'monte_carlo', label: 'Monte Carlo' },
          { value: 'ml_research', label: 'Machine Learning' },
          { value: 'behavior', label: 'Hành vi' },
        ]}
      />
      {tab === 'bayesian_analysis' && <Bayes />}
      {tab === 'markov' && <Markov />}
      {tab === 'monte_carlo' && <MonteCarlo />}
      {tab === 'ml_research' && <Ml />}
      {tab === 'behavior' && <Behavior />}
      {!tab && <EmptyState title="Chọn mô hình" />}
    </>
  );
}

import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleAlert, FileDown, FileSpreadsheet, UploadCloud } from 'lucide-react';
import { useStudio } from '../../components/studio/StudioContext';
import { PageHeader, Panel } from '../../components/studio/StudioLayout';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/Field';
import { Badge } from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { api, type GuestInput, type ImportResult } from '../../lib/api';
import { downloadTemplate, guessField, readSpreadsheet, targetFields, type Sheet, type TargetField } from '../../lib/excel';
import { cx } from '../../lib/format';

const steps = ['Tải file', 'Ánh xạ cột', 'Kiểm tra dữ liệu', 'Hoàn tất'];

interface CheckedRow {
  line: number;
  data: GuestInput;
  issues: string[];
  duplicateExisting: boolean;
}

export default function ImportExcel() {
  const { guests, reload } = useStudio();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [map, setMap] = useState<TargetField[]>([]);
  const [mode, setMode] = useState<'skip' | 'overwrite'>('skip');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);

  const load = async (f: File) => {
    setError('');
    setBusy(true);
    try {
      const s = await readSpreadsheet(f);
      const guessed = s.headers.map(guessField);
      // Mỗi trường chỉ gán cho một cột.
      const seen = new Set<TargetField>();
      setMap(guessed.map((g) => (g && !seen.has(g) ? (seen.add(g), g) : '')));
      setFile(f);
      setSheet(s);
      setStep(1);
    } catch (e) {
      setError((e as Error).message || 'Không đọc được file');
    } finally {
      setBusy(false);
    }
  };

  const missingRequired = targetFields.filter((t) => t.required && !map.includes(t.value)).map((t) => t.label);

  const checked: CheckedRow[] = useMemo(() => {
    if (!sheet) return [];
    const existing = new Set(guests.map((g) => g.guest_id.toUpperCase()));
    const counts = new Map<string, number>();
    const rows = sheet.rows.map((r, i) => {
      const get = (f: TargetField) => {
        const idx = map.indexOf(f);
        return idx >= 0 ? (r[idx] ?? '').replace(/\s+/g, ' ').trim() : '';
      };
      const salutation = get('salutation');
      const guest_name = get('guest_name');
      const data: GuestInput = {
        guest_id: get('guest_id').toUpperCase(),
        guest_name,
        salutation,
        display_name: get('display_name') || `${salutation} ${guest_name}`.trim(),
        guest_group: get('guest_group'),
        note: get('note'),
      };
      counts.set(data.guest_id, (counts.get(data.guest_id) ?? 0) + 1);
      return { line: i + 2, data, issues: [] as string[], duplicateExisting: false };
    });
    for (const r of rows) {
      const d = r.data;
      if (!d.guest_id) r.issues.push('Thiếu mã khách');
      else if (!/^[A-Z0-9][A-Z0-9_.-]{0,39}$/.test(d.guest_id)) r.issues.push('Mã khách chỉ gồm chữ không dấu, số, - _ .');
      if (d.guest_id && (counts.get(d.guest_id) ?? 0) > 1) r.issues.push(`Trùng mã ${d.guest_id} trong file`);
      if (!d.guest_name) r.issues.push('Thiếu tên khách mời');
      if (/\{\{|\}\}|undefined|null/i.test(d.display_name)) r.issues.push('Tên hiển thị chứa giá trị không hợp lệ');
      if (d.display_name.length > 60) r.issues.push('Tên hiển thị quá dài (> 60 ký tự)');
      r.duplicateExisting = existing.has(d.guest_id);
    }
    return rows;
  }, [sheet, map, guests]);

  const valid = checked.filter((r) => !r.issues.length);
  const willCreate = valid.filter((r) => !r.duplicateExisting).length;
  const dupExisting = valid.filter((r) => r.duplicateExisting).length;
  const invalid = checked.length - valid.length;

  const doImport = async () => {
    setBusy(true);
    try {
      const res = await api.importGuests(valid.map((r) => r.data), mode);
      setResult(res);
      await reload();
      setStep(3);
      toast({ kind: 'success', title: `Đã nhập ${res.created + res.updated} khách`, body: file?.name });
    } catch (e) {
      toast({ kind: 'warning', title: 'Nhập không thành công', body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep(0);
    setFile(null);
    setSheet(null);
    setResult(null);
    if (input.current) input.current.value = '';
  };

  const canGo = (i: number) => i === 0 || (i === 1 && !!sheet) || (i === 2 && !!sheet && !missingRequired.length) || (i === 3 && !!result);

  return (
    <>
      <PageHeader
        eyebrow="Import"
        title="Nhập danh sách từ Excel"
        description="Hỗ trợ XLSX và CSV (UTF-8), giữ nguyên tiếng Việt có dấu. Kiểm tra lỗi và mã trùng trước khi nhập."
        actions={
          <Button variant="secondary" icon={<FileDown className="size-4" />} onClick={() => downloadTemplate()}>
            Tải file mẫu
          </Button>
        }
      >
        <ol className="mt-7 grid grid-cols-4 gap-2">
          {steps.map((s, i) => (
            <li key={s}>
              <button disabled={!canGo(i)} onClick={() => setStep(i)} className="group w-full text-left disabled:cursor-default">
                <span className={cx('block h-[2px] rounded-full transition-colors', i <= step ? 'bg-burgundy-700' : 'bg-espresso/10')} />
                <span className={cx('mt-2.5 flex items-center gap-2 text-[12.5px]', i === step ? 'font-semibold text-burgundy-700' : 'text-espresso-soft')}>
                  <span
                    className={cx(
                      'grid size-5 shrink-0 place-items-center rounded-full text-[10.5px]',
                      i < step ? 'bg-burgundy-700 text-ivory' : i === step ? 'border border-burgundy-700' : 'border border-espresso/20',
                    )}
                  >
                    {i < step ? <Check className="size-3" /> : i + 1}
                  </span>
                  <span className="hidden sm:inline">{s}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </PageHeader>

      <div className="px-4 py-8 sm:px-8">
        {step === 0 && (
          <Panel className="p-6 sm:p-10">
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const f = e.dataTransfer.files[0];
                if (f) load(f);
              }}
              className={cx(
                'flex cursor-pointer flex-col items-center rounded-[18px] border-[1.5px] border-dashed px-6 py-14 text-center transition-colors',
                drag ? 'border-burgundy-600 bg-rose-soft/50' : 'border-champagne bg-ivory/80 hover:bg-ivory',
              )}
            >
              <div className="grid size-16 place-items-center rounded-full bg-beige/70">
                <UploadCloud className="size-7 text-burgundy-700" strokeWidth={1.4} />
              </div>
              <p className="mt-5 font-serif text-[26px] text-burgundy-800">{busy ? 'Đang đọc file…' : 'Kéo thả file vào đây'}</p>
              <p className="mt-1 text-[13.5px] text-espresso-soft">.xlsx hoặc .csv · tối đa 3.000 dòng</p>
              <span className="mt-6 inline-flex h-10 items-center gap-2 rounded-full bg-burgundy-700 px-5 text-sm font-medium text-ivory">
                <FileSpreadsheet className="size-4" /> Chọn file từ máy
              </span>
              <input
                ref={input}
                type="file"
                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
              />
            </label>
            {error && <p className="mt-4 rounded-xl bg-rose-soft px-4 py-3 text-[13px] text-burgundy-700">{error}</p>}
            <div className="mt-8 grid gap-4 text-[13px] text-espresso-soft sm:grid-cols-3">
              <Tip n="01" t="Một khách mỗi dòng" d="Mã khách là duy nhất — không dùng tên làm mã." />
              <Tip n="02" t="Xưng hô do bạn chọn" d="Hệ thống không tự đoán giới tính hay quan hệ." />
              <Tip n="03" t="Giữ nguyên dấu" d="Lưu CSV với mã hoá UTF-8; XLSX giữ dấu tự động." />
            </div>
          </Panel>
        )}

        {step === 1 && sheet && (
          <Panel className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-espresso/8 px-6 py-4">
              <FileSpreadsheet className="size-5 text-[#3d5a3a]" strokeWidth={1.5} />
              <div className="mr-auto">
                <p className="text-[14px] font-medium text-espresso">{file?.name}</p>
                <p className="text-[12px] text-espresso-soft">
                  {sheet.rows.length} dòng · {sheet.headers.length} cột
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={reset}>
                Chọn file khác
              </Button>
            </div>
            <ul className="divide-y divide-espresso/6">
              {sheet.headers.map((h, i) => (
                <li key={i} className="grid grid-cols-1 items-center gap-2 px-6 py-3.5 sm:grid-cols-[1fr_auto_1fr] sm:gap-6">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-espresso">{h}</p>
                    <p className="truncate text-[12px] text-espresso-soft">VD: {sheet.rows.slice(0, 2).map((r) => r[i]).filter(Boolean).join(' · ') || '—'}</p>
                  </div>
                  <ArrowRight className="hidden size-4 text-champagne-deep sm:block" />
                  <select
                    aria-label={`Ánh xạ cột ${h}`}
                    value={map[i]}
                    onChange={(e) => {
                      const v = e.target.value as TargetField;
                      setMap((m) => m.map((x, j) => (j === i ? v : v && x === v ? '' : x)));
                    }}
                    className="w-full rounded-lg border border-espresso/12 bg-white px-3 py-2 text-[13px] text-espresso"
                  >
                    {targetFields.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                        {t.required ? ' *' : ''}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
            {missingRequired.length > 0 && (
              <p className="border-t border-espresso/8 bg-rose-soft/50 px-6 py-3 text-[13px] text-burgundy-700">Chưa chọn cột cho: {missingRequired.join(', ')}</p>
            )}
            <p className="border-t border-espresso/8 bg-ivory-deep/50 px-6 py-3 text-[12px] text-espresso-soft">
              Không có cột “Tên hiển thị” thì hệ thống ghép “Xưng hô + Tên khách”.
            </p>
          </Panel>
        )}

        {step === 2 && (
          <>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[20px] border border-espresso/8 bg-espresso/8 sm:grid-cols-4">
              {[
                { l: 'Khách mới', v: willCreate, c: 'text-[#3d5a3a]' },
                { l: 'Trùng với danh sách hiện có', v: dupExisting, c: 'text-champagne-deep' },
                { l: 'Cần sửa (sẽ bỏ qua)', v: invalid, c: 'text-burgundy-600' },
                { l: 'Tổng dòng', v: checked.length, c: 'text-espresso' },
              ].map((s) => (
                <div key={s.l} className="bg-ivory p-5">
                  <p className="text-[12.5px] text-espresso-soft">{s.l}</p>
                  <p className={cx('mt-1 font-serif text-[38px] leading-none font-medium', s.c)}>{s.v}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              {dupExisting > 0 ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[13px] text-espresso-soft">Khách trùng mã:</span>
                  <Segmented
                    size="sm"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'skip', label: 'Giữ khách cũ' },
                      { value: 'overwrite', label: 'Cập nhật theo file' },
                    ]}
                  />
                </div>
              ) : (
                <span />
              )}
              <label className="flex items-center gap-2 text-[13px] text-espresso-soft">
                <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} className="accent-burgundy-700" /> Chỉ xem dòng cần sửa
              </label>
            </div>

            <Panel className="mt-4 max-h-[60dvh] overflow-auto">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead className="sticky top-0">
                  <tr className="border-b border-espresso/8 bg-ivory-deep text-[11.5px] tracking-[0.08em] text-espresso-soft uppercase">
                    <th className="px-4 py-3 font-medium">Dòng</th>
                    <th className="px-4 py-3 font-medium">Mã khách</th>
                    <th className="px-4 py-3 font-medium">Tên khách mời</th>
                    <th className="px-4 py-3 font-medium">Tên trên thiệp</th>
                    <th className="px-4 py-3 font-medium">Nhóm</th>
                    <th className="px-4 py-3 font-medium">Kiểm tra</th>
                  </tr>
                </thead>
                <tbody>
                  {checked
                    .filter((r) => !onlyIssues || r.issues.length)
                    .map((r) => (
                      <tr key={r.line} className={cx('border-b border-espresso/6 last:border-0', r.issues.length > 0 && 'bg-rose-soft/40')}>
                        <td className="px-4 py-2.5 text-espresso-soft">{r.line}</td>
                        <td className="px-4 py-2.5 font-mono text-[12px]">{r.data.guest_id || '—'}</td>
                        <td className="px-4 py-2.5">{r.data.guest_name || <span className="text-burgundy-600 italic">— trống —</span>}</td>
                        <td className="px-4 py-2.5">{r.data.display_name}</td>
                        <td className="px-4 py-2.5 text-espresso-soft">{r.data.guest_group}</td>
                        <td className="px-4 py-2.5">
                          {r.issues.length ? (
                            <span className="inline-flex items-start gap-1.5 text-[12.5px] text-burgundy-600">
                              <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {r.issues.join(' · ')}
                            </span>
                          ) : r.duplicateExisting ? (
                            <Badge tone="gold">{mode === 'skip' ? 'Trùng — giữ khách cũ' : 'Trùng — cập nhật'}</Badge>
                          ) : (
                            <Badge tone="success">Hợp lệ</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Panel>
          </>
        )}

        {step === 3 && result && (
          <Panel className="px-6 py-14 text-center">
            <div className="mx-auto grid size-16 place-items-center rounded-full bg-[#e7efe6]">
              <Check className="size-7 text-[#3d5a3a]" />
            </div>
            <p className="mt-5 font-serif text-[30px] text-burgundy-800">Đã nhập xong</p>
            <p className="mx-auto mt-2 max-w-md text-[14px] text-espresso-soft">
              Thêm mới <b className="text-espresso">{result.created}</b> · cập nhật <b className="text-espresso">{result.updated}</b> · giữ nguyên{' '}
              <b className="text-espresso">{result.skipped}</b>
              {invalid > 0 && (
                <>
                  {' '}
                  · bỏ qua <b className="text-burgundy-600">{invalid}</b> dòng lỗi
                </>
              )}
              {result.errors.length > 0 && <> · máy chủ từ chối {result.errors.length} dòng</>}
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <ButtonLink to="/studio/khach-moi" variant="primary">
                Xem danh sách khách
              </ButtonLink>
              <Button variant="ghost" onClick={reset}>
                Nhập file khác
              </Button>
            </div>
          </Panel>
        )}

        {step > 0 && step < 3 && (
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} icon={<ArrowLeft className="size-4" />}>
              Quay lại
            </Button>
            {step === 1 ? (
              <Button variant="primary" disabled={missingRequired.length > 0} onClick={() => setStep(2)}>
                Kiểm tra dữ liệu <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button variant="primary" disabled={busy || valid.length === 0} onClick={doImport}>
                {busy ? 'Đang nhập…' : `Nhập ${mode === 'overwrite' ? valid.length : willCreate} khách`}
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Tip({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <div className="border-t border-champagne/40 pt-4">
      <span className="font-serif text-[18px] text-champagne-deep">{n}</span>
      <p className="mt-1 font-medium text-espresso">{t}</p>
      <p className="mt-0.5 leading-relaxed">{d}</p>
    </div>
  );
}

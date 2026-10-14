import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleAlert, FileDown, FileSpreadsheet, UploadCloud } from 'lucide-react';
import { PageHeader, Panel } from '../../components/studio/StudioLayout';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Badge, DemoTag } from '../../components/ui/StatusBadge';
import { cx } from '../../lib/format';

const steps = ['Tải file', 'Ánh xạ cột', 'Kiểm tra dữ liệu', 'Hoàn tất'];

const sampleColumns = [
  { source: 'Mã KH', target: 'guest_id', label: 'Mã khách' },
  { source: 'Họ và tên', target: 'guest_name', label: 'Tên khách mời' },
  { source: 'Xưng hô', target: 'salutation', label: 'Cách xưng hô' },
  { source: 'Tên in thiệp', target: 'display_name', label: 'Tên hiển thị' },
  { source: 'Nhóm', target: 'guest_group', label: 'Nhóm khách' },
  { source: 'Ghi chú', target: 'note', label: 'Ghi chú' },
];

const sampleRows = [
  { id: 'HM-0101', name: 'Nguyễn Văn A', sal: 'Anh', display: 'Anh Nguyễn Văn A', group: 'Bạn chú rể', issue: null },
  { id: 'HM-0102', name: 'Trần Thị B', sal: 'Chị', display: 'Chị Trần Thị B', group: 'Đồng nghiệp', issue: null },
  { id: 'HM-0103', name: '', sal: 'Chú', display: '', group: 'Họ hàng nhà trai', issue: 'Thiếu tên khách mời' },
  { id: 'HM-0102', name: 'Lê Hoàng C', sal: 'Anh', display: 'Anh Lê Hoàng C', group: 'Đối tác', issue: 'Trùng mã khách HM-0102' },
  { id: 'HM-0105', name: 'Phạm Minh D', sal: '', display: 'Phạm Minh D', group: 'Bạn cô dâu', issue: 'Chưa chọn cách xưng hô' },
];

export default function ImportExcel() {
  const [step, setStep] = useState(0);
  return (
    <>
      <PageHeader
        eyebrow="Import"
        title="Nhập danh sách từ Excel"
        description="Hỗ trợ XLSX và CSV, giữ nguyên tiếng Việt có dấu. Kiểm tra lỗi và mã trùng trước khi nhập."
        actions={
          <Button variant="secondary" soon icon={<FileDown className="size-4" />}>
            Tải file mẫu
          </Button>
        }
      >
        <ol className="mt-7 grid grid-cols-4 gap-2">
          {steps.map((s, i) => (
            <li key={s}>
              <button onClick={() => setStep(i)} className="group w-full text-left">
                <span className={cx('block h-[2px] rounded-full transition-colors', i <= step ? 'bg-burgundy-700' : 'bg-espresso/10')} />
                <span className={cx('mt-2.5 flex items-center gap-2 text-[12.5px]', i === step ? 'font-semibold text-burgundy-700' : 'text-espresso-soft')}>
                  <span className={cx('grid size-5 shrink-0 place-items-center rounded-full text-[10.5px]', i < step ? 'bg-burgundy-700 text-ivory' : i === step ? 'border border-burgundy-700' : 'border border-espresso/20')}>
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
        <div className="mb-4 flex justify-end">
          <DemoTag>Giao diện minh họa · chưa xử lý file thật</DemoTag>
        </div>

        {step === 0 && (
          <Panel className="p-6 sm:p-10">
            <div className="flex flex-col items-center rounded-[18px] border-[1.5px] border-dashed border-champagne bg-ivory/80 px-6 py-14 text-center">
              <div className="grid size-16 place-items-center rounded-full bg-beige/70">
                <UploadCloud className="size-7 text-burgundy-700" strokeWidth={1.4} />
              </div>
              <p className="mt-5 font-serif text-[26px] text-burgundy-800">Kéo thả file vào đây</p>
              <p className="mt-1 text-[13.5px] text-espresso-soft">.xlsx hoặc .csv · tối đa 2.000 dòng</p>
              <Button className="mt-6" variant="primary" soon icon={<FileSpreadsheet className="size-4" />}>
                Chọn file từ máy
              </Button>
            </div>
            <div className="mt-8 grid gap-4 text-[13px] text-espresso-soft sm:grid-cols-3">
              <Tip n="01" t="Một khách mỗi dòng" d="Mã khách là duy nhất — không dùng tên làm mã." />
              <Tip n="02" t="Xưng hô do bạn chọn" d="Hệ thống không tự đoán giới tính hay quan hệ." />
              <Tip n="03" t="Giữ nguyên dấu" d="Lưu file với mã hoá UTF-8 khi dùng CSV." />
            </div>
          </Panel>
        )}

        {step === 1 && (
          <Panel className="overflow-hidden">
            <div className="flex items-center gap-3 border-b border-espresso/8 px-6 py-4">
              <FileSpreadsheet className="size-5 text-[#3d5a3a]" strokeWidth={1.5} />
              <div>
                <p className="text-[14px] font-medium text-espresso">khach-moi-mau.xlsx</p>
                <p className="text-[12px] text-espresso-soft">Sheet “Khách mời” · 38 dòng · 6 cột</p>
              </div>
            </div>
            <ul className="divide-y divide-espresso/6">
              {sampleColumns.map((c) => (
                <li key={c.target} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-6 py-3.5 sm:gap-6">
                  <span className="truncate rounded-lg bg-ivory-deep px-3 py-2 text-[13px] text-espresso">{c.source}</span>
                  <ArrowRight className="size-4 text-champagne-deep" />
                  <span className="flex items-center justify-between gap-2 rounded-lg border border-espresso/12 bg-white px-3 py-2 text-[13px]">
                    <span className="truncate text-espresso">{c.label}</span>
                    <code className="hidden text-[11px] text-espresso-soft sm:inline">{c.target}</code>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {step === 2 && (
          <>
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[20px] border border-espresso/8 bg-espresso/8">
              {[
                { l: 'Hợp lệ', v: 35, c: 'text-[#3d5a3a]' },
                { l: 'Cần sửa', v: 2, c: 'text-burgundy-600' },
                { l: 'Mã trùng', v: 1, c: 'text-champagne-deep' },
              ].map((s) => (
                <div key={s.l} className="bg-ivory p-5">
                  <p className="text-[12.5px] text-espresso-soft">{s.l}</p>
                  <p className={cx('mt-1 font-serif text-[38px] leading-none font-medium', s.c)}>{s.v}</p>
                </div>
              ))}
            </div>
            <Panel className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-espresso/8 bg-ivory-deep/70 text-[11.5px] tracking-[0.08em] text-espresso-soft uppercase">
                    <th className="px-5 py-3 font-medium">Mã khách</th>
                    <th className="px-5 py-3 font-medium">Tên khách mời</th>
                    <th className="px-5 py-3 font-medium">Xưng hô</th>
                    <th className="px-5 py-3 font-medium">Nhóm</th>
                    <th className="px-5 py-3 font-medium">Kiểm tra</th>
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.map((r, i) => (
                    <tr key={i} className={cx('border-b border-espresso/6 last:border-0', r.issue && 'bg-rose-soft/40')}>
                      <td className="px-5 py-3 font-mono text-[12px]">{r.id}</td>
                      <td className="px-5 py-3">{r.name || <span className="text-burgundy-600 italic">— trống —</span>}</td>
                      <td className="px-5 py-3">{r.sal || <span className="text-burgundy-600 italic">— trống —</span>}</td>
                      <td className="px-5 py-3 text-espresso-soft">{r.group}</td>
                      <td className="px-5 py-3">
                        {r.issue ? (
                          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-burgundy-600">
                            <CircleAlert className="size-3.5" /> {r.issue}
                          </span>
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

        {step === 3 && (
          <Panel className="px-6 py-14 text-center">
            <div className="mx-auto grid size-16 place-items-center rounded-full bg-[#e7efe6]">
              <Check className="size-7 text-[#3d5a3a]" />
            </div>
            <p className="mt-5 font-serif text-[30px] text-burgundy-800">Sẵn sàng nhập 35 khách</p>
            <p className="mx-auto mt-2 max-w-md text-[13.5px] text-espresso-soft">3 dòng cần sửa sẽ được giữ lại để bạn xử lý sau. Không ghi đè khách đã có cùng mã.</p>
            <div className="mt-6 flex justify-center gap-2">
              <Button variant="primary" soon>Nhập vào danh sách</Button>
              <ButtonLink to="/studio/khach-moi" variant="ghost">Về danh sách khách</ButtonLink>
            </div>
          </Panel>
        )}

        <div className="mt-6 flex justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)} icon={<ArrowLeft className="size-4" />}>
            Quay lại
          </Button>
          <Button variant="secondary" disabled={step === steps.length - 1} onClick={() => setStep((s) => s + 1)}>
            Xem bước tiếp <ArrowRight className="size-4" />
          </Button>
        </div>
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

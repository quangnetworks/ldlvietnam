import type { Guest } from '../data/types';
import { statusMeta } from '../data/demo';
import { inviteUrl } from './api';

export type TargetField = 'guest_id' | 'guest_name' | 'salutation' | 'display_name' | 'guest_group' | 'note' | '';

export const targetFields: Array<{ value: TargetField; label: string; required?: boolean }> = [
  { value: 'guest_id', label: 'Mã khách', required: true },
  { value: 'guest_name', label: 'Tên khách mời', required: true },
  { value: 'salutation', label: 'Cách xưng hô' },
  { value: 'display_name', label: 'Tên hiển thị trên thiệp' },
  { value: 'guest_group', label: 'Nhóm khách' },
  { value: 'note', label: 'Ghi chú' },
  { value: '', label: '— Bỏ qua cột này —' },
];

export const templateHeaders = ['Mã khách', 'Tên khách mời', 'Cách xưng hô', 'Tên hiển thị trên thiệp', 'Nhóm khách', 'Ghi chú'];

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Đoán cột theo tiêu đề (có dấu / không dấu / tên kỹ thuật). */
export function guessField(header: string): TargetField {
  const h = norm(header);
  if (/^(guest id|ma khach|ma kh|ma|id|stt ma|code)$/.test(h) || h === 'guest_id') return 'guest_id';
  if (/(ten hien thi|ten in thiep|display name|tren thiep)/.test(h)) return 'display_name';
  if (/(xung ho|salutation|danh xung)/.test(h)) return 'salutation';
  if (/(nhom|group|quan he)/.test(h)) return 'guest_group';
  if (/(ghi chu|note)/.test(h)) return 'note';
  if (/(ho va ten|ho ten|ten khach|guest name|^ten$|name)/.test(h)) return 'guest_name';
  return '';
}

export interface Sheet {
  headers: string[];
  rows: string[][];
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toLocaleDateString('vi-VN');
  return String(v).normalize('NFC').trim();
}

/** Đọc CSV (UTF-8, có/không BOM; dấu phân cách , ; hoặc tab; hỗ trợ ngoặc kép). */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export async function readSpreadsheet(file: File): Promise<Sheet> {
  let raw: string[][];
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
    raw = parseCsv(await file.text());
  } else if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser');
    raw = (await readSheet(file)).map((r) => r.map(cell));
  } else {
    throw new Error('Chỉ hỗ trợ file .xlsx hoặc .csv');
  }
  raw = raw.map((r) => r.map(cell)).filter((r) => r.some((c) => c !== ''));
  if (raw.length < 2) throw new Error('File không có dữ liệu (cần dòng tiêu đề và ít nhất một dòng khách)');
  const width = Math.max(...raw.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '');
  return { headers: pad(raw[0]).map((h, i) => h || `Cột ${i + 1}`), rows: raw.slice(1).map(pad) };
}

async function writeXlsx(data: Array<Array<string | number | { value: string | number; fontWeight?: 'bold' }>>, columns: number[], filename: string) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const sheet = data.map((r) => r.map((c) => (typeof c === 'object' ? c : { value: c })));
  const blob = await writeXlsxFile(sheet as never, { columns: columns.map((width) => ({ width })) } as never).toBlob();
  const { downloadBlob } = await import('./exporter');
  downloadBlob(blob, filename);
}

export function downloadTemplate() {
  return writeXlsx(
    [
      templateHeaders.map((h) => ({ value: h, fontWeight: 'bold' as const })),
      ['HM-0001', 'Nguyễn Văn A', 'Anh', 'Anh Nguyễn Văn A', 'Bạn chú rể', 'Ví dụ — xoá dòng này'],
      ['HM-0002', 'Lê Hoàng C', 'Gia đình', 'Gia đình anh Lê Hoàng C', 'Họ hàng nhà trai', ''],
    ],
    [14, 28, 16, 36, 22, 30],
    'mau-danh-sach-khach-moi.xlsx',
  );
}

export function downloadGuestList(guests: Guest[]) {
  const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString('vi-VN') : '');
  return writeXlsx(
    [
      [...templateHeaders, 'Trạng thái thiệp', 'Link thiệp riêng', 'Đã gửi link', 'Mở lần đầu', 'Số lần mở'].map((h) => ({ value: h, fontWeight: 'bold' as const })),
      ...guests.map((g) => [
        g.guest_id,
        g.guest_name,
        g.salutation,
        g.display_name,
        g.guest_group,
        g.note,
        statusMeta[g.invitation_status].label,
        inviteUrl(g),
        fmt(g.link_sent_at),
        fmt(g.opened_at),
        g.open_count ?? 0,
      ]),
    ],
    [14, 28, 14, 36, 20, 24, 14, 44, 18, 18, 10],
    `khach-moi-HM-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

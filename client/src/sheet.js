/** Đọc / tải bảng tính: Excel (.xlsx qua read-excel-file) và CSV (UTF-8, dấu phẩy hoặc chấm phẩy). */

export function parseCsv(text, sep) {
  const s = sep || (text.split('\n')[0].split(';').length > text.split('\n')[0].split(',').length ? ';' : ',');
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === s) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

const pad = (n) => String(n).padStart(2, '0');
const cellText = (v) => (v instanceof Date ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` : v == null ? '' : String(v).trim());

/** Tệp .xlsx / .csv → mảng dòng (mảng ô dạng chuỗi; ngày Excel → YYYY-MM-DD). */
export async function readSheetFile(file) {
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsx } = await import('read-excel-file/browser');
    return (await readXlsx(file)).map((r) => r.map(cellText)).filter((r) => r.some(Boolean));
  }
  if (/\.(csv|txt)$/i.test(file.name)) return parseCsv((await file.text()).replace(/^﻿/, '')).map((r) => r.map(cellText));
  throw new Error('Chỉ hỗ trợ tệp Excel (.xlsx) hoặc CSV');
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '');

/**
 * Dòng tiêu đề + dữ liệu → đối tượng theo cột: columns = [[key, 'Tiêu đề', ...tên khác]].
 * So khớp tiêu đề không phân biệt hoa thường / dấu.
 */
export function rowsToObjects(rows, columns) {
  if (!rows.length) return [];
  const head = rows[0].map(norm);
  const idx = columns.map(([key, ...names]) => [key, head.findIndex((h) => names.map(norm).includes(h) || h === norm(key))]);
  return rows.slice(1).map((r) => Object.fromEntries(idx.filter(([, i]) => i >= 0).map(([k, i]) => [k, r[i] ?? ''])));
}

export function downloadBlob(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function downloadCsv(name, head, rows) {
  const esc = (v) => { const t = v == null ? '' : String(v); return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  downloadBlob(`${name}.csv`, new Blob([`﻿${[head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
}

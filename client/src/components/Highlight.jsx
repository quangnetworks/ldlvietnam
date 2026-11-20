/**
 * Tô sáng các từ khớp với từ khoá tìm kiếm — khớp kiểu "không dấu, không phân biệt hoa thường, theo đầu từ"
 * giống chỉ mục tìm kiếm phía máy chủ (gõ "quyet" vẫn tô "Quyết").
 */
import { Fragment } from 'react';

// Bỏ dấu từng ký tự để giữ nguyên vị trí (độ dài chuỗi không đổi)
const foldChar = (ch) => ch.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().charAt(0) || ch;
const foldKeep = (s) => Array.from(s, foldChar).join('');
const words = (q) => [...new Set(foldKeep(String(q || '')).split(/[^a-z0-9]+/).filter(Boolean))].sort((a, b) => b.length - a.length);

export function highlightRanges(text, q) {
  const src = String(text ?? '');
  const ws = words(q);
  if (!src || !ws.length) return [];
  const f = foldKeep(src);
  const ranges = [];
  for (const w of ws) {
    let i = f.indexOf(w);
    while (i >= 0) {
      const atStart = i === 0 || !/[a-z0-9]/.test(f[i - 1]) || (/\d/.test(f[i]) !== /\d/.test(f[i - 1]));
      if (atStart) ranges.push([i, i + w.length]);
      i = f.indexOf(w, i + 1);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]);
  }
  return merged;
}

/** <Hl text="Quyết định bổ nhiệm" q="quyet bo" /> */
export function Hl({ text, q }) {
  const src = String(text ?? '');
  const ranges = highlightRanges(src, q);
  if (!ranges.length) return src;
  const out = [];
  let pos = 0;
  ranges.forEach(([a, b], i) => {
    if (a > pos) out.push(<Fragment key={`t${i}`}>{src.slice(pos, a)}</Fragment>);
    out.push(<mark key={`m${i}`} className="hl">{src.slice(a, b)}</mark>);
    pos = b;
  });
  if (pos < src.length) out.push(<Fragment key="end">{src.slice(pos)}</Fragment>);
  return <>{out}</>;
}

/** Đoạn trích quanh từ khớp đầu tiên (cho nội dung dài như tin nhắn). */
export function snippet(text, q, radius = 60) {
  const src = String(text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const r = highlightRanges(src, q)[0];
  if (!r || src.length <= radius * 2) return src.slice(0, radius * 2);
  const start = Math.max(0, r[0] - radius);
  return `${start ? '…' : ''}${src.slice(start, r[0] + radius)}${r[0] + radius < src.length ? '…' : ''}`;
}

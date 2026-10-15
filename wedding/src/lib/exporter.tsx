import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { toBlob } from 'html-to-image';
import { CARD_H, CARD_W, InvitationCard } from '../components/invitation/InvitationCard';
import type { InvitationDesign } from '../data/design';
import type { Guest } from '../data/types';

/** Ảnh xuất: 1080 × 1920 (thiệp dựng ở 540 × 960, hệ số 2). */
export const EXPORT_SCALE = 2;
export const EXPORT_W = CARD_W * EXPORT_SCALE;
export const EXPORT_H = CARD_H * EXPORT_SCALE;

const FAMILIES = ['Cormorant Garamond', 'Be Vietnam Pro', 'Ballet'];

export function slugify(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'))
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
}

export function fileNameFor(g: Pick<Guest, 'guest_id' | 'display_name'>) {
  return `${g.guest_id}_${slugify(g.display_name) || 'khach'}.png`;
}

let fontCssPromise: Promise<string> | null = null;

/**
 * Nhúng font (latin + tiếng Việt) dưới dạng data URL một lần cho mọi ảnh,
 * để ảnh xuất không bao giờ rơi về font mặc định hay mất dấu.
 */
function fontEmbedCss() {
  fontCssPromise ??= (async () => {
    const rules: CSSFontFaceRule[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let list: CSSRuleList;
      try {
        list = sheet.cssRules;
      } catch {
        continue;
      }
      for (const r of Array.from(list)) {
        if (r instanceof CSSFontFaceRule) {
          const fam = r.style.getPropertyValue('font-family').replace(/['"]/g, '').trim();
          const src = r.style.getPropertyValue('src');
          if (FAMILIES.includes(fam) && !/cyrillic|greek/.test(src)) rules.push(r);
        }
      }
    }
    const toDataUrl = async (url: string) => {
      const buf = await (await fetch(url)).arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return `data:font/woff2;base64,${btoa(bin)}`;
    };
    const parts = await Promise.all(
      rules.map(async (r) => {
        const m = r.style.getPropertyValue('src').match(/url\(["']?([^"')]+\.woff2)["']?\)/);
        if (!m) return '';
        const base = r.parentStyleSheet?.href ?? document.baseURI;
        const data = await toDataUrl(new URL(m[1], base).href);
        const s = r.style;
        return `@font-face{font-family:'${s.getPropertyValue('font-family').replace(/['"]/g, '')}';font-style:${s.getPropertyValue('font-style') || 'normal'};font-weight:${s.getPropertyValue('font-weight') || '400'};font-display:block;src:url(${data}) format('woff2');${s.getPropertyValue('unicode-range') ? `unicode-range:${s.getPropertyValue('unicode-range')};` : ''}}`;
      }),
    );
    return parts.join('\n');
  })().catch((e) => {
    fontCssPromise = null;
    throw e;
  });
  return fontCssPromise;
}

async function ensureFontsLoaded() {
  const samples = [
    '500 44px "Cormorant Garamond"',
    'italic 500 36px "Cormorant Garamond"',
    '600 54px "Cormorant Garamond"',
    'italic 400 13px "Cormorant Garamond"',
    '400 12px "Be Vietnam Pro"',
    '500 12px "Be Vietnam Pro"',
    '600 12px "Be Vietnam Pro"',
    '400 48px "Ballet"',
  ];
  await Promise.all(samples.map((f) => document.fonts.load(f, 'Trần Ước Đặng ỹ')));
  await document.fonts.ready;
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class ExportCheckError extends Error {}

/** Dựng một thiệp ngoài màn hình rồi chụp thành PNG. Có kiểm tra tên khách trước khi chụp. */
export async function renderInvitationPng(displayName: string, design: InvitationDesign, salutation = ''): Promise<Blob> {
  const name = displayName.trim();
  if (!name || /\{\{|\}\}|undefined|null/.test(name)) throw new ExportCheckError('Tên hiển thị trống hoặc còn biến chưa thay');

  const [fontEmbedCSS] = await Promise.all([fontEmbedCss(), ensureFontsLoaded()]);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', width: `${CARD_W}px`, height: `${CARD_H}px`, pointerEvents: 'none' });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<InvitationCard guestName={name} salutation={salutation} design={design} />));
    await frame();
    await frame();
    const card = host.firstElementChild as HTMLElement;
    const nameEl = card.querySelector<HTMLElement>('[data-guest-name]');
    if (design.sections.guest) {
      if (!nameEl || nameEl.textContent !== name) throw new ExportCheckError('Tên khách không hiển thị đúng trên thiệp');
      const box = nameEl.parentElement!;
      if (nameEl.scrollWidth > box.clientWidth + 1 || nameEl.getBoundingClientRect().height > 2.4 * parseFloat(getComputedStyle(nameEl).fontSize) * 1.1)
        throw new ExportCheckError('Tên quá dài — vượt quá 2 dòng');
    }
    const blob = await toBlob(card, {
      width: CARD_W,
      height: CARD_H,
      pixelRatio: EXPORT_SCALE,
      fontEmbedCSS,
      cacheBust: false,
      skipAutoScale: true,
    });
    if (!blob || blob.size < 10_000) throw new Error('Ảnh tạo ra bị trống');
    return blob;
  } finally {
    root.unmount();
    host.remove();
  }
}

let warmed = false;
/** Lần chụp đầu tiên trên một số trình duyệt (Safari) có thể thiếu font — chụp nháp một lần. */
export async function warmUp(design: InvitationDesign) {
  if (warmed) return;
  await renderInvitationPng('Khởi động', design).catch(() => undefined);
  warmed = true;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Chia sẻ ảnh qua Zalo / Messenger trên điện thoại (Web Share API). */
export async function shareFile(blob: Blob, filename: string, text?: string) {
  const file = new File([blob], filename, { type: 'image/png' });
  if (!navigator.canShare?.({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], text });
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw e;
  }
  return true;
}

export async function zipBlobs(files: Array<{ name: string; blob: Blob }>, onProgress?: (p: number) => void): Promise<Blob> {
  const { zip } = await import('fflate');
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const f of files) entries[f.name] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
  onProgress?.(0.5);
  const data = await new Promise<Uint8Array>((res, rej) => zip(entries, (err, out) => (err ? rej(err) : res(out))));
  onProgress?.(1);
  return new Blob([data as BlobPart], { type: 'application/zip' });
}

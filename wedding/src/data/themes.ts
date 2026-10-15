import type { CSSProperties } from 'react';

/**
 * Chủ đề màu thiệp — chọn theo thuần phong mỹ tục cưới hỏi Việt Nam:
 * đỏ (hỷ sự, may mắn), vàng kim (phú quý), hồng (hạnh phúc, viên mãn), kem/ngà (trang nhã).
 * Tránh các màu tối (đen, xám, nâu sẫm, xanh đen) và trắng toát.
 *
 * Mỗi chủ đề ghi đè các biến màu Tailwind (`--color-burgundy-*`, `--color-champagne*`,
 * `--color-ivory*`), nên cùng một bộ giao diện tự đổi màu cho thiệp tĩnh, thiệp động và ảnh PNG.
 */
export type ThemeId = 'burgundy' | 'dosonhy' | 'hongdao' | 'hoangkim' | 'senhong' | 'champagne';

interface Scale {
  50: string;
  100: string;
  300: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
}

export interface ThemeDef {
  id: ThemeId;
  name: string;
  /** Ý nghĩa theo văn hoá Việt, hiển thị khi chọn chủ đề. */
  meaning: string;
  /** Màu chủ đạo — thay cho dải burgundy. */
  scale: Scale;
  gold: { base: string; light: string; deep: string };
  paper: string;
  paperDeep: string;
  /** Khối lời mời trên thiệp tĩnh: nền màu chủ đạo (chữ ngà) hoặc nền sáng (chữ đậm). */
  panel: { kind: 'rich' } | { kind: 'light'; bg: string };
}

export const themes: ThemeDef[] = [
  {
    id: 'burgundy',
    name: 'Đỏ Rượu Vang',
    meaning: 'Sắc đỏ trầm của thiệp in gốc — trang trọng, bền lâu.',
    scale: { 50: '#f9eef0', 100: '#f0d6db', 300: '#b65a69', 500: '#8a2236', 600: '#6e1423', 700: '#5a1020', 800: '#4a0e18', 900: '#300910' },
    gold: { base: '#c9a96e', light: '#e6d3a8', deep: '#9c7c45' },
    paper: '#fbf7f0',
    paperDeep: '#f5eee2',
    panel: { kind: 'rich' },
  },
  {
    id: 'dosonhy',
    name: 'Đỏ Son Hỷ Sự',
    meaning: 'Đỏ son và vàng kim — màu của chữ Song Hỷ, may mắn và sung túc.',
    scale: { 50: '#fdeeec', 100: '#fad4cf', 300: '#ec8a7f', 500: '#d4362b', 600: '#c22a21', 700: '#ad1f19', 800: '#b3241c', 900: '#8f1812' },
    gold: { base: '#d6a84a', light: '#f6dfa0', deep: '#a5781f' },
    paper: '#fff8ee',
    paperDeep: '#fcefdc',
    panel: { kind: 'rich' },
  },
  {
    id: 'hongdao',
    name: 'Hồng Đào',
    meaning: 'Sắc hoa đào ngày xuân — tươi mới, ấm áp, khởi đầu tốt lành.',
    scale: { 50: '#fff1ee', 100: '#fddcd5', 300: '#f0a092', 500: '#df7465', 600: '#cf5f53', 700: '#b84a43', 800: '#b04741', 900: '#8f3833' },
    gold: { base: '#d6a65e', light: '#f7e2bb', deep: '#a77a33' },
    paper: '#fff8f4',
    paperDeep: '#fdebe4',
    panel: { kind: 'light', bg: '#fbdcd3' },
  },
  {
    id: 'hoangkim',
    name: 'Hoàng Kim Phú Quý',
    meaning: 'Vàng kim điểm đỏ cam — phú quý, đủ đầy, vững bền.',
    scale: { 50: '#fdf0e6', 100: '#f9dcc4', 300: '#eb9a68', 500: '#d8642f', 600: '#c85422', 700: '#ae431a', 800: '#bf5223', 900: '#933914' },
    gold: { base: '#c99a35', light: '#f4dd9c', deep: '#9a7020' },
    paper: '#fffaf0',
    paperDeep: '#fbf0d5',
    panel: { kind: 'light', bg: '#f5e2ad' },
  },
  {
    id: 'senhong',
    name: 'Sen Hồng',
    meaning: 'Sắc sen hồng — thanh khiết, gắn bó, trăm năm hoà hợp.',
    scale: { 50: '#fdf0f4', 100: '#f9d9e3', 300: '#eba0b8', 500: '#d6698d', 600: '#c6547b', 700: '#a93f67', 800: '#b44a72', 900: '#8c3156' },
    gold: { base: '#d2ab68', light: '#f4e2bd', deep: '#a37c3b' },
    paper: '#fff8fa',
    paperDeep: '#fcecf1',
    panel: { kind: 'rich' },
  },
  {
    id: 'champagne',
    name: 'Champagne Ngà',
    meaning: 'Kem ngà điểm đỏ rượu — nhẹ nhàng, thanh lịch.',
    scale: { 50: '#f9eef0', 100: '#f0d6db', 300: '#b65a69', 500: '#8a2236', 600: '#6e1423', 700: '#5a1020', 800: '#7a1a2c', 900: '#4a0e18' },
    gold: { base: '#c9a96e', light: '#e6d3a8', deep: '#9c7c45' },
    paper: '#fbf7f0',
    paperDeep: '#f5eee2',
    panel: { kind: 'light', bg: '#efe4d3' },
  },
];

const byId = new Map(themes.map((t) => [t.id, t]));

/** Mã cũ không còn dùng (chủ đề tối) được chuyển về chủ đề gần nhất. */
export function resolveTheme(id: string | undefined): ThemeDef {
  if (id === 'espresso') return byId.get('burgundy')!;
  return byId.get(id as ThemeId) ?? themes[0];
}

/** Biến CSS áp lên phần tử gốc để toàn bộ cây con đổi theo chủ đề. */
export function themeStyle(id: string | undefined): CSSProperties {
  const t = resolveTheme(id);
  const v: Record<string, string> = {
    '--color-ivory': t.paper,
    '--color-ivory-deep': t.paperDeep,
    '--color-champagne': t.gold.base,
    '--color-champagne-light': t.gold.light,
    '--color-champagne-deep': t.gold.deep,
    '--color-rose-soft': t.scale[50],
  };
  for (const k of [50, 100, 300, 500, 600, 700, 800, 900] as const) v[`--color-burgundy-${k}`] = t.scale[k];
  return v as CSSProperties;
}

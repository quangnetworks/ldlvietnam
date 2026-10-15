import type { InvitationDesign } from '../data/design';

const YOUNGER = ['em', 'cháu', 'con'];
const ELDER_OR_PEER = ['ông', 'bà', 'bác', 'chú', 'thím', 'cô', 'dượng', 'dì', 'cậu', 'mợ', 'anh', 'chị', 'thầy', 'quý', 'cụ'];

/** Cách gọi khách trong câu (“Anh”, “Ông Bà”, “Gia đình Anh Chị”…). Không có xưng hô → “Quý Khách”. */
export function addressTerm(salutation: string | undefined) {
  const s = (salutation ?? '').replace(/\s+/g, ' ').trim();
  if (!s || /^quý khách$/i.test(s)) return 'Quý Khách';
  return s.charAt(0).toLocaleUpperCase('vi') + s.slice(1);
}

/** Khách nhỏ tuổi hơn (Em, Cháu, Con…) — dùng lời thân mật thay cho “vinh hạnh”. */
export function isYounger(salutation: string | undefined) {
  const words = (salutation ?? '').toLocaleLowerCase('vi').split(/\s+/).filter(Boolean);
  return words.some((w) => YOUNGER.includes(w)) && !words.some((w) => ELDER_OR_PEER.includes(w));
}

/** Lời cảm ơn cuối thiệp theo xưng hô của khách. Mẫu dùng biến {{xung_ho}}. */
export function thanksFor(text: InvitationDesign['text'], salutation: string | undefined) {
  const tpl = isYounger(salutation) ? text.thanksYoung : text.thanks;
  return tpl.replace(/\{\{\s*xung_ho\s*\}\}/g, addressTerm(salutation));
}

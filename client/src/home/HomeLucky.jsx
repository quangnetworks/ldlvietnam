/**
 * Con số may mắn hôm nay theo Thần số học (Pythagoras), tính từ ngày sinh trong hồ sơ:
 *  - Số chủ đạo  = rút gọn tổng các chữ số của ngày/tháng/năm sinh (giữ số bậc thầy 11, 22, 33)
 *  - Năm cá nhân = rút gọn(ngày sinh + tháng sinh + năm hiện tại)
 *  - Tháng cá nhân = rút gọn(năm cá nhân + tháng hiện tại)
 *  - Ngày cá nhân (con số may mắn hôm nay) = rút gọn(tháng cá nhân + ngày hiện tại)
 * Mang tính tham khảo, giải trí — luôn diễn giải theo hướng tích cực.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context.jsx';

const digitSum = (n) => String(n).split('').reduce((s, d) => s + Number(d), 0);
export function reduceNum(n, keepMaster = true) {
  let x = n;
  while (x > 9 && !(keepMaster && [11, 22, 33].includes(x))) x = digitSum(x);
  return x;
}

/** Ngày sinh 'YYYY-MM-DD' → các con số; null nếu chưa có / sai định dạng. */
export function numerology(birthday, date = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthday || '');
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const lifePath = reduceNum(digitSum(`${y}${String(mo).padStart(2, '0')}${String(d).padStart(2, '0')}`));
  const year = reduceNum(reduceNum(d, false) + reduceNum(mo, false) + reduceNum(digitSum(date.getFullYear()), false), false);
  const month = reduceNum(year + date.getMonth() + 1, false);
  const day = reduceNum(month + reduceNum(date.getDate(), false));
  return { lifePath, year, month, day };
}

// Ý nghĩa tích cực của từng con số (dùng cho ngày cá nhân & số chủ đạo)
const MEANING = {
  1: { word: 'Khởi đầu', color: 'Đỏ', icon: '🚀', tip: 'Ngày tuyệt vời để bắt đầu việc mới, chủ động đề xuất ý tưởng và dẫn dắt.' },
  2: { word: 'Kết nối', color: 'Cam', icon: '🤝', tip: 'Hợp tác, lắng nghe và phối hợp nhóm sẽ mang lại kết quả tốt đẹp.' },
  3: { word: 'Sáng tạo', color: 'Vàng', icon: '🎨', tip: 'Hãy chia sẻ ý tưởng, giao tiếp cởi mở — năng lượng sáng tạo đang lên cao.' },
  4: { word: 'Nền tảng', color: 'Xanh lá', icon: '🧱', tip: 'Tập trung sắp xếp, hoàn thiện kế hoạch; sự kiên trì hôm nay tạo nền móng vững.' },
  5: { word: 'Đổi mới', color: 'Xanh ngọc', icon: '🌿', tip: 'Đón nhận thay đổi, thử cách làm mới — linh hoạt sẽ mở ra cơ hội.' },
  6: { word: 'Yêu thương', color: 'Hồng', icon: '💗', tip: 'Quan tâm, hỗ trợ đồng nghiệp; trách nhiệm và sự tận tâm được ghi nhận.' },
  7: { word: 'Chiêm nghiệm', color: 'Tím', icon: '🔍', tip: 'Dành thời gian phân tích, học hỏi sâu — trực giác của bạn rất nhạy bén.' },
  8: { word: 'Thành tựu', color: 'Vàng kim', icon: '🏆', tip: 'Thời điểm tốt cho mục tiêu lớn, tài chính và ra quyết định quan trọng.' },
  9: { word: 'Hoàn thành', color: 'Trắng', icon: '🌟', tip: 'Khép lại việc dang dở, lan toả lòng tốt — mọi nỗ lực đều đáng giá.' },
  11: { word: 'Truyền cảm hứng', color: 'Bạc', icon: '✨', tip: 'Số bậc thầy: trực giác mạnh, hãy truyền cảm hứng và dẫn dắt bằng tầm nhìn.' },
  22: { word: 'Kiến tạo', color: 'Xanh dương', icon: '🏛️', tip: 'Số bậc thầy: biến ý tưởng lớn thành hiện thực bằng kế hoạch bài bản.' },
  33: { word: 'Sẻ chia', color: 'Xanh biển', icon: '🕊️', tip: 'Số bậc thầy: lan toả sự tử tế, nâng đỡ mọi người xung quanh.' },
};

export default function HomeLucky() {
  const { user } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const k = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);

  const n = numerology(user?.birthday);
  if (!n) {
    return (
      <div className="weather-wrap"><Link to="/account/edit" className="weather-mini lucky-mini" title="Nhập ngày sinh trong hồ sơ để xem con số may mắn hôm nay">
        <span className="weather-mini-icon" aria-hidden>🔮</span>
        <span className="weather-mini-text">Số may mắn: nhập ngày sinh</span>
      </Link></div>
    );
  }
  const today = MEANING[n.day];
  const life = MEANING[n.lifePath];
  return (
    <div className="weather-wrap" ref={ref}>
      <button type="button" className="weather-mini lucky-mini" onClick={() => setOpen(!open)} aria-expanded={open}
        title={`Con số may mắn hôm nay: ${n.day} — ${today.word}`}>
        <span className="weather-mini-icon" aria-hidden>🔮</span>
        <span className="weather-mini-text">Số may mắn</span>
        <b className="lucky-num">{n.day}</b>
      </button>
      {open && (
        <div className="weather glass-pop lucky-pop">
          <div className="lucky-head">
            <span className="lucky-big">{n.day}</span>
            <div className="grow">
              <small>Con số may mắn hôm nay</small>
              <b>{today.icon} {today.word}</b>
            </div>
          </div>
          <p className="lucky-tip">{today.tip}</p>
          <div className="lucky-grid">
            <div><small>Số chủ đạo</small><b>{n.lifePath}</b><span>{life.word}</span></div>
            <div><small>Năm cá nhân</small><b>{n.year}</b><span>{MEANING[n.year].word}</span></div>
            <div><small>Màu may mắn</small><b className="lucky-color">{today.color}</b><span>hôm nay</span></div>
          </div>
          <small className="lucky-note">Theo Thần số học Pythagoras, tính từ ngày sinh trong hồ sơ · mang tính tham khảo.</small>
        </div>
      )}
    </div>
  );
}

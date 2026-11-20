import { useMemo, useState } from 'react';
import { Quote, RefreshCw } from 'lucide-react';
import { useApp } from '../context.jsx';
import { QUOTES, quoteFor } from './quotes.js';

/**
 * Câu nói truyền cảm hứng của riêng mỗi người trong ngày (không ai trùng ai, đổi lúc 0h).
 * Nút ↻ chọn trong các câu chưa ai nhận hôm nay nên vẫn không trùng người khác.
 */
export default function HomeQuote() {
  const { user, users } = useApp();
  const today = new Date().toDateString();
  const { index, spare } = useMemo(() => quoteFor(user.id, (users || []).map((u) => u.id).concat(user.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user.id, users, today]);
  const [extra, setExtra] = useState(-1); // -1: câu của hôm nay; ≥ 0: vị trí trong danh sách câu dự phòng
  const idx = extra >= 0 && spare.length ? spare[extra % spare.length] : index;
  const [text, author] = QUOTES[idx];
  return (
    <figure className="home2-quote" aria-label="Câu nói truyền cảm hứng hôm nay">
      <Quote size={16} className="home2-quote-ico" aria-hidden="true" />
      <div className="home2-quote-body" key={idx}>
        <blockquote>{text}</blockquote>
        <figcaption>— {author}</figcaption>
      </div>
      {spare.length > 0 && (
        <button type="button" className="home2-quote-next" onClick={() => setExtra((e) => (e + 1 + Math.floor(Math.random() * 3)) % spare.length)}
          title="Câu khác" aria-label="Xem câu khác"><RefreshCw size={13} /></button>
      )}
    </figure>
  );
}

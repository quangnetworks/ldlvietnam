import { useState } from 'react';
import { Quote, RefreshCw } from 'lucide-react';
import { QUOTES, quoteIndexFor } from './quotes.js';

/** Câu nói truyền cảm hứng của ngày (đổi lúc 0h); bấm ↻ để xem câu khác trong lúc này. */
export default function HomeQuote() {
  const [idx, setIdx] = useState(() => quoteIndexFor());
  const [anim, setAnim] = useState(0);
  const [text, author] = QUOTES[idx];
  const next = () => {
    let n = idx;
    while (n === idx && QUOTES.length > 1) n = Math.floor(Math.random() * QUOTES.length);
    setIdx(n);
    setAnim((a) => a + 1);
  };
  return (
    <figure className="home2-quote" aria-label="Câu nói truyền cảm hứng hôm nay">
      <Quote size={16} className="home2-quote-ico" aria-hidden="true" />
      <div className="home2-quote-body" key={anim}>
        <blockquote>{text}</blockquote>
        <figcaption>— {author}</figcaption>
      </div>
      <button type="button" className="home2-quote-next" onClick={next} title="Câu khác" aria-label="Xem câu khác"><RefreshCw size={13} /></button>
    </figure>
  );
}

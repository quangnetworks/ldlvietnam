import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../../lib/format';

/**
 * Khung xem trước giữ đúng tỷ lệ: nội dung được dựng ở kích thước gốc
 * (mặc định 540×960 = 1/2 của 1080×1920) rồi thu phóng cho vừa chiều rộng khung.
 */
export function ScaledFrame({
  width = 540,
  height = 960,
  className,
  children,
}: {
  width?: number;
  height?: number;
  className?: string;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={host} className={cx('relative w-full overflow-hidden', className)} style={{ aspectRatio: `${width} / ${height}` }}>
      <div className="absolute top-0 left-0 origin-top-left" style={{ width, height, transform: `scale(${scale})`, visibility: scale ? 'visible' : 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

/** Khung điện thoại tối giản bao quanh bản xem trước. */
export function PhoneFrame({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx('relative rounded-[44px] bg-espresso p-[10px] shadow-[0_50px_90px_-40px_rgba(48,9,16,0.65),0_0_0_1px_rgba(201,169,110,0.35)]', className)}>
      <div className="absolute top-[18px] left-1/2 z-10 h-[22px] w-[30%] -translate-x-1/2 rounded-full bg-espresso" />
      <div className="overflow-hidden rounded-[34px]">{children}</div>
    </div>
  );
}

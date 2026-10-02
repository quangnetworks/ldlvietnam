/**
 * Chiều cao màn hình thật cho giao diện điện thoại.
 * iOS khi mở từ "Thêm vào màn hình chính" (standalone) có lúc tính 100vh / 100dvh thiếu phần thanh trạng thái,
 * làm khung ứng dụng ngắn hơn màn hình và hở một dải trắng phía trên thanh tab. Đo window.innerHeight
 * (luôn đúng vùng hiển thị) và gán vào --app-h; CSS dùng var(--app-h, 100dvh).
 * Bàn phím ảo trên iOS không làm đổi innerHeight nên khung không bị co khi gõ.
 */
import { isStandalone } from './push.js';

const root = document.documentElement;
let frame = 0;

function measure() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => root.style.setProperty('--app-h', `${window.innerHeight}px`));
}

root.classList.toggle('standalone', isStandalone());
measure();
window.addEventListener('resize', measure);
window.addEventListener('pageshow', measure);
// iOS cập nhật kích thước sau khi xoay màn hình một nhịp
window.addEventListener('orientationchange', () => setTimeout(measure, 250));

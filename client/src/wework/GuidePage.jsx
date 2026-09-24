import { PlayCircle, CheckSquare, FolderKanban, Repeat, Filter, BarChart3, FileText } from 'lucide-react';

const STEPS = [
  { icon: CheckSquare, title: 'Tạo & giao việc', text: 'Bấm "Tạo công việc mới", nhập tên, chọn người thực hiện, thời hạn và mức ưu tiên. Người được giao nhận thông báo ngay.' },
  { icon: FolderKanban, title: 'Dự án & phòng ban', text: 'Tạo dự án/phòng ban, thêm thành viên, chia nhóm công việc. Xem theo Danh sách, Kanban (kéo thả), Lịch hoặc Tiến độ.' },
  { icon: Repeat, title: 'Công việc lặp lại', text: 'Chọn chu kỳ Hằng ngày / tuần / tháng. Khi hoàn thành, hệ thống tự tạo kỳ tiếp theo với thời hạn mới.' },
  { icon: Filter, title: 'Bộ lọc tùy chỉnh', text: 'Kết hợp phạm vi, trạng thái, dự án, sắp xếp rồi "Lưu bộ lọc hiện tại" để dùng lại nhanh.' },
  { icon: BarChart3, title: 'Báo cáo', text: 'Theo dõi tỷ lệ hoàn thành, việc quá hạn theo từng thành viên và dự án; xu hướng 30 ngày.' },
  { icon: FileText, title: 'Văn bản (Office)', text: 'Soạn, trình duyệt nhiều bước, cấp số, ban hành và lưu trữ văn bản; theo dõi ai đã xem.' },
];

export default function GuidePage() {
  return (
    <div className="ww-page">
      <div className="ww-main">
        <div className="page-head"><h1><PlayCircle size={22} /> Hướng dẫn sử dụng</h1></div>
        <div className="guide-grid">
          {STEPS.map((s) => (
            <div key={s.title} className="card">
              <s.icon size={26} className="text-blue" />
              <h3>{s.title}</h3>
              <p className="muted">{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

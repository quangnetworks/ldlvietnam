import {
  LayoutGrid, Globe, MessageCircle, FolderOpen, UserCircle2, CheckSquare, UserPlus, GitPullRequestArrow, Users2, FileText,
  CalendarCheck, Target, Workflow, Link2, LifeBuoy, Contact, Wallet, Fingerprint, Plane, Clock, Star, ShieldAlert, Package,
  BookOpen, Video, PenLine, Receipt, TrendingUp, Landmark, CalendarDays, Bot, Database, Award, GraduationCap, HeartHandshake,
  ClipboardCheck,
} from 'lucide-react';

export const CATEGORIES = [
  { key: 'all', label: 'Tất cả ứng dụng' },
  { key: 'work', label: 'Work+' },
  { key: 'hrm', label: 'HRM+' },
  { key: 'info', label: 'Info+' },
  { key: 'finance', label: 'Finance+' },
  { key: 'platform', label: 'Platform' },
];

/**
 * Full ecosystem. `module` = key granted per user in Account → Ứng dụng (null = always available),
 * `path` = route when implemented; apps without a path are shown as "Sắp ra mắt".
 */
export const ECOSYSTEM = [
  { key: 'home', name: 'Base Platform', desc: 'Trang chủ', cat: 'platform', icon: LayoutGrid, color: '#4c6ef5', path: '/', module: null },
  { key: 'account', name: 'Base Account', desc: 'Tài khoản & phân quyền', cat: 'platform', icon: UserCircle2, color: '#1c7ed6', path: '/account', module: null },
  { key: 'office', name: 'Base Office', desc: 'Công văn và thông báo', cat: 'info', icon: FileText, color: '#12b886', path: '/office', module: 'office' },
  { key: 'wework', name: 'Base Wework', desc: 'Công việc và dự án', cat: 'work', icon: CheckSquare, color: '#3b5bdb', path: '/wework', module: 'wework' },
  { key: 'request', name: 'Base Request', desc: 'Phê duyệt và Đề xuất', cat: 'work', icon: GitPullRequestArrow, color: '#2f9e44', path: '/request', module: 'request' },
  { key: 'xspace', name: 'Base XSpace', desc: 'Không gian số', cat: 'platform', icon: Globe, color: '#4263eb' },
  { key: 'message', name: 'Base Message', desc: 'Chat nhóm', cat: 'platform', icon: MessageCircle, color: '#1098ad' },
  { key: 'drive', name: 'Base Drive', desc: 'Tài liệu', cat: 'platform', icon: FolderOpen, color: '#f59f00' },
  { key: 'sign', name: 'Base Sign', desc: 'Chữ ký điện tử', cat: 'platform', icon: PenLine, color: '#495057' },
  { key: 'table', name: 'Base Table', desc: 'Dữ liệu hợp nhất', cat: 'platform', icon: Database, color: '#5f3dc4' },
  { key: 'ai', name: 'Base AI', desc: 'AI Agent', cat: 'platform', icon: Bot, color: '#862e9c' },
  { key: 'goal', name: 'Base Goal', desc: 'Mục tiêu', cat: 'work', icon: Target, color: '#e8590c' },
  { key: 'workflow', name: 'Base Workflow', desc: 'Quy trình', cat: 'work', icon: Workflow, color: '#0b7285' },
  { key: 'process', name: 'Base Process', desc: 'Trung tâm liên kết', cat: 'work', icon: Link2, color: '#364fc7' },
  { key: 'service', name: 'Base Service', desc: 'Dịch vụ nội bộ', cat: 'work', icon: LifeBuoy, color: '#c2255c' },
  { key: 'me', name: 'Base Me', desc: 'Cổng nhân viên', cat: 'hrm', icon: Contact, color: '#1c7ed6' },
  { key: 'hiring', name: 'Base E-Hiring', desc: 'Tuyển dụng', cat: 'hrm', icon: UserPlus, color: '#228be6' },
  { key: 'hrm', name: 'Base HRM', desc: 'Nhân sự', cat: 'hrm', icon: Users2, color: '#e03131' },
  { key: 'payroll', name: 'Base Payroll', desc: 'Tính lương', cat: 'hrm', icon: Wallet, color: '#2b8a3e' },
  { key: 'checkin', name: 'Base Checkin', desc: 'Chấm công', cat: 'hrm', icon: Fingerprint, color: '#f76707' },
  { key: 'timeoff', name: 'Base Timeoff', desc: 'Nghỉ phép và vắng mặt', cat: 'hrm', icon: Plane, color: '#15aabf' },
  { key: 'timesheet', name: 'Base Timesheet', desc: 'Quản lý công', cat: 'hrm', icon: CalendarDays, color: '#ae3ec9' },
  { key: 'overtime', name: 'Base Overtime', desc: 'Làm thêm giờ', cat: 'hrm', icon: Clock, color: '#d9480f' },
  { key: 'review', name: 'Base Review', desc: 'Đánh giá nhân sự', cat: 'hrm', icon: ClipboardCheck, color: '#5c940d' },
  { key: 'onboard', name: 'Base Onboard', desc: 'Hội nhập', cat: 'hrm', icon: HeartHandshake, color: '#0ca678' },
  { key: 'reward', name: 'Base Reward', desc: 'Tặng thưởng', cat: 'hrm', icon: Award, color: '#fab005' },
  { key: 'case', name: 'Base Case', desc: 'Vi phạm và sự vụ', cat: 'hrm', icon: ShieldAlert, color: '#c92a2a' },
  { key: 'asset', name: 'Base Asset', desc: 'Quản lý tài sản', cat: 'hrm', icon: Package, color: '#795548' },
  { key: 'inside', name: 'Base Inside', desc: 'Mạng xã hội doanh nghiệp', cat: 'info', icon: Star, color: '#7950f2' },
  { key: 'booking', name: 'Base Booking', desc: 'Đặt tài nguyên', cat: 'info', icon: CalendarCheck, color: '#1971c2' },
  { key: 'wiki', name: 'Base Wiki', desc: 'Tri thức', cat: 'info', icon: BookOpen, color: '#2f9e44' },
  { key: 'meeting', name: 'Base Meeting', desc: 'Cuộc họp', cat: 'info', icon: Video, color: '#e64980' },
  { key: 'square', name: 'Base Square', desc: 'Mạng học tập', cat: 'info', icon: GraduationCap, color: '#f08c00' },
  { key: 'finance', name: 'Base Finance', desc: 'Quản lý tài chính', cat: 'finance', icon: Landmark, color: '#0c8599' },
  { key: 'expense', name: 'Base Expense', desc: 'Quản lý chi phí', cat: 'finance', icon: Receipt, color: '#e8590c' },
  { key: 'income', name: 'Base Income', desc: 'Quản lý doanh thu', cat: 'finance', icon: TrendingUp, color: '#2b8a3e' },
];

export const MODULE_APPS = ECOSYSTEM.filter((a) => a.module);

/** Can this user open the app? (implemented + granted) */
export function canOpen(app, userApps) {
  if (!app.path) return false;
  return !app.module || (userApps || []).includes(app.module);
}

export function AppIcon({ app, size = 44 }) {
  const Icon = app.icon;
  return (
    <span className="app-icon-round" style={{ width: size, height: size, background: app.color }}>
      <Icon size={size * 0.5} color="#fff" strokeWidth={2.2} />
    </span>
  );
}

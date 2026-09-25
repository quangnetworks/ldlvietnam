import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from './context.jsx';
import { Spinner } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import OfficeLayout from './office/OfficeLayout.jsx';
import DocList from './office/DocList.jsx';
import DocForm from './office/DocForm.jsx';
import DocDetail from './office/DocDetail.jsx';
import OfficeSettings from './office/OfficeSettings.jsx';
import WeworkLayout from './wework/WeworkLayout.jsx';
import TasksHome from './wework/TasksHome.jsx';
import MyTasksPage from './wework/MyTasksPage.jsx';
import ProjectsPage from './wework/ProjectsPage.jsx';
import ProjectPage from './wework/ProjectPage.jsx';
import MembersPage from './wework/MembersPage.jsx';
import ReportsPage from './wework/ReportsPage.jsx';
import BulkPage from './wework/BulkPage.jsx';
import TaskPage from './wework/TaskPage.jsx';
import GuidePage from './wework/GuidePage.jsx';
import Home from './pages/Home.jsx';
import AccountLayout from './account/AccountLayout.jsx';
import { ProfileView, ProfileEdit, PasswordPage, ColorPage, LoginHistory } from './account/ProfilePages.jsx';
import {
  MembersPage as AccountMembers, GroupsPage, AppsPage, CompanyPage, AuditPage, NotificationsPage, DepartmentsPage, BulkPasswordPage,
} from './account/AdminPages.jsx';
import RequestLayout from './request/RequestLayout.jsx';
import RequestList from './request/RequestList.jsx';
import RequestForm from './request/RequestForm.jsx';
import RequestDetail from './request/RequestDetail.jsx';
import { GroupsAdmin, GroupEditor, TemplatesPage, GroupHistory, RequestGuide } from './request/GroupsAdmin.jsx';
import RequestReports from './request/RequestReports.jsx';
import RequestPrint from './request/RequestPrint.jsx';
import { useApp as useAppCtx } from './context.jsx';
import { TwoFactorPage, SecuritySettingsPage } from './account/SecurityPages.jsx';
import { WebhooksPage } from './request/Webhooks.jsx';
import ModuleShell from './components/ModuleShell.jsx';
import { HrmHome, HrmEmployees, HrmEmployee, HrmSettings } from './hrm/Hrm.jsx';
import { CheckinHome, CheckinTeam, CheckinSettings } from './hrm/Checkin.jsx';
import { TimeoffHome, TimeoffCalendar, TimeoffBalances } from './hrm/Timeoff.jsx';
import DrivePage from './drive/Drive.jsx';
import MessagePage from './message/Message.jsx';
import MobileTabBar from './components/MobileNav.jsx';
import { refreshBadge } from './push.js';

/** Guard a module route by the user's app access (Account → Ứng dụng). */
function RequireApp({ app, children }) {
  const { apps } = useAppCtx();
  if (!apps.includes(app)) {
    return (
      <div className="center-screen">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <h2>Chưa được cấp quyền</h2>
          <p className="muted">Bạn chưa được cấp quyền sử dụng ứng dụng này. Vui lòng liên hệ quản trị viên.</p>
          <a className="btn btn-primary" href="/">Về trang chủ</a>
        </div>
      </div>
    );
  }
  return children;
}

export default function App() {
  const { user, loading } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  // Bấm vào thông báo đẩy khi ứng dụng đang mở → chuyển tới nội dung
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const h = (e) => {
      if (e.data?.type !== 'open' || !e.data.url) return;
      const u = new URL(e.data.url, window.location.origin);
      if (u.origin === window.location.origin) navigate(u.pathname + u.search);
    };
    navigator.serviceWorker.addEventListener('message', h);
    return () => navigator.serviceWorker.removeEventListener('message', h);
  }, [navigate]);
  // Mở công việc / đề xuất / văn bản / cuộc trò chuyện → máy chủ đánh dấu thông báo liên quan đã đọc → cập nhật số trên biểu tượng
  useEffect(() => {
    if (!user) return undefined;
    const t = setTimeout(() => refreshBadge(true), 1500);
    return () => clearTimeout(t);
  }, [user, location.pathname]);
  // Số trên biểu tượng ứng dụng (iPhone / taskbar Windows): cập nhật khi mở lại ứng dụng
  useEffect(() => {
    if (!user) return undefined;
    refreshBadge(true);
    const h = () => { if (!document.hidden) refreshBadge(); };
    document.addEventListener('visibilitychange', h);
    window.addEventListener('focus', h);
    return () => { document.removeEventListener('visibilitychange', h); window.removeEventListener('focus', h); };
  }, [user]);
  if (loading) return <div className="center-screen"><Spinner /></div>;
  if (!user) {
    if (location.pathname !== '/login') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
    return <Login />;
  }
  return (
    <>
    <Routes>
      <Route path="/login" element={<Navigate to={location.state?.from || '/'} replace />} />
      <Route path="/" element={<Home />} />
      <Route path="/office" element={<RequireApp app="office"><OfficeLayout /></RequireApp>}>
        <Route index element={<DocList />} />
        <Route path="new" element={<DocForm />} />
        <Route path="doc/:id" element={<DocDetail />} />
        <Route path="doc/:id/edit" element={<DocForm />} />
        <Route path="settings" element={<OfficeSettings />} />
      </Route>
      <Route path="/wework" element={<RequireApp app="wework"><WeworkLayout /></RequireApp>}>
        <Route index element={<TasksHome />} />
        <Route path="my" element={<MyTasksPage />} />
        <Route path="task/:id" element={<TaskPage />} />
        <Route path="projects" element={<ProjectsPage key="project" kind="project" />} />
        <Route path="departments" element={<ProjectsPage key="department" kind="department" />} />
        <Route path="templates" element={<ProjectsPage key="template" kind="template" />} />
        <Route path="project/:id" element={<ProjectPage />} />
        <Route path="members" element={<AccountMembers />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="bulk" element={<BulkPage />} />
        <Route path="guide" element={<GuidePage />} />
      </Route>
      <Route path="/account" element={<AccountLayout />}>
        <Route index element={<ProfileView />} />
        <Route path="u/:id" element={<ProfileView />} />
        <Route path="edit" element={<ProfileEdit />} />
        <Route path="password" element={<PasswordPage />} />
        <Route path="color" element={<ColorPage />} />
        <Route path="logins" element={<LoginHistory />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="members" element={<AccountMembers />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="apps" element={<AppsPage />} />
        <Route path="company" element={<CompanyPage />} />
        <Route path="departments" element={<DepartmentsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="bulk-password" element={<BulkPasswordPage />} />
        <Route path="2fa" element={<TwoFactorPage />} />
        <Route path="security" element={<SecuritySettingsPage />} />
      </Route>
      <Route path="/request/:id/print" element={<RequireApp app="request"><RequestPrint /></RequireApp>} />
      <Route path="/request" element={<RequireApp app="request"><RequestLayout /></RequireApp>}>
        <Route index element={<RequestList />} />
        <Route path="new" element={<RequestForm />} />
        <Route path="reports" element={<RequestReports />} />
        <Route path="guide" element={<RequestGuide />} />
        <Route path="settings" element={<GroupsAdmin />} />
        <Route path="settings/bulk" element={<GroupsAdmin bulk />} />
        <Route path="settings/all-requests" element={<RequestList adminAll />} />
        <Route path="settings/history" element={<GroupHistory />} />
        <Route path="settings/webhooks" element={<WebhooksPage />} />
        <Route path="settings/templates" element={<TemplatesPage />} />
        <Route path="settings/group/:id" element={<GroupEditor />} />
        <Route path=":id" element={<RequestDetail />} />
        <Route path=":id/edit" element={<RequestForm />} />
      </Route>
      <Route path="/admin" element={<Navigate to="/account/members" replace />} />
      <Route path="/hrm" element={<RequireApp app="hrm"><ModuleShell app="hrm" /></RequireApp>}>
        <Route index element={<HrmHome />} />
        <Route path="employees" element={<HrmEmployees />} />
        <Route path="employees/:id" element={<HrmEmployee />} />
        <Route path="settings" element={<HrmSettings />} />
      </Route>
      <Route path="/checkin" element={<RequireApp app="checkin"><ModuleShell app="checkin" /></RequireApp>}>
        <Route index element={<CheckinHome />} />
        <Route path="team" element={<CheckinTeam />} />
        <Route path="settings" element={<CheckinSettings />} />
      </Route>
      <Route path="/timeoff" element={<RequireApp app="timeoff"><ModuleShell app="timeoff" /></RequireApp>}>
        <Route index element={<TimeoffHome />} />
        <Route path="calendar" element={<TimeoffCalendar />} />
        <Route path="balances" element={<TimeoffBalances />} />
      </Route>
      <Route path="/drive" element={<RequireApp app="drive"><ModuleShell app="drive" /></RequireApp>}>
        <Route index element={<DrivePage />} />
        <Route path=":space" element={<DrivePage />} />
        <Route path="folder/:folderId" element={<DrivePage />} />
      </Route>
      <Route path="/message" element={<RequireApp app="message"><MessagePage /></RequireApp>} />
      <Route path="/message/:channelId" element={<RequireApp app="message"><MessagePage /></RequireApp>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <MobileTabBar />
    </>
  );
}

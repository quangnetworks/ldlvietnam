import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from './context.jsx';
import { Spinner } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import { useApp as useAppCtx } from './context.jsx';
import MobileTabBar from './components/MobileNav.jsx';
import GlobalSearch from './components/GlobalSearch.jsx';
import { refreshBadge } from './push.js';
import { lazyPage, RootBoundary } from './components/Boundary.jsx';

// Mỗi phân hệ là một tệp JS riêng, chỉ tải khi mở tới → trang chủ mở nhanh dù hệ thống có thêm nhiều phân hệ
const OfficeLayout = lazyPage(() => import('./office/OfficeLayout.jsx'));
const DocList = lazyPage(() => import('./office/DocList.jsx'));
const DocForm = lazyPage(() => import('./office/DocForm.jsx'));
const DocDetail = lazyPage(() => import('./office/DocDetail.jsx'));
const OfficeSettings = lazyPage(() => import('./office/OfficeSettings.jsx'));
const WeworkLayout = lazyPage(() => import('./wework/WeworkLayout.jsx'));
const TasksHome = lazyPage(() => import('./wework/TasksHome.jsx'));
const MyTasksPage = lazyPage(() => import('./wework/MyTasksPage.jsx'));
const ProjectsPage = lazyPage(() => import('./wework/ProjectsPage.jsx'));
const ProjectPage = lazyPage(() => import('./wework/ProjectPage.jsx'));
const ReportsPage = lazyPage(() => import('./wework/ReportsPage.jsx'));
const BulkPage = lazyPage(() => import('./wework/BulkPage.jsx'));
const TaskPage = lazyPage(() => import('./wework/TaskPage.jsx'));
const GuidePage = lazyPage(() => import('./wework/GuidePage.jsx'));
const GoalsPage = lazyPage(() => import('./wework/GoalsPage.jsx'));
const WeworkSettingsPage = lazyPage(() => import('./wework/GoalsPage.jsx'), 'WeworkSettingsPage');
const AccountLayout = lazyPage(() => import('./account/AccountLayout.jsx'));
const ProfileView = lazyPage(() => import('./account/ProfilePages.jsx'), 'ProfileView');
const ProfileEdit = lazyPage(() => import('./account/ProfilePages.jsx'), 'ProfileEdit');
const PasswordPage = lazyPage(() => import('./account/ProfilePages.jsx'), 'PasswordPage');
const ColorPage = lazyPage(() => import('./account/ProfilePages.jsx'), 'ColorPage');
const LoginHistory = lazyPage(() => import('./account/ProfilePages.jsx'), 'LoginHistory');
const AccountMembers = lazyPage(() => import('./account/AdminPages.jsx'), 'MembersPage');
const GroupsPage = lazyPage(() => import('./account/AdminPages.jsx'), 'GroupsPage');
const AppsPage = lazyPage(() => import('./account/AdminPages.jsx'), 'AppsPage');
const CompanyPage = lazyPage(() => import('./account/AdminPages.jsx'), 'CompanyPage');
const AuditPage = lazyPage(() => import('./account/AdminPages.jsx'), 'AuditPage');
const NotificationsPage = lazyPage(() => import('./account/AdminPages.jsx'), 'NotificationsPage');
const DepartmentsPage = lazyPage(() => import('./account/AdminPages.jsx'), 'DepartmentsPage');
const BulkPasswordPage = lazyPage(() => import('./account/AdminPages.jsx'), 'BulkPasswordPage');
const RequestLayout = lazyPage(() => import('./request/RequestLayout.jsx'));
const RequestList = lazyPage(() => import('./request/RequestList.jsx'));
const RequestForm = lazyPage(() => import('./request/RequestForm.jsx'));
const RequestDetail = lazyPage(() => import('./request/RequestDetail.jsx'));
const GroupsAdmin = lazyPage(() => import('./request/GroupsAdmin.jsx'), 'GroupsAdmin');
const GroupEditor = lazyPage(() => import('./request/GroupsAdmin.jsx'), 'GroupEditor');
const TemplatesPage = lazyPage(() => import('./request/GroupsAdmin.jsx'), 'TemplatesPage');
const GroupHistory = lazyPage(() => import('./request/GroupsAdmin.jsx'), 'GroupHistory');
const RequestGuide = lazyPage(() => import('./request/GroupsAdmin.jsx'), 'RequestGuide');
const RequestReports = lazyPage(() => import('./request/RequestReports.jsx'));
const RequestPrint = lazyPage(() => import('./request/RequestPrint.jsx'));
const TwoFactorPage = lazyPage(() => import('./account/SecurityPages.jsx'), 'TwoFactorPage');
const SecuritySettingsPage = lazyPage(() => import('./account/SecurityPages.jsx'), 'SecuritySettingsPage');
const WebhooksPage = lazyPage(() => import('./request/Webhooks.jsx'), 'WebhooksPage');
const ModuleShell = lazyPage(() => import('./components/ModuleShell.jsx'));
const HrmHome = lazyPage(() => import('./hrm/Hrm.jsx'), 'HrmHome');
const HrmEmployees = lazyPage(() => import('./hrm/Hrm.jsx'), 'HrmEmployees');
const HrmEmployee = lazyPage(() => import('./hrm/Hrm.jsx'), 'HrmEmployee');
const HrmSettings = lazyPage(() => import('./hrm/Hrm.jsx'), 'HrmSettings');
const HrmContracts = lazyPage(() => import('./hrm/HrmRecords.jsx'), 'HrmContracts');
const HrmCareers = lazyPage(() => import('./hrm/HrmRecords.jsx'), 'HrmCareers');
const HrmReports = lazyPage(() => import('./hrm/HrmRecords.jsx'), 'HrmReports');
const SalesOrg = lazyPage(() => import('./hrm/SalesOrg.jsx'), 'SalesOrg');
const MyAssets = lazyPage(() => import('./asset/AssetPages.jsx'), 'MyAssets');
const AssetOverview = lazyPage(() => import('./asset/AssetPages.jsx'), 'AssetOverview');
const AssetList = lazyPage(() => import('./asset/AssetPages.jsx'), 'AssetList');
const AssetDetail = lazyPage(() => import('./asset/AssetPages.jsx'), 'AssetDetail');
const AssetPeople = lazyPage(() => import('./asset/AssetPages.jsx'), 'AssetPeople');
const AssetPerson = lazyPage(() => import('./asset/AssetPages.jsx'), 'AssetPerson');
const HandoverList = lazyPage(() => import('./asset/AssetFlows.jsx'), 'HandoverList');
const HandoverDetail = lazyPage(() => import('./asset/AssetFlows.jsx'), 'HandoverDetail');
const ProcedureList = lazyPage(() => import('./asset/AssetFlows.jsx'), 'ProcedureList');
const ProcedureDetail = lazyPage(() => import('./asset/AssetFlows.jsx'), 'ProcedureDetail');
const AssetSettings = lazyPage(() => import('./asset/AssetFlows.jsx'), 'AssetSettings');
const CheckinHome = lazyPage(() => import('./hrm/Checkin.jsx'), 'CheckinHome');
const CheckinTeam = lazyPage(() => import('./hrm/Checkin.jsx'), 'CheckinTeam');
const CheckinSettings = lazyPage(() => import('./hrm/Checkin.jsx'), 'CheckinSettings');
const TimeoffHome = lazyPage(() => import('./hrm/Timeoff.jsx'), 'TimeoffHome');
const TimeoffCalendar = lazyPage(() => import('./hrm/Timeoff.jsx'), 'TimeoffCalendar');
const TimeoffBalances = lazyPage(() => import('./hrm/Timeoff.jsx'), 'TimeoffBalances');
const DrivePage = lazyPage(() => import('./drive/Drive.jsx'));
const MessagePage = lazyPage(() => import('./message/Message.jsx'));

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
    <RootBoundary>
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
        <Route path="goals" element={<GoalsPage />} />
        <Route path="settings" element={<WeworkSettingsPage />} />
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
        <Route path="contracts" element={<HrmContracts />} />
        <Route path="careers" element={<HrmCareers />} />
        <Route path="reports" element={<HrmReports />} />
        <Route path="sales" element={<SalesOrg />} />
        <Route path="settings" element={<HrmSettings />} />
      </Route>
      <Route path="/asset/handovers/:id" element={<RequireApp app="asset"><HandoverDetail /></RequireApp>} />
      <Route path="/asset" element={<RequireApp app="asset"><ModuleShell app="asset" /></RequireApp>}>
        <Route index element={<MyAssets />} />
        <Route path="overview" element={<AssetOverview />} />
        <Route path="list" element={<AssetList />} />
        <Route path="item/:id" element={<AssetDetail />} />
        <Route path="people" element={<AssetPeople />} />
        <Route path="people/:id" element={<AssetPerson />} />
        <Route path="handovers" element={<HandoverList />} />
        <Route path="procedures" element={<ProcedureList />} />
        <Route path="procedures/:id" element={<ProcedureDetail />} />
        <Route path="settings" element={<AssetSettings />} />
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
    </RootBoundary>
    <MobileTabBar />
    <GlobalSearch />
    </>
  );
}

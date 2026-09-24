import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
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
import ProjectsPage from './wework/ProjectsPage.jsx';
import ProjectPage from './wework/ProjectPage.jsx';
import MembersPage from './wework/MembersPage.jsx';
import ReportsPage from './wework/ReportsPage.jsx';
import BulkPage from './wework/BulkPage.jsx';
import TaskPage from './wework/TaskPage.jsx';
import GuidePage from './wework/GuidePage.jsx';
import AdminPage from './admin/AdminPage.jsx';

export default function App() {
  const { user, loading } = useApp();
  const location = useLocation();
  if (loading) return <div className="center-screen"><Spinner /></div>;
  if (!user) {
    if (location.pathname !== '/login') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
    return <Login />;
  }
  return (
    <Routes>
      <Route path="/login" element={<Navigate to={location.state?.from || '/'} replace />} />
      <Route path="/" element={<Navigate to="/office" replace />} />
      <Route path="/office" element={<OfficeLayout />}>
        <Route index element={<DocList />} />
        <Route path="new" element={<DocForm />} />
        <Route path="doc/:id" element={<DocDetail />} />
        <Route path="doc/:id/edit" element={<DocForm />} />
        <Route path="settings" element={<OfficeSettings />} />
      </Route>
      <Route path="/wework" element={<WeworkLayout />}>
        <Route index element={<TasksHome />} />
        <Route path="my" element={<TasksHome mode="my" />} />
        <Route path="task/:id" element={<TaskPage />} />
        <Route path="projects" element={<ProjectsPage kind="project" />} />
        <Route path="departments" element={<ProjectsPage kind="department" />} />
        <Route path="templates" element={<ProjectsPage kind="template" />} />
        <Route path="project/:id" element={<ProjectPage />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="bulk" element={<BulkPage />} />
        <Route path="guide" element={<GuidePage />} />
      </Route>
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

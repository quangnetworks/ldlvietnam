import { useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { StudioLayout } from './components/studio/StudioLayout';
import { ToastProvider } from './components/ui/Toast';
import GuestInvitation from './pages/GuestInvitation';
import InvitationPreview from './pages/InvitationPreview';
import Landing from './pages/Landing';
import BulkExport from './pages/studio/BulkExport';
import Designer from './pages/studio/Designer';
import Guests from './pages/studio/Guests';
import ImportExcel from './pages/studio/ImportExcel';
import Overview from './pages/studio/Overview';
import Settings from './pages/studio/Settings';

function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
        return;
      }
    }
    window.scrollTo({ top: 0 });
  }, [pathname, hash]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ScrollManager />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/xem-truoc" element={<InvitationPreview />} />
          <Route path="/thiep" element={<GuestInvitation />} />
          <Route path="/studio" element={<StudioLayout />}>
            <Route index element={<Overview />} />
            <Route path="thiet-ke" element={<Designer />} />
            <Route path="khach-moi" element={<Guests />} />
            <Route path="nhap-excel" element={<ImportExcel />} />
            <Route path="xuat-thiep" element={<BulkExport />} />
            <Route path="cai-dat" element={<Settings />} />
          </Route>
          <Route path="*" element={<Landing />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}

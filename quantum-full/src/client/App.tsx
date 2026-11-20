import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/toast';
import { LoadingBlock, EmptyState } from './components/ui';
import { GameProvider } from './lib/game';

const Overview = lazy(() => import('./pages/Overview'));
const Today = lazy(() => import('./pages/Today'));
const Bingo18 = lazy(() => import('./pages/Bingo18'));
const DataCenter = lazy(() => import('./pages/DataCenter'));
const Statistics = lazy(() => import('./pages/Statistics'));
const Predictability = lazy(() => import('./pages/Predictability'));
const Xskt = lazy(() => import('./pages/Xskt'));
const Research = lazy(() => import('./pages/Research'));
const Generator = lazy(() => import('./pages/Generator'));
const Portfolio = lazy(() => import('./pages/Portfolio'));
const Backtesting = lazy(() => import('./pages/Backtesting'));
const Capital = lazy(() => import('./pages/Capital'));
const ModelAudit = lazy(() => import('./pages/ModelAudit'));
const SettingsPage = lazy(() => import('./pages/Settings'));

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <GameProvider>
          <Layout>
            <Suspense fallback={<LoadingBlock rows={6} />}>
              <Routes>
                <Route path="/" element={<Overview />} />
                <Route path="/today" element={<Today />} />
                <Route path="/bingo18" element={<Bingo18 />} />
                <Route path="/data" element={<DataCenter />} />
                <Route path="/statistics" element={<Statistics />} />
                <Route path="/predictability" element={<Predictability />} />
                <Route path="/xskt" element={<Xskt />} />
                <Route path="/research" element={<Research />} />
                <Route path="/generator" element={<Generator />} />
                <Route path="/portfolio" element={<Portfolio />} />
                <Route path="/backtesting" element={<Backtesting />} />
                <Route path="/capital" element={<Capital />} />
                <Route path="/audit" element={<ModelAudit />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<EmptyState title="Không tìm thấy trang" description="Đường dẫn không tồn tại." />} />
              </Routes>
            </Suspense>
          </Layout>
        </GameProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

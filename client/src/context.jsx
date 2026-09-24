import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, setUnauthorizedHandler } from './api.js';

const AppCtx = createContext(null);
const ToastCtx = createContext(() => {});

export function useApp() {
  return useContext(AppCtx);
}
export function useToast() {
  return useContext(ToastCtx);
}

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState('');
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);

  const loadDirectory = useCallback(async () => {
    const [u, d] = await Promise.all([api.get('/users'), api.get('/departments')]);
    setUsers(u);
    setDepartments(d);
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const r = await api.get('/auth/me');
      setUser(r.user);
      setCompany(r.company);
      setApps(r.apps || []);
      await loadDirectory();
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [loadDirectory]);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    refreshMe();
  }, [refreshMe]);

  const login = async (username, password, otp) => {
    const r = await api.post('/auth/login', { username, password, otp: otp || undefined });
    setUser(r.user);
    await refreshMe();
  };
  const logout = async () => {
    await api.post('/auth/logout');
    setUser(null);
  };

  const value = useMemo(
    () => ({ user, setUser, company, setCompany, apps, loading, login, logout, users, departments, loadDirectory, refreshMe }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, company, apps, loading, users, departments]
  );
  return (
    <AppCtx.Provider value={value}>
      <ToastProvider>{children}</ToastProvider>
    </AppCtx.Provider>
  );
}

function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);
  const push = useCallback((message, type = 'success') => {
    const id = ++idRef.current;
    setItems((x) => [...x, { id, message, type }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Small data-fetch hook: returns [data, reload, loading, error]. */
export function useFetch(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const seq = useRef(0);
  const load = useCallback(async () => {
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fn();
      if (my === seq.current) setState({ data, loading: false, error: null });
    } catch (e) {
      if (my === seq.current) setState((s) => ({ ...s, loading: false, error: e }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    load();
  }, [load]);
  return [state.data, load, state.loading, state.error];
}

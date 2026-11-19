import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, type Envelope } from './api';

export interface QueryState<T> {
  data: T | null;
  meta: Record<string, any> | undefined;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

/** Tải dữ liệu GET; tự huỷ request cũ khi path đổi. path = null ⇒ không tải. */
export function useApi<T = any>(path: string | null): QueryState<T> {
  const [state, setState] = useState<{ env: Envelope<T> | null; loading: boolean; error: Error | null }>({ env: null, loading: !!path, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) {
      setState({ env: null, loading: false, error: null });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    apiFetch<T>(path, { signal: ctrl.signal })
      .then((env) => setState({ env, loading: false, error: null }))
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setState({ env: null, loading: false, error: e as Error });
      });
    return () => ctrl.abort();
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: state.env?.data ?? null, meta: state.env?.meta, loading: state.loading, error: state.error, reload };
}

/** Thao tác ghi (POST/PUT) có trạng thái đang chạy. */
export function useMutation<TBody, TRes = any>(fn: (body: TBody) => Promise<TRes>) {
  const [running, setRunning] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  const run = useCallback(
    async (body: TBody) => {
      setRunning(true);
      try {
        return await fn(body);
      } finally {
        if (mounted.current) setRunning(false);
      }
    },
    [fn],
  );
  return { run, running };
}

export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? (JSON.parse(s) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (nv: T) => {
      setV(nv);
      try {
        localStorage.setItem(key, JSON.stringify(nv));
      } catch {
        /* bỏ qua */
      }
    },
    [key],
  );
  return [v, set];
}

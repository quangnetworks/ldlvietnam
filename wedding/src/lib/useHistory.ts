import { useCallback, useState } from 'react';

/** Hoàn tác / làm lại cho một giá trị trạng thái (tối đa 50 bước). */
export function useHistory<T>(value: T, setValue: (v: T) => void) {
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);

  const commit = useCallback(
    (next: T) => {
      setPast((p) => [...p.slice(-49), value]);
      setFuture([]);
      setValue(next);
    },
    [value, setValue],
  );
  const undo = useCallback(() => {
    if (!past.length) return;
    setFuture((f) => [value, ...f]);
    setValue(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  }, [past, value, setValue]);
  const redo = useCallback(() => {
    if (!future.length) return;
    setPast((p) => [...p, value]);
    setValue(future[0]);
    setFuture((f) => f.slice(1));
  }, [future, value, setValue]);

  return { commit, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}

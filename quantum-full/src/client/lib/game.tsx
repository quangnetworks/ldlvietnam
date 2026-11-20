import { createContext, useContext, type ReactNode } from 'react';
import type { Game } from '../../shared/game';
import { useApi, useLocalState } from './hooks';

interface GameCtx {
  games: Game[];
  game: Game | null;
  code: string;
  setCode: (c: string) => void;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

const Ctx = createContext<GameCtx>({ games: [], game: null, code: 'lotto535', setCode: () => {}, loading: true, error: null, reload: () => {} });

export function GameProvider({ children }: { children: ReactNode }) {
  const q = useApi<Game[]>('/games');
  const [code, setCode] = useLocalState('quantum.game', 'lotto535');
  // Bingo18 (engine 'dice3') có trang riêng; bộ chọn game chung chỉ gồm game dạng chọn K số trong N.
  const games = (q.data ?? []).filter((g) => (g.engine ?? 'pick') === 'pick');
  const game = games.find((g) => g.code === code) ?? games[0] ?? null;
  return <Ctx.Provider value={{ games, game, code: game?.code ?? code, setCode, loading: q.loading, error: q.error, reload: q.reload }}>{children}</Ctx.Provider>;
}

export const useGame = () => useContext(Ctx);

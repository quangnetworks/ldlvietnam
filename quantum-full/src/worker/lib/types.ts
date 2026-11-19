import type { Env } from '../env';

export type Role = 'admin' | 'viewer';

export interface AuthUser {
  id: string;
  email: string | null;
  role: Role;
  method: 'access' | 'token' | 'dev';
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: AuthUser; requestId: string };
};

/** Bindings & biến môi trường của Worker. */
export interface Env {
  DB: D1Database;
  RATE_LIMITER?: RateLimit;
  APP_ENV?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_EMAILS?: string;
  ALLOW_DEV_AUTH?: string;
  /** Secret: token quản trị (Bearer) cho tự động hoá/CLI. */
  ADMIN_TOKEN?: string;
  /** Secret tuỳ chọn: token chỉ đọc. */
  VIEWER_TOKEN?: string;
}

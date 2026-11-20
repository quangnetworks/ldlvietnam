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
  /** SHA-256 (hex) của admin token — có thể công khai trong cấu hình mà không lộ token. */
  ADMIN_TOKEN_SHA256?: string;
  /** Secret tuỳ chọn: token chỉ đọc. */
  VIEWER_TOKEN?: string;
}

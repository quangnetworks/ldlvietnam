# QUANTUM FULL — Lottery Intelligence Platform

Nền tảng phân tích xác suất, nghiên cứu dữ liệu lịch sử, kiểm định thuật toán (walk-forward backtest) và quản lý ngân sách vé xổ số cho **Lotto 5/35** và **Power 6/55**.

Tên miền dự kiến: `quantum.vanquang.xyz` · Worker: `quantum-full` · D1: `quantum-full-db`

> **Nguyên tắc: MATHEMATICAL INTEGRITY OVER FALSE PREDICTION.**
> Hệ thống không tuyên bố dự đoán được xổ số, không tạo dữ liệu lịch sử giả, không giả lập kết quả kiểm định, không tự động mua vé.
> Mọi chiến lược đều được so với baseline Random Uniform; nếu không vượt baseline có ý nghĩa thống kê, giao diện ghi rõ **KHÔNG CÓ LỢI THẾ DỰ BÁO ĐƯỢC CHỨNG MINH**.

## Công nghệ

| Lớp | Công nghệ |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4, Apache ECharts 6, Lucide |
| Backend | Cloudflare Workers, Hono 4, Zod 4 |
| Database | Cloudflare D1 (SQLite), SQL migrations, prepared statements, khoá ngoại, trigger bất biến |
| Kiểm thử | Vitest 4 + `@cloudflare/vitest-plugin` (Workers runtime, kế nhiệm `vitest-pool-workers`), Playwright |
| Triển khai | `@cloudflare/vite-plugin` (SPA + Worker thống nhất), Workers Assets, Custom Domain, Cloudflare Access |

Không có backend Node.js riêng; production chạy hoàn toàn trên Workers + D1.

## Kiến trúc (Modular Monolith)

```
quantum-full/
├── migrations/               # 0001_init.sql (18 bảng + trigger), 0002_seed_config.sql (cấu hình, KHÔNG có dữ liệu lịch sử)
├── src/
│   ├── shared/               # Kiểu & schema cấu hình game (dùng chung UI/API/Engine)
│   ├── engine/               # Mathematical Engine — thuần TypeScript, không phụ thuộc React/Worker
│   │   ├── combinatorics.ts  # Q1: tổ hợp BigInt, phân số chính xác
│   │   ├── probability.ts    # Q1: siêu bội, xác suất từng hạng, EV, nhiều vé/nhiều kỳ
│   │   ├── distributions.ts  # χ², chuẩn, Beta, Wilson, Bonferroni, Benjamini–Hochberg
│   │   ├── statistics.ts     # Q2: tần suất, χ² hiệu chỉnh, phân phối, cặp/bộ ba, cửa sổ trượt
│   │   ├── bayesian.ts       # Q3: Beta-Binomial, Dirichlet-Multinomial, độ nhạy prior, Brier/log loss
│   │   ├── markov.ts         # Q4: kiểm định độc lập chuỗi, chuyển trạng thái, tự tương quan
│   │   ├── montecarlo.ts     # Q5: mô phỏng có seed, KTC Wilson, giới hạn khối lượng
│   │   ├── ml.ts             # Q6: Logistic Regression, Random Forest, Gradient Boosting vs baseline
│   │   ├── behavior.ts       # Q7: ước lượng mức phổ biến bộ số (heuristic)
│   │   ├── strategies.ts     # Number Generator + Q8 Portfolio Optimizer
│   │   ├── backtest.ts       # Walk-forward backtest chống look-ahead
│   │   ├── prize.ts, validation.ts, rng.ts, types.ts
│   ├── worker/               # API Layer (Hono) + Data Access Layer
│   │   ├── index.ts          # Entry, middleware (log, auth, rate limit, lỗi)
│   │   ├── lib/              # auth (Access JWT / token), audit, http, observability, hash
│   │   ├── db/               # games, draws, settings, models (prepared statements)
│   │   ├── services/         # importer, generator, tracking, capital
│   │   └── routes/           # system, draws, statistics, generator, portfolios, models, backtests, capital, audit, dashboard
│   └── client/               # Presentation Layer (React)
├── test/                     # Unit (engine) + integration (API, D1 migration) chạy trong Workers runtime
├── e2e/                      # Playwright (desktop + mobile)
└── docs/                     # API.md, DEPLOYMENT.md, QA_REPORT.md
```

## Bắt đầu nhanh (cục bộ)

```bash
cd quantum-full
npm install
cp .dev.vars.example .dev.vars        # ALLOW_DEV_AUTH=true chỉ dùng cục bộ
npm run db:migrate:local              # áp migration vào D1 cục bộ (.wrangler/state)
npm run dev                           # http://localhost:5190 — Vite + Worker + D1 cục bộ
```

Lần đầu mở ứng dụng, Dashboard trống: hãy vào **Data Center → Nhập dữ liệu** để import CSV/JSON kết quả quay từ nguồn chính thức, rồi **xác minh** dữ liệu.

### Định dạng CSV

```csv
draw_code,draw_date,draw_time,numbers,special
01234,2026-11-18,13:00,05 12 19 27 33,07
```

`numbers` cách nhau bằng khoảng trắng/gạch/chấm phẩy (hoặc dùng cột `n1..nK`). `draw_time` tuỳ chọn (cần cho Lotto 5/35 vì quay 2 kỳ/ngày). Power 6/55: `special` là số đặc biệt quay từ các số còn lại.

## Lệnh

| Lệnh | Mô tả |
| --- | --- |
| `npm run dev` | Phát triển cục bộ |
| `npm run typecheck` | Kiểm tra kiểu (app, worker, test, e2e) |
| `npm run build` | Typecheck + build production (`dist/client`, `dist/quantum_full`) |
| `npm test` | Unit + integration tests (Workers runtime, D1 cô lập) |
| `npm run test:e2e` | Playwright E2E (tự dựng D1 cục bộ riêng `.wrangler/e2e-state`) |
| `npm run db:migrate:local` / `db:migrate:remote` | Áp migration D1 |
| `npm run deploy` | Build + `wrangler deploy` (**chỉ chạy khi chủ dự án cho phép**) |

## Bảo mật & phân quyền

- Production: toàn bộ site đặt sau **Cloudflare Access**; Worker xác minh JWT `Cf-Access-Jwt-Assertion` (chữ ký RS256, `aud`, `iss`, `exp`).
- Email trong `ADMIN_EMAILS` ⇒ vai trò **admin**; người dùng Access khác ⇒ **viewer** (chỉ đọc).
- Token `ADMIN_TOKEN` / `VIEWER_TOKEN` (Wrangler secret) cho tự động hoá. Không commit secrets.
- Mọi thao tác ghi yêu cầu admin; endpoint `/admin/*` và `/audit` không bao giờ công khai. Chỉ `/api/v1/health` là public.
- Rate limiting (binding Cloudflare Rate Limiting), structured logging JSON, audit log bất biến (trigger SQL).

## Tính toàn vẹn dữ liệu

- Kỳ quay lưu nguồn, URL, SHA-256 nội dung, thời điểm nhập/xác minh, người xác minh.
- Kết quả **đã xác minh** không thể sửa/xoá trực tiếp (trigger); điều chỉnh phải qua `/admin/draws/:id/correct` với lý do + audit trước/sau.
- `recommendations`, `model_runs`, `audit_logs`, `bankroll_ledger` bất biến (trigger chặn UPDATE/DELETE).
- Backtest kiểm tra dataset hash ở mỗi đoạn; dữ liệu thay đổi giữa chừng ⇒ phiên bị huỷ.

## Thể lệ trò chơi

Cấu hình game nằm trong bảng `games` và chỉnh được tại **Cài đặt**. Cơ cấu giải được seed từ thông tin báo chí do trang vietlott.vn chặn truy cập tự động trong quá trình phát triển, nên ở trạng thái **`unverified`** — chủ dự án cần đối chiếu thể lệ chính thức và xác minh. Xem `docs/QA_REPORT.md`.

Tài liệu khác: [API](docs/API.md) · [Triển khai](docs/DEPLOYMENT.md) · [Báo cáo nghiệm thu](docs/QA_REPORT.md)

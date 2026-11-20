# QUANTUM FULL — API v1

Base URL: `/api/v1` · JSON · Lỗi: `{ "error": { "code", "message", "details" } }` · Danh sách: `{ "data": [...], "meta": { page, page_size, total, total_pages } }` (`page` ≥ 1, `page_size` 1–200).

## Xác thực

| Cách | Header | Vai trò |
| --- | --- | --- |
| Cloudflare Access | `Cf-Access-Jwt-Assertion` (do Access tự thêm) | admin nếu email ∈ `ADMIN_EMAILS`, ngược lại viewer |
| API token | `Authorization: Bearer <ADMIN_TOKEN | VIEWER_TOKEN>` | admin / viewer |
| Dev cục bộ | `ALLOW_DEV_AUTH=true` và `APP_ENV≠production` | admin |

Viewer chỉ được gọi `GET`. Mọi `POST/PUT` cần admin. `401` thiếu/sai xác thực · `403` thiếu quyền · `429` vượt giới hạn tốc độ (600 đơn vị/phút/người dùng; endpoint nặng tốn 3–5 đơn vị).

## Hệ thống & cấu hình

| Method | Path | Mô tả |
| --- | --- | --- |
| GET | `/health` | **Public.** Trạng thái API & D1 |
| GET | `/me` | Người dùng hiện tại |
| GET | `/games` | Cấu hình game (pool, số đặc biệt, hạng giải, trạng thái xác minh thể lệ) |
| GET | `/games/:code/probability` | Xác suất chính xác từng hạng (`exact` = phân số), EV |
| PUT | `/admin/games/:id` | Sửa giá vé, hạng giải, trạng thái thể lệ (audit) |
| GET | `/settings` | Thiết lập (ngân sách/kỳ, hạn mức tháng/năm…) |
| PUT | `/admin/settings` | Sửa hạn mức (ràng buộc kỳ ≤ tháng ≤ năm; audit) |
| GET | `/dashboard?game=` | Dữ liệu tổng quan |

## Data Center

| Method | Path | Mô tả |
| --- | --- | --- |
| GET | `/draws?game=&status=&from=&to=&q=&import_job_id=&page=&page_size=` | Danh sách kỳ quay (+ `meta.statusCounts`) |
| GET | `/draws/:id` | Chi tiết |
| POST | `/admin/draws/import` | `{ game, format: "csv"|"json", content, data_source_id, source_url?, retrieved_at? }` → import job: inserted / duplicates / conflicts / invalid + lỗi từng dòng. Tối đa 5.000 dòng |
| POST | `/admin/draws` | Nhập tay một kỳ `{ game, draw_code, draw_date, draw_time?, main[], special? }` |
| POST | `/admin/draws/:id/verify` | `{ status: verified|rejected|unverified, note? }` (bỏ xác minh cần lý do) |
| POST | `/admin/draws/verify-batch` | `{ ids[≤500], note? }` |
| POST | `/admin/draws/:id/correct` | Điều chỉnh có kiểm soát `{ main[], special?, draw_date?, draw_time?, reason(≥10) }` |
| GET | `/import-jobs?game=` | Lịch sử nhập (payload hash, nguồn, lỗi) |
| GET | `/sync/status` | Trạng thái đồng bộ tự động (nguồn, lịch, lần chạy cuối, các lần nhập + số kỳ chưa xác minh) |
| POST | `/admin/sync` | Đồng bộ ngay `{ games?: string[] }` |
| POST | `/admin/import-jobs/:id/verify` | Xác minh toàn bộ kỳ chưa xác minh của một lần nhập `{ note(≥10) }` |
| GET | `/data-sources` · POST `/admin/data-sources` | Nguồn dữ liệu `{ name, kind: official|third_party|manual, url? }` |

Quy tắc: không nhận ngày quay tương lai; kỳ trùng nội dung ⇒ `duplicates`; kỳ đã có nhưng khác nội dung ⇒ `conflicts`, **không ghi đè**.

## Thống kê (query chung: `game`, `include_unverified`, `from`, `to`, `last`)

| GET | Mô tả |
| --- | --- |
| `/statistics/frequency` | Tần suất, z-score, χ² hiệu chỉnh, phương sai, số đặc biệt, cửa sổ 30/60/100 |
| `/statistics/distribution` | Chẵn/lẻ, thấp/cao (so siêu bội), tổng (phân phối chính xác), liên tiếp, khoảng cách |
| `/statistics/pairs?top=` · `/statistics/triplets?top=` | Cặp/bộ ba với p Poisson và q (FDR) |
| `/statistics/summary` | Cỡ mẫu & mức tin cậy |
| `/predictability?game=&include_unverified=&warmup=&window=` | Phán quyết khả năng dự đoán (`insufficient` · `random` · `anomaly` · `exploitable`): 6 kiểm định ngẫu nhiên + backtest walk-forward các chiến lược nóng/lạnh/lặp/gan, hiệu chỉnh Benjamini–Hochberg. Cần ≥ 200 kỳ |

## Sinh số & danh mục

| Method | Path | Mô tả |
| --- | --- | --- |
| GET | `/generator/strategies` | Danh sách chiến lược & phiên bản |
| POST | `/generator/generate` | `{ game, strategy, budget, ticket_count(≤200), target_draw_date?, seed?, include_unverified?, params? }` → vé, chi phí, xác suất, độ phủ, giải thích, phiên bản, mốc dữ liệu, trạng thái kiểm định. Lưu bất biến |
| PUT · DELETE | `/admin/split-draw` | Xác nhận / xoá kỳ **Chia giải Độc đắc**: `{ game, date, time, jackpot, reference_winners?: {first,second,third,fourth,fifth}, tickets_override?, sales_growth (mặc định 0,3), shares? }`. Số lần dự thưởng ước lượng MLE Poisson từ số vé trúng từng hạng của kỳ tham chiếu. `GET /decision/today` trả thêm `split` (kỳ vọng ước tính / thận trọng, điểm hoà vốn) và hỗ trợ `mode=split_only` |
| POST | `/portfolio/odds` | `{ game, tickets: [{ main, special }] (1–50) }` → xác suất CHÍNH XÁC của cả danh mục trong một kỳ (liệt kê mọi kết quả khi C(N,K) ≤ 600.000, ngược lại Monte Carlo có seed): P(≥1 vé trúng) so với chọn độc lập, P(hoàn vốn), kỳ vọng, phân phối. Tính toán thuần, không ghi dữ liệu (quyền admin như mọi POST) |
| POST | `/portfolio/optimize` | Như trên với chiến lược `portfolio_optimized` (`params.maxOverlap`, `avoidPopular`, `candidates`) |
| GET | `/recommendations` · `/recommendations/:id` | Lịch sử sinh số |
| POST | `/portfolios` | Lưu danh mục từ bản ghi `{ recommendation_id, name, mode: simulated|real, target_draw_date, target_draw_time? }` |
| GET | `/portfolios` · `/portfolios/:id` | Danh mục, vé, kết quả chấm |
| POST | `/portfolios/:id/purchase` | Ghi nhận **đã tự mua** (chỉ `real`, kiểm hạn mức kỳ/tháng/năm) |
| POST | `/portfolios/:id/cancel` · `/portfolios/:id/evaluate` | Huỷ nháp / chấm với kết quả ĐÃ XÁC MINH |
| POST | `/tracking/evaluate` | Chấm mọi danh mục đến hạn |

Ngân sách: `ticket_count × giá vé ≤ budget ≤ …` và `≤ budget_per_draw` (422 `budget_violation`). Ngày mục tiêu đã qua ⇒ 422.

## Bingo18

| Method | Path | Mô tả |
| --- | --- | --- |
| GET | `/bingo18/rules` | Cơ cấu giải, xác suất chính xác, kỳ vọng & hoàn trả từng cách chơi |
| GET | `/bingo18/draws?date=&status=` | Kết quả (phân trang) |
| GET | `/bingo18/statistics?last=&include_unverified=` | Kiểm định ngẫu nhiên |
| POST | `/bingo18/simulate` | `{ bets:[{bet:{type,value?},stakeUnits}], drawsPerSession, sessions, stopLoss?, seed? }` |
| GET | `/bingo18/decision` | Kế hoạch hôm nay theo hạn mức & lịch quay |
| POST | `/bingo18/ledger` | Ghi nhận chi tiêu/thưởng thực tế `{ stake (bội số 10.000), prize, entry_date? }` (kiểm hạn mức) |

## Mô hình, backtest, vốn, kiểm toán

| Method | Path | Mô tả |
| --- | --- | --- |
| GET | `/models?game=` | Phiên bản thuật toán + trạng thái kiểm định |
| GET | `/models/runs` · `/models/runs/:id` | Lịch sử chạy (tham số, seed, mốc dữ liệu, dataset hash) |
| POST | `/models/run` | `{ game, model: statistics|bayesian_analysis|markov|monte_carlo|ml_research|behavior, seed?, params }` |
| POST | `/backtests/run` | `{ game, strategies[], tickets_per_draw, min_history, max_draws?, seed?, include_unverified?, params }` → chạy đoạn đầu |
| POST | `/backtests/:id/continue` | Chạy đoạn tiếp theo (≈3.000 lần sinh vé/request) tới khi `completed` |
| GET | `/backtests` · `/backtests/:id` | Danh sách / tổng hợp (baseline, KTC, Bonferroni, calibration, cửa sổ thời gian) |
| GET | `/capital/summary?mode=real|simulated` | Đầu tư, thưởng, ròng, ROI, chi phí/kỳ, hạn mức & còn lại |
| GET | `/capital/ledger` · POST `/capital/ledger` | Sổ quỹ bất biến; bút toán thủ công `prize|adjustment` (ghi chú bắt buộc) |
| GET | `/audit?action=&entity_type=&actor=` | **Admin.** Nhật ký kiểm toán trước/sau |

Giới hạn tính toán: Monte Carlo ≤ 2.000.000 (vé × kỳ)/request; ML ≤ 600 kỳ gần nhất; backtest chạy theo đoạn.

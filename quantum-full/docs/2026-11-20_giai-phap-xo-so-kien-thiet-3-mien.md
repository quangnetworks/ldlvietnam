# Giải pháp: Hệ thống phân tích Xổ số kiến thiết 3 miền (XSKT)

Ngày: 2026-11-20 · Phạm vi đã chốt với chủ dự án: **Kiểm định & giám sát** + **Mô hình dự báo + backtest** + **Giá trị vé & chọn kỳ mua**, đủ **Miền Bắc / Trung / Nam**, đặt **trong app QUANTUM FULL**.

## 1. Nguyên tắc

- Kết quả quay XSKT là ngẫu nhiên. Mọi mô hình dự báo phải được chấm walk-forward (chỉ dùng dữ liệu trước kỳ đó) và so với chọn ngẫu nhiên.
  Mô hình nào không vượt chuẩn có ý nghĩa thống kê thì hệ thống ghi rõ **"không có lợi thế"**.
- Hệ thống phục vụ **vé XSKT hợp pháp** (vé in sẵn 6 chữ số ở miền Nam/Trung; 5 chữ số + ký hiệu ở miền Bắc).
- Hệ thống **không** có tính năng lô/đề: không có "bạch thủ", "dàn đề", "lô xiên", không dự báo 2 số cuối để cá cược.
  Lô/đề là cờ bạc trái phép.
- Dữ liệu từ nguồn mở bên thứ ba được lưu ở trạng thái **chưa xác minh**.

## 2. Nguồn dữ liệu (giấy phép MIT, cập nhật hằng ngày bằng GitHub Actions)

| Miền | Kho | Tệp | Phạm vi |
|---|---|---|---|
| Bắc | `khiemdoan/vietnam-lottery-xsmb-analysis` | `data/xsmb.csv` | 7.619 kỳ, 01/10/2005 → nay, 27 số/kỳ |
| Nam | `tuanseo5t-alt/xosomn-xosomt` | `data/xsmn/xsmn.csv` | 21.229 kỳ-đài, 2008 → nay, 21 đài, 18 số/kỳ |
| Trung | `tuanseo5t-alt/xosomn-xosomt` | `data/xsmt/xsmt.csv` | 15.006 kỳ-đài, 2009 → nay, 14 đài, 18 số/kỳ |

Chất lượng dữ liệu đã kiểm tra:
- Không có dòng sai số lượng giải.
- Tệp miền Bắc làm mất số 0 ở đầu (ví dụ giải bảy "1" phải là "01"). Hệ thống bổ sung lại theo độ dài chuẩn của từng giải.
- Giải đặc biệt chuyển từ 5 lên 6 chữ số: miền Nam vào 2008–2010, miền Trung muộn hơn.
  Các phân tích theo vé 6 chữ số chỉ dùng các kỳ có giải đặc biệt 6 chữ số.
- Lịch đài theo thứ trong tuần được **suy ra từ dữ liệu**, không ghi cứng (các tỉnh có thể sáp nhập hoặc đổi tên).

## 3. Cơ cấu giải (vé 10.000đ)

Miền Nam / Trung, mỗi loại vé 1.000.000 số (6 chữ số):

| Giải | Số lượng số quay | Số chữ số | Giá trị | Số giải / 1 triệu vé |
|---|---|---|---|---|
| Đặc biệt | 1 | 6 | 2 tỷ | 1 |
| Phụ đặc biệt | (trùng 5 số cuối của ĐB, sai số đầu) | — | 50 triệu | 9 |
| Khuyến khích | (trùng số đầu của ĐB, sai đúng 1 trong 5 số còn lại) | — | 6 triệu | 45 |
| Nhất | 1 | 5 | 30 triệu | 10 |
| Nhì | 1 | 5 | 15 triệu | 10 |
| Ba | 2 | 5 | 10 triệu | 20 |
| Tư | 7 | 5 | 3 triệu | 70 |
| Năm | 1 | 4 | 1 triệu | 100 |
| Sáu | 3 | 4 | 400.000 | 300 |
| Bảy | 1 | 3 | 200.000 | 1.000 |
| Tám | 1 | 2 | 100.000 | 10.000 |

Tổng giải là 5 tỷ trên 1 triệu vé, tức **trả lại 50% tiền vé**.

Miền Bắc, vé 5 chữ số + ký hiệu, 15 loại vé/ngày (20 loại vào mùng 1 âm lịch). Mỗi ngày quay 6 ký hiệu đặc biệt (8 vào mùng 1).

| Giải | Số lượng số quay | Số chữ số | Giá trị |
|---|---|---|---|
| Đặc biệt | 1 (+ ký hiệu) | 5 | 500 triệu |
| Phụ đặc biệt | trùng 5 số, ký hiệu không trúng | — | 25 triệu |
| Khuyến khích | trùng 2 số cuối của ĐB | 2 | 40.000 |
| Nhất | 1 | 5 | 10 triệu |
| Nhì | 2 | 5 | 5 triệu |
| Ba | 6 | 5 | 1 triệu |
| Tư | 4 | 4 | 400.000 |
| Năm | 6 | 4 | 200.000 |
| Sáu | 3 | 3 | 100.000 |
| Bảy | 4 | 2 | 40.000 |

Mỗi loại vé 100.000 số trả 499 triệu, tức **49,9%**. Kiểm tra chéo: 15 loại × 499 triệu = 7,485 tỷ/ngày, khớp con số báo chí công bố.

Giả định cần đối chiếu thể lệ chính thức: một vé trúng nhiều giải thì được lĩnh tất cả các giải. Cơ cấu giải được khai báo bằng **dữ liệu cấu hình** trong engine, đổi được khi thể lệ thay đổi.

## 4. Thành phần

1. **Migration `0007_xskt.sql`**: bảng `xskt_draws` (miền, đài, ngày, 18/27 số theo thứ tự giải, mã băm nguồn, trạng thái xác minh, khoá duy nhất miền + đài + ngày), index, 2 nguồn dữ liệu, trạng thái đồng bộ.
2. **Đồng bộ `xsktSync.ts`** (cron mỗi giờ + "Đồng bộ ngay"):
   - Lần đầu tải toàn bộ tệp, nhập dần theo lô cắt ở ranh giới ngày.
   - Các lần sau chỉ tải phần đuôi tệp bằng HTTP Range. Nếu phần đuôi không phủ hết khoảng trống thì tải toàn bộ.
3. **Engine `xskt.ts`**:
   - Bố cục giải và cơ cấu giải theo miền.
   - Chấm vé (cộng dồn mọi giải trúng; miền Bắc tính kỳ vọng theo xác suất trúng ký hiệu).
   - Xác suất và kỳ vọng chính xác từng giải, trước/sau thuế; P(trúng ít nhất 1 giải).
   - **Kiểm định ngẫu nhiên** theo miền và theo từng đài (hiệu chỉnh Benjamini–Hochberg):
     - phân bố đều chữ số theo vị trí;
     - phân bố đều 2 số cuối (00–99);
     - chữ số của giải đặc biệt;
     - phụ thuộc kỳ trước (bảng 10×10);
     - số đuôi trùng nhau trong cùng kỳ.
   - **Mô hình dự báo** (walk-forward theo từng đài): Nóng, Lạnh, Bayes Dirichlet, Markov bậc 1, Tổ hợp, so với baseline Đồng đều.
     - Thước đo chính: log-loss trên từng chữ số so với ln 10 (kiểm định z ghép cặp).
     - Thước đo phụ: tiền thưởng thực tế của "vé gợi ý" so với kỳ vọng chính xác.
4. **API** `/xskt/summary`, `/xskt/draws`, `/xskt/audit`, `/xskt/models`, `/xskt/value`, `POST /admin/xskt/sync`.
5. **Giao diện** trang "Xổ số kiến thiết" gồm 4 tab: Kết quả, Kiểm định, Mô hình dự báo, Giá trị vé.
   Tab Giá trị vé so XSKT với Vietlott: Lotto kỳ thường, Power, kỳ Chia giải.

## 5. Tiêu chí chấp nhận

- Kỳ vọng mỗi vé tính bằng công thức đúng bằng 5.000đ (miền Nam/Trung) và 4.990đ (miền Bắc). Bộ chấm vé khớp các ví dụ tay.
- Dữ liệu mô phỏng đồng đều: không mô hình nào vượt chuẩn. Dữ liệu cố tình lệch chữ số: mô hình Nóng/Bayes phát hiện được (q < 0,05).
- Đồng bộ chịu được dòng sai, chạy lại không tạo dữ liệu trùng, nhập dần đúng ranh giới ngày.
- `npm test`, `typecheck` và E2E trong CI đều xanh; trang hiển thị tốt ở màn hình 375px.

## 6. Kết quả trên dữ liệu thật (2026-11-20)

Dữ liệu: Bắc 7.619 kỳ; Trung 15.001 kỳ-đài (bỏ 5 dòng sai); Nam 21.229 kỳ-đài.

| Miền | Kiểm định | Mô hình dự báo |
|---|---|---|
| Bắc | Khớp ngẫu nhiên. Phát hiện **quy tắc quay**: các số trong cùng một giải không bao giờ trùng nhau (giải Bảy 0/7.619 kỳ, lý thuyết khoảng 449). Từng số vẫn có phân bố đều, nên quy tắc này không tạo lợi thế. | Không mô hình nào vượt ngẫu nhiên; tất cả đều có log-loss tệ hơn ln 10. |
| Trung | Khớp ngẫu nhiên, 14 đài. | Không mô hình nào vượt ngẫu nhiên. |
| Nam | Độ lệch cần rà soát ở chữ số hàng đơn vị của đài Long An (chữ số 4 ra nhiều hơn, z = +3,8; q = 0,029). Có thể do dữ liệu nguồn hoặc thiết bị quay. | Không mô hình nào khai thác được, kể cả riêng đài Long An. |

**Giá trị vé:** Bắc hoàn lại 49,9% (47,9% sau thuế); Nam/Trung 50% (47,4% sau thuế).
Mức này cao hơn Lotto 5/35 kỳ thường (khoảng 31–45%) nhưng thấp hơn kỳ Chia giải Độc đắc.

**Hiệu năng (workerd cục bộ):**
- Lần tính đầu: kiểm định 0,4–1,0 giây; mô hình 1,2–2,1 giây.
- Các lần sau dùng bộ nhớ đệm: dưới 0,3 giây.
- Nạp lần đầu toàn bộ 44 nghìn kỳ mất 8 lần đồng bộ, mỗi lần tối đa khoảng 3.000 kỳ mỗi miền.

**Kiểm thử:** 187/187 test; trình duyệt desktop và 375px không tràn ngang.

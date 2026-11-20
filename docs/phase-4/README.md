# Phase 4 · Hiệu năng và phát hành

## Kiểm chứng

| Kiểm tra | Bằng chứng |
| --- | --- |
| Hồi quy và tính tất định | [Kết quả npm test](test-output.txt). So sánh đầu ra headless v1.3 với [kịch bản đã lưu ở Phase 3](../phase-3/dawn.jsonl). |
| Benchmark 30 giây | [bench.json](bench.json), seed 42, viewport 1280×720, 200 Bóng Mực, 100 đom đóm và 3 đèn sáng. Camera xoay 15 giây/vòng. Bỏ qua 3 giây đầu. |
| Soak | [soak.json](soak.json), 10 đêm trong một tiến trình mô phỏng, seed đầu là 7, giữ mẫu RSS sau khi nạp đêm đầu và sau khi giải phóng đêm cuối. Gọi GC tại hai mốc để giảm nhiễu từ rác chưa được thu gom. |
| Edge | [Kết quả kiểm tra trình duyệt](browser-output.txt), [ảnh gameplay](gameplay.png) và [video demo](../demo/demo.mp4). |

Benchmark dùng cờ Chromium để tắt đồng bộ khung hình và bỏ giới hạn tốc độ của scheduler. Không thu được tổng RSS cho các tiến trình của trình duyệt từ API đo khung hình, nên trường `peak_mem_mb` là `null`. Số đo dùng Windows, Edge và AMD Ryzen 7 H 255 với Radeon 780M. Kết quả chính thức còn phụ thuộc máy chấm.

Soak đánh số lượt từ 0, nên seed chạy là 7–16. Hướng di chuyển được lấy đều trên vòng tròn mỗi 30 tick. Phím hành động lấy độc lập từng tick theo xác suất của contract và vẫn đi qua cơ chế phát hiện cạnh nhấn của game.

## Chạy lại

```sh
npm ci
npm test
node bench.mjs --seed 42 --duration 30 --out bench.json
node soak.mjs --seed 7 --nights 10 --out soak.json
```

Điểm đã thắng ở từng đêm được cộng vào tổng chiến dịch, và lượt thua vẫn được nhập tên để lưu phần tổng đã tích lũy. File điểm nằm bên cạnh máy chủ và được loại khỏi Git. Có thể dùng `LEADERBOARD_FILE` để chỉ định vị trí khác. Trình duyệt lưu phím và tùy chọn trợ năng vào localStorage.

Chưa có kết quả bộ chấm ẩn, benchmark trên máy giảng viên hoặc kết quả chạy macOS/Linux. Xem [retro bốn phase](RETRO.md).

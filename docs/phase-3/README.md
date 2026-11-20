# Phase 3 · Ticket-03 «Đèn cạn dầu»

## Quyết định thiết kế

Browser và headless dùng chung mô phỏng 60 tick/giây. Đèn có trạng thái tắt/cháy, tiến độ nạp, bộ đếm dầu theo đơn vị 1/60 và lịch sử từng thắp. Nhờ số nguyên, việc so ngưỡng 30, cạn dầu và tính điểm bình minh không phụ thuộc làm tròn. JSONL làm tròn dầu tới một chữ số thập phân. Khi đèn tắt, tiến độ về 0, lịch sử vẫn còn để chọn chi phí thắp lại.

Ở bước cập nhật bộ đếm, đèn trừ hao tự nhiên và trừ dầu của các Bóng Mực đang hút hợp lệ, sau đó đèn cạn tắt trước khi Mây tương tác. Bóng vừa vào `drain` bắt đầu hút ở bước cập nhật kế tiếp. Mốc `fuel_drain` theo `sim_tick` chia hết cho 60, mỗi Bóng Mực một sự kiện với số dầu còn lại sau khi cộng dồn. Do trừ hao trước tương tác, đèn đầy ở cuối tick trước có thể đã nhận được đom đóm ở tick sau. Bóng Mực giữ ngưỡng phát hiện và bỏ đuổi cũ khi di chuyển. Nếu đang hút, ngưỡng chuyển sang đuổi là 6 m.

Kết quả sau khi cập nhật toàn bộ tick. Hết Ngọn Lửa được xét trước. Ở bình minh, chỉ đếm đèn đang sáng và dùng dầu còn lại thực tế để cộng điểm. Đèn yếu vẫn được tính nếu chưa tắt. Đèn có đúng 30 dầu vẫn bảo vệ Mây, và pha đẩy Bóng Mực đã bắt đầu được hoàn tất trong tối đa 30 tick.

## Changelog · Thay đổi phá vỡ tương thích

- Test Contract lên 1.2. Snapshot có `player.capacity` và `lanterns[].fuel`, `ever_lit`, `relit_count`. Scenario hỗ trợ dầu/trạng thái đèn, số lần thắp thành công của Mây và đèn mục tiêu của Bóng Mực.
- `lantern_lit` thêm `relight`. Thêm `refuel`, `lantern_out`, `fuel_drain` và trạng thái `drain`. Đèn đang cháy có thể nhận thêm đom đóm. Đèn dưới 30 dầu mất vùng an toàn.
- Ba đêm kéo dài 240/270/300 giây. Bỏ thắng ngay với `all_lit`. Thắng dùng `dawn_survived` khi đủ 3/5, 4/6 hoặc 5/7 đèn tương ứng.
- Sức chứa từ 10 tới 20. Thay điểm nạp, thắp lại, choáng Bóng đang hút và thưởng bình minh. Bỏ thưởng giây còn lại.
- Sửa các test cũ về thời lượng, điểm nạp, thắng sớm và lý do kết thúc để phản ánh luật mới. Test Tỏa Sáng giờ kiểm tra Bóng Mực về `wander` ở tick hết choáng trước khi phát hiện Mây ở tick kế tiếp. Giữ các kiểm tra hồi quy còn lại.

## Bằng chứng

| Kiểm tra | Kết quả |
| --- | --- |
| `npm test` | [26/26 đạt](test-output.txt), gồm nạp/châm dầu, cạn/thắp lại, hút cộng dồn, ngưỡng bảo vệ, điểm, tạm dừng và kết quả bình minh của cả ba đêm. |
| Headless có đầu vào xác định | [Scenario](dawn-scenario.json), [phím](dawn-inputs.json) và [JSONL](dawn.jsonl). L1 tắt và được thắp lại ở tick 1, L2 bị hút ở tick 60 và 120, kết thúc thắng tại tick 120 với 569 điểm. Hai lần chạy khớp từng byte. |
| Headless hết Đêm 3 | Chạy 18.000 tick trong 0,247 giây trên Windows, với [scenario đo của Phase 2](../phase-2/full-night.json). [Số đo và cấu hình máy](performance.json). |
| `npm start` trên Edge chạy nền | Kiểm tra menu, lưu bảng màu sau khi tải lại, mục tiêu bình minh, HUD và tạm dừng. Trạng thái dựng sẵn ở Đêm 1 kiểm tra cảnh báo cạn dầu, tiến độ thắp lại, sức chứa 12 và phím E châm dầu. [Ảnh sau khi châm dầu](browser-refuel.png). |

```sh
npm test
node headless.mjs --seed 20 --night 1 --scenario docs/phase-3/dawn-scenario.json --inputs docs/phase-3/dawn-inputs.json --ticks 120 --snapshot-every 60 --out run.local.jsonl
```

Chưa chạy bộ chấm ẩn, macOS/Linux hoặc chơi thắng đủ ba đêm trên browser. Chưa đo FPS và chưa đối chiếu mức nhấp nháy bằng công cụ đo.

## Nhật ký AI và retro

Codex đọc Ticket-02 và Ticket-03, cập nhật mô phỏng, phần hiển thị và test, rồi tạo bằng chứng từ các lần chạy thật. Dùng scenario ngắn để kiểm tra đúng thứ tự xử lý ở tick hết dầu và tick bình minh. Giữ JavaScript/Canvas sẵn có để giảm phạm vi thay đổi. Phiên không có số token thực, ước tính thô 10.000–20.000 token văn bản.

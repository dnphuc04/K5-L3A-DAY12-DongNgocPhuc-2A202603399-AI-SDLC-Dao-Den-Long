# Phase 2 · Ticket-02 «Ba hòn đảo»

| Yêu cầu | Kiểm chứng | Kết quả |
| --- | --- | --- |
| Ba bản đồ và số liệu chuẩn | So cấu hình với Ticket-02. Test số đèn, thời lượng, lịch sinh, bục nhảy Đêm 2 và 3, hai dốc Đêm 3. | Đạt các trường được kiểm tra |
| Hồi quy thao tác, đèn, điểm, Tỏa Sáng và Bóng Mực | Test CLI về chuyển động, sức chứa, nạp từng phần, điểm, đẩy 15 tick, choáng 120 tick, vùng an toàn, mất lửa và bất tử. | Đạt |
| Lướt, rơi, bùa, Gió Lạc, gió mạnh | Test CLI về độ dài lướt, mất đồ khi rơi, hồi sinh, bùa bỏ hồi lướt, thứ tự cướp/hit, trả đồ và cửa sổ gió. | Đạt |
| Tạm dừng, HUD, menu, cài đặt | Test CLI đóng băng thời gian, TTL và bộ đếm. Kiểm tra trực tiếp qua npm start tại cổng 8128. | Đã thấy menu → lời Ông Đăng → Đêm 1 → Esc → Cài đặt → Quay lại → Tiếp tục, cùng HUD và mũi tên. |
| Headless v1.1 | Kiểm tra JSONL, đầu vào lỗi, ba giá trị night, kết quả theo tick và đầu vào giống nhau sinh đầu ra giống từng byte. | Đạt 19/19 test. Chưa chạy bộ chấm ẩn và macOS/Linux. |
| Headless một Đêm đầy đủ trong 30 giây | Chạy Đêm 3 tới 21.600 tick trên Windows. Scenario giữ bất tử tới hết đêm để tránh kết thúc sớm do bị đánh, vẫn bật lịch sinh và gió. | Đạt trên máy làm bài. Xem số đo và cấu hình máy trong performance.json. |
| Kết quả qua ba đêm, âm thanh, cài đặt lưu, màu | UI có luồng chơi lại, chuyển đêm, Bình Minh, các thanh cài đặt và âm thanh tổng hợp. | Chưa chơi thắng liên tiếp cả ba đêm qua browser, chưa nghe và đối chiếu từng hiệu ứng, chưa thử tải lại sau khi đổi cài đặt hoặc đo pixel toàn bộ palette. |

## Bằng chứng có thể chạy lại

- [Kết quả Phase 2](test-output.txt)
- [Kết quả chạy test từ tag Phase 1](phase1-tag-test.txt)
- [Scenario Đêm 3](full-night.json), [JSONL](night3.jsonl), [số đo và cấu hình máy](performance.json)

```sh
npm test
node headless.mjs --seed 20 --night 3 --scenario docs/phase-2/full-night.json --ticks 21600 --snapshot-every 1800 --out run.local.jsonl
```

## Giả định và thay đổi so với Phase 1

- Giữ cùng một mô phỏng 60 tick/giây cho browser và CLI. Hồi quy giữ các kiểm tra còn hiệu lực, cập nhật kỳ vọng về điểm khi nạp, mốc thời gian, vùng an toàn, bước đẩy và trạng thái Bóng Mực. Test v1.0 chạy nguyên trạng từ tag phase-1 (commit 2c8df29).
- Giữ mặc định snapshot mỗi 60 tick. night_start xuất ở tick mô phỏng đầu tiên. Tick nhấn tiếp tục đổi trạng thái và phát resumed, bước kế tiếp chạy mô phỏng.
- Giải thích list scenario có mặt là thay thế danh sách ban đầu. Cờ random điều khiển lịch sinh về sau. Đom đóm tự nhiên có ttl_s là null. Gió Lạc dùng các điểm sương của Bóng Mực. Không tính thời gian Bóng Mực ở trạng thái spawning dài hơn tick vừa được sinh vì ticket chỉ yêu cầu bắt đầu tương tác từ tick sau.
- Khoảng cách tương tác đèn xét trên XZ và lọc khác tầng bằng chênh cao tối đa bằng bán kính tương tác. Khi chọn mục tiêu hướng dẫn ngoài màn hình, vẫn xét đèn gần nhất trên XZ. Điểm xuất phát Đêm 3 ở mặt đất dưới tầng trung tâm, giữ nguyên tọa độ gốc của contract. Tháp chỉ là vật cản từ mặt sàn tầng 2 trở lên.
- Nhạc, tiếng hiệu ứng và lá báo gió là phần trình bày trong browser. Headless chỉ xuất sự kiện của contract. Bảng màu dùng màu gốc của ticket kết hợp lớp ánh sáng ấm tăng theo tiến độ.

## Nhật ký AI và đánh giá

- Phúc giao Codex đọc Ticket-02 và thực hiện Phase 2. Codex cập nhật contract, mô phỏng, UI, test và thu bằng chứng.
- Kiểm tra bổ sung phát hiện và sửa va chạm tại điểm xuất phát dưới tầng 2 của Đảo Chuông. Test gió đặt tại vị trí thoáng để đo vận tốc do gió mà không bị vách chắn. Giữ cả hai trong bộ hồi quy.
- Ước tính thô 15.000–30.000 token dựa trên phần đọc, mã, kiểm chứng và trao đổi. Phiên không cung cấp số đo thực. Tái sử dụng Canvas và bộ test CLI, tập trung kiểm tra theo tick trước khi thêm trình bày.
- Tag phase-2 và push đang chờ môi trường Git có quyền ghi và có mạng. Đã xác nhận phiên hiện tại từ chối tạo .git/index.lock và không kết nối được GitHub.

## Lượt cải thiện đồ họa

- Codex vẽ lại bầu trời, lớp sương, vách đá, trang phục Mây, đèn và tháp chuông bằng Canvas, rồi chỉnh HUD và menu. Các chi tiết cảnh trí chỉ dùng để hiển thị. Mọi hình học và hiệu ứng của lượt này được tạo trong mã.
- npm start phục vụ view.mjs tại cổng 8131. Chạy thử đường vẽ với Canvas giả lập cho cả ba đêm tại 1050×680 và 420×800. npm test đạt 19/19. Lần chạy headless 21.600 tick cho JSONL khớp từng byte với bằng chứng trước đó.
- Trình duyệt tích hợp trả lỗi khi mở tab bản mới. Chưa xác minh trực tiếp chất lượng hình ảnh và FPS sau lần sửa này.

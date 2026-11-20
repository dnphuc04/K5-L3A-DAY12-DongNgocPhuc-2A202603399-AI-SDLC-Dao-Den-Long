# Retro · Đảo Đèn Lồng

| Phase | Đánh giá |
| --- | --- |
| 1 · Nguyên mẫu | Dùng chung mô phỏng 60 tick/giây cho browser và headless ngay từ đầu. Kịch bản tái lập theo seed giúp chứng minh thắng, thua, va chạm và chơi lại. Bản đồ và phần hiển thị còn đơn giản. |
| 2 · Ba hòn đảo | Mở rộng bản đồ, HUD và cơ chế mà vẫn tái sử dụng lõi mô phỏng. Đường chạy CLI phát hiện lỗi va chạm ở điểm xuất phát bên dưới tầng hai của Đảo Chuông. Giữ ca hồi quy cho dốc, bục nhảy và cửa sổ gió. |
| 3 · Đèn cạn dầu | ADR và ca thử theo tick làm rõ thứ tự cạn dầu, thắp lại và bình minh. Số nguyên theo đơn vị 1/60 tránh sai ngưỡng dầu 30. Edge chạy nền kiểm tra thao tác châm dầu và lưu bảng màu. |
| 4 · Phát hành | Kịch bản 200 Bóng Mực bộc lộ chi phí vẽ mà test headless không quan sát được. Soak và benchmark đo hai thuộc tính khác nhau. Test trình duyệt xác nhận đổi phím, thông báo và lưu điểm qua các luồng người dùng. |

## Cách làm với AI

Yêu cầu hiệu quả nhất là giao cho AI một phần của ticket với đầu ra kiểm chứng được, như JSONL ở tick cuối hoặc tiêu chí bàn phím ở 1280×720. Mô phỏng chia sẻ giúp test CLI kiểm tra cùng luật với browser. Đọc diff trước khi gắn tag giúp kết quả theo phase ngắn và có thể tái lập.

AI đã từng dùng độ sâu trung tâm đa giác để sắp xếp mặt đất, khiến mặt đất che chân Mây. Playtest phát hiện lỗi đó trong lúc test headless vẫn xanh. Bản sửa tách thứ tự mặt sàn và bóng dưới chân, rồi xác minh trực quan bằng Edge. Ở Phase 4, thử nghiệm trình duyệt với thời lượng ngắn còn phát hiện cảnh báo đếm ngược có thể bị bỏ qua khi màn menu đã đọc cùng giá trị đồng hồ. Đã chuyển điều kiện hiển thị sang bộ đếm phụ đề.

Benchmark đầu tiên dưới ngưỡng FPS trung bình và p1 low. Phân tích đường vẽ chỉ ra việc tạo lại gradient, vẽ nhiều mặt khuất và đọc kích thước DOM trong vòng lặp. Đã lưu ảnh quầng sáng để dùng lại, loại mặt khuất của hình khối đơn giản và đọc kích thước một lần mỗi khung. Số đo ghi trực tiếp từ lần chạy chuẩn.

## Harness, token và việc sẽ đổi

`AGENTS.md` giúp giữ đúng contract và nhắc chạy cả `npm test` lẫn game. Scenario headless là đường kiểm chứng hữu ích nhất vì chạy nhanh, có tick cụ thể và lưu JSONL thật. Kỹ năng PDF hỗ trợ đọc các ticket gốc. Playwright và FFmpeg hỗ trợ kiểm tra giao diện và lưu video từ một lượt thao tác thật.

Không có số liệu token hoặc hóa đơn thực cho toàn lab. Ước tính thô theo lượng nội dung đọc, mã và kiểm chứng là **55.000–110.000 token văn bản** qua bốn phase. Các phase tái sử dụng mô phỏng và fixture, tập trung đọc diff và log cần thiết. Nếu làm lại, sẽ đặt phép đo benchmark sớm hơn, thêm kiểm tra browser cho lỗi che nhân vật từ Phase 1 và giữ một bản tóm tắt quy tắc theo từng ticket để giảm số lần đọc lại.

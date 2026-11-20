# Phase 1 · PRD-0

## Tiêu chí nghiệm thu

| Yêu cầu | Cách kiểm chứng | Kết quả trên môi trường làm bài |
| --- | --- | --- |
| Đêm 1 có 5 đèn, camera theo Mây, màn bắt đầu và HUD | Mở npm start, bấm Bắt đầu, quan sát màn 3D, 3 lửa, 0/8 ánh sáng, 0/5 đèn và 3:00 | Đã thấy trong trình duyệt |
| Di chuyển theo camera, nhảy, nhặt đom đóm, nạp một phần và thắp đèn | Test CLI với input thưa tại các tick xác định | Đạt |
| Bóng Mực truy đuổi, gây mất lửa; tỏa sáng đẩy và làm choáng; đèn đã thắp bảo vệ | Test vị trí, hồi chiêu, miễn nhiễm và vùng an toàn | Đạt |
| Thắng khi thắp đủ, thua vì hết lửa hoặc trời sáng | Test chuỗi sự kiện và dòng cuối JSONL | Đạt ở CLI |
| Chơi lại khi kết thúc | Đứng yên đến khi Bóng Mực làm Mây mất hết lửa, bấm Chơi lại | Đã thấy màn thua ở 2:49. Chơi lại khôi phục 3 lửa, 0/8 ánh sáng, 0/5 đèn, 3:00 và 0 điểm |
| 60 tick/giây, cùng đầu vào cho cùng kết quả, lỗi định dạng trả 2 | Test CLI và so từng byte đầu ra | Đạt |
| Chạy trên macOS/Linux và bộ chấm ẩn | Node.js và các lệnh đa nền tảng | Chưa chạy trên hai hệ điều hành này hoặc bộ chấm |

Bằng chứng chạy thật nằm trong [test-output.txt](test-output.txt) và [dawn.jsonl](dawn.jsonl). Bản ghi dawn được tạo bằng lệnh sau.

```sh
node headless.mjs --seed 20 --night 1 --scenario docs/phase-1/dawn.json --ticks 120 --snapshot-every 30 --out docs/phase-1/dawn.jsonl
```

## Giả định và thiết kế

- Dùng game web, JS thuần, chiếu phối cảnh hình học 3D lên Canvas. Node chạy cùng mô phỏng với trình duyệt, không cần GPU hay thư viện npm.
- Đảo bán kính 32 m và có rìa chặn. Mở màn có 48 đom đóm, 3 Bóng Mực, 5 đèn; seed cố định ở bản chơi, seed CLI quyết định bố trí headless. Không sinh Bóng Mực giữa trận nên không có sự kiện shade_spawned trong màn mặc định.
- Đèn nhận ánh sáng từng phần, nạp vào đèn chưa sáng gần nhất, chiếu vùng an toàn khi đủ. Mất lửa không làm rơi đom đóm. Bóng Mực làm choáng không gây va chạm. Dash chưa dùng.
- Snapshot mặc định mỗi 60 tick dựa trên tần số mô phỏng. Dòng mô tả tham số này trong bản PDF bị cắt ở mép phải. Có thể chỉ định rõ bằng --snapshot-every.
- Snapshot định kỳ ghi sau sự kiện cùng tick. Phần thời gian hiển thị làm tròn lên, điểm thời gian khi thắng lấy số giây nguyên còn lại và làm tròn xuống.

## Nhật ký AI và retro

- Phúc giao Codex đọc PRD-0 và tài liệu repo rồi thực hiện Phase 1. Codex chọn kiến trúc, viết mã, soạn test, chạy kiểm chứng và ghi nhận các phần chưa kiểm tra. Đây là công việc do Codex thực hiện theo yêu cầu của Phúc.
- Giới hạn phạm vi theo PRD-0, dùng chung mô phỏng và kiểm tra sớm bằng CLI để tránh viết hai bộ gameplay. Ước tính thô 15.000–30.000 token văn bản, dựa trên lượng nội dung đọc, mã và kết quả công cụ. Phiên làm việc không cung cấp số đo token hoặc chi phí thực.
- CLI cho phép tái lập từng hành vi và xác định tick sai khi sửa ở phase sau. Trình duyệt đã kiểm tra khởi động, thua và chơi lại. Trận thắng đã được kiểm tra qua CLI, còn lượt chơi thủ công từ đầu đến thắng chưa chạy.

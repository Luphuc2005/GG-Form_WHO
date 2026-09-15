# Hướng dẫn Cập nhật Hệ thống An toàn (Update Guide)

Tài liệu hướng dẫn quy trình cập nhật mã nguồn và phiên bản mới cho hệ thống khảo sát y khoa.

---

## 1. NGUYÊN TẮC CẬP NHẬT
- **Không bao giờ xóa Volume dữ liệu**: Tuyệt đối không sử dụng lệnh `docker compose down -v`.
- **Luôn sao lưu trước khi cập nhật**: Tạo một bản sao lưu cơ sở dữ liệu trước mỗi lần triển khai bản vá.
- **Không làm gián đoạn người dùng dài**: Tiến trình cập nhật được tối ưu diễn ra trong vòng dưới 30 giây.

---

## 2. QUY TRÌNH CẬP NHẬT TỰ ĐỘNG

Chạy lệnh cập nhật kèm tùy chọn tự động sao lưu:
```bash
./scripts/update.sh --backup
```

Script sẽ tự động:
1. Tạo một tệp sao lưu `.dump` tại `/opt/ovarian-survey/backups/`.
2. Kéo mã nguồn mới nhất bằng `git pull` (nếu có kho git).
3. Xây dựng lại các image container có thay đổi.
4. Chạy lệnh `alembic upgrade head` để cập nhật cấu trúc bảng dữ liệu (nếu có).
5. Khởi động lại các container mà không làm mất dữ liệu.

---

## 3. CẬP NHẬT BIỂU MẪU KHẢO SÁT (FORM VERSIONING)

Nếu nhóm chuyên môn y khoa muốn cập nhật danh mục phân loại giải phẫu bệnh hoặc bổ sung các lựa chọn mới:

1. Tạo một tệp định nghĩa phiên bản mới: `form-definitions/ovarian-pathology-v2.json` với `"version": 2`.
2. Nạp phiên bản mới vào hệ thống:
   ```bash
   docker compose exec backend python -m app.commands.import_form form-definitions/ovarian-pathology-v2.json
   ```
3. Hệ thống sẽ tự động chuyển sang phục vụ phiên bản mới nhất cho người dùng mới mà **hoàn toàn không làm ảnh hưởng** đến các submission cũ của phiên bản v1.

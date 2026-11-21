# Hướng dẫn Sao lưu và Phục hồi Dữ liệu (Backup & Recovery Guide)

Hệ thống lưu trữ dữ liệu y khoa khảo sát quan trọng, do đó việc thiết lập sao lưu định kỳ là yêu cầu bắt buộc.

---

## 1. SAO LƯU THỦ CÔNG (MANUAL BACKUP)

Chạy script:
```bash
bash scripts/backup_db.sh
```

Tệp sao lưu được xuất ra theo định dạng nén tối ưu của PostgreSQL (`-Fc`), có gắn mốc thời gian:
`ovarian_YYYY-MM-DD_HHMMSS.dump`

Mặc định lưu trong `/opt/ovarian-survey/backups/` nếu có thư mục cài đặt, hoặc `./backups/` ở gốc checkout. Biến shell `BACKUP_DIR` cho phép chỉ định thư mục khác.

Kiểm tra danh sách các bản sao lưu đã tạo:
```bash
ls -lh /opt/ovarian-survey/backups/
```

---

## 2. SAO LƯU TỰ ĐỘNG BẰNG DOCKER COMPOSE

Bản triển khai hiện tại có dịch vụ `backup`: tạo bản sao ngay khi khởi động, sau đó mặc định mỗi 24 giờ, giữ khoảng 7 ngày. Điều chỉnh bằng `BACKUP_INTERVAL_HOURS` và `BACKUP_KEEP_DAYS`. Bản sao nén được kiểm tra bằng `pg_restore --list` trước khi ghi nhận thành công; bản cũ không bị xóa khi lần sao lưu mới lỗi. Healthcheck báo lỗi nếu quá chu kỳ mà chưa có bản sao thành công.

```bash
docker compose ps backup
docker compose logs --tail=20 backup
docker compose exec -T backup ls -lh /backups
```

Dữ liệu nằm trong volume `ovarian_survey_backup_data`, tách với volume database. Tên file là `who-YYYYMMDD-HHMMSS.dump`, thời gian UTC. Để lấy một bản sao về máy chủ Linux, thay tên file dưới đây bằng tên vừa liệt kê:

```bash
mkdir -p backups
umask 077
docker compose exec -T backup cat /backups/who-YYYYMMDD-HHMMSS.dump > backups/who-YYYYMMDD-HHMMSS.dump
docker compose exec -T postgres pg_restore --list < backups/who-YYYYMMDD-HHMMSS.dump >/dev/null
```

Giữ thêm bản sao trên nơi lưu trữ khác máy chủ. Volume backup cùng máy giúp xử lý xóa/sửa nhầm nhưng không thay thế bản sao ngoài máy khi ổ đĩa máy chủ hỏng. Khi ứng dụng dùng `DATABASE_URL` bên ngoài Compose, cấu hình nhóm `BACKUP_PG*` trong `.env.example` trỏ đúng database đó.

Đã thử script backup trong container PostgreSQL 16, khôi phục vào database thử riêng với 20.000 phiếu giả và đối chiếu khớp toàn bộ hash nội dung. Trên máy chủ đích, vẫn cần diễn tập khôi phục bản sao của chính máy chủ.

### Nếu dùng cron thay cho dịch vụ backup

Không cần đặt thêm cron khi dịch vụ `backup` đã chạy. Nếu hạ tầng quản lý sao lưu bằng cron riêng, có thể dùng script thủ công ở phần 1 và lịch sau:

Mở cấu hình crontab của hệ thống:
```bash
sudo crontab -e
```

Thêm dòng lệnh sau vào cuối tệp:
```cron
# Sao lưu cơ sở dữ liệu khảo sát vào lúc 02:00 sáng mỗi ngày
0 2 * * * /bin/bash /opt/ovarian-survey/scripts/backup_db.sh >> /var/log/ovarian_backup.log 2>&1
```

---

## 3. KHÔI PHỤC DỮ LIỆU (RESTORE)

Khi cần khôi phục lại cơ sở dữ liệu:

1. Xác định tệp sao lưu cần khôi phục:
   ```bash
   ls -lt /opt/ovarian-survey/backups/
   ```
2. Chạy lệnh khôi phục:
   ```bash
   bash scripts/restore_db.sh /opt/ovarian-survey/backups/ovarian_2026-09-10_160000.dump
   ```
3. Hệ thống sẽ hiển thị cảnh báo và yêu cầu xác nhận `DONG_Y` trước khi thực hiện.

Script kiểm tra archive trước, tạo bản sao database hiện tại rồi dừng Nginx, backend, worker và backup trước khi phục hồi để không có tiến trình ghi đồng thời. Sau khi khôi phục, ứng dụng vẫn dừng. Đối chiếu commit cần dùng rồi chạy `bash scripts/deploy.sh` để chạy migration phù hợp và mở lại. Không restore khi còn người nhập dữ liệu.

Script dùng cho database riêng của ứng dụng: thay toàn bộ schema `public` bằng nội dung bản sao trong một giao dịch. Bảng mới không có trong backup cũ cũng được gỡ, tránh lỗi khóa ngoại khi quay về schema cũ. Nếu SQL phục hồi lỗi, PostgreSQL rollback toàn bộ giao dịch. File SQL tạm chỉ người chạy đọc được và được xóa khi script kết thúc. Không dùng script này trên database dùng chung với ứng dụng khác.

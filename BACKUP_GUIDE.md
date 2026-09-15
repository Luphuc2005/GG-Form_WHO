# Hướng dẫn Sao lưu và Phục hồi Dữ liệu (Backup & Recovery Guide)

Hệ thống lưu trữ dữ liệu y khoa khảo sát quan trọng, do đó việc thiết lập sao lưu định kỳ là yêu cầu bắt buộc.

---

## 1. SAO LƯU THỦ CÔNG (MANUAL BACKUP)

Chạy script:
```bash
./scripts/backup_db.sh
```

Tệp sao lưu được xuất ra theo định dạng nén tối ưu của PostgreSQL (`-Fc`), có gắn mốc thời gian:
`ovarian_YYYY-MM-DD_HHMMSS.dump`

Kiểm tra danh sách các bản sao lưu đã tạo:
```bash
ls -lh /opt/ovarian-survey/backups/
```

---

## 2. THIẾT LẬP SAO LƯU TỰ ĐỘNG HÀNG NGÀY (CRONJOB)

Mở cấu hình crontab của hệ thống:
```bash
sudo crontab -e
```

Thêm dòng lệnh sau vào cuối tệp:
```cron
# Sao lưu cơ sở dữ liệu khảo sát vào lúc 02:00 sáng mỗi ngày
0 2 * * * /opt/ovarian-survey/scripts/backup_db.sh >> /var/log/ovarian_backup.log 2>&1
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
   ./scripts/restore_db.sh /opt/ovarian-survey/backups/ovarian_2026-09-10_160000.dump
   ```
3. Hệ thống sẽ hiển thị cảnh báo và yêu cầu xác nhận `DONG_Y` trước khi thực hiện.

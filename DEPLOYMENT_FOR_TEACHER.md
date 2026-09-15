# TÀI LIỆU HƯỚNG DẪN TRIỂN KHAI VÀ VẬN HÀNH HỆ THỐNG
## Dành riêng cho Giảng viên & Quản trị viên Máy chủ Linux (Ubuntu Server)
**Hệ thống:** Khảo sát Phân loại Giải phẫu bệnh U buồng trứng theo WHO

---

## MỤC LỤC
1. [Giới thiệu hệ thống](#1-giới-thiệu-hệ-thống)
2. [Sơ đồ kiến trúc hoạt động](#2-sơ-đồ-kiến-trúc-hoạt-động)
3. [Yêu cầu cấu hình máy chủ](#3-yêu-cầu-cấu-hình-máy-chủ)
4. [Kiểm tra hiện trạng máy chủ trước khi cài](#4-kiểm-tra-hiện-trạng-máy-chủ-trước-khi-cài)
5. [Cài đặt Docker & Docker Compose (nếu chưa có)](#5-cài-đặt-docker--docker-compose-nếu-chưa-có)
6. [Tải mã nguồn dự án lên máy chủ](#6-tải-mã-nguồn-dự-án-lên-máy-chủ)
7. [Thiết lập tệp cấu hình .env](#7-thiết-lập-tệp-cấu-hình-env)
8. [Hai phương án triển khai thực tế (Quan trọng)](#8-hai-phương-án-triển-khai-thực-tế-quan-trọng)
   - [Kịch bản A: Máy chủ độc lập (Chưa chạy web nào khác)](#kịch-bản-a-máy-chủ-độc-lập-chưa-chạy-web-nào-khác)
   - [Kịch bản B: Máy chủ trường đã có sẵn Nginx/Website khác](#kịch-bản-b-máy-chủ-trường-đã-có-sẵn-nginxwebsite-khác)
9. [Lệnh triển khai tự động (1 dòng lệnh)](#9-lệnh-triển-khai-tự-động-1-dòng-lệnh)
10. [Cấu hình Tên miền và Chứng chỉ bảo mật HTTPS](#10-cấu-hình-tên-miền-và-chứng-chỉ-bảo-mật-https)
11. [Khởi tạo và quản lý tài khoản Quản trị (Admin)](#11-khởi-tạo-và-quản-lý-tài-khoản-quản-trị-admin)
12. [Kiểm tra hoạt động của Khảo sát và Trang Quản trị](#12-kiểm-tra-hoạt-động-của-khảo-sát-và-trang-quản-trị)
13. [Quy trình Sao lưu Cơ sở dữ liệu (Backup)](#13-quy-trình-sao-lưu-cơ-sở-dữ-liệu-backup)
14. [Quy trình Khôi phục Dữ liệu (Restore)](#14-quy-trình-khôi-phục-dữ-liệu-restore)
15. [Cập nhật phiên bản mới an toàn (Update)](#15-cập-nhật-phiên-bản-mới-an-toàn-update)
16. [Xem Logs, Khởi động lại và Dừng hệ thống](#16-xem-logs-khởi-động-lại-và-dừng-hệ-thống)
17. [Xử lý sự cố thường gặp (Troubleshooting)](#17-xử-lý-sự-cố-thường-gặp-troubleshooting)

---

## 1. GIỚI THIỆU HỆ THỐNG

Hệ thống được xây dựng nhằm giải quyết triệt để hạn chế của Google Forms trong các nghiên cứu giải phẫu bệnh học:
- **Hiện lựa chọn con NGAY DƯỚI lựa chọn cha**: Khi người dùng tick vào một mục bệnh lý phức tạp (ví dụ: *Carcinoma tuyến thanh dịch độ mô học cao*), 3 lựa chọn con sẽ lập tức mở rộng bên dưới.
- **Thu gọn và tự động xóa dữ liệu con**: Khi người dùng bỏ tick mục cha, toàn bộ lựa chọn con sẽ biến mất và dữ liệu của chúng được xóa sạch, đảm bảo không có dữ liệu rác gửi về máy chủ.
- **Không gây nghẽn máy chủ**: Toàn bộ thao tác bấm tick/untick diễn ra 100% trong bộ nhớ trình duyệt người dùng. Máy chủ chỉ nhận đúng 1 request khi người dùng bấm **[Gửi]**.
- **Khả năng lưu trữ**: Được thiết kế để lưu trữ bền vững ít nhất **1.000.000 phiếu khảo sát** trong cơ sở dữ liệu PostgreSQL.

---

## 2. SƠ ĐỒ KIẾN TRÚC HOẠT ĐỘNG

```
[Người dùng truy cập] ──► [Cổng 80/443 HTTPS]
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │     Nginx Container   │
                     └───────────┬───────────┘
               Phục vụ static    │     Chuyển tiếp /api/*
               React SPA (nhẹ)   │
                                 ▼
                     ┌───────────────────────┐
                     │   FastAPI Backend     │ (Stateless, Uvicorn)
                     └───────────┬───────────┘
                                 │ Mạng nội bộ bảo mật (Không mở ra Internet)
                                 ▼
                     ┌───────────────────────┐
                     │ PostgreSQL 16 (DB)    │ (Lưu trên Volume ổ cứng máy chủ)
                     └───────────────────────┘
```

---

## 3. YÊU CẦU CẤU HÌNH MÁY CHỦ

Cấu hình tối thiểu đề xuất cho Ubuntu 20.04 / 22.04 / 24.04 LTS:
- **CPU**: 2 vCPU trở lên.
- **RAM**: 2 GB trở lên (Khuyến nghị 4 GB nếu lưu lượng truy cập dồn dập).
- **Ổ cứng (Disk)**: Còn trống tối thiểu 10 GB SSD.
- **Quyền hạn**: Tài khoản có quyền `sudo`.

---

## 4. KIỂM TRA HIỆN TRẠNG MÁY CHỦ TRƯỚC KHI CÀI

Trong thư mục dự án đã chuẩn bị sẵn một script kiểm tra **chỉ đọc** (hoàn toàn không làm thay đổi hệ thống của trường). Hãy chạy:

```bash
chmod +x scripts/check_server.sh
./scripts/check_server.sh
```

Kết quả in ra màn hình sẽ cho biết:
- Hệ điều hành, số lõi CPU, dung lượng RAM và ổ đĩa còn trống.
- Trạng thái Docker đã có hay chưa.
- **Các cổng 80, 443, 8080, 5432 có đang bị dịch vụ nào chiếm dụng hay không**.

---

## 5. CÀI ĐẶT DOCKER & DOCKER COMPOSE (NẾU CHƯA CÓ)

Nếu script `check_server.sh` báo máy chủ chưa có Docker, hãy chạy các lệnh chính thức sau trên Ubuntu:

```bash
# Cập nhật danh sách gói
sudo apt-get update

# Cài đặt các gói phụ trợ
sudo apt-get install -y ca-certificates curl gnupg

# Thêm khóa GPG chính thức của Docker
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Thêm kho phần mềm Docker
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Cài đặt Docker Engine và Compose plugin
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Phân quyền cho người dùng hiện tại (để không cần gõ sudo mỗi lần gọi docker)
sudo usermod -aG docker $USER
newgrp docker
```

---

## 6. TẢI MÃ NGUỒN DỰ ÁN LÊN MÁY CHỦ

Khuyến nghị đặt toàn bộ dự án tại thư mục chuẩn `/opt/ovarian-survey/`:

```bash
# Tạo thư mục và cấp quyền
sudo mkdir -p /opt/ovarian-survey
sudo chown -R $USER:$USER /opt/ovarian-survey

# Cách 1: Sao chép qua Git
git clone <LINK_GIT_REPO> /opt/ovarian-survey

# Cách 2: Nếu nhận tệp .zip từ người phát triển
# unzip ovarian-pathology-survey.zip -d /opt/ovarian-survey

cd /opt/ovarian-survey
```

---

## 7. THIẾT LẬP TỆP CẤU HÌNH .ENV

Tạo tệp `.env` từ tệp mẫu `.env.example`:

```bash
cp .env.example .env
nano .env
```

**Các thông số quan trọng cần thay đổi:**
1. `DOMAIN`: Điền tên miền của trường nếu có (ví dụ: `gpb.example.edu.vn`).
2. `POSTGRES_PASSWORD`: Đặt một chuỗi mật khẩu mạnh cho cơ sở dữ liệu.
3. `SECRET_KEY`: Đặt một chuỗi ngẫu nhiên dài trên 32 ký tự để mã hóa token phiên.
4. `ADMIN_USERNAME`: Tên đăng nhập trang quản trị (Mặc định: `admin`).
5. `ADMIN_PASSWORD`: Mật khẩu đăng nhập trang quản trị (Vui lòng đổi mật khẩu an toàn).
6. `APP_HTTP_PORT`:
   - Nếu theo **Kịch bản A** (Máy chủ mới): Có thể để `80` hoặc `8080`.
   - Nếu theo **Kịch bản B** (Máy chủ đã có sẵn Nginx): Để `8080`.

Lưu tệp bằng tổ hợp phím `Ctrl + O` -> `Enter`, thoát bằng `Ctrl + X`.

---

## 8. HAI PHƯƠNG ÁN TRIỂN KHAI THỰC TẾ (QUAN TRỌNG)

### Kịch bản A: Máy chủ độc lập (Chưa chạy web nào khác)
- Cổng 80 và 443 đang trống.
- Container Nginx của dự án sẽ trực tiếp lắng nghe cổng 80 (và 443).
- Cấu hình trong `.env`:
  ```bash
  APP_HTTP_PORT=80
  ```

### Kịch bản B: Máy chủ trường đã có sẵn Nginx/Website khác
> [!IMPORTANT]
> Tuyệt đối KHÔNG gỡ bỏ hoặc tắt Nginx đang có của trường!

1. Trong tệp `.env` của dự án, giữ nguyên:
   ```bash
   APP_HTTP_PORT=8080
   ```
2. Dự án sẽ chạy ngầm và lắng nghe tại `127.0.0.1:8080`.
3. Cấu hình Nginx có sẵn của máy chủ để chuyển tiếp (Reverse Proxy) vào ứng dụng:
   ```bash
   sudo cp deploy/nginx-host-example.conf /etc/nginx/sites-available/ovarian-survey.conf
   ```
4. Mở tệp `/etc/nginx/sites-available/ovarian-survey.conf` và điền tên miền thực tế.
5. Kích hoạt:
   ```bash
   sudo ln -s /etc/nginx/sites-available/ovarian-survey.conf /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```

---

## 9. LỆNH TRIỂN KHAI TỰ ĐỘNG (1 DÒNG LỆNH)

Sau khi đã điền tệp `.env`, chỉ cần chạy 1 lệnh duy nhất:

```bash
chmod +x scripts/*.sh
sudo ./scripts/deploy.sh
```

Script này sẽ tự động:
1. Kiểm tra Docker & Compose.
2. Xây dựng Docker images (Frontend React & Backend FastAPI).
3. Khởi động PostgreSQL và chờ PostgreSQL đạt trạng thái `healthy`.
4. Chạy Alembic Migration tạo đầy đủ các bảng dữ liệu.
5. Tự động nạp biểu mẫu khảo sát WHO v1 từ `form-definitions/ovarian-pathology-v1.json`.
6. Khởi tạo tài khoản quản trị viên.
7. Khởi động Nginx và kiểm tra sức khỏe hệ thống (Healthcheck).

---

## 10. CẤU HÌNH TÊN MIỀN VÀ CHỨNG CHỈ BẢO MẬT HTTPS

Để chạy HTTPS miễn phí và tự động gia hạn bằng Let's Encrypt / Certbot:

```bash
# Cài đặt Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# Tạo chứng chỉ cho tên miền (Thay YOUR_DOMAIN bằng domain thật)
sudo certbot --nginx -d gpb.example.edu.vn

# Kiểm tra tính năng tự động gia hạn chứng chỉ
sudo certbot renew --dry-run
```

---

## 11. KHỞI TẠO VÀ QUẢN LÝ TÀI KHOẢN QUẢN TRỊ (ADMIN)

Nếu muốn tạo thêm tài khoản admin hoặc đổi mật khẩu sau này, chạy lệnh:

```bash
docker compose exec backend python -m app.commands.create_admin --username admin --password "MatKhauMoiCucKyAnToan2026!"
```

---

## 12. KIỂM TRA HOẠT ĐỘNG CỦA KHẢO SÁT VÀ TRANG QUẢN TRỊ

1. **Khảo sát dành cho người dùng**:
   - Truy cập: `https://YOUR_DOMAIN/` (hoặc `http://<IP_MAY_CHU>:8080/`)
   - Thử nghiệm:
     - Chưa tick *Carcinoma tuyến thanh dịch độ mô học cao*: 3 lựa chọn con ẩn hoàn toàn.
     - Tick vào: 3 lựa chọn con xuất hiện ngay bên dưới.
     - Chọn thử 1 lựa chọn con rồi bỏ tick cha: Lựa chọn con lập tức ẩn và bị xóa.
     - Chọn mục *Lành/Ác*.
     - Bấm **[Gửi]**: Nhận thông báo "Đã ghi nhận phiếu" kèm mã số tham chiếu.
2. **Trang Quản trị (Admin)**:
   - Truy cập: `https://YOUR_DOMAIN/admin`
   - Đăng nhập bằng tài khoản và mật khẩu admin đã tạo.
   - Xem bảng thống kê tổng số phiếu, số phiếu hôm nay, phân loại Lành/Giáp biên ác/Ác.
   - Bấm nút **[Xuất CSV (UTF-8 BOM)]**: Tải về tệp CSV mở được trực tiếp bằng Microsoft Excel mà không bị lỗi font tiếng Việt.

---

## 13. QUY TRÌNH SAO LƯU CƠ SỞ DỮ LIỆU (BACKUP)

Chạy lệnh sao lưu:
```bash
./scripts/backup_db.sh
```
Bản sao lưu sẽ được lưu trực tiếp trên ổ đĩa của máy chủ host tại:
`/opt/ovarian-survey/backups/ovarian_YYYY-MM-DD_HHMMSS.dump`

### Thiết lập tự động sao lưu định kỳ hàng ngày (Cronjob)
Mở bảng lịch trình cron:
```bash
sudo crontab -e
```
Thêm dòng sau để tự động sao lưu vào 02:00 sáng mỗi ngày:
```cron
0 2 * * * /opt/ovarian-survey/scripts/backup_db.sh > /dev/null 2>&1
```

---

## 14. QUY TRÌNH KHÔI PHỤC DỮ LIỆU (RESTORE)

Khi cần khôi phục lại dữ liệu từ một bản sao lưu trước đó:

```bash
./scripts/restore_db.sh /opt/ovarian-survey/backups/ovarian_2026-09-10_160000.dump
```
> Script sẽ hiển thị cảnh báo và yêu cầu gõ chữ `DONG_Y` trước khi thực hiện để đảm bảo an toàn tuyệt đối, tránh ghi đè nhầm lẫn.

---

## 15. CẬP NHẬT PHIÊN BẢN MỚI AN TOÀN (UPDATE)

Khi có bản cập nhật mới từ nhóm lập trình:

```bash
# Cập nhật an toàn (tự động sao lưu database trước khi cập nhật)
./scripts/update.sh --backup
```
> [!CAUTION]
> Tuyệt đối KHÔNG chạy lệnh `docker compose down -v` vì cờ `-v` sẽ xóa sạch ổ cứng lưu trữ database!

---

## 16. XEM LOGS, KHỞI ĐỘNG LẠI VÀ DỪNG HỆ THỐNG

```bash
# Xem trạng thái các container
docker compose ps

# Xem log hoạt động của Backend trong thời gian thực
docker compose logs -f backend

# Xem log của Nginx
docker compose logs -f nginx

# Khởi động lại riêng Backend (không ảnh hưởng dữ liệu)
docker compose restart backend

# Khởi động lại toàn bộ stack
docker compose restart

# Dừng tạm thời hệ thống (Dữ liệu vẫn được bảo toàn nguyên vẹn trên volume)
docker compose stop

# Khởi động lại sau khi dừng
docker compose up -d
```

---

## 17. XỬ LÝ SỰ CỐ THƯỜNG GẶP (TROUBLESHOOTING)

### 1. Không thể truy cập cổng 80/443 hoặc 8080 từ bên ngoài:
Kiểm tra tường lửa (Firewall) trên máy chủ Ubuntu:
```bash
sudo ufw status
# Mở cổng nếu đang chặn:
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8080/tcp
```
*(Lưu ý: Không bao giờ mở cổng 5432 của PostgreSQL ra Internet).*

### 2. Backend báo lỗi không thể kết nối tới Cơ sở dữ liệu:
Kiểm tra xem container PostgreSQL có đang chạy và đạt trạng thái Healthy hay không:
```bash
docker compose ps postgres
docker compose logs postgres
```

### 3. File CSV xuất ra hiển thị ký tự lạ trong Excel:
Tệp CSV của hệ thống đã được nhúng sẵn tiền tố UTF-8 BOM (`\ufeff`). Nếu mở bằng Excel phiên bản cũ:
Vào `Data` -> `From Text/CSV` -> Chọn `65001: Unicode (UTF-8)`.

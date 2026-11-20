# Sửa bố cục biểu mẫu đã xuất bản từ trang quản lý

Từ ngày 20/11/2026, tính năng chọn đơn vị cho CA 125, HE4, ROMA, AFP, beta hCG đã được bỏ theo yêu cầu. Năm mục này tiếp tục chỉ nhập số. Không chạy lệnh bật đơn vị xét nghiệm của bản cập nhật trước. Bản sửa bố cục và các câu hỏi do admin thêm vẫn được giữ lại.

Website hiện đã có biểu mẫu v3 và câu Số lượng u do admin thêm trong phần Phẫu thuật. Cấu hình nằm trong database, dùng mã `custom_eb7f5f353789`, với ba lựa chọn Trái, Phải, 2 bên. Bản sửa này giữ nguyên mã và cấu hình đó.

Lỗi trước đây xuất hiện khi form chuyển từ giao diện chuẩn sang giao diện đọc cấu hình: khung tiêu đề chưa chiếm toàn bộ chiều ngang của lưới hai cột. Bản sửa dùng chung các lớp bố cục cho tiêu đề, thanh tiến độ, menu, nhóm câu hỏi và thanh gửi. Câu hỏi và nội dung dài tiếp tục được bố trí theo cấu hình khi thêm hoặc xuất bản phiên bản mới.

## Chị Linh chạy trên máy chủ

Trong thư mục có `docker-compose.yml`:

```bash
set -e
git pull --ff-only origin main
docker compose build nginx
docker compose up -d --no-deps nginx
docker compose ps nginx
```

Service `nginx` trong Compose đóng gói frontend. Cần build lại image; restart image cũ sẽ chưa nhận giao diện mới.

Đây là bản cập nhật frontend. Không cần build lại backend, chạy migration, `import_form`, `create_admin`, bản vá WHO hoặc xuất bản lại v3. Giữ nguyên các biến môi trường và Apps Script đang hoạt động. Các phiếu cũ tiếp tục dùng phiên bản đã nhập.

Frontend cũng kiểm tra danh mục backend trước khi bật bộ trường phẫu thuật trong form chuẩn cũ. Vì vậy cập nhật riêng frontend với backend hiện tại không tự gửi những mã trường mà backend chưa hỗ trợ. Câu do admin thêm trong v3 tiếp tục được lấy từ cấu hình v3.

## Đối chiếu sau khi deploy

1. Mở trang Quản lý biểu mẫu, xác nhận v3 hoặc phiên bản mới hơn do admin đã xuất bản vẫn có câu Số lượng u đã thêm. Không thêm một câu trùng chỉ để cập nhật giao diện.
2. Tải lại trang bằng Ctrl+F5. Có thể đặt mức thu phóng trình duyệt về mặc định bằng Ctrl+0 khi kiểm tra.
3. Mở phiên nhập mới trên cửa sổ ẩn danh. Khung tiêu đề và thanh tiến độ phải trải hết chiều ngang, menu nằm bên trái và nội dung ở bên phải trên desktop. Trên điện thoại, các phần xếp thành một cột.
4. Mở phần Phẫu thuật. Câu Số lượng u do admin thêm phải xuất hiện đúng một lần với Trái, Phải, 2 bên. WHO giữ 20 lựa chọn.
5. Có thể xem thử một câu mới trong Quản lý biểu mẫu → Kiểm tra & xem trước để kiểm tra nội dung dài. Chỉ xuất bản khi thực sự muốn áp dụng cấu hình mới. Phiếu đã tạo trước đó vẫn giữ phiên bản của phiếu.

Các câu hỏi bổ sung tiếp tục được quản lý qua trang Quản lý biểu mẫu. Bản sửa giao diện không thay thế danh sách câu hỏi đã lưu bằng bộ câu hỏi mặc định trong code.

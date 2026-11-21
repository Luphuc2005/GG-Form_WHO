# Cập nhật phần protocol phẫu thuật

> Các lệnh cập nhật riêng trong tài liệu này chỉ áp dụng cho bản cũ. Với `main` hiện tại, dùng [hướng dẫn nâng cấp từ form v3](HUONG_DAN_DEPLOY_LAI_CHO_LINH.md); bản mới cần migration và worker. Không dùng `up --no-deps backend nginx` để bỏ qua các bước đó.

Website đã xuất bản cấu hình v3 và admin đã tự thêm câu Số lượng u. Nếu mục đích hiện tại là sửa bố cục và giữ câu đã thêm, dùng [hướng dẫn sửa giao diện form](HUONG_DAN_SUA_GIAO_DIEN_FORM.md). Hướng dẫn bên dưới dành cho cập nhật bộ câu hỏi chuẩn trong code.

Bản này thêm bốn mục vào phần VI trên form nhập liệu và màn hình xem/sửa phiếu admin:

1. Số lượng u: Trái, Phải, 2 bên, cùng danh mục với siêu âm và MRI.
2. Dịch ổ bụng: Không/Có; chọn Có sẽ hiện ô mô tả.
3. U dính với cơ quan khác: Không/Có; chọn Có sẽ hiện ô mô tả.
4. Tổn thương nghi ngờ di căn: Không/Có; chọn Có sẽ hiện ô mô tả.

Các mục mới có thể để trống nếu hồ sơ chưa có thông tin. Khi đổi từ Có sang Không, mô tả tương ứng được xóa khỏi bản đang chỉnh. Excel/CSV có bảy cột riêng cho bốn mục và ba mô tả. Google Sheets tự thêm bảy cột ở cuối khi có phiếu đã gửi chứa dữ liệu phẫu thuật mới, giữ vị trí các cột hiện có.

Mục dịch ổ bụng cũ từng lưu lượng dịch vẫn được giữ nguyên trong phiếu cũ và dữ liệu xuất. Mục Có/Không mới dùng mã riêng, không tự diễn giải lại dữ liệu lịch sử.

## Chạy trên máy chủ

Chạy tại thư mục có `docker-compose.yml`:

```bash
set -e
git pull --ff-only origin main
bash scripts/backup_db.sh
docker compose build backend nginx
docker compose up -d --no-deps backend nginx
docker compose ps
```

Service `nginx` chứa bản build frontend. Cần build lại cả `backend` và `nginx`; restart container cũ sẽ tiếp tục dùng mã cũ trong image.

## Kiểm tra sau cập nhật

```bash
docker compose exec -T backend python -c 'import json,urllib.request; print(json.load(urllib.request.urlopen("http://localhost:8000/health/ready")))'
docker compose exec -T backend python -c 'import json,urllib.request; d=json.load(urllib.request.urlopen("http://localhost:8000/api/v1/forms/clinical-contract")); print("contract_version =",d["version"]); print("surgery_choices =",d["choices"]["pt_so_luong_u"]); assert d["version"] >= 5; assert d["choices"]["pt_so_luong_u"] == ["Trái","Phải","2 bên"]'
```

Mở lại website, tải mới bằng Ctrl+F5. Phần VI hiển thị 11 mục chính. Chọn Có ở mỗi mục mới để kiểm tra ô mô tả. Lưu bản nháp và mở lại phiếu để kiểm tra dữ liệu. Khi gửi phiếu, Google Sheets thêm các cột mới và trạng thái phải chuyển sang Đã đồng bộ. Nếu phiếu đang Đồng bộ lỗi, dùng Đồng bộ lại sau khi kiểm tra kết nối.

## Phạm vi triển khai

- Không thêm biến môi trường. Giữ nguyên ba giá trị kết nối Google Sheets đang hoạt động.
- Không sửa Dockerfile hoặc `docker-compose.yml`.
- Không có migration database mới. Không cần chạy lại `import_form`, `create_admin` hay bản vá WHO.
- Danh mục WHO 20 lựa chọn hiện hành được giữ nguyên.
- Apps Script đã cập nhật có hỗ trợ `schema` và `snapshot` tiếp tục dùng được, không cần dán lại mã hoặc tạo URL mới.
- Hướng dẫn này áp dụng cho biểu mẫu chuẩn đang chạy trên website (`clinical_fields: null`). Nếu đã xuất bản cấu hình riêng qua Quản lý biểu mẫu, cần thêm các câu hỏi vào cấu hình riêng rồi xuất bản phiên bản mới.

Các mã câu hỏi mới là `pt_so_luong_u`, `pt_co_dich_o_bung`, `pt_co_dich_o_bung_ghi_chu`, `pt_u_dinh_co_quan_khac`, `pt_u_dinh_co_quan_khac_ghi_chu`, `pt_nghi_ngo_di_can`, `pt_nghi_ngo_di_can_ghi_chu`.

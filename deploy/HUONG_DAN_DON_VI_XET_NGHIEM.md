# Đơn vị gốc cho 5 chỉ số xét nghiệm

Bản này thêm lựa chọn đơn vị cạnh CA 125, HE4, ROMA, AFP và beta hCG. Kết quả số và đơn vị được lưu riêng, xuất thành các cột riêng trên Excel/CSV/Google Sheets. Không tự quy đổi số, suy đoán đơn vị theo bệnh viện, hoặc gán lại đơn vị cho dữ liệu lịch sử.

## Cách nhập liệu

| Chỉ số | Lựa chọn ban đầu |
|---|---|
| CA 125 | U/mL, kU/L, Khác, Chưa xác nhận |
| HE4 | pmol/L, Khác, Chưa xác nhận |
| ROMA | %, Chỉ số, Khác, Chưa xác nhận |
| AFP | IU/mL, ng/mL, Khác, Chưa xác nhận |
| beta hCG | mIU/mL, IU/L, Khác, Chưa xác nhận |

- Chọn theo đúng phiếu xét nghiệm gốc. Khi chưa có kết quả, để trống cả giá trị và đơn vị.
- Ở phiên bản biểu mẫu đã bật tính năng, có kết quả số, kể cả 0, thì phải chọn đơn vị trước khi gửi. Bản nháp được lưu khi chưa điền xong.
- Chọn Khác để nhập đơn vị/dạng kết quả ngoài danh sách, tối đa 200 ký tự. Chọn Chưa xác nhận khi chưa đối chiếu được nguồn; trạng thái này cần được xử lý khi chuẩn bị dữ liệu phân tích.
- ROMA có thể ghi theo % hoặc dạng chỉ số như phiếu gốc; hệ thống không tự nhân/chia 100. Giới hạn kiểm tra số của phiếu hiện có được giữ nguyên.
- Đổi từ Khác sang một đơn vị trong danh sách sẽ xóa nội dung ô đơn vị khác của lần chỉnh sửa đó. Giá trị xét nghiệm không đổi.
- Các phiếu cũ vẫn giữ phiên bản đã nhập. Sau khi cập nhật backend/frontend, admin có thể bổ sung đơn vị cho phiếu cũ sau khi đối chiếu nguồn; việc bổ sung là thủ công. Không có tác vụ tự điền đơn vị vào phiếu cũ.

Các đơn vị là lựa chọn ghi nhận dữ liệu, không phải công thức chuẩn hóa hay ngưỡng chẩn đoán. Phương pháp/bộ xét nghiệm cũng cần được xem xét khi đối chiếu AFP giữa các nơi. Tham khảo tài liệu gốc: [Roche AFP](https://elabdoc-prod.roche.com/LifeScience/Document/86d4790f-32a7-ea11-fa90-005056a772fd), [Labcorp ROMA/CA 125/HE4](https://www.labcorp.com/tests/140045/ovarian-malignancy-risk-roma), [UW hCG tumor marker](https://testguide.labmed.uw.edu/view/HCGTRD?tabs=yes).

## Chị Linh triển khai một lần

Chạy trong thư mục có `docker-compose.yml`. Bản này cần cả backend và frontend mới, khác với bản chỉ sửa bố cục trước đó.

```bash
set -e
git pull --ff-only origin main
bash scripts/backup_db.sh
docker compose build backend nginx
docker compose up -d --no-deps backend nginx
docker compose ps
```

Xác nhận sao lưu thành công trước khi cập nhật. Service `nginx` chứa frontend. Giữ nguyên các biến môi trường và Apps Script đang hoạt động; không có migration Alembic mới, không cần chạy lại `import_form` hay `create_admin`.

### Xem trước cập nhật cấu hình

```bash
docker compose exec -T backend python -m app.commands.enable_biomarker_units
```

Lệnh mặc định chỉ đọc. Kết quả có `status: "preview"`, số phiên bản hiện tại, danh sách 10 ô đơn vị/đơn vị khác cần thêm và số câu hỏi tự thêm được giữ lại. Với cấu hình v3 đang dùng, câu Số lượng u do admin tạo được giữ nguyên.

Nếu `pending_configuration_draft: true`, hoàn tất bản nháp trong Quản lý biểu mẫu trước, rồi chạy lại. Lệnh áp dụng sẽ dừng khi còn bản nháp chung để bảo vệ thay đổi đang làm.

### Bật đơn vị cho phiên bản mới

```bash
docker compose exec -T backend python -m app.commands.enable_biomarker_units --apply
```

Kết quả có `status: "published"` và `published_version`. Nếu hiện tại là v3 và chưa có phiên bản khác, bản mới là v4. Lệnh cấp số phiên bản kế tiếp thực tế, không ép ghi đè v3. Chạy lại trả `already_enabled` và giữ danh sách đơn vị do admin đã chỉnh, không tạo trùng.

Lệnh giữ nguyên danh mục WHO, câu hỏi tự thêm, biểu mẫu lịch sử và giá trị đã lưu. Nó tạo hàng đợi cập nhật cột Sheet và đối chiếu lại phiếu đã gửi. Không cần tự thêm lại các câu đơn vị bằng nút + Thêm.

## Kiểm tra sau khi cập nhật

```bash
docker compose exec -T backend python -c 'import json,urllib.request; print(json.load(urllib.request.urlopen("http://localhost:8000/health/ready")))'
docker compose exec -T backend python -c 'import json,urllib.request; d=json.load(urllib.request.urlopen("http://localhost:8000/api/v1/forms/current")); fields={f["id"]:f for f in d["schema_json"]["clinical_fields"]}; print("version =",d["version"]); print("AFP units =",fields["afp_unit"]["choices"]); assert all(k+"_unit" in fields for k in ("ca_125","he4","roma","afp","beta_hcg"))'
```

1. Tải lại website bằng Ctrl+F5, mở phiên nhập mới để lấy phiên bản vừa xuất bản.
2. Phần Dấu ấn sinh học vẫn có 5 chỉ số, mỗi chỉ số có giá trị gốc và đơn vị cạnh nhau. Chưa có lựa chọn đơn vị mặc định.
3. Thử lưu nháp khi đã nhập số nhưng chưa chọn đơn vị. Khi gửi phiếu mới đã bật tính năng, hệ thống phải yêu cầu chọn đơn vị. Các chỉ số không có kết quả vẫn được để trống.
4. Thử Khác, lưu nội dung đơn vị rồi mở lại phiếu. Đối chiếu số gốc không thay đổi.
5. Kiểm tra câu Số lượng u đã tự thêm xuất hiện một lần và WHO vẫn có 20 lựa chọn.
6. Tab Quản lý biểu mẫu → Phiên bản & đồng bộ phải xác nhận cập nhật cấu trúc Sheet. Kiểm tra các cột Đơn vị và Đơn vị khác riêng biệt, phiếu cũ chưa thu đơn vị vẫn để trống ở các cột này.

## Tự thêm đơn vị về sau, không cần deploy lại

Vào Quản lý biểu mẫu, chọn câu Đơn vị của chỉ số cần sửa, thêm lựa chọn rồi Lưu nháp → Kiểm tra & xem trước → Xuất bản phiên bản mới. Giữ hai lựa chọn Khác và Chưa xác nhận. Phiếu đã tạo tiếp tục dùng danh mục của phiên bản đã nhập.

Nhóm, hiển thị và cột xuất của đơn vị đi cùng chỉ số số tương ứng. Các ô đơn vị không bật Bắt buộc cho mọi phiếu: hệ thống kiểm tra có điều kiện khi thực sự có kết quả. Đổi đơn vị trong danh sách không quy đổi dữ liệu cũ.

## Kiểm tra kỹ thuật đã thực hiện

- API: đơn vị bắt buộc khi có số trên phiên bản mới, kết quả 0, Khác, Chưa xác nhận, giá trị ngoài danh sách và mô tả tối đa 200 ký tự.
- Giữ số gốc, đơn vị riêng và metadata trên CSV/Excel; không suy đoán theo bệnh viện.
- Xuất bản lặp lại an toàn, giữ câu tự thêm và WHO; không ghi đè bản nháp cấu hình đang sửa hoặc phiếu cũ.
- Đồng bộ trên Sheet giả: thêm cột, giữ dữ liệu lịch sử và thứ tự cột, đọc lại để xác nhận, không ghi trùng khi thử lại.
- Chrome/Edge ở kích thước desktop, điện thoại dọc/ngang: nhập, lưu nháp, tải lại, gửi, xem admin và tự thêm đơn vị trong trang quản lý.

Kiểm tra Sheet giả không thay thế đối chiếu trạng thái trên Google Sheets thật sau khi triển khai. Bản này không bao gồm tối ưu tải 20.000 phiếu.

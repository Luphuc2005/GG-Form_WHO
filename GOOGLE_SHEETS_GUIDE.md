# Hướng dẫn Kết nối Trực tiếp vào Google Sheets theo Thời gian thực
### (Real-Time Direct Sync to Google Sheets)

Hệ thống cho phép bạn **tự động đẩy dữ liệu từng phiếu khảo sát vào thẳng một file Google Sheets** ngay khi người dùng nhấn nút [Gửi], y hệt như Google Forms cũ nhưng với đầy đủ logic cha-con hiện đại!

---

## CÁCH THỰC HIỆN TRONG 2 PHÚT:

### BƯỚC 1: Tạo Google Apps Script trên file Google Sheets
1. Mở trang Google Sheets của bạn (hoặc tạo một trang tính Google mới tại [sheets.new](https://sheets.new)).
2. Đặt tên trang tính (ví dụ: *Kết quả Khảo sát GPB U buồng trứng WHO*).
3. Trên thanh menu, bấm vào **Tiện ích mở rộng** (Extensions) -> Chọn **Apps Script**.
4. Xóa toàn bộ đoạn code mặc định có sẵn và dán đoạn mã sau vào (đã có sẵn trong [deploy/google_apps_script.js](file:///d:/HocTap/Form-GG/deploy/google_apps_script.js)):

```javascript
function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);

    // Tạo dòng tiêu đề nếu trang tính còn trống
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(data.headers);
      var headerRange = sheet.getRange(1, 1, 1, data.headers.length);
      headerRange.setFontWeight("bold");
      headerRange.setBackground("#673ab7");
      headerRange.setFontColor("#ffffff");
      sheet.setFrozenRows(1);
    }

    // Chèn dữ liệu phiếu mới vào cuối bảng
    sheet.appendRow(data.row);

    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

### BƯỚC 2: Triển khai (Deploy) lấy đường link Webhook
1. Ở góc trên bên phải màn hình Apps Script, bấm nút **Triển khai** (Deploy) màu xanh -> Chọn **Tùy chọn triển khai mới** (New deployment).
2. Bấm vào biểu tượng bánh răng cạnh "Chọn loại" -> Chọn **Ứng dụng web** (Web app).
3. Cấu hình 3 mục:
   - **Mô tả**: *Khảo sát GPB Sync*
   - **Thực thi dưới dạng**: **Tôi** (Me)
   - **Ai có quyền truy cập**: **Bất kỳ ai** (Anyone) *(Rất quan trọng: phải chọn Anyone để server gửi dữ liệu qua được).*
4. Nhấn **Triển khai** (Deploy) -> Bấm **Ủy quyền truy cập** (Authorize access) bằng tài khoản Google của bạn -> Bấm **Nâng cao** (Advanced) -> Chọn **Đi tới dự án (không an toàn)** -> Bấm **Cho phép** (Allow).
5. Sau khi xong, màn hình sẽ cung cấp một đường link **URL ứng dụng web**, có dạng:
   `https://script.google.com/macros/s/AKfycbx.../exec`
6. Sao chép (Copy) đường link này.

### BƯỚC 3: Dán link vào hệ thống
Mở tệp `.env` của dự án (hoặc `backend/.env`), dán đường link vừa copy vào biến:

```bash
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/AKfycbx.../exec
```

---

## KẾT QUẢ ĐẠT ĐƯỢC:
- Cứ mỗi khi có bất kỳ ai điền phiếu khảo sát trên trang web và bấm **[GỬI]**:
  1. Dữ liệu được lưu trữ an toàn vào cơ sở dữ liệu PostgreSQL của hệ thống.
  2. Đồng thời, một tiến trình chạy ngầm lập tức đẩy dòng dữ liệu đó lên **Google Sheets** của bạn.
- Bạn và giảng viên có thể mở file Google Sheets trên điện thoại hoặc máy tính để xem từng dòng kết quả nhảy vào theo thời gian thực (real-time)!

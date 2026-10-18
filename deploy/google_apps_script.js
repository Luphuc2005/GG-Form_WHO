/**
 * ==============================================================================
 * GOOGLE APPS SCRIPT: TỰ ĐỘNG ĐỒNG BỘ PHIẾU KHẢO SÁT VÀO GOOGLE SHEETS
 * ==============================================================================
 * HƯỚNG DẪN 3 BƯỚC:
 * 1. Mở một trang Google Sheets mới của bạn (hoặc của thầy cô).
 * 2. Trên thanh menu, chọn: Tiện ích mở rộng (Extensions) -> Apps Script.
 * 3. Xóa hết mã cũ trong Apps Script, dán toàn bộ đoạn mã này vào.
 * 4. Nhấn nút "Triển khai" (Deploy) ở góc trên bên phải -> "Tùy chọn triển khai mới" (New deployment):
 *    - Chọn loại: Ứng dụng web (Web app).
 *    - Thực thi dưới dạng: Tôi (Me).
 *    - Ai có quyền truy cập: Bất kỳ ai (Anyone).
 * 5. Nhấn "Triển khai", cấp quyền và sao chép đường link "URL ứng dụng web"
 *    (Có dạng: https://script.google.com/macros/s/....../exec).
 * 6. Dán link đó vào tệp .env của hệ thống:
 *    GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/....../exec
 * ==============================================================================
 */

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);

    // =========================================================================
    // HÀM TIỆN ÍCH: ĐỊNH DẠNG TEXT CHO CỘT PARA VÀ SỐ HS (ĐỂ KHÔNG MẤT SỐ 0000)
    // =========================================================================
    function formatSpecialColumns(headersList) {
      if (!headersList || headersList.length === 0) return;
      var maxRows = Math.max(10, sheet.getMaxRows());
      for (var c = 0; c < headersList.length; c++) {
        var hName = String(headersList[c] || "").toUpperCase();
        if (hName.indexOf("PARA") !== -1 || hName.indexOf("SỐ HS") !== -1) {
          sheet.getRange(2, c + 1, maxRows - 1, 1).setNumberFormat("@");
        }
      }
    }

    // =========================================================================
    // TRƯỜNG HỢP 1: XÓA PHIẾU KHẢO SÁT (Khi Admin bấm [Xóa] trên hệ thống web)
    // =========================================================================
    if (data.action === "delete") {
      var targetUuid = String(data.submission_uuid || "").trim().toLowerCase();
      var lastRow = sheet.getLastRow();
      if (lastRow >= 2 && targetUuid) {
        var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        // Lặp từ dưới lên để xóa an toàn không bị lệch chỉ mục dòng
        for (var i = values.length - 1; i >= 0; i--) {
          var cellValue = String(values[i][0]).trim().toLowerCase();
          if (cellValue === targetUuid) {
            sheet.deleteRow(i + 2);
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: "deleted" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // =========================================================================
    // TRƯỜNG HỢP 2: ĐỒNG BỘ LẠI TOÀN BỘ (Khi Admin bấm [Đồng bộ lại Google Sheet])
    // =========================================================================
    if (data.action === "resync_all") {
      sheet.clearContents();
      if (data.headers && data.headers.length > 0) {
        sheet.appendRow(data.headers);
        var headerRange = sheet.getRange(1, 1, 1, data.headers.length);
        headerRange.setFontWeight("bold");
        headerRange.setBackground("#673ab7"); // Màu tím đồng bộ
        headerRange.setFontColor("#ffffff");
        sheet.setFrozenRows(1);
        formatSpecialColumns(data.headers);
      }
      if (data.rows && data.rows.length > 0) {
        for (var r = 0; r < data.rows.length; r++) {
          sheet.appendRow(data.rows[r]);
        }
        formatSpecialColumns(data.headers);
      }
      sheet.getDataRange().setFontFamily("Times New Roman");
      return ContentService.createTextOutput(JSON.stringify({ status: "resynced", count: data.rows ? data.rows.length : 0 }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // =========================================================================
    // TRƯỜNG HỢP 3: THÊM PHIẾU MỚI (Khi người dùng điền và bấm [Gửi])
    // =========================================================================
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(data.headers);
      var headerRange = sheet.getRange(1, 1, 1, data.headers.length);
      headerRange.setFontWeight("bold");
      headerRange.setBackground("#673ab7");
      headerRange.setFontColor("#ffffff");
      sheet.setFrozenRows(1);
      formatSpecialColumns(data.headers);
    }

    // Chèn dòng dữ liệu mới vào cuối Sheet
    sheet.appendRow(data.row);

    // Đảm bảo định dạng cột PARA và font chữ
    if (data.headers) {
      formatSpecialColumns(data.headers);
    }
    sheet.getDataRange().setFontFamily("Times New Roman");

    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

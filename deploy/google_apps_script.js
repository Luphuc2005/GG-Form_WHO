/**
 * Webhook đồng bộ phiếu nghiên cứu với tab gid=0.
 * Xem GOOGLE_SHEETS_GUIDE.md để cấu hình Script Properties và triển khai Web App.
 */
function alignFormColumns(sheet, data) {
  var columns = data.columns || [];
  if (!columns.length || columns[0].key !== "submission_uuid" || !columns[0].export) throw new Error("Invalid schema");
  var properties = PropertiesService.getScriptProperties();
  var propertyKey = "FORM_COLUMNS_" + sheet.getSheetId();
  var previous = JSON.parse(properties.getProperty(propertyKey) || "null");
  if (previous && Number(data.schema_version) < previous.version) throw new Error("Stale schema version");
  var width = sheet.getLastColumn();
  var headers = width ? sheet.getRange(1, 1, 1, width).getDisplayValues()[0] : [];
  var byKey = {}, aliases = {}, keys = [], seen = {};
  columns.forEach(function(column) {
    if (byKey[column.key]) throw new Error("Duplicate field key");
    byKey[column.key] = column;
    (column.aliases || []).concat([column.label]).forEach(function(label) {
      if (aliases[label] && aliases[label] !== column.key) throw new Error("Ambiguous header");
      aliases[label] = column.key;
    });
  });
  // Resolve every existing column BEFORE modifying the sheet. Previous names
  // and stable keys keep data attached when questions are renamed or moved.
  var legacyUuidHeader = headers[0] === "Mã phiếu" && headers.indexOf("ID đồng bộ") === -1;
  headers.forEach(function(header, index) {
    var key = legacyUuidHeader && index === 0 ? "submission_uuid" : aliases[header];
    if (!key && previous && previous.columns) {
      var old = previous.columns.filter(function(column) { return column.label === header; });
      if (old.length === 1 && byKey[old[0].key]) key = old[0].key;
    }
    if (!key || seen[key]) throw new Error("Unknown or duplicate destination column; schema was not changed");
    seen[key] = true;
    keys.push(key);
  });
  if (keys.length && keys[0] !== "submission_uuid") throw new Error("UUID must remain the first column");
  for (var i = keys.length - 1; i >= 0; i--) {
    if (!byKey[keys[i]].export) {
      sheet.deleteColumn(i + 1);
      keys.splice(i, 1);
    }
  }
  // Keep the human-readable research code at the beginning of the visible
  // table. The first physical column remains the hidden UUID for old webhooks.
  if (byKey.study_code && byKey.study_code.export && keys.length) {
    var studyIndex = keys.indexOf("study_code");
    if (studyIndex === -1) {
      sheet.insertColumnAfter(1);
      keys.splice(1, 0, "study_code");
    } else if (studyIndex !== 1) {
      sheet.moveColumns(sheet.getRange(1, studyIndex + 1, sheet.getMaxRows(), 1), 2);
      keys.splice(studyIndex, 1);
      keys.splice(1, 0, "study_code");
    }
  }
  columns.forEach(function(column) {
    if (column.export && keys.indexOf(column.key) === -1) keys.push(column.key);
  });
  if (sheet.getMaxColumns() < keys.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), keys.length - sheet.getMaxColumns());
  var names = keys.map(function(key) { return byKey[key].label; });
  sheet.getRange(1, 1, 1, names.length).setValues([names]).setFontWeight("bold").setBackground("#7c6d97").setFontColor("#ffffff").setWrap(true);
  keys.forEach(function(key, index) {
    if (byKey[key].type !== "number" && sheet.getMaxRows() > 1) sheet.getRange(2, index + 1, sheet.getMaxRows() - 1, 1).setNumberFormat("@");
    if (byKey[key].hidden) sheet.hideColumns(index + 1);
  });
  sheet.setFrozenRows(1);
  // Historical key/name aliases are sent by the server on every migration.
  // Keep the property small even for forms with hundreds of questions.
  properties.setProperty(propertyKey, JSON.stringify({version: Number(data.schema_version)}));
  return {status: "schema_updated", schema_version: Number(data.schema_version)};
}

function applyDataRowTypography(sheet, rowIndex, width) {
  if (rowIndex < 2 || width < 1) return;
  // Use the first data row as the template, preserving per-column sizes
  // (for example, the smaller research code) without changing cell contents.
  var template = sheet.getRange(2, 1, 1, width);
  sheet.getRange(rowIndex, 1, 1, width)
    .setFontFamilies(template.getFontFamilies())
    .setFontSizes(template.getFontSizes());
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = null;
  try {
    var data = JSON.parse(e.postData.contents);
    var properties = PropertiesService.getScriptProperties();
    var token = properties.getProperty("GOOGLE_SHEETS_WEBHOOK_TOKEN");
    var spreadsheetId = properties.getProperty("GOOGLE_SHEETS_SPREADSHEET_ID");
    if (!token || !spreadsheetId || data.token !== token || data.spreadsheet_id !== spreadsheetId) {
      return jsonResponse({status: "unauthorized"});
    }

    // Web apps open the fixed target by ID and serialize read/write operations.
    lock = LockService.getScriptLock();
    lock.waitLock(25000);
    var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetById(0);
    if (!sheet) throw new Error("Data tab gid=0 is missing");

    if (data.action === "snapshot") {
      var height = sheet.getLastRow();
      var rows = height ? sheet.getRange(1, 1, height, sheet.getLastColumn()).getDisplayValues() : [];
      return jsonResponse({status: "snapshot", rows: rows});
    }

    if (data.action === "schema") {
      return ContentService.createTextOutput(JSON.stringify(alignFormColumns(sheet, data)))
        .setMimeType(ContentService.MimeType.JSON);
    }

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
    // TRƯỜNG HỢP 2: THÊM PHIẾU MỚI (Khi người dùng điền và bấm [Gửi])
    // =========================================================================
    if (data.action) throw new Error("Unsupported webhook action");
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(data.headers);
      var headerRange = sheet.getRange(1, 1, 1, data.headers.length);
      headerRange.setFontWeight("bold");
      headerRange.setBackground("#673ab7");
      headerRange.setFontColor("#ffffff");
      sheet.setFrozenRows(1);
      formatSpecialColumns(data.headers);
    }

    // Never append under mismatched headers or silently place values in the
    // wrong columns after a concurrent schema publication.
    var currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    if (!Array.isArray(data.row) || !Array.isArray(data.headers) || JSON.stringify(currentHeaders) !== JSON.stringify(data.headers) || data.row.length !== currentHeaders.length) throw new Error("Destination schema changed; retry sync");
    var safeRow = data.row.map(function(value) {
      return typeof value === "string" && /^[=+\-@]/.test(value) ? "'" + value : value;
    });
    sheet.appendRow(safeRow);
    applyDataRowTypography(sheet, sheet.getLastRow(), currentHeaders.length);

    // Đảm bảo định dạng cột PARA và font chữ
    if (data.headers) {
      formatSpecialColumns(data.headers);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

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
  if (!data.preserve_column_order && byKey.study_code && byKey.study_code.export && keys.length) {
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
  if (data.organize_columns) {
    var wanted = columns.filter(function(column) { return column.export; }).map(function(column) { return column.key; });
    wanted.forEach(function(key, index) {
      var currentIndex = keys.indexOf(key);
      if (currentIndex !== index) {
        sheet.moveColumns(sheet.getRange(1, currentIndex + 1, sheet.getMaxRows(), 1), index + 1);
        keys.splice(currentIndex, 1);
        keys.splice(index, 0, key);
      }
    });
  }
  var names = keys.map(function(key) { return byKey[key].label; });
  sheet.getRange(1, 1, 1, names.length).setValues([names]).setFontWeight("bold").setBackground("#7c6d97").setFontColor("#ffffff").setWrap(true);
  keys.forEach(function(key, index) {
    if (byKey[key].type !== "number" && sheet.getMaxRows() > 1) sheet.getRange(2, index + 1, sheet.getMaxRows() - 1, 1).setNumberFormat("@");
    if (byKey[key].hidden) sheet.hideColumns(index + 1);
  });
  sheet.setFrozenRows(1);
  if (data.organize_columns) {
    if (sheet.getName() !== "Tổng hợp") sheet.setName("Tổng hợp");
    sheet.setTabColor("#6b5b85");
    var ordered = keys.map(function(key) { return byKey[key]; });
    styleOrganizedSheet(sheet, ordered);
    syncHospitalViews(sheet, ordered);
    properties.setProperty("FORM_LAYOUT_" + sheet.getSheetId(), "2");
  }
  // Historical key/name aliases are sent by the server on every migration.
  // Keep the property small even for forms with hundreds of questions.
  properties.setProperty(propertyKey, JSON.stringify({version: Number(data.schema_version)}));
  return {status: "schema_updated", schema_version: Number(data.schema_version), layout_version: 2};
}

var HOSPITAL_VIEWS = [
  {code: "TD", name: "TD - Từ Dũ", color: "#0f766e"},
  {code: "HV", name: "HV - Hùng Vương", color: "#2563eb"},
  {code: "YD", name: "YD - ĐH Y Dược", color: "#7c3aed"},
  {code: "GD", name: "GD - Gia Định", color: "#b45309"},
  {code: "UB", name: "UB - Ung Bướu CS2", color: "#be185d"}
];
var SECTION_COLORS = {
  identity: "#6b5b85", sec1: "#3e6880", sec2: "#587271", sec3: "#73648d",
  sec4: "#377b73", sec5: "#426c9a", sec6: "#92653d", who: "#77556f",
  extra: "#64748b", system: "#6b7280"
};

function hospitalViewFormula(sourceName, code, locale, width) {
  if (!HOSPITAL_VIEWS.some(function(hospital) { return hospital.code === code; })) throw new Error("Invalid hospital code");
  var source = "'" + sourceName.replace(/'/g, "''") + "'";
  // FILTER preserves mixed text/numeric identifiers. LET evaluates the source
  // once; full-row/full-column bounds follow new rows and schema columns.
  var bound = Number.isInteger(width) && width > 0 ? String(width) : 'COLUMNS(' + source + '!1:1)';
  var formula = '=LET(source,INDIRECT("' + source + '!A1:"&ADDRESS(ROWS(' + source + '!A:A),' + bound + ',4)),FILTER(source,(SEQUENCE(ROWS(source))=1)+(INDEX(source,0,MATCH("Mã bệnh viện",INDEX(source,1,0),0))="' + code + '")))';
  return /^vi(?:_|$)/i.test(locale || "") ? formula.replace(/,/g, ";") : formula;
}

function organizedColumnWidth(column) {
  if (column.key === "submission_uuid") return 110;
  if (column.key === "study_code") return 145;
  if (column.key === "created_at") return 190;
  if (column.key === "so_hs") return 130;
  if (column.key === "ho_ten") return 225;
  if (column.key === "hospital_code") return 110;
  if (column.type === "textarea" || /ket_luan|ghi_chu|dia_chi/.test(column.key)) return 300;
  if (column.type === "number" || column.key === "para") return 130;
  return 175;
}

function styleOrganizedSheet(sheet, columns) {
  var width = columns.length;
  if (!width) return;
  sheet.setHiddenGridlines(true).setFrozenRows(1).setFrozenColumns(4);
  sheet.showColumns(1, width);
  sheet.getRange(1, 1, 1, width).setFontFamily("Arial").setFontSize(13)
    .setFontWeight("bold").setFontColor("#ffffff").setWrap(true)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 84);
  var height = Math.max(1, sheet.getMaxRows() - 1);
  sheet.getRange(2, 1, height, width).setFontFamily("Arial").setFontSize(12)
    .setVerticalAlignment("middle").setWrap(true);
  sheet.getRange(1, 1, 1, width).setBackgrounds([columns.map(function(column) {
    return SECTION_COLORS[column.section] || SECTION_COLORS.system;
  })]);
  for (var index = 0; index < width;) {
    var size = organizedColumnWidth(columns[index]);
    var end = index + 1;
    while (end < width && organizedColumnWidth(columns[end]) === size) end++;
    sheet.setColumnWidths(index + 1, end - index, size);
    index = end;
  }
  columns.forEach(function(column, index) {
    if (column.hidden) sheet.hideColumns(index + 1);
  });
  if (sheet.getLastRow() > 1) sheet.setRowHeights(2, sheet.getLastRow() - 1, 48);
}

function syncHospitalViews(source, columns) {
  var book = source.getParent();
  fitManagedGrid(source, source.getLastRow(), columns.length);
  var counts = hospitalRowCounts(source);
  HOSPITAL_VIEWS.forEach(function(hospital) {
    var view = book.getSheetByName(hospital.name);
    if (view) {
      var owned = view.getDeveloperMetadata().some(function(item) {
        return item.getKey() === "GG_FORM_WHO_HOSPITAL" && item.getValue() === hospital.code;
      });
      if (!owned) throw new Error("Hospital tab name is already used by an unmanaged sheet");
    } else {
      view = book.insertSheet(hospital.name);
      view.addDeveloperMetadata("GG_FORM_WHO_HOSPITAL", hospital.code);
    }
    fitManagedGrid(view, (counts[hospital.code] || 0) + 1, columns.length);
    var formula = hospitalViewFormula(source.getName(), hospital.code, book.getSpreadsheetLocale(), columns.length);
    if (view.getRange(1, 1).getFormula() !== formula) view.getRange(1, 1).setFormula(formula);
    view.getRange(1, 1).setNote("Tự động lọc từ Tổng hợp theo Mã bệnh viện. Sửa phiếu trong ứng dụng; dùng bộ lọc Giai đoạn nghiên cứu để chọn R/P.");
    styleOrganizedSheet(view, columns);
    view.setTabColor(hospital.color);
    var filter = view.getFilter();
    if (filter) filter.remove();
    view.getRange(1, 1, view.getMaxRows(), columns.length).createFilter();
  });
}

function growHospitalViews(source) {
  var book = source.getParent();
  var counts = hospitalRowCounts(source);
  var width = source.getLastColumn();
  HOSPITAL_VIEWS.forEach(function(hospital) {
    var view = book.getSheetByName(hospital.name);
    if (!view) return;
    if (!view.getDeveloperMetadata().some(function(item) { return item.getKey() === "GG_FORM_WHO_HOSPITAL" && item.getValue() === hospital.code; })) return;
    var oldRows = view.getMaxRows();
    fitManagedGrid(view, (counts[hospital.code] || 0) + 1, width);
    if (view.getMaxRows() > oldRows) {
      view.setRowHeights(oldRows + 1, view.getMaxRows() - oldRows, 48);
      view.getRange(oldRows + 1, 1, view.getMaxRows() - oldRows, width).setFontFamily("Arial").setFontSize(12).setWrap(true);
    }
  });
}

function hospitalRowCounts(source) {
  var width = source.getLastColumn();
  var headers = width ? source.getRange(1, 1, 1, width).getDisplayValues()[0] : [];
  var index = headers.indexOf("Mã bệnh viện");
  var counts = {};
  if (index < 0 || source.getLastRow() < 2) return counts;
  source.getRange(2, index + 1, source.getLastRow() - 1, 1).getDisplayValues().forEach(function(row) {
    var code = String(row[0]).trim();
    counts[code] = (counts[code] || 0) + 1;
  });
  return counts;
}

function fitManagedGrid(sheet, neededRows, width) {
  // Shrink empty grid space only. Actual values (including unmanaged notes in
  // extra columns) are never discarded to make the grid fit.
  var rows = Math.max(1000, Math.ceil((Math.max(neededRows, sheet.getLastRow()) + 100) / 500) * 500);
  if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  if (sheet.getMaxRows() > rows) sheet.deleteRows(rows + 1, sheet.getMaxRows() - rows);
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  if (sheet.getMaxColumns() > width && sheet.getLastColumn() <= width) sheet.deleteColumns(width + 1, sheet.getMaxColumns() - width);
}

function uuidPositions(sheet) {
  var positions = {};
  if (sheet.getLastRow() < 2) return positions;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues().forEach(function(row, index) {
    var key = String(row[0] || "").trim().toLowerCase();
    if (key) (positions[key] || (positions[key] = [])).push(index + 2);
  });
  return positions;
}

function groupedWrites(sheet, updates, width) {
  updates.sort(function(a, b) { return a.row - b.row; });
  for (var i = 0; i < updates.length;) {
    var values = [updates[i].values], start = updates[i].row;
    var next = i + 1;
    while (next < updates.length && updates[next].row === start + values.length) values.push(updates[next++].values);
    sheet.getRange(start, 1, values.length, width).setValues(values);
    i = next;
  }
}

function syncRecordBatch(sheet, data) {
  var width = sheet.getLastColumn();
  var headers = width ? sheet.getRange(1, 1, 1, width).getDisplayValues()[0] : [];
  if (JSON.stringify(headers) !== JSON.stringify(data.headers)) throw new Error("Destination schema changed; retry sync");
  if (!Array.isArray(data.items) || !data.items.length || data.items.length > 200) throw new Error("Invalid sync batch size");
  var schemaVersion = Number(data.schema_version);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) throw new Error("Invalid batch schema version");
  var properties = PropertiesService.getScriptProperties();
  var schema = JSON.parse(properties.getProperty("FORM_COLUMNS_" + sheet.getSheetId()) || "null");
  if (schema && schemaVersion < schema.version) throw new Error("Stale batch schema version");
  var seen = {};
  data.items.forEach(function(item) {
    var key = String(item.submission_uuid || "");
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(key) || seen[key]) throw new Error("Invalid or duplicate batch UUID");
    if (!Number.isInteger(item.revision) || item.revision < 1 || !/^[a-f0-9]{64}$/.test(item.digest)) throw new Error("Invalid batch revision");
    if (item.row !== null && (!Array.isArray(item.row) || item.row.length !== width || item.row[0] !== key)) throw new Error("Invalid batch row");
    seen[key] = true;
  });
  var book = sheet.getParent();
  var state = book.getSheetByName("__GG_FORM_SYNC");
  if (state && !state.getDeveloperMetadata().some(function(item) { return item.getKey() === "GG_FORM_SYNC_STATE" && item.getValue() === "1"; })) throw new Error("Sync state tab name is already used");
  if (!state) {
    state = book.insertSheet("__GG_FORM_SYNC");
    state.addDeveloperMetadata("GG_FORM_SYNC_STATE", "1");
    state.getRange(1, 1, 1, 4).setValues([["UUID", "Revision", "Schema", "Digest"]]);
    state.hideSheet();
  }
  var states = {}, stateHeight = state.getLastRow();
  if (stateHeight > 1) state.getRange(2, 1, stateHeight - 1, 4).getValues().forEach(function(row, index) {
    var key = String(row[0]);
    if (states[key]) throw new Error("Duplicate sync state UUID");
    states[key] = {row: index + 2, revision: Number(row[1]), schema: Number(row[2]), digest: String(row[3])};
  });
  var results = [], apply = [], stateUpdates = [];
  data.items.forEach(function(item) {
    var old = states[item.submission_uuid];
    if (old && (item.revision < old.revision || schemaVersion < old.schema)) {
      results.push({submission_uuid: item.submission_uuid, revision: item.revision, status: "stale", count: null});
      return;
    }
    if (old && item.revision === old.revision && schemaVersion === old.schema && item.digest !== old.digest) {
      results.push({submission_uuid: item.submission_uuid, revision: item.revision, status: "conflict", count: null});
      return;
    }
    stateUpdates.push({row: old ? old.row : ++stateHeight, values: [item.submission_uuid, item.revision, schemaVersion, item.digest]});
    apply.push(item);
  });
  fitManagedGrid(state, stateHeight, 4);
  // Persist revision fences before data writes. A retry of this same revision
  // always repairs/verifies its row; an older delayed write cannot resurrect a deletion.
  groupedWrites(state, stateUpdates, 4);
  properties.setProperty("FORM_COLUMNS_" + sheet.getSheetId(), JSON.stringify({version: schemaVersion}));
  var positions = uuidPositions(sheet), deletions = [];
  apply.forEach(function(item) {
    (positions[item.submission_uuid] || []).forEach(function(row, index) {
      if (item.row === null || index > 0) deletions.push(row);
    });
  });
  deletions.sort(function(a, b) { return b - a; });
  for (var d = 0; d < deletions.length;) {
    var e = d + 1;
    while (e < deletions.length && deletions[e] === deletions[e - 1] - 1) e++;
    sheet.deleteRows(deletions[e - 1], e - d);
    d = e;
  }
  positions = uuidPositions(sheet);
  var updates = [], lastRow = sheet.getLastRow();
  apply.forEach(function(item) {
    if (item.row === null) return;
    var values = item.row.map(function(value) { return typeof value === "string" && /^[=+\-@]/.test(value) ? "'" + value : value; });
    updates.push({row: (positions[item.submission_uuid] || [])[0] || ++lastRow, values: values});
  });
  fitManagedGrid(sheet, lastRow, width);
  // Preserve identifier zeros on newly allocated rows as well as existing ones.
  (data.keys || []).forEach(function(key, index) {
    if (["submission_uuid", "so_hs", "para", "study_code"].indexOf(key) !== -1) sheet.getRange(2, index + 1, sheet.getMaxRows() - 1, 1).setNumberFormat("@");
  });
  groupedWrites(sheet, updates, width);
  SpreadsheetApp.flush();
  positions = uuidPositions(sheet);
  var readbacks = {};
  // Read contiguous target rows together, rather than returning the whole table.
  updates.sort(function(a, b) { return a.row - b.row; });
  for (var i = 0; i < updates.length;) {
    var end = i + 1;
    while (end < updates.length && updates[end].row === updates[end - 1].row + 1) end++;
    sheet.getRange(updates[i].row, 1, end - i, width).getDisplayValues().forEach(function(row) { readbacks[String(row[0])] = row; });
    i = end;
  }
  apply.forEach(function(item) {
    results.push({submission_uuid: item.submission_uuid, revision: item.revision,
      status: item.row === null ? "removed" : "synced", count: (positions[item.submission_uuid] || []).length,
      row: item.row === null ? null : readbacks[item.submission_uuid]});
  });
  growHospitalViews(sheet);
  return {status: "batch_synced", results: results};
}

function applyDataRowTypography(sheet, rowIndex, width) {
  if (rowIndex < 2 || width < 1) return;
  // Use the first data row as the template, preserving per-column sizes
  // (for example, the smaller research code) without changing cell contents.
  var template = sheet.getRange(2, 1, 1, width);
  sheet.getRange(rowIndex, 1, 1, width)
    .setFontFamilies(template.getFontFamilies())
    .setFontSizes(template.getFontSizes());
  sheet.setRowHeight(rowIndex, 48);
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
      return jsonResponse({status: "snapshot", rows: rows, layout_version: 2,
        layout_applied: properties.getProperty("FORM_LAYOUT_" + sheet.getSheetId()) === "2"});
    }

    if (data.action === "capabilities") {
      var current = JSON.parse(properties.getProperty("FORM_COLUMNS_" + sheet.getSheetId()) || "null");
      var currentWidth = sheet.getLastColumn();
      return jsonResponse({status: "capabilities", batch_version: 1, layout_version: 2,
        schema_version: current ? current.version : 0,
        layout_applied: properties.getProperty("FORM_LAYOUT_" + sheet.getSheetId()) === "2",
        headers: currentWidth ? sheet.getRange(1, 1, 1, currentWidth).getDisplayValues()[0] : []});
    }

    if (data.action === "batch") return jsonResponse(syncRecordBatch(sheet, data));

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
    growHospitalViews(sheet);

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

// Run with: node deploy/test_google_apps_script.cjs. No Google services contacted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const properties = new Map();
const context = {PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key),setProperty:(key,value)=>properties.set(key,value)})}};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname+'/google_apps_script.js','utf8'),context);
class Sheet {
  constructor(headers,row){this.rows=[headers,row];this.maxColumns=10;}
  getSheetId(){return 0;}
  getLastColumn(){return this.rows[0].length;}
  getMaxColumns(){return this.maxColumns;}
  getMaxRows(){return 100;}
  hideColumns(column){this.hidden=column;}
  insertColumnAfter(column){this.rows.forEach(row=>row.splice(column,0,''));this.maxColumns++;}
  moveColumns(range,to){this.rows.forEach(row=>{const value=row.splice(range.column-1,1)[0];row.splice(to-1,0,value);});}
  insertColumnsAfter(_position,count){this.maxColumns+=count;}
  deleteColumn(position){this.rows.forEach(row=>row.splice(position-1,1));this.maxColumns--;}
  setFrozenRows(){}
  getRange(row,col,height,width){
    const sheet=this;
    return {column:col,getDisplayValues(){return Array.from({length:height},(_,i)=>sheet.rows[row-1+i].slice(col-1,col-1+width));},
      setValues(values){values.forEach((value,i)=>value.forEach((v,j)=>{sheet.rows[row-1+i][col-1+j]=v;}));return this;},
      setFontWeight(){return this;},setBackground(){return this;},setFontColor(){return this;},setWrap(){return this;},setNumberFormat(){return this;}};
  }
}
const columns=[{key:'submission_uuid',label:'Mã phiếu',aliases:['Mã phiếu'],export:true},{key:'custom_name',label:'Tên mới',aliases:['Tên cũ','Tên mới'],export:true},{key:'custom_date',label:'Ngày mới',aliases:['Ngày mới'],export:true}];
const sheet=new Sheet(['Mã phiếu','Tên cũ'],['synthetic-uuid','SYNTHETIC']);
const align=data=>context.alignFormColumns(sheet,data);
align({schema_version:2,columns});
assert.deepEqual(sheet.rows[0],['Mã phiếu','Tên mới','Ngày mới']);
assert.equal(sheet.rows[1][1],'SYNTHETIC');
align({schema_version:2,columns});
assert.equal(sheet.rows[0].length,3,'retry must not duplicate columns');
assert.throws(()=>align({schema_version:1,columns}),/Stale/);
const before=JSON.stringify(sheet.rows);
assert.throws(()=>align({schema_version:3,columns:columns.filter(c=>c.key!=='custom_name')}),/Unknown/);
assert.equal(JSON.stringify(sheet.rows),before,'unknown headers must not trigger partial edits');
align({schema_version:3,columns:columns.map(c=>c.key==='custom_name'?{...c,export:false}:c)});
assert.deepEqual(sheet.rows[0],['Mã phiếu','Ngày mới']);
assert.equal(sheet.rows[1][0],'synthetic-uuid');
// A manually reordered known column follows its key instead of its old index.
properties.clear();
const reordered=new Sheet(['Mã phiếu','Ngày mới','Tên cũ'],['synthetic-uuid','2026-01-01','SYNTHETIC']);
context.alignFormColumns(reordered,{schema_version:4,columns});
assert.deepEqual(reordered.rows[0],['Mã phiếu','Ngày mới','Tên mới']);
assert.deepEqual(reordered.rows[1],['synthetic-uuid','2026-01-01','SYNTHETIC']);
console.log('Apps Script schema checks passed: rename, append, retry, stale version, unknown headers, export removal, reordered columns.');
properties.clear();
const identities=[{key:'submission_uuid',label:'ID đồng bộ',aliases:['ID đồng bộ'],export:true,hidden:true},{key:'study_code',label:'Mã phiếu',aliases:['Mã phiếu','Mã nghiên cứu'],export:true},{key:'custom_name',label:'Tên',aliases:['Tên'],export:true}];
const legacy=new Sheet(['Mã phiếu','Tên'],['synthetic-uuid','SYNTHETIC']);
context.alignFormColumns(legacy,{schema_version:5,columns:identities});
assert.deepEqual(legacy.rows[0],['ID đồng bộ','Mã phiếu','Tên']);
assert.equal(legacy.rows[1][0],'synthetic-uuid');
assert.equal(legacy.rows[1][2],'SYNTHETIC');
assert.equal(legacy.hidden,1);
properties.clear();
const existingCode=new Sheet(['Mã phiếu','Tên','Mã nghiên cứu'],['synthetic-uuid','SYNTHETIC','YD_R_00001']);
context.alignFormColumns(existingCode,{schema_version:6,columns:identities});
assert.deepEqual(existingCode.rows[0],['ID đồng bộ','Mã phiếu','Tên']);
assert.deepEqual(existingCode.rows[1],['synthetic-uuid','YD_R_00001','SYNTHETIC']);
console.log('Human-readable record code checks passed: hidden UUID, legacy sheet migration, existing research-code column.');
const typographyCalls=[];
const fontSheet={getRange(row,col,height,width){
  assert.equal(col,1);assert.equal(height,1);assert.equal(width,3);
  return {getFontFamilies(){assert.equal(row,2);return [['Arial','Arial','Arial']];},
    getFontSizes(){assert.equal(row,2);return [[10,12,12]];},
    setFontFamilies(fonts){typographyCalls.push({row,fonts});return this;},
    setFontSizes(sizes){typographyCalls.push({row,sizes});return this;}};
},setRowHeight(row,height){typographyCalls.push({row,height});}};
context.applyDataRowTypography(fontSheet,3,3);
assert.deepEqual(typographyCalls,[{row:3,fonts:[['Arial','Arial','Arial']]},{row:3,sizes:[[10,12,12]]},{row:3,height:48}]);
console.log('Row font checks passed: later rows inherit the per-column font family and size from row 2.');

properties.set('GOOGLE_SHEETS_WEBHOOK_TOKEN', 'synthetic-token');
properties.set('GOOGLE_SHEETS_SPREADSHEET_ID', 'synthetic-sheet');
context.ContentService = {
  MimeType: {JSON: 'application/json'},
  createTextOutput: text => ({setMimeType: () => JSON.parse(text)}),
};
let opened = 0;
context.LockService = {getScriptLock: () => ({
  waitLock() {}, hasLock: () => true, releaseLock() {},
})};
context.SpreadsheetApp = {openById(id) {
  assert.equal(id, 'synthetic-sheet');
  opened++;
  return {getSheetById(gid) {
    assert.equal(gid, 0);
    return Object.assign(existingCode, {getLastRow: () => 2});
  }};
}};
const post = data => context.doPost({postData: {contents: JSON.stringify(data)}});
const auth = {token: 'synthetic-token', spreadsheet_id: 'synthetic-sheet'};
assert.equal(post({action: 'snapshot'}).status, 'unauthorized');
assert.equal(post({...auth, spreadsheet_id: 'some-other-sheet', action: 'delete'}).status, 'unauthorized');
assert.equal(opened, 0);
assert.deepEqual(post({...auth, action: 'snapshot'}), {status: 'snapshot', rows: existingCode.rows, layout_version: 2, layout_applied: false});
assert.equal(post({...auth, action: 'resync_all'}).status, 'error');
console.log('Webhook checks passed: private readback, fixed spreadsheet ID, and rejected unauthenticated requests.');

properties.clear();
const legacyTrimmed = new Sheet(['Mã phiếu', 'Tên', 'Mã nghiên cứu'], ['synthetic-uuid', 'SYNTHETIC', 'YD_R_00001']);
const legacyColumns = [
  {key: 'submission_uuid', label: 'Mã phiếu', aliases: ['Mã phiếu'], export: true, hidden: true},
  {key: 'custom_name', label: 'Tên', aliases: ['Tên'], export: true},
  {key: 'study_code', label: 'Mã nghiên cứu', aliases: ['Mã nghiên cứu'], export: true},
  {key: 'sa_ket_luan', label: 'Kết luận siêu âm', aliases: ['Kết luận siêu âm'], export: true},
];
context.alignFormColumns(legacyTrimmed, {schema_version: 1, columns: legacyColumns, preserve_column_order: true});
assert.deepEqual(legacyTrimmed.rows[0], ['Mã phiếu', 'Tên', 'Mã nghiên cứu', 'Kết luận siêu âm']);
assert.deepEqual(legacyTrimmed.rows[1], ['synthetic-uuid', 'SYNTHETIC', 'YD_R_00001']);
console.log('Legacy Sheet conclusion check passed with original column positions.');

properties.clear();
const grouped = new Sheet(['ID đồng bộ', 'Tên', 'Kết luận', 'Mã phiếu'], ['synthetic-uuid', 'SYNTHETIC', 'KEEP CONCLUSION', 'TD_R_00001']);
grouped.getName = () => 'Tổng hợp';
grouped.setTabColor = () => {};
const originalStyle = context.styleOrganizedSheet;
const originalViews = context.syncHospitalViews;
context.styleOrganizedSheet = () => {};
context.syncHospitalViews = () => {};
context.alignFormColumns(grouped, {schema_version: 7, organize_columns: true, columns: [
  {key:'submission_uuid', label:'ID đồng bộ', aliases:['ID đồng bộ'], export:true},
  {key:'study_code', label:'Mã phiếu', aliases:['Mã phiếu'], export:true},
  {key:'custom_name', label:'Tên', aliases:['Tên'], export:true},
  {key:'sa_ket_luan', label:'Kết luận', aliases:['Kết luận'], export:true},
]});
assert.deepEqual(grouped.rows[0], ['ID đồng bộ', 'Mã phiếu', 'Tên', 'Kết luận']);
assert.deepEqual(grouped.rows[1], ['synthetic-uuid', 'TD_R_00001', 'SYNTHETIC', 'KEEP CONCLUSION']);
context.styleOrganizedSheet = originalStyle;
context.syncHospitalViews = originalViews;
const formula = context.hospitalViewFormula('Tổng hợp', 'TD');
assert.ok(formula.startsWith('=LET(') && formula.includes('FILTER(') && formula.includes('Mã bệnh viện'));
assert.ok(formula.includes('COLUMNS(') && formula.includes('ROWS('));
assert.ok(!formula.includes('QUERY('), 'mixed identifier types must not be coerced');
assert.ok(context.hospitalViewFormula('Tổng hợp', 'TD', 'vi_VN').startsWith('=LET(source;'));
assert.throws(() => context.hospitalViewFormula('Tổng hợp', 'INVALID'), /Invalid hospital/);
console.log('Hospital layout checks passed: value-preserving column moves, dynamic FILTER views, and hospital-code validation.');

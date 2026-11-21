// Real Apps Script functions against an in-memory 20,000-row spreadsheet.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const props = new Map([['GOOGLE_SHEETS_WEBHOOK_TOKEN','synthetic-token'],['GOOGLE_SHEETS_SPREADSHEET_ID','synthetic']]);
class Sheet {
  constructor(book,name,rows,maxRows=1000,maxColumns=300){Object.assign(this,{book,name,rows,maxRows,maxColumns,metadata:[],reads:[],writes:[],formulas:new Map()});}
  getName(){return this.name;} setName(v){this.name=v;return this;}
  getSheetId(){return this.name==='Tổng hợp'?0:this.book.sheets.indexOf(this)+1;}
  getParent(){return this.book;}
  getMaxRows(){return this.maxRows;} getMaxColumns(){return this.maxColumns;}
  getLastRow(){let n=this.rows.length;while(n>0&&!this.rows[n-1]?.some(v=>v!==''&&v!==null&&v!==undefined))n--;return Math.max(n,this.formulas.size?1:0);}
  getLastColumn(){return Math.max(0,...this.rows.map(row=>{let n=row.length;while(n>0&&(row[n-1]===''||row[n-1]===undefined||row[n-1]===null))n--;return n;}));}
  insertRowsAfter(_row,n){this.maxRows+=n;} deleteRows(row,n){this.rows.splice(row-1,n);this.maxRows-=n;}
  insertColumnsAfter(_col,n){this.maxColumns+=n;} deleteColumns(col,n){this.rows.forEach(row=>row.splice(col-1,n));this.maxColumns-=n;}
  getDeveloperMetadata(){return this.metadata.map(([key,value])=>({getKey:()=>key,getValue:()=>value}));}
  addDeveloperMetadata(key,value){this.metadata.push([key,value]);return this;}
  hideSheet(){this.hidden=true;return this;} getFilter(){return null;}
  getRange(row,col,height=1,width=1){
    const sheet=this;
    const range={
      getValues(){sheet.reads.push({row,col,height,width});return Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>sheet.rows[row-1+i]?.[col-1+j]??''));},
      getDisplayValues(){return this.getValues().map(r=>r.map(v=>String(v??'')));},
      setValues(values){sheet.writes.push({row,col,height,width,values});values.forEach((r,i)=>{while(sheet.rows.length<row+i)sheet.rows.push([]);r.forEach((value,j)=>{sheet.rows[row-1+i][col-1+j]=typeof value==='string'&&value.startsWith("'")?value.slice(1):value;});});return this;},
      getFormula(){return sheet.formulas.get(`${row}:${col}`)||'';},setFormula(value){sheet.formulas.set(`${row}:${col}`,value);return this;},
      createFilter(){return this;},
    };
    for(const name of ['setFontWeight','setBackground','setFontColor','setWrap','setNumberFormat','setFontFamily','setFontSize','setHorizontalAlignment','setVerticalAlignment','setBackgrounds','setNote'])range[name]=()=>range;
    return range;
  }
}
for(const name of ['setTabColor','setHiddenGridlines','setFrozenRows','setFrozenColumns','showColumns','hideColumns','setRowHeight','setRowHeights','setColumnWidths'])Sheet.prototype[name]=function(){return this;};
const book={sheets:[],getSheetById:id=>book.sheets.find(s=>s.getSheetId()===id),getSheetByName:name=>book.sheets.find(s=>s.name===name),getSpreadsheetLocale:()=> 'vi_VN',insertSheet(name){const sheet=new Sheet(book,name,[]);book.sheets.push(sheet);return sheet;}};
const headers=['ID đồng bộ','Mã phiếu','Số HS','Mã bệnh viện','PARA',...Array.from({length:79},(_,i)=>`Clinical ${i}`)];
const keys=['submission_uuid','study_code','so_hs','hospital_code','para',...Array.from({length:79},(_,i)=>`clinical_${i}`)];
const hospitals=['TD','HV','YD','GD','UB'];
const initial=Array.from({length:20000},(_,i)=>[crypto.randomUUID(),`SYNTHETIC-${i}`,`000${i}`,hospitals[i%5],'0000',...Array(79).fill('SYNTHETIC')]);
const source=new Sheet(book,'Tổng hợp',[headers,...initial],30000,300);book.sheets.push(source);
const state=new Sheet(book,'__GG_FORM_SYNC',[['UUID','Revision','Schema','Digest'],...initial.map(row=>[row[0],1,4,'0'.repeat(64)])],21000,4);
state.addDeveloperMetadata('GG_FORM_SYNC_STATE','1');book.sheets.push(state);
const context={Number,JSON,PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key),setProperty:(key,v)=>props.set(key,v)})},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},
  LockService:{getScriptLock:()=>({waitLock(){},hasLock:()=>true,releaseLock(){}})},
  SpreadsheetApp:{openById:()=>book,flush(){}},};
vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/google_apps_script.js','utf8'),context);
const auth={token:'synthetic-token',spreadsheet_id:'synthetic'};
const post=body=>context.doPost({postData:{contents:JSON.stringify({...auth,...body})}});
const item=(key,revision,row)=>({submission_uuid:key,revision,row,digest:crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex')});
const send=items=>post({action:'batch',schema_version:5,headers,keys,items});
const capabilities=post({action:'capabilities'});
assert.equal(capabilities.batch_version,1);assert.ok(!('rows' in capabilities));
const incoming=Array.from({length:100},(_,i)=>{
  const key=crypto.randomUUID();return item(key,1,[key,`NEW-${i}`,'000007',hospitals[i%5],'0000',...Array(79).fill('SYNTHETIC NEW')]);
});
let response=send(incoming);
assert.equal(response.status,'batch_synced');assert.equal(response.results.length,100);
assert.ok(response.results.every(r=>r.status==='synced'&&r.count===1&&r.row[2]==='000007'&&r.row[4]==='0000'));
assert.equal(source.getLastRow(),20101);
assert.ok(source.reads.every(r=>r.width===1||r.height===1||r.height<=100),'must not read all 84 clinical columns for 20,000 patients');
response=send(incoming);assert.equal(source.getLastRow(),20101,'lost response replay must be idempotent');
const key=incoming[0].submission_uuid;
const revised=[...incoming[0].row];revised[5]='=SYNTHETIC_FORMULA';
assert.equal(send([item(key,2,revised)]).results[0].status,'synced');
assert.equal(send([incoming[0]]).results[0].status,'stale');
assert.equal(source.rows.find(r=>r[0]===key)[5],'=SYNTHETIC_FORMULA');
assert.ok(source.writes.some(w=>w.values.some(r=>r[5]==="'=SYNTHETIC_FORMULA")),'formula-like values must be escaped');
assert.equal(send([item(key,3,null)]).results[0].count,0);
assert.equal(send([item(key,2,revised)]).results[0].status,'stale','a delayed write must not resurrect deletion');
assert.ok(!source.rows.some(row=>row[0]===key));
assert.equal(send([item(key,4,revised)]).results[0].count,1,'restoring a newer revision is allowed');
const conflict=[...revised];conflict[5]='DIFFERENT SAME REVISION';
assert.equal(send([item(key,4,conflict)]).results[0].status,'conflict');
source.rows.push([...revised]);source.maxRows++;
assert.equal(send([item(key,5,revised)]).results[0].count,1,'duplicates are repaired by UUID');
const before=JSON.stringify(source.rows);
assert.equal(send([incoming[1],incoming[1]]).status,'error');
assert.equal(JSON.stringify(source.rows),before,'invalid batch validation must precede writes');
assert.equal(post({action:'batch',schema_version:4,headers,keys,items:[item(key,6,revised)]}).status,'error');
for(const hospital of context.HOSPITAL_VIEWS){const view=book.insertSheet(hospital.name);view.addDeveloperMetadata('GG_FORM_WHO_HOSPITAL',hospital.code);}
context.syncHospitalViews(source,headers.map((label,i)=>({key:keys[i],label,type:'text',section:'sec1'})));
assert.equal(source.getMaxColumns(),84);
assert.ok(book.sheets.filter(s=>s.name!=='__GG_FORM_SYNC').every(s=>s.getMaxColumns()===84));
const totalCells=book.sheets.reduce((n,s)=>n+s.getMaxRows()*s.getMaxColumns(),0);
assert.ok(totalCells<4000000,`20,000 records should use a bounded grid, actual ${totalCells}`);
assert.deepEqual(source.rows[1],initial[0],'grid resizing must preserve clinical values');
assert.ok(book.getSheetByName('TD - Từ Dũ').getRange(1,1).getFormula().includes(';84;4)'));
console.log(JSON.stringify({records:20000,batch:100,replay:true,staleWriteBlocked:true,deleteRestore:true,duplicateRepair:true,boundedReadback:true,totalAllocatedCells:totalCells}));

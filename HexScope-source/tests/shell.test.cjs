'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {app,eventually}=require('./dom-helper.cjs');

test('compact queue preserves range filters, selected file and module state when advanced controls are collapsed',async t=>{
  const ui=app(t),{$,w,d}=ui;
  assert.equal($('queueOptions').open,false);
  $('demoBtn').click();await eventually(()=>$('statTotal').textContent==='04');
  const selected=w.HexApp.selected();assert(selected);
  assert.equal($('detailName').title,selected.file.name);assert.equal($('detailMeta').title,$('detailMeta').textContent);
  $('queueOptions').querySelector('summary').click();assert.equal($('queueOptions').open,true);
  const largest=Math.max(...w.HexApp.state.items.map(item=>item.file.size));
  $('minSize').value=String(largest);$('maxSize').value=String(largest);$('sizeUnit').value='1';
  $('sizeUnit').dispatchEvent(new w.Event('change'));
  assert.equal($('queueOptionsLabel').textContent,'大小筛选已应用');
  assert.equal(d.querySelectorAll('.file-row').length,w.HexApp.state.items.filter(item=>item.file.size===largest).length);
  $('queueOptions').querySelector('summary').click();assert.equal($('queueOptions').open,false);
  for(const id of ['cryptoMode','hashMode','codecMode','diskMode','inspectMode']){
    $(id).click();assert.equal($(id).getAttribute('aria-pressed'),'true');
    assert.equal(d.querySelectorAll('.mode-nav [aria-pressed=true]').length,1);
  }
  assert.equal(w.HexApp.selected(),selected);assert.equal($('minSize').value,String(largest));
  assert.equal($('queueOptions').open,false);assert.equal($('queueOptionsLabel').textContent,'大小筛选已应用');
  $('queueOptions').querySelector('summary').click();$('resetSize').click();
  assert.equal(d.querySelectorAll('.file-row').length,4);assert.equal($('queueOptionsLabel').textContent,'大小与排序');
  $('minSize').value='20';$('maxSize').value='1';$('maxSize').dispatchEvent(new w.Event('input'));
  assert.equal($('queueOptionsLabel').textContent,'大小范围无效');assert.equal(d.querySelectorAll('.file-row').length,4);
});

import { isBusy } from '../../platform/lifecycle.js';

export const FLOOR_PAGE_SIZE=30;
export function floorPage(snapshot, query={}) {
  const matches=message=>(!query.role||query.role==='all'||message.role===query.role)&&(!query.visibility||query.visibility==='all'||!!message.is_hidden===(query.visibility==='hidden'));
  const messages=snapshot.messages.filter(matches),pages=Math.max(1,Math.ceil(messages.length/FLOOR_PAGE_SIZE));
  let page=query.page??0;
  if(Number.isInteger(query.jump)){
    const index=messages.findIndex(message=>message.message_id>=query.jump);
    page=Math.floor((index<0?Math.max(0,messages.length-1):index)/FLOOR_PAGE_SIZE);
  }
  page=Math.max(0,Math.min(pages-1,page));
  const selected=messages.slice(page*FLOOR_PAGE_SIZE,(page+1)*FLOOR_PAGE_SIZE),from=selected[0]?.message_id,to=selected.at(-1)?.message_id;
  const groups=selected.length?snapshot.groups.filter(group=>matches({role:group.role,is_hidden:group.hidden})&&group.to>=from&&group.from<=to).map(group=>({...group,from:Math.max(from,group.from),to:Math.min(to,group.to),count:Math.min(to,group.to)-Math.max(from,group.from)+1})):[];
  return {page,pages,count:messages.length,groups};
}
export function refreshFloorBrowser(panel) {
  const details=panel.querySelector('[data-floor-details]'),target=details?.querySelector('[data-floor-browser]');
  if(!target)return;
  if(!details.open){target.replaceChildren();return;}
  const snapshot=panel._visibilitySnapshot;if(!snapshot)return;
  const query=panel._floorQuery??={page:0,role:'all',visibility:'all'};
  const state=floorPage(snapshot,query);query.page=state.page;delete query.jump;
  const roleLabel=role=>role==='user'?'用户输入':role==='assistant'?'AI 输出':'系统消息';
  const options=(items,selected)=>items.map(([value,label])=>`<option value="${value}" ${value===selected?'selected':''}>${label}</option>`).join('');
  target.innerHTML=`<div class="sa-floor-filters"><label>消息类型<select class="sa-select" data-floor-filter="role">${options([['all','全部类型'],['user','用户输入'],['assistant','AI 输出'],['system','系统消息']],query.role)}</select></label><label>显示状态<select class="sa-select" data-floor-filter="visibility">${options([['all','全部状态'],['shown','仅显示'],['hidden','仅隐藏']],query.visibility)}</select></label></div><div class="sa-floor-jump"><input class="sa-input" type="number" min="0" max="${snapshot.messages.at(-1)?.message_id??0}" placeholder="输入楼层编号" aria-label="定位楼层" data-floor-jump-input><button class="sa-btn" type="button" data-floor-jump>前往</button></div><p class="sa-hint" data-floor-browser-message role="status">共 ${state.count} 楼，每页最多 ${FLOOR_PAGE_SIZE} 楼。点击“查看”才加载原文。</p><div class="sa-floor-table-wrap"><table class="sa-floor-table"><thead><tr><th>楼层 / 类型</th><th>状态</th><th>操作</th></tr></thead><tbody>${state.groups.map(group=>`<tr><td><strong>${group.from===group.to?group.from:group.from+'—'+group.to} 楼${group.from===0?' · 开局':''}</strong><span>${roleLabel(group.role)} · ${group.count} 楼${group.covered?' · 已总结':''}</span></td><td><span class="sa-floor-state ${group.hidden?'is-hidden':'is-shown'}">${group.state}</span></td><td><button type="button" class="sa-btn sa-btn-sm" data-floor-view data-from="${group.from}" data-to="${group.to}">查看</button><button type="button" class="sa-btn sa-btn-sm" data-floor-toggle data-from="${group.from}" data-to="${group.to}" data-hide="${!group.hidden}" ${isBusy()?'disabled':''}>${group.hidden?'显示':'隐藏'}</button></td></tr>`).join('')||'<tr><td colspan="3">没有符合筛选条件的楼层</td></tr>'}</tbody></table></div><div class="sa-floor-pages"><button type="button" class="sa-btn" data-floor-page="-1" ${state.page===0?'disabled':''}>上一页</button><span role="status">${state.page+1} / ${state.pages} 页</span><button type="button" class="sa-btn" data-floor-page="1" ${state.page+1>=state.pages?'disabled':''}>下一页</button></div>`;
}
export function bindFloorBrowser(panel) {
  panel.addEventListener('toggle',event=>{if(event.target.matches('[data-floor-details]'))refreshFloorBrowser(panel);},true);
  panel.addEventListener('change',event=>{if(event.target.matches('[data-floor-filter]')){panel._floorQuery={...panel._floorQuery,[event.target.dataset.floorFilter]:event.target.value,page:0};refreshFloorBrowser(panel);}});
  const jump=()=>{
    const input=panel.querySelector('[data-floor-jump-input]'),value=input.valueAsNumber;
    if(!Number.isInteger(value)||value<0||value>Number(input.max)){panel.querySelector('[data-floor-browser-message]').textContent=`请输入 0—${input.max} 之间的楼层编号`;return;}
    panel._floorQuery={...panel._floorQuery,jump:value};refreshFloorBrowser(panel);
    const row=panel.querySelector(`[data-floor-view][data-from="${value}"]`)?.closest('tr');row?.scrollIntoView({block:'nearest'});
  };
  panel.addEventListener('click',event=>{
    const filter=event.target.closest('[data-floor-visibility]');
    if(filter){
      panel._floorQuery={page:0,role:'all',visibility:filter.dataset.floorVisibility};
      const details=panel.querySelector('[data-floor-details]');details.open=true;refreshFloorBrowser(panel);
      details.scrollIntoView({block:'start'});return;
    }
    const page=event.target.closest('[data-floor-page]');
    if(page){panel._floorQuery.page+=Number(page.dataset.floorPage);refreshFloorBrowser(panel);}
    else if(event.target.closest('[data-floor-jump]'))jump();
  });
  panel.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('[data-floor-jump-input]')){event.preventDefault();jump();}});
}

export const BATCH_PRESETS = {
  'with-summary': { triggerFloorCount:50, keepFloorCount:10 },
  'without-summary': { triggerFloorCount:20, keepFloorCount:5 },
};
export function describeBatches(trigger, keep, limit, parallel=false, concurrency=2) {
  if(![trigger,keep,limit].every(Number.isInteger)||trigger<=keep||keep<1||limit<1)return '触发数应大于保留数，每批上限须为正整数。';
  const count=trigger-keep,parts=[];
  for(let remaining=count;remaining>0;remaining-=limit)parts.push(Math.min(remaining,limit));
  const split=parts.length<=8?parts.join('＋'):`${parts.length} 批，每批不超过 ${limit} 楼`;
  return `达到 ${trigger} 楼时，保留最近 ${keep} 楼，本轮处理 ${count} 楼：${split}。${parallel?`每组最多同时生成 ${concurrency} 批，再按楼层顺序保存。`:'一批保存完成后继续下一批。'}实际范围按完整 AI 回复收尾，可能略少于上限。`;
}
export function refreshBatchSettings(panel) {
  const number=id=>panel.querySelector(id).valueAsNumber,parallel=panel.querySelector('#sa-parallel-batches').checked;
  panel.querySelector('#sa-batch-concurrency').disabled=!parallel;
  panel.querySelector('[data-batch-explanation]').textContent=describeBatches(number('#sa-trigger-count'),number('#sa-keep-count'),number('#sa-batch-count'),parallel,number('#sa-batch-concurrency'));
  panel.querySelector('[data-batch-history-hint]').hidden=!parallel;
}
export function bindBatchSettings(panel) {
  panel.querySelector('#sa-batch-preset').addEventListener('change',event=>{
    const preset=BATCH_PRESETS[event.target.value];
    if(preset){panel.querySelector('#sa-trigger-count').value=preset.triggerFloorCount;panel.querySelector('#sa-keep-count').value=preset.keepFloorCount;}
    refreshBatchSettings(panel);
  });
  for(const input of panel.querySelectorAll('#sa-trigger-count,#sa-keep-count,#sa-batch-count,#sa-parallel-batches,#sa-batch-concurrency'))input.addEventListener('input',()=>{
    if(['sa-trigger-count','sa-keep-count'].includes(input.id))panel.querySelector('#sa-batch-preset').value='custom';
    refreshBatchSettings(panel);
  });
  refreshBatchSettings(panel);
}

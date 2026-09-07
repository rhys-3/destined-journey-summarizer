import { makeSummaryEntryName } from './utils.js';

export function splitFloorBatches(messages, limit, {exactEnd=false}={}) {
  if(!Number.isInteger(limit)||limit<1)throw new Error('每批楼层上限须为正整数');
  const plans=[];
  for(let offset=0;offset<messages.length;){
    let end=offset+1;
    while(end<messages.length&&messages[end].id===messages[end-1].id+1)end++;
    for(let cursor=offset;cursor<end;){
      let stop=Math.min(end,cursor+limit);
      if(!(exactEnd&&stop===messages.length))while(stop>cursor&&messages[stop-1].role!=='assistant')stop--;
      if(stop===cursor)break;
      const startFloor=messages[cursor].id,endFloor=messages[stop-1].id;
      plans.push({startFloor,endFloor,entryName:makeSummaryEntryName(startFloor,endFloor)});cursor=stop;
    }
    offset=end;
  }
  return plans;
}
export function batchTaskSpec(plans) {
  const batches=plans.map(({startFloor,endFloor,entryName})=>({kind:'normal',startFloor,endFloor,entryName,regenerate:false}));
  if(!batches.length)throw new Error('没有可以总结的完整楼层范围');
  return batches.length===1?batches[0]:{kind:'batch',startFloor:batches[0].startFloor,endFloor:batches.at(-1).endFloor,batches};
}

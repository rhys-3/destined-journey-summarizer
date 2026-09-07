import { DEFAULT_SETTINGS, BLOCK_TYPES } from './config.js';

const booleans = ['enabled','includeOldSummary','autoTriggerConfirm','autoHideSummarizedFloors','excludeHtmlComments','autoMegaSummary','parallelBatches'];
const strings = ['customApiUrl','customApiModel','customApiSource','userPrefix','assistantPrefix'];
function demand(value, message) { if(!value) throw new Error(message); }
export function summarySnapshot(input) {
  demand(input && typeof input === 'object' && !Array.isArray(input), '总结配置格式无效');
  const value = { ...structuredClone(DEFAULT_SETTINGS), ...input };
  const out = {};
  demand(value.behaviorVersion===1,'不支持的总结行为设置版本');out.behaviorVersion=1;
  demand(['with-summary','without-summary','custom'].includes(value.batchPreset),'批次方案无效');out.batchPreset=value.batchPreset;
  demand(Number.isInteger(value.batchConcurrency)&&value.batchConcurrency>=1&&value.batchConcurrency<=8,'并发数须为 1—8 的整数');out.batchConcurrency=value.batchConcurrency;
  for (const key of booleans) { demand(typeof value[key] === 'boolean', `总结参数 ${key} 必须是开关`); out[key]=value[key]; }
  for (const key of strings) { demand(typeof value[key] === 'string', `总结参数 ${key} 必须是文本`); out[key]=value[key]; }
  demand(['tavern','custom'].includes(value.apiMode), '总结 API 模式无效'); out.apiMode=value.apiMode;
  for (const key of ['triggerFloorCount','keepFloorCount','batchFloorCount','megaTriggerCount','megaBatchCount']) {
    demand(Number.isInteger(value[key]) && value[key]>=1 && value[key]<=999, '总结楼层数须为 1—999 的整数'); out[key]=value[key];
  }
  demand(out.keepFloorCount < out.triggerFloorCount, '保留楼层数须小于触发楼层数');
  demand(out.megaBatchCount >= 2 && out.megaBatchCount < out.megaTriggerCount, '大总结合并条数须至少为 2，且小于触发条数');
  out.promptVersion = DEFAULT_SETTINGS.promptVersion;
  demand(Array.isArray(value.customMacros), '自定义宏必须是列表');
  const macroNames = new Set();
  out.customMacros = value.customMacros.map(macro => {
    demand(macro && /^[a-zA-Z][\w.-]*$/.test(macro.name) && !macro.name.startsWith('summary.') && !['user','char'].includes(macro.name) && !macroNames.has(macro.name) && typeof macro.content === 'string', '宏名称无效或重复');
    macroNames.add(macro.name); return { name: macro.name, content: macro.content };
  });
  for (const key of ['temperature','maxTokens']) {
    const field=value[key];
    demand(field==='same_as_preset' || ((typeof field==='number'||typeof field==='string') && String(field).trim()!=='' && Number.isFinite(Number(field))), `${key} 须为数字或 same_as_preset`);
    out[key]=field==='same_as_preset'?field:Number(field);
  }
  demand(out.temperature==='same_as_preset'||out.temperature>=0, '温度不能为负数');
  demand(out.maxTokens==='same_as_preset'||(Number.isInteger(out.maxTokens)&&out.maxTokens>0), '最大 Tokens 须为正整数');
  for (const key of ['includeTags','excludeTags']) {
    demand(Array.isArray(value[key])&&value[key].every(t=>typeof t==='string'&&/^[\w:-]+$/.test(t)), '标签名称格式无效'); out[key]=[...value[key]];
  }
  for (const key of ['promptBlocks','megaPromptBlocks']) {
    demand(Array.isArray(value[key]), '总结提示词板块必须是列表'); const ids=new Set();
    out[key]=value[key].map(block=>{
      demand(block && typeof block.id==='string' && block.id && !ids.has(block.id), '总结板块 ID 缺失或重复'); ids.add(block.id);
      demand(Object.values(BLOCK_TYPES).includes(block.type) && typeof block.name==='string' && typeof block.enabled==='boolean', '总结板块格式无效');
      const item={id:block.id,type:block.type,name:block.name,enabled:block.enabled};
      if(block.choiceGroup!==undefined){demand(['format','check','tail'].includes(block.choiceGroup),'总结条目分组无效');item.choiceGroup=block.choiceGroup;}
      demand(['system','user','assistant'].includes(block.role ?? 'system'),'总结板块角色无效'); item.role=block.role ?? 'system';
      for(const field of ['content','leadText','xmlTag']) if(Object.hasOwn(block,field)) { demand(typeof block[field]==='string','总结板块内容须为文本'); item[field]=block[field]; }
      if(item.xmlTag) demand(/^[\w:-]+$/.test(item.xmlTag),'总结内容标签格式无效');
      return item;
    });
    for(const group of ['format','check','tail'])demand(out[key].filter(block=>block.enabled&&block.choiceGroup===group).length<=1,`同一总结预设中只能启用一个${group==='format'?'输出格式':group==='tail'?'尾部条目':'检查条目'}`);
  }
  return out;
}

import { getHost } from '../../platform/lifecycle.js';
import { summarySnapshot } from '../settingsSchema.js';
import { migrateOldSettings } from '../storage.js';
import { buildSummaryPromptParams, buildMegaSummaryPromptParams } from '../prompt.js';
import { prepareGeneration } from '../api.js';
import { computeSummaryPlan, computeMegaPlan } from '../summary.js';
import { snapshotContext } from '../macros.js';

export function collectCustomMacros(panel) { return structuredClone(panel._customMacros??[]); }
export function bindPromptTools(panel, settings, {collect,rerender}) {
  panel._customMacros=structuredClone(settings.customMacros??[]);
  const changed=()=>panel.dispatchEvent(new Event('summary-blocks-changed'));
  const report=error=>getHost().status(error.message,'error');
  panel.querySelector('[data-edit-macros]').onclick=async()=>{
    try{
      const raw=await getHost().popup('自定义变量使用名称与内容组成的列表；在条目里通过“插入变量”使用。\n示例：[{"name":"archive_style","content":"简洁中文"}]',globalThis.SillyTavern.POPUP_TYPE.INPUT,JSON.stringify(collectCustomMacros(panel),null,2),{rows:12,okButton:'保存变量'});
      if(typeof raw!=='string')return;
      const value=summarySnapshot({...collect(panel),customMacros:JSON.parse(raw)});panel._customMacros=value.customMacros;changed();
    }catch(error){report(error);}
  };
  panel.querySelector('[data-prompts-export]').onclick=()=>{
    try{
      const value=summarySnapshot(collect(panel));
      const data={format:'destined-summary-prompts',version:4,promptBlocks:value.promptBlocks,megaPromptBlocks:value.megaPromptBlocks,customMacros:value.customMacros};
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=panel.ownerDocument.createElement('a');link.href=url;link.download='命定总结提示词.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){report(error);}
  };
  const file=panel.querySelector('[data-prompts-file]');panel.querySelector('[data-prompts-import]').onclick=()=>file.click();
  file.onchange=async()=>{
    try{
      if(!file.files?.[0])return;
      const raw=JSON.parse(await file.files[0].text());if(raw.format!=='destined-summary-prompts')throw new Error('请选择总结提示词导出文件');
      const value=summarySnapshot(migrateOldSettings({...collect(panel),...raw,promptVersion:raw.version??1}));
      rerender(panel,value.promptBlocks);rerender(panel,value.megaPromptBlocks,'#sa-mega-blocks-container');panel._customMacros=value.customMacros;changed();
    }catch(error){report(error);}finally{file.value='';}
  };
  for(const button of panel.querySelectorAll('[data-prompt-preview]'))button.onclick=async()=>{
    try{
      const value=summarySnapshot(collect(panel)),kind=button.dataset.promptPreview;
      let params,previewOnly=false;
      if(kind==='normal'){const plan=await computeSummaryPlan();if(plan)params=await buildSummaryPromptParams(plan.startFloor,plan.endFloor,value);}
      else{const plan=await computeMegaPlan();if(plan)params=await buildMegaSummaryPromptParams(plan.summaryNames,null,value);}
      if(!params){previewOnly=true;params={kind,promptBlocks:kind==='normal'?value.promptBlocks:value.megaPromptBlocks,mergedChatText:'（尚无可生成批次；此处会填入本次实际材料）',scanText:''};params.macroValues=await snapshotContext(params,value);}
      const request=await prepareGeneration(params,value);
      const note=previewOnly?'当前展示启用条目的结构预览，材料用占位说明表示。':'下面是当前批次展开后的消息，预览不会发送。';
      await getHost().viewText('展开后的总结请求（不会发送）',note+'\n\n'+request.config.ordered_prompts.map((message,index)=>'['+(index+1)+' · '+message.role+']\n'+message.content).join('\n\n'));
    }catch(error){report(error);}
  };
}

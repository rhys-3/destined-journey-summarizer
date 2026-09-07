import { getSettings } from './storage.js';
import { getActiveWorldbookName, ensureWorldbookExists, auditArchiveSources, applySummarizedFloorsVisibility, commitArchiveEntry, getWorldbookEntriesSafe } from './worldbook.js';
import { buildSummaryPromptParams, buildMegaSummaryPromptParams } from './prompt.js';
import { prepareGeneration, sendPreparedGeneration } from './api.js';
import { extractSummaryResult, validateResultBody } from './result.js';
import { sourcesMatch, fingerprint } from './provenance.js';
import { beginTask, checkTask, updateTask, finishTask, getTask, taskRunning, waitForRetry, taskBatchFields } from './taskState.js';
import { getHost, cancelOwnRequests } from '../platform/lifecycle.js';
import { safeErrorDetails, extractHttpStatus } from './errorHandler.js';

const finished=batch=>['complete','skipped','paused'].includes(batch.phase);
function failure(error, stage, settings) {
  const sourceChanged=/来源|世界书已改变|原始总结/.test(error.message),status=extractHttpStatus(error);
  const errorKind=sourceChanged?'source':stage==='saving'?'save':stage==='visibility'?'visibility':stage==='validating'?'format':'request';
  const requestMessage=status===401||status===403?'连接认证失败，请检查密钥和权限':status===429?'接口繁忙或额度受限':/timeout|timed out|超时|超过 5 分钟/i.test(error.message)?'连接超时':'请求未完成，请检查连接后重试';
  return {phase:'pending',errorKind,message:errorKind==='visibility'?'总结已保存，楼层隐藏尚未完成':errorKind==='save'?'总结未保存，生成结果已保留':errorKind==='format'?'返回内容不符合结果标签或正文要求':sourceChanged?error.message:requestMessage,details:safeErrorDetails(error,[settings.customApiKey])};
}
async function assertSources(task, batch) {
  checkTask(task);
  if(batch.book&&batch.book!==getActiveWorldbookName())throw new Error('本聊天的总结世界书已改变，请重新生成');
  if(!sourcesMatch(batch.sources))throw new Error('来源楼层或回复版本已变化，请重新生成');
  const entries=await getWorldbookEntriesSafe();checkTask(task);
  if(!(batch.parents??[]).every(parent=>entries.some(entry=>entry.name===parent.name&&fingerprint(entry.content)===parent.fingerprint)))throw new Error('原始总结已变化，请重新生成');
}
const retryMode=batch=>batch.saved?'visibility':batch.body&&!['request','format','source'].includes(batch.errorKind)?'save':'generate';
async function generateBatch(task, batch, settings, advance, mode, editedBody) {
  if(mode!=='generate'){
    advance(batch.saved?'visibility':'validating',{errorKind:null});
    await assertSources(task,batch);
    if(editedBody!==undefined)advance('validating',{body:validateResultBody(editedBody,batch.resultFormat??'free'),saved:false,errorKind:null});
    return;
  }
  const spec=batch.spec;
  advance('preparing',{body:'',raw:'',saved:false,errorKind:null,details:''});
  const params=spec.kind==='mega'?await buildMegaSummaryPromptParams(spec.summaryNames,spec.regenerate?spec.entryName:null,settings):await buildSummaryPromptParams(spec.startFloor,spec.endFloor,settings);
  checkTask(task);
  const prepared=await prepareGeneration(params,settings);checkTask(task);
  advance('generating',{book:getActiveWorldbookName(),sources:params.sources,parents:params.parents,resultFormat:prepared.resultFormat});
  for(let attempt=0;attempt<2;attempt++){
    advance('generating',{attempt:attempt+1});
    try{
      const response=await sendPreparedGeneration(prepared,settings);checkTask(task);
      advance('validating',{raw:response});
      const body=extractSummaryResult(response,{prefill:prepared.prefill,format:prepared.resultFormat});
      advance('validating',{body});return;
    }catch(error){
      if(error.name==='AbortError')throw error;
      if(attempt===1||[401,403].includes(extractHttpStatus(error)))throw error;
      advance('retrying',{message:'本次请求将自动重试一次'});await waitForRetry(task);checkTask(task);
    }
  }
}
async function commitBatch(task, batch, advance) {
  await assertSources(task,batch);
  if(!batch.saved){
    advance('saving',{message:''});
    await commitArchiveEntry(batch.spec.entryName,batch.body,{taskId:task.id,sources:batch.sources,parents:batch.parents,summaryNames:batch.spec.summaryNames??[]});checkTask(task);
    advance('visibility',{saved:true});
  }else advance('visibility');
  await applySummarizedFloorsVisibility({taskId:task.id});checkTask(task);
  advance('complete',{saved:true,errorKind:null,details:'',raw:'',message:'总结已保存'});
}

export async function runSummaryTask(spec, {previous=null, mode, editedBody, automatic=false}={}) {
  if(taskRunning())throw new Error('当前总结任务尚未结束');
  if(!previous&&['pending','stopped'].includes(getTask()?.phase))throw new Error('请先在任务详情中重试或跳过待处理批次');
  const settings=getSettings(),specs=spec.kind==='batch'?spec.batches:[spec];
  const batches=previous?.batches?structuredClone(previous.batches):specs.map(item=>({spec:item,phase:'queued',...taskBatchFields(previous)}));
  const selected=previous?.selectedBatch??0;
  if(mode&&batches[selected])batches[selected].phase='queued';
  const task=beginTask(spec,previous),multiple=batches.length>1;
  let activeIndex=selected;
  const change=(index,phase,patch={},parentPhase)=>{
    activeIndex=index;Object.assign(batches[index],patch,{phase});
    return updateTask(task,{...taskBatchFields(batches[index]),batches,selectedBatch:index,phase:parentPhase??phase,message:multiple?`已完成 ${batches.filter(batch=>batch.phase==='complete').length} / ${batches.length} 批`:batches[index].message??''},{save:true});
  };
  try{
    updateTask(task,{batches,selectedBatch:selected},{save:true});
    await ensureWorldbookExists({taskId:task.id});checkTask(task);
    await auditArchiveSources({taskId:task.id});checkTask(task);
    const pending=batches.map((batch,index)=>finished(batch)||mode&&index!==selected?-1:index).filter(index=>index>=0);
    const concurrency=settings.parallelBatches?settings.batchConcurrency:1;
    for(let cursor=0;cursor<pending.length;cursor+=concurrency){
      if(automatic&&!getSettings().enabled){for(const index of pending.slice(cursor))batches[index].phase='paused';break;}
      const wave=pending.slice(cursor,cursor+concurrency);
      // Generate a bounded group together. All writes below remain in floor order.
      await Promise.all(wave.map(async index=>{
        const batch=batches[index],selectedMode=index===selected?mode:undefined;
        try{
          await generateBatch(task,batch,settings,(phase,patch)=>change(index,phase,patch,multiple?'generating':phase),selectedMode??retryMode(batch),index===selected?editedBody:undefined);
        }catch(error){
          if(error.name==='AbortError')throw error;
          const problem=failure(error,batch.phase,settings);change(index,'pending',problem,multiple?'generating':'pending');
        }
      }));
      checkTask(task);
      for(const index of wave){
        const batch=batches[index];if(batch.phase==='pending')continue;
        try{await commitBatch(task,batch,(phase,patch)=>change(index,phase,patch,phase==='complete'?'visibility':phase));}
        catch(error){if(error.name==='AbortError')throw error;change(index,'pending',failure(error,batch.phase,settings));}
      }
      if(wave.some(index=>batches[index].phase==='pending'))break;
    }
    const incomplete=batches.findIndex(batch=>!finished(batch)),focus=incomplete>=0?incomplete:Math.max(0,batches.findLastIndex(batch=>batch.phase==='complete'));
    const message=incomplete>=0?(batches[focus].message||'还有批次待处理'):batches.some(batch=>batch.phase==='paused')?'本轮已暂停，已生成的结果已保存':multiple?`已保存 ${batches.filter(batch=>batch.phase==='complete').length} 批总结`:'总结已保存';
    finishTask(task,{...taskBatchFields(batches[focus]),batches,selectedBatch:focus,phase:incomplete>=0?'pending':'complete',message});
    return incomplete<0;
  }catch(error){
    if(error.name==='AbortError')return false;
    try{checkTask(task);}catch{return false;}
    cancelOwnRequests();
    const problem=failure(error,batches[activeIndex]?.phase,settings);
    Object.assign(batches[activeIndex],problem);
    try{finishTask(task,{...taskBatchFields(batches[activeIndex]),...problem,batches,selectedBatch:activeIndex});}
    catch{getHost()?.status('任务恢复记录暂时无法保存，请保留当前页面后重试','error');}
    return false;
  }
}

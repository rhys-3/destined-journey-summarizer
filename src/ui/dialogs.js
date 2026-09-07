import { onCancel } from '../platform/lifecycle.js';
export const DIALOG_STYLES = `
.dj-dialog-backdrop{position:fixed;inset:0;background:var(--overlay);display:flex;align-items:center;justify-content:center;padding:16px;z-index:2147483645;box-sizing:border-box;pointer-events:auto}
.dj-dialog{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:16px;padding:20px;width:min(720px,100%);max-height:calc(100dvh - 32px);overflow:auto;box-sizing:border-box}
.dj-dialog h3{margin:0 0 12px}.dj-dialog-message{white-space:pre-wrap;overflow-wrap:anywhere;max-height:30dvh;overflow:auto;line-height:1.6}
.dj-dialog textarea{box-sizing:border-box;width:100%;min-height:100px;max-height:45dvh;padding:12px;margin:14px 0;background:var(--input);color:var(--ink);border:1px solid var(--line);border-radius:8px;resize:vertical}
.dj-dialog-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:16px}.dj-dialog-actions button{padding:10px 16px;background:var(--soft);border:1px solid var(--line);color:var(--ink);border-radius:8px}.dj-dialog-actions button:first-child{background:var(--selected);color:var(--gold)}
.dj-dialog-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:12px}.dj-dialog-field{display:flex;flex-direction:column;gap:7px;min-width:0}.dj-dialog-field-wide{grid-column:1/-1}.dj-dialog-field input,.dj-dialog-field select{box-sizing:border-box;width:100%;min-width:0;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--input);color:var(--ink);font:inherit}.dj-dialog-field textarea{margin:0;min-height:220px;font:inherit;line-height:1.65}.dj-dialog-error{color:var(--danger);font-size:13px;margin-top:10px}.dj-dialog-fields label{font-size:13px}.dj-dialog-insert{font-size:12px;color:var(--muted)}
`;
export function createDialogs({ getRoot, open }) {
  const pending=new Set();
  function show({title='总结',message='',value,rows=12,choices,cancelValue=null,readOnly=false,recordWrite=false,fields,validate}) {
    open(); const root=getRoot();
    return new Promise(resolve=>{
      const doc=root.ownerDocument,backdrop=doc.createElement('div'); backdrop.className='dj-dialog-backdrop';
      const dialog=doc.createElement('section');dialog.className='dj-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',title);
      const heading=doc.createElement('h3');heading.textContent=title;
      const body=doc.createElement('div');body.className='dj-dialog-message';
      // Existing summary callers escape names; decode text without inserting HTML.
      const decoder=doc.createElement('textarea');decoder.innerHTML=message;body.textContent=decoder.value;
      dialog.append(heading,body); let input;
      if(value!==undefined){input=doc.createElement('textarea');input.value=value;input.rows=rows;input.readOnly=readOnly;input.setAttribute('aria-label',title+'内容');dialog.append(input);}
      const controls=new Map();
      if(fields){
        const grid=doc.createElement('div');grid.className='dj-dialog-fields';dialog.append(grid);
        for(const field of fields){
          const label=doc.createElement('label');label.className='dj-dialog-field'+(field.type==='textarea'?' dj-dialog-field-wide':'');label.textContent=field.label;
          const control=doc.createElement(field.type==='textarea'?'textarea':field.type==='select'?'select':'input');
          if(control.tagName==='INPUT')control.type=field.type||'text';
          if(field.options)for(const [value,text] of field.options){const option=doc.createElement('option');option.value=value;option.textContent=text;control.append(option);}
          control.value=field.value??'';control.dataset.formField=field.name;control.setAttribute('aria-label',field.label);
          for(const key of ['min','max','step','placeholder'])if(field[key]!==undefined)control.setAttribute(key,String(field[key]));
          label.append(control);grid.append(label);controls.set(field.name,control);
          if(field.macros){
            const menu=doc.createElement('select');menu.className='dj-dialog-insert';menu.setAttribute('aria-label','插入变量');const placeholder=doc.createElement('option');placeholder.value='';placeholder.textContent='插入变量…';menu.append(placeholder);
            for(const [name,text] of field.macros){const option=doc.createElement('option');option.value=name;option.textContent=text+' · {{'+name+'}}';menu.append(option);}
            menu.onchange=()=>{if(menu.value){control.setRangeText('{{'+menu.value+'}}',control.selectionStart,control.selectionEnd,'end');menu.value='';control.focus({preventScroll:true});}};label.append(menu);
          }
        }
      }
      const error=doc.createElement('div');error.className='dj-dialog-error';error.setAttribute('role','alert');error.hidden=true;dialog.append(error);
      const actions=doc.createElement('div');actions.className='dj-dialog-actions';dialog.append(actions);backdrop.append(dialog);
      const previous=root.activeElement;let finished=false;let off=()=>{};
      function finish(result){if(finished)return;finished=true;backdrop.remove();pending.delete(cancel);off();previous?.focus?.({preventScroll:true});resolve(result);}
      const cancel=()=>finish(cancelValue);pending.add(cancel);off=onCancel(cancel);
      for(const [label,result] of choices){const button=doc.createElement('button');button.type='button';button.textContent=label;if(recordWrite&&result==='__input__')button.dataset.recordSave='';button.onclick=()=>{
        if(result==='__copy__'){doc.defaultView.navigator.clipboard.writeText(input.value).catch(()=>{});return;}
        const value=result==='__form__'?Object.fromEntries([...controls].map(([name,control])=>[name,control.type==='number'?control.valueAsNumber:control.value])):result==='__input__'?input.value:result;
        if(result==='__form__'&&validate){const message=validate(value);if(message){error.textContent=message;error.hidden=false;return;}}
        finish(value);
      };actions.append(button);}
      backdrop.onclick=e=>{if(e.target===backdrop)cancel();};
      backdrop.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();cancel();}if(e.key==='Tab'){const fields=[...dialog.querySelectorAll('button,textarea,input,select')];const first=fields[0],last=fields.at(-1);if(e.shiftKey&&root.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&root.activeElement===last){e.preventDefault();first.focus();}}};
      root.querySelector('.destined-root').append(backdrop);(input??controls.values().next().value??actions.firstChild).focus();
    });
  }
  return {
    confirm(message, title='确认操作') { return show({title,message,cancelValue:false,choices:[['确定',true],['取消',false]]}); },
    async prompt(title, value='') {
      const result=await show({title,fields:[{name:'text',label:title,value}],choices:[['保存','__form__'],['取消',null]]});
      return result?.text ?? null;
    },
    form(options){return show({...options,choices:options.choices??[['保存','__form__'],['取消',null]]});},
    popup(message,type,value,options={}) {
      const st=globalThis.SillyTavern;
      const input=type===st.POPUP_TYPE.INPUT;
      return show({message,title:input?'编辑与确认':'确认操作',value:input?(value??''):undefined,rows:options.rows??12,recordWrite:options.recordWrite,choices:[[options.okButton??'确定',input?'__input__':st.POPUP_RESULT.AFFIRMATIVE],[options.cancelButton??'取消',null]]});
    },
    viewText(title,value){return show({title,value,readOnly:true,choices:[['复制','__copy__'],['关闭',null]]});},
    chooseFailure({title,message,retryLabel='重新总结',reviewLabel='手动编辑',cancelLabel='取消'}) {return show({title,message,cancelValue:'cancel',choices:[[retryLabel,'retry'],[reviewLabel,'review'],[cancelLabel,'cancel']]});},
    destroy(){for(const cancel of [...pending])cancel();},
  };
}

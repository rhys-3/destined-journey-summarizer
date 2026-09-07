import { escapeHtml } from '../utils.js';

const validTag = value => /^[\w:-]+$/.test(value);
export function parseTagNames(text) {
  const names=String(text).trim().split(/[\s,，、;；<>/]+/).filter(Boolean);
  if(names.some(name=>!validTag(name)))throw new Error('只需填写标签名称，不要输入标点或标签正文');
  return [...new Set(names)];
}
const chips = tags => tags.map(tag=>`<span class="sa-tag-chip"><code>${escapeHtml(tag)}</code><button type="button" data-tag-remove="${escapeHtml(tag)}" aria-label="移除标签 ${escapeHtml(tag)}">×</button></span>`).join('');
export function renderTagEditor(key, label, tags) {
  const id=key==='includeTags'?'sa-include-tags':'sa-exclude-tags';
  return `<div class="sa-tag-editor" data-tag-key="${key}" data-tags="${escapeHtml(JSON.stringify(tags))}"><label for="${id}" class="sa-field-label">${label}</label><div class="sa-tag-chips" data-tag-chips>${chips(tags)}</div><div class="sa-tag-input-row"><input class="sa-input" id="${id}" type="text" placeholder="输入标签名称" autocomplete="off" spellcheck="false"><button class="sa-btn" type="button" data-tag-add>添加</button></div><p class="sa-hint">输入名称后按回车或点“添加”，无需填写标点或尖括号。</p><p class="sa-hint" data-tag-error role="status" hidden></p></div>`;
}
export function readTagEditor(panel, key) { return JSON.parse(panel.querySelector(`[data-tag-key="${key}"]`).dataset.tags); }
export function bindTagEditors(panel, changed) {
  for(const editor of panel.querySelectorAll('[data-tag-key]')){
    const input=editor.querySelector('input'),error=editor.querySelector('[data-tag-error]');
    const showError=message=>{error.textContent=message;error.hidden=!message;};
    const save=tags=>{editor.dataset.tags=JSON.stringify(tags);editor.querySelector('[data-tag-chips]').innerHTML=chips(tags);showError('');changed();};
    const add=text=>{
      try{const names=parseTagNames(text);if(!names.length)return;const previous=JSON.parse(editor.dataset.tags),next=[...new Set([...previous,...names])];input.value='';if(next.length!==previous.length)save(next);else showError('该标签已添加');}
      catch(problem){showError(problem.message);}
    };
    editor.querySelector('[data-tag-add]').onclick=()=>{add(input.value);input.focus();};
    editor.querySelector('[data-tag-chips]').onclick=event=>{const button=event.target.closest('[data-tag-remove]');if(button)save(JSON.parse(editor.dataset.tags).filter(tag=>tag!==button.dataset.tagRemove));};
    input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();event.stopPropagation();add(input.value);}});
    input.addEventListener('beforeinput',event=>{if(event.data&&/[^\w:-]/.test(event.data)){event.preventDefault();if(/^[\s,，、;；]+$/.test(event.data))add(input.value);else showError('只需输入标签名称');}});
    input.addEventListener('input',()=>{if(/[^\w:-]/.test(input.value)){input.value=input.value.replace(/[^\w:-]/g,'');showError('只需输入标签名称');}});
    input.addEventListener('paste',event=>{event.preventDefault();add(event.clipboardData.getData('text'));});
  }
}

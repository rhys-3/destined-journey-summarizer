// Tavern Helper's insertOrAssignVariables recursively merges objects and
// replaces arrays. Omitting an object member does NOT delete its old value.
// Contract: JS-Slash-Runner/src/function/variables.ts, insertOrAssignVariables.
function mergeTavernVariables(target, patch) {
  for (const [key,value] of Object.entries(patch)) {
    if (['__proto__','constructor','prototype'].includes(key)) continue;
    if (Array.isArray(value)) target[key]=structuredClone(value);
    else if (value && typeof value==='object') {
      if (!target[key] || typeof target[key]!=='object' || Array.isArray(target[key])) target[key]={};
      mergeTavernVariables(target[key],value);
    } else if (value!==undefined || !Object.hasOwn(target,key)) target[key]=value;
  }
  return target;
}
module.exports={mergeTavernVariables};

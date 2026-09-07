import { errorCatched } from './errorHandler.js';
import { escapeRegex } from './utils.js';
import { SillyTavern } from '../platform/lifecycle.js';
/**
 * messages.js
 * 聊天消息的提取、标签过滤、合并处理
 * 依赖: utils.js, errorHandler.js
 */

const replaceMacros = (text) => {
  if (!text || typeof text !== "string") return text || "";
  const userName = SillyTavern.name1 || "User";
  const charName = SillyTavern.name2 || "Character";
  return text
    .replace(/\{\{user\}\}/gi, userName)
    .replace(/\{\{char\}\}/gi, charName);
};

const getRawMessages = errorCatched(async (startFloor, endFloor) => {
  const lastId = getLastMessageId();
  if (lastId < 0) return [];
  const s = Math.max(0, startFloor);
  const e = Math.min(lastId, endFloor);
  if (s > e) return [];
  const msgs = getChatMessages(`${s}-${e}`, {
    role: "all",
    hide_state: "all",
    include_swipes: false,
  });
  return msgs.map((m) => ({
    id: m.message_id,
    role: m.role,
    name: m.name,
    message: m.message,
    swipe_id: m.swipe_id ?? null,
  }));
});

const getAllRawMessages = errorCatched(async () => {
  const lastId = getLastMessageId();
  if (lastId < 0) return [];
  return await getRawMessages(0, lastId);
});

const extractTagContent = (text, tagNames) => {
  if (!text || !tagNames || tagNames.length === 0) return text || "";
  const results = [];
  for (const tag of tagNames) {
    const tagClean = tag.trim();
    if (!tagClean) continue;
    const regex = new RegExp(
      `<${escapeRegex(tagClean)}(?:\\s[^>]*)?>(.*?)</${escapeRegex(tagClean)}\\s*>`,
      "gis",
    );
    let match;
    while ((match = regex.exec(text)) !== null) {
      const content = match[1].trim();
      if (content) results.push(content);
    }
  }
  return results.join("\n");
};

const excludeTagContent = (text, tagNames) => {
  if (!text || !tagNames || tagNames.length === 0) return text || "";
  let result = text;
  for (const tag of tagNames) {
    const tagClean = tag.trim();
    if (!tagClean) continue;
    const escapedTag = escapeRegex(tagClean);
    const pattern=new RegExp(`<\\/?${escapedTag}(?=[\\s/>])[^>]*>`,'gi');
    let depth=0,start=0,kept=0,filtered='',match;
    while((match=pattern.exec(result))){
      const closing=match[0].startsWith('</'),selfClosing=/\/\s*>$/.test(match[0]);
      if(!closing){if(!depth)start=match.index;if(!selfClosing)depth++;}
      else if(depth)depth--;else continue;
      if(!depth){filtered+=result.slice(kept,start);kept=pattern.lastIndex;}
    }
    result=filtered+result.slice(kept,depth?start:result.length);
  }
  return result.trim();
};

const removeHtmlComments = (text) => {
  if (!text) return text || "";
  return text.replace(/<!--[\s\S]*?-->/g, "").trim();
};

const processMessagesByTags = (
  messages,
  includeTags,
  excludeTags,
  excludeHtmlComments,
) => {
  const results = [];
  for (const msg of messages) {
    let content = msg.message || "";
    if (excludeHtmlComments) {
      content = removeHtmlComments(content);
    }
    if (msg.role !== 'user' && includeTags && includeTags.length > 0) {
      content = extractTagContent(content, includeTags);
    }
    if (msg.role !== 'user' && excludeTags && excludeTags.length > 0) {
      content = excludeTagContent(content, excludeTags);
    }
    if (!content.trim()) continue;
    results.push({
      id: msg.id,
      role: msg.role,
      name: msg.name,
      content: content.trim(),
    });
  }
  return results;
};

const messagesToMergedText = (
  processedMessages,
  userPrefix = "{{user}}",
  assistantPrefix = "AI",
) => {
  const resolvedUserPrefix = replaceMacros(userPrefix);
  const resolvedAssistantPrefix = replaceMacros(assistantPrefix);
  const lines = [];
  for (const msg of processedMessages) {
    const label = msg.role === 'user'
      ? `用户输入（意图，未必实现） · ${resolvedUserPrefix}`
      : msg.role === 'assistant' ? `${msg.id === 0 ? '开局 · ' : ''}AI 正文（实际剧情）` + (resolvedAssistantPrefix ? ` · ${resolvedAssistantPrefix}` : '') : '系统消息（补充材料）';
    lines.push(`[第 ${msg.id} 楼 · ${label}]\n${msg.content}`);
  }
  return lines.join("\n\n");
};

const getRawChatTextForScan = errorCatched(async (startFloor, endFloor) => {
  const msgs = await getRawMessages(startFloor, endFloor);
  return msgs.map((m) => m.message).join("\n");
});

export { replaceMacros, getRawMessages, getAllRawMessages, extractTagContent, excludeTagContent, removeHtmlComments, processMessagesByTags, messagesToMergedText, getRawChatTextForScan };

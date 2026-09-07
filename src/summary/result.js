export function extractSummaryResult(output, { prefill = '', format = 'free' } = {}) {
  const text = `${prefill}${String(output ?? '')}`;
  const tags = [...text.matchAll(/<\/?summary_result\b[^>]*>/gi)];
  if (tags.length !== 2 || tags[0][0] !== '<summary_result>' || tags[1][0] !== '</summary_result>') throw new Error('需要且只能有一组完整的 <summary_result> 结果标签');
  const body = text.slice(tags[0].index + tags[0][0].length, tags[1].index).trim();
  // Also reject a truncated duplicate opener/closer that the complete-tag scan cannot see.
  if ((text.match(/<\/?summary_result\b/gi) ?? []).length !== 2) throw new Error('结果标签重复或未闭合');
  validateResultBody(body, format);
  return body;
}
export function validateResultBody(body, format = 'free') {
  if (!String(body ?? '').trim()) throw new Error('总结正文为空');
  if (/<\/?summary_result\b/i.test(body)) throw new Error('正文内不能嵌套结果标签');
  if (format === 'archive') {
    if (!/^【时空与事件】\s*\r?\n[-*] .+/m.test(body)) throw new Error('分项档案需要“【时空与事件】”标题和至少一条事件');
    const headings = [...body.matchAll(/^【([^】]+)】/gm)].map(match => match[1]);
    if (headings.some(heading => !['时空与事件','信息与关系变化','约定与未决事项'].includes(heading)) || new Set(headings).size !== headings.length) throw new Error('分项档案的分类标题不符合所选格式');
  }
  if (format === 'legacy') {
    const segments = String(body).trim().split(/^---[ \t]*\r?$/m);
    if (segments.shift() !== '' || !segments.length || segments.some(segment => {
      const lines = segment.replace(/^\r?\n/, '').trimEnd().split(/\r?\n/);
      return !/^[^|\n]+ \| [^\n]+[:：]$/.test(lines[0] ?? '') || lines.filter(line => /^ {2}\S/.test(line)).length < 2;
    })) throw new Error('时间地点档案需要 --- 分隔、日期 | 地点: 标题，以及缩进的时间和事件正文');
  }
  return String(body).trim();
}

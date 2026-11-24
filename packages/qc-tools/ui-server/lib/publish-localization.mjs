export function parseSrt(input) {
  const text = String(input || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error('字幕为空。');
  const blocks = text.split(/\n[ \t]*\n+/);
  let previousStart = -1, previousEnd = -1;
  const warnings = [];
  const cues = blocks.map((block, i) => {
    const lines = block.split('\n');
    if (!/^\d+$/.test(lines[0]?.trim() || '') || lines.length < 3) throw new Error(`第 ${i + 1} 段缺少序号、时间或正文。`);
    const match = /^(\d{2,}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2,}):(\d{2}):(\d{2}),(\d{3})$/.exec(lines[1].trim());
    if (!match) throw new Error(`第 ${i + 1} 段时间格式错误，应为 00:00:00,000 --> 00:00:01,000。`);
    const n = match.slice(1).map(Number);
    if ([n[1], n[2], n[5], n[6]].some(v => v >= 60)) throw new Error(`第 ${i + 1} 段时间超出范围。`);
    const ms = a => ((a[0] * 60 + a[1]) * 60 + a[2]) * 1000 + a[3];
    const start = ms(n.slice(0, 4)), end = ms(n.slice(4));
    if (start >= end) throw new Error(`第 ${i + 1} 段结束时间须晚于开始时间。`);
    if (!lines.slice(2).join('\n').trim()) throw new Error(`第 ${i + 1} 段正文为空。`);
    if (Number(lines[0].trim()) !== i + 1) warnings.push(`第 ${i + 1} 段序号不连续`);
    if (start < previousStart) warnings.push(`第 ${i + 1} 段时间顺序异常`);
    if (start < previousEnd) warnings.push(`第 ${i + 1} 段与前一段重叠`);
    if (lines.slice(2).join('').length > 100) warnings.push(`第 ${i + 1} 段文字较长，请检查阅读速度`);
    previousStart = start; previousEnd = end;
    return { index: lines[0].trim(), time: lines[1].trim(), text: lines.slice(2).join('\n'), end };
  });
  return { cues, warnings };
}
export function renderSrt(cues) { return cues.map(c => `${c.index}\n${c.time}\n${c.text}`).join('\n\n') + '\n'; }

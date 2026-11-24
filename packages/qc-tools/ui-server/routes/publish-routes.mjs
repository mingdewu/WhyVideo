import fs from 'node:fs';
import path from 'node:path';
import { readBody } from '../lib/config.mjs';
import { callOpenRouterText } from '../lib/llm-gateway.mjs';

const DEFAULT_PROMPT = '你是一位中文 YouTube 视频编辑。请根据文案生成准确、有吸引力的标题、简介和搜索标签。标题清晰自然，简介概括视频内容，标签覆盖主题、相关人物和常见搜索词。不要编造事实，不要编造章节时间。';

export async function handlePublishRoutes(req, res, { pathname, paths }) {
  if (!['/api/publish/generate', '/api/publish/prompt'].includes(pathname)) return false;
  const respond = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); return true; };
  const promptPath = path.join(paths.dataDir, 'publish-prompt.json');
  const getPrompt = () => { try { const saved = JSON.parse(fs.readFileSync(promptPath, 'utf8')); return typeof saved.prompt === 'string' && saved.prompt.trim() ? saved.prompt : DEFAULT_PROMPT; } catch { return DEFAULT_PROMPT; } };
  try {
    if (pathname === '/api/publish/prompt' && req.method === 'GET') return respond(200, {prompt: getPrompt(), defaultPrompt: DEFAULT_PROMPT});
    if (pathname === '/api/publish/prompt' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.reset === true) { if (fs.existsSync(promptPath)) fs.unlinkSync(promptPath); return respond(200, {prompt: DEFAULT_PROMPT}); }
      if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 12000) return respond(400, {error:'提示词不能为空，且不能超过 12000 个字符。'});
      fs.mkdirSync(paths.dataDir, {recursive:true}); fs.writeFileSync(promptPath, JSON.stringify({prompt:body.prompt.trim()}, null, 2));
      return respond(200, {prompt:body.prompt.trim()});
    }
    if (pathname !== '/api/publish/generate' || req.method !== 'POST') return false;
    if (!fs.existsSync(paths.finalScriptPath)) return respond(400, { error: '当前工程没有文案终稿，请先在文案创作台完成定稿。' });
    const script = fs.readFileSync(paths.finalScriptPath, 'utf8');
    if (!script.trim() || script.trim() === '{}' || script.trim() === '[]') return respond(400, { error: '当前工程的文案终稿为空。' });
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(paths.promptConfigPath, 'utf8')); } catch {}
    const instruction = getPrompt() + '\n\n输出格式要求：只返回 JSON 对象，包含 title（标题字符串，不超过100字符）、description（简介字符串）和 tags（搜索标签字符串数组），标签总长度不超过400字符。';
    const result = await callOpenRouterText(instruction, script.slice(0, 100000), { model: cfg.writerModel || cfg.textModel, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, maxTokens: 2000 });
    if (!result) return respond(502, { error: globalThis.__lastWriterLlmError || 'AI 生成失败，请检查模型配置。' });
    const cleaned = result.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const data = JSON.parse(cleaned);
    if (typeof data.title !== 'string' || typeof data.description !== 'string' || !data.title.trim() || !data.description.trim() || !Array.isArray(data.tags) || !data.tags.every(tag => typeof tag === 'string')) throw new Error('AI 返回的标题、简介或标签格式不正确，请重试。');
    return respond(200, { title: data.title.trim().slice(0, 100), description: data.description.trim(), tags: data.tags.map(t => t.trim()).filter(Boolean) });
  } catch (err) { return respond(500, { error: '操作失败：' + err.message }); }
}

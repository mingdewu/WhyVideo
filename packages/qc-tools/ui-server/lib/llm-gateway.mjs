import fs from 'fs';
import path from 'path';
import { rootDir } from './config.mjs';
import { renderWriterPrompt } from '../../writer-prompts.mjs';

export function extractJsonFromText(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  // Prefer fenced JSON, then scan complete outer containers in their original order.
  // Parsing braces first turns a one-card array with a prose prefix into an object.
  const candidates = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)].map((match) => match[1]);
  candidates.push(text);
  for (const candidate of candidates) {
    try { return JSON.parse(candidate.trim()); } catch {}
    let start = -1;
    let quoted = false;
    let escaped = false;
    const stack = [];
    for (let i = 0; i < candidate.length; i++) {
      const char = candidate[i];
      if (start === -1) {
        if (char !== '{' && char !== '[') continue;
        start = i;
      }
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === '{' || char === '[') stack.push(char);
      else if (char === '}' || char === ']') {
        const opening = stack.pop();
        if ((char === '}' && opening !== '{') || (char === ']' && opening !== '[')) {
          start = -1;
          stack.length = 0;
        } else if (!stack.length) {
          try { return JSON.parse(candidate.slice(start, i + 1)); } catch {}
          start = -1;
        }
      }
    }
  }
  return null;
}

export async function fetchWikipediaExtract(query) {
  try {
    const cleanQuery = query.replace(/^(为什么|为何|为何要|怎么|日本|中国|美国|如何)/g, '').replace(/[？?，,。！!].*$/, '').trim() || query;
    const url = 'https://zh.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(cleanQuery);
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch(url, { headers: { 'User-Agent': 'WhyVideo-FactResearcher/1.0' }, signal: ctrl.signal });
    clearTimeout(tid);
    if (res.ok) {
      const data = await res.json();
      if (data.extract) return '【权威百科背景词条摘要】：\n' + data.extract + '\n\n';
    }
  } catch (e) {
    // 忽略异常，降级到模型深度考证
  }
  return '';
}

function normalizeSecretKey(value) {
  const s = String(value || '').trim();
  return s && !/^•+$/.test(s) ? s : '';
}

export function getWriterTavilyKey(projectDir, explicitKey = '', { projectsRoot } = {}) {
  const direct = normalizeSecretKey(explicitKey);
  if (direct) return direct;

  if (projectDir) {
    const configPath = path.join(projectDir, 'data', 'prompt-config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const localKey = normalizeSecretKey(config.tavilyApiKey);
        if (localKey) return localKey;
      } catch (e) {}
    }
  }

  const envKey = normalizeSecretKey(process.env.TAVILY_API_KEY);
  if (envKey) return envKey;

  try {
    const projDir = projectsRoot ? path.resolve(projectsRoot) : path.resolve(rootDir, 'projects');
    if (fs.existsSync(projDir)) {
      const candidates = [];
      for (const sub of fs.readdirSync(projDir)) {
        const cfgPath = path.join(projDir, sub, 'data', 'prompt-config.json');
        if (!fs.existsSync(cfgPath)) continue;
        try {
          const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
          const candidateKey = normalizeSecretKey(cfg.tavilyApiKey);
          if (!candidateKey) continue;
          const parsedTime = Date.parse(cfg.updated_at || '');
          const ts = Number.isFinite(parsedTime) ? parsedTime : fs.statSync(cfgPath).mtimeMs;
          candidates.push({ key: candidateKey, ts: ts || 0 });
        } catch (e) {}
      }
      candidates.sort((a, b) => b.ts - a.ts);
      if (candidates.length > 0) return candidates[0].key;
    }
  } catch (e) {}
  return '';
}

export function getMeowloadApiKey(projectDir, explicitKey = '') {
  if (explicitKey && String(explicitKey).trim()) return String(explicitKey).trim();
  if (projectDir) {
    const configPath = path.join(projectDir, 'data', 'prompt-config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.meowloadApiKey && String(config.meowloadApiKey).trim()) {
          return String(config.meowloadApiKey).trim();
        }
      } catch (e) {}
    }
  }
  if (process.env.MEOWLOAD_API_KEY && String(process.env.MEOWLOAD_API_KEY).trim()) {
    return String(process.env.MEOWLOAD_API_KEY).trim();
  }
  try {
    const projDir = path.resolve(rootDir, 'projects');
    if (fs.existsSync(projDir)) {
      const subs = fs.readdirSync(projDir);
      for (const sub of subs) {
        const cfgPath = path.join(projDir, sub, 'data', 'prompt-config.json');
        if (fs.existsSync(cfgPath)) {
          const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
          if (cfg.meowloadApiKey && String(cfg.meowloadApiKey).trim()) {
            return String(cfg.meowloadApiKey).trim();
          }
        }
      }
    }
  } catch (e) {}
  return '';
}

export async function fetchWriterTavilyResults(query, projectDir) {
  const apiKey = getWriterTavilyKey(projectDir);
  if (!apiKey) throw new Error('未配置 Tavily API Key，请在「AI 写作模型与网关配置」中填写 Tavily Key，或设置 TAVILY_API_KEY');
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30000);
  let response;
  try {
    response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: String(query || '').trim().slice(0, 300), search_depth: 'advanced', include_answer: false, include_raw_content: true, max_results: 6 }),
      signal: ctrl.signal,
    });
  } catch (error) {
    throw new Error(`Tavily 检索失败：${error.name === 'AbortError' ? '请求超时' : error.message}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Tavily 检索失败（HTTP ${response.status}）`);
  const data = await response.json();
  const results = (Array.isArray(data.results) ? data.results : [])
    .filter((item) => item && /^https?:\/\//i.test(String(item.url || '')))
    .map((item) => ({
      title: String(item.title || '').trim(),
      url: String(item.url).trim(),
      content: String(item.content || '').trim().slice(0, 700),
      rawContent: String(item.raw_content || '').trim().slice(0, 2200),
    }));
  if (!results.length) throw new Error('Tavily 未返回带来源链接的检索结果，请调整题目后重试');
  return results;
}

export async function searchWriterTavily(query, projectDir) {
  const results = await fetchWriterTavilyResults(query, projectDir);
  return results.map((item, index) => `${index + 1}. ${item.title || '未命名资料'}\n来源链接：${item.url}\n检索摘要：${item.content || '无摘要'}\n${item.rawContent ? `网页正文摘录：${item.rawContent}` : '未取得网页正文，需要打开原文核查'}`).join('\n\n');
}

export async function researchFactMaterials(title, { model, apiKey, baseUrl, projectDir, tavilyResults: suppliedResults } = {}) {
  const tavilyResults = suppliedResults || await searchWriterTavily(title, projectDir);
  const wikiContext = await fetchWikipediaExtract(title);
  const sys = renderWriterPrompt(projectDir, 'W1_research', {
    title,
    wiki_context: wikiContext || '',
  });
  const user = `【视频选题】：${title}\n\n【Tavily 检索结果（摘要仅供线索，未逐篇核验原文）】\n${tavilyResults}\n\n${wikiContext ? wikiContext : ''}\n请依据检索结果整理资料，逐条保留来源链接与限定条件；不要把摘要当作已经核实的原文。`;
  const text = await callOpenRouterText(sys, user, { model, apiKey, baseUrl, maxTokens: 2500 });
  return text && text.trim() ? text.trim() : `【Tavily 检索结果（待核验）】\n${tavilyResults}`;
}

export async function callOpenRouterText(systemPrompt, userPrompt, { model, apiKey, baseUrl, maxTokens = 3500 } = {}) {
  let curApiKey = (apiKey || process.env.OPENROUTER_API_KEY || '').trim();
  let curBase = (baseUrl || 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '');
  let curModel = (model || 'deepseek/deepseek-chat').trim();

  // 若无显式传入 key，尝试从工程目录中寻找任意已配置的有效 key
  if (!curApiKey) {
    try {
      const projDir = path.resolve('projects');
      if (fs.existsSync(projDir)) {
        const subs = fs.readdirSync(projDir);
        for (const sub of subs) {
          const cfgPath = path.join(projDir, sub, 'data', 'prompt-config.json');
          if (fs.existsSync(cfgPath)) {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            if (cfg.apiKey) {
              curApiKey = cfg.apiKey.trim();
              if (cfg.baseUrl) curBase = cfg.baseUrl.trim().replace(/\/+$/, '');
              if (cfg.textModel && !model) curModel = cfg.textModel.trim();
              break;
            }
          }
        }
      }
    } catch (e) {}
  }

  if (!curApiKey) {
    globalThis.__lastWriterLlmError = '未配置 API Key，请先在「⚙️ AI 模型与网关配置」中填入有效的 API Key';
    return null;
  }

  // 针对 Google 官方端点的模型自适应转换
  let sendModel = curModel;
  if (curBase.includes('googleapis.com')) {
    sendModel = sendModel.replace(/^google\//, '');
    if (!sendModel.startsWith('gemini-') || sendModel.includes('2.5') || sendModel.includes('1.5')) {
      sendModel = 'gemini-flash-lite-latest';
    }
  }

  globalThis.__lastWriterLlmError = '';

  const doChatFetch = async (modelToUse) => {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 90000);
    try {
      return await fetch(`${curBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${curApiKey}`,
          'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
          'X-Title': 'WhyVideo Studio',
        },
        body: JSON.stringify({
          model: modelToUse,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.4,
          max_tokens: maxTokens,
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(tid);
    }
  };

  try {
    let resp = await doChatFetch(sendModel);

    // 针对 Google 端点或 OpenRouter 已下线模型 (404/400/503) 自动平滑降级
    if (!resp.ok && (resp.status === 404 || resp.status === 400 || resp.status === 503)) {
      if (curBase.includes('googleapis.com') && sendModel !== 'gemini-flash-lite-latest') {
        sendModel = 'gemini-flash-lite-latest';
        resp = await doChatFetch(sendModel);
      } else if (curBase.includes('openrouter.ai') && sendModel !== 'deepseek/deepseek-chat') {
        sendModel = 'deepseek/deepseek-chat';
        resp = await doChatFetch(sendModel);
      }
    }

    if (!resp.ok) {
      const err = await resp.text();
      const shortErr = `HTTP ${resp.status}: ${err.slice(0, 180)}`;
      globalThis.__lastWriterLlmError = shortErr;
      console.warn(`[Writer Text Warning] (${sendModel}) ${shortErr}`);
      return null;
    }

    const json = await resp.json();
    const choice = json.choices?.[0];
    const content = choice?.message?.content;
    const text = typeof content === 'string' ? content.trim()
      : Array.isArray(content) ? content.map((part) => typeof part?.text === 'string' ? part.text : '').join('\n').trim() : '';
    if (choice?.finish_reason === 'length') {
      globalThis.__lastWriterLlmError = '模型输出达到长度上限，JSON 可能被截断，请减少单次提取数量后重试';
    } else if (!text) {
      globalThis.__lastWriterLlmError = choice?.message?.refusal
        ? '模型拒绝了本次请求，请调整资料或更换模型后重试'
        : '模型返回了空内容，请重试或更换模型';
    }
    return text;
  } catch (err) {
    globalThis.__lastWriterLlmError = err.name === 'AbortError' ? '请求超时 (90s)' : err.message;
    console.error('[Writer Text Error]:', err);
    return null;
  }
}

// ⏱️ 自然语言时间点与时间段解析工具（支持“第1分5秒到1分15秒”、“01:05~01:15”、“一分五秒到一分十五秒”、“65秒到75秒”等）

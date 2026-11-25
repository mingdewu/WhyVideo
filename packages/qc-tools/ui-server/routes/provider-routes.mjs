import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { getPaths, readBody } from '../lib/config.mjs';
import { getWriterTavilyKey, getMeowloadApiKey } from '../lib/llm-gateway.mjs';

export async function handleProviderRoutes(req, res, { url, pathname, queryProject }) {
  // 4.1 测试各平台 API 连接 (OpenRouter / SiliconFlow / Runway / Remotion)
  if (req.method === 'POST' && (pathname === '/api/test-provider' || pathname === '/api/test-openrouter')) {
    const body = await readBody(req);
    const { provider = 'openrouter', apiKey, baseUrl, model } = body;

    if (!apiKey || !apiKey.trim()) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: false,
        error: '请先填入有效的 API Key'
      }));
    }

    const startTime = Date.now();
    try {
      if (provider === 'siliconflow' || (baseUrl && baseUrl.includes('siliconflow.cn'))) {
        const cleanBase = (baseUrl || 'https://api.siliconflow.cn/v1').trim().replace(/\/+$/, '');
        const testRes = await fetch(`${cleanBase}/models`, {
          signal: AbortSignal.timeout(15000),
          headers: { 'Authorization': `Bearer ${apiKey.trim()}` }
        });
        const latencyMs = Date.now() - startTime;
        if (!testRes.ok) {
          const errText = await testRes.text();
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: false,
            latencyMs,
            error: `SiliconFlow 认证失败 (HTTP ${testRes.status}): ${errText.slice(0, 200)}`
          }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          ok: true,
          latencyMs,
          message: `SiliconFlow (硅基流动) 连接成功！模型网关正常（耗时 ${latencyMs}ms）`
        }));
      } else if (provider === 'runway') {
        const cleanBase = (baseUrl || 'https://api.dev.runwayml.com/v1').trim().replace(/\/+$/, '');
        const testRes = await fetch(`${cleanBase}/tasks`, {
          signal: AbortSignal.timeout(15000),
          headers: {
            'Authorization': `Bearer ${apiKey.trim()}`,
            'X-Runway-Version': '2024-09-13'
          }
        });
        const latencyMs = Date.now() - startTime;
        if (testRes.status === 401 || testRes.status === 403) {
          const errText = await testRes.text();
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: false,
            latencyMs,
            error: `Runway 认证失败 (HTTP ${testRes.status}): ${errText.slice(0, 200)}`
          }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          ok: true,
          latencyMs,
          message: `Runway API 连接正常！耗时 ${latencyMs}ms`
        }));
      } else if (provider === 'gemini' || (baseUrl && baseUrl.includes('generativelanguage.googleapis.com'))) {
        // Google Gemini 官方端点：直接向官方 /models 端点验证 API Key 有效性（零模型依赖）
        const cleanBase = (baseUrl || 'https://generativelanguage.googleapis.com/v1beta').trim().replace(/\/+$/, '');
        const rootBase = cleanBase.replace(/\/openai\/?$/, '');
        const testUrl = `${rootBase}/models?key=${apiKey.trim()}`;

        const testRes = await fetch(testUrl, { signal: AbortSignal.timeout(15000) });
        const latencyMs = Date.now() - startTime;
        if (!testRes.ok) {
          const errText = await testRes.text();
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: false,
            latencyMs,
            error: `Google Gemini 校验未通过 (HTTP ${testRes.status}): ${errText.slice(0, 200)}`,
          }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          ok: true,
          latencyMs,
          message: `Google Gemini 官方 API 连接成功！（密钥有效，耗时 ${latencyMs}ms）`,
        }));
      } else if (provider === 'remotion') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          ok: true,
          latencyMs: 1,
          message: 'Remotion 内置规则引擎零成本就绪，无需 API Key！'
        }));
      } else {
        // OpenRouter
        const cleanBase = (baseUrl || 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '');
        const targetUrl = `${cleanBase}/chat/completions`;
        const testRes = await fetch(targetUrl, {
          method: 'POST',
          signal: AbortSignal.timeout(15000),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey.trim()}`,
            'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
            'X-Title': 'WhyVideo Studio'
          },
          body: JSON.stringify({
            model: (model || 'deepseek/deepseek-chat').trim(),
            messages: [{ role: 'user', content: 'Say "OK" in 1 word' }],
            max_tokens: 5,
          }),
        });

        const latencyMs = Date.now() - startTime;
        if (!testRes.ok) {
          const errText = await testRes.text();
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: false,
            latencyMs,
            error: `OpenRouter 响应异常 (HTTP ${testRes.status}): ${errText.slice(0, 200)}`
          }));
        }

        const data = await testRes.json();
        const reply = data.choices?.[0]?.message?.content?.trim() || 'OK';
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          ok: true,
          latencyMs,
          model: (model || 'deepseek/deepseek-chat').trim(),
          reply,
          message: `OpenRouter 连接成功！模型 ${model || 'deepseek/deepseek-chat'} 响应正常（耗时 ${latencyMs}ms）`
        }));
      }
    } catch (err) {
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: false,
        latencyMs: Date.now() - startTime,
        error: isTimeout ? '连接超时（超过 15 秒未响应），请检查本机网络或代理是否能访问 OpenRouter' : `无法连接到服务: ${err.message}`
      }));
    }
  }

  // 4.12 测试 Tavily API 连接
  if (req.method === 'POST' && pathname === '/api/test-tavily') {
    const body = await readBody(req);
    const curPaths = getPaths(body.projectId || queryProject);
    const rawKey = String(body.apiKey || '').trim();
    const effectiveKey = (rawKey && !/^•+$/.test(rawKey)) ? rawKey : getWriterTavilyKey(curPaths.projectDir);
    if (!effectiveKey) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: '请先填入有效的 Tavily API Key' }));
    }
    const startTime = Date.now();
    try {
      const testRes = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${effectiveKey}`,
        },
        body: JSON.stringify({ query: 'WhyVideo test', search_depth: 'basic', max_results: 1 }),
      });
      const latencyMs = Date.now() - startTime;
      if (!testRes.ok) {
        const errText = await testRes.text();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          ok: false,
          latencyMs,
          error: `Tavily 校验失败 (HTTP ${testRes.status}): ${errText.slice(0, 200)}`,
        }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true,
        latencyMs,
        message: `Tavily 连接成功！（检索接口正常，耗时 ${latencyMs}ms）`,
      }));
    } catch (err) {
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: false,
        latencyMs: Date.now() - startTime,
        error: isTimeout ? 'Tavily 连接超时（15秒），请检查网络或代理设置' : `Tavily 连接失败: ${err.message}`,
      }));
    }
  }

  // 4.13 检测本机 哼哼猫桌面端 (meowload CLI) 连接状态
  if (req.method === 'POST' && pathname === '/api/test-meowload') {
    const startTime = Date.now();
    const candidates = ['/usr/local/bin/meowload', '/opt/homebrew/bin/meowload'];
    let cliPath = candidates.find((p) => fs.existsSync(p)) || '';
    if (!cliPath) {
      const whichRes = spawnSync('which', ['meowload'], { encoding: 'utf8' });
      if (whichRes.status === 0 && whichRes.stdout.trim()) cliPath = whichRes.stdout.trim();
    }
    const latencyMs = Date.now() - startTime;
    if (!cliPath) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: false,
        latencyMs,
        error: '未检测到本机哼哼猫桌面端 CLI (meowload)，请确认已安装并登录本机哼哼猫桌面端',
      }));
    }
    const verRes = spawnSync(cliPath, ['version'], { encoding: 'utf8', timeout: 5000 });
    let verText = '';
    try {
      const parsed = JSON.parse((verRes.stdout || '').trim());
      if (parsed?.version) verText = 'v' + parsed.version;
    } catch (e) {
      verText = (verRes.stdout || verRes.stderr || '').trim().split('\n')[0] || '';
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      ok: true,
      latencyMs: Date.now() - startTime,
      cliPath,
      message: `本机哼哼猫已连接 (${cliPath}${verText ? ' · ' + verText : ''})`,
    }));
  }

  // 4.15 获取 OpenRouter / 当前网关真实支持的最新模型列表
  if (req.method === 'GET' && pathname === '/api/openrouter-models') {
    const curPaths = getPaths(queryProject);
    let savedCfg = {};
    if (fs.existsSync(curPaths.promptConfigPath)) {
      try { savedCfg = JSON.parse(fs.readFileSync(curPaths.promptConfigPath, 'utf8')) || {}; } catch (e) {}
    }
    const reqKey = String(url.searchParams.get('apiKey') || savedCfg.apiKey || process.env.OPENROUTER_API_KEY || '').trim();
    const rawBaseUrl = String(url.searchParams.get('baseUrl') || savedCfg.baseUrl || 'https://openrouter.ai/api/v1').trim();
    const cleanBase = (rawBaseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
    const priorityPrefixes = ['deepseek/', 'google/', 'anthropic/', 'openai/', 'qwen/', 'meta-llama/', 'x-ai/', 'mistralai/'];
    const rankOf = (id) => {
      const idx = priorityPrefixes.findIndex((p) => String(id || '').startsWith(p));
      return idx === -1 ? 99 : idx;
    };
    const normalizeAndSort = (rawItems, stripModelsPrefix = false) =>
      (Array.isArray(rawItems) ? rawItems : [])
        .map((m) => {
          let id = String(m?.id || m?.name || '').trim();
          if (stripModelsPrefix && id.startsWith('models/')) id = id.slice('models/'.length);
          const rawName = String(m?.displayName || m?.name || id).trim();
          const desc = String(m?.description || '').trim().slice(0, 80);
          const inputModalities = Array.isArray(m?.architecture?.input_modalities)
            ? m.architecture.input_modalities
            : [];
          const supports_audio = inputModalities.length > 0
            ? inputModalities.includes('audio')
            : (stripModelsPrefix ? /^gemini-(1\.5|2\.|3\.)/i.test(id) && !/embedding|imagen|veo|aqa/i.test(id) : false);
          return {
            id,
            name: rawName || id,
            description: desc,
            context_length: m?.context_length || m?.inputTokenLimit || null,
            input_modalities: inputModalities,
            supports_audio,
          };
        })
        .filter((m) => m.id)
        .sort((a, b) => rankOf(a.id) - rankOf(b.id) || String(a.id).localeCompare(String(b.id)));

    let lastErr = '';

    // 若配置了非 OpenRouter 的自定义/官方 OpenAI 兼容网关且具备 Key，优先请求该网关 /models
    if (!cleanBase.includes('openrouter.ai') && reqKey) {
      try {
        const gwRes = await fetch(`${cleanBase}/models`, {
          signal: AbortSignal.timeout(15000),
          headers: {
            Authorization: `Bearer ${reqKey}`,
            'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
            'X-Title': 'WhyVideo Studio',
          },
        });
        if (gwRes.ok) {
          const gwJson = await gwRes.json();
          const rawList = gwJson.data || gwJson.models || [];
          const list = normalizeAndSort(rawList, cleanBase.includes('googleapis.com'));
          if (list.length > 0) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
              ok: true,
              source: 'live',
              gateway: cleanBase.includes('googleapis.com') ? 'gemini' : 'custom',
              count: list.length,
              models: list,
            }));
          }
        } else {
          lastErr = `网关 HTTP ${gwRes.status}`;
        }
      } catch (e) {
        lastErr = e.message;
      }
    }

    // 默认拉取 OpenRouter 全量文本模型目录
    try {
      const headers = {
        'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
        'X-Title': 'WhyVideo Studio',
      };
      if (reqKey && reqKey.startsWith('sk-or-')) {
        headers['Authorization'] = `Bearer ${reqKey}`;
      }
      const resModels = await fetch('https://openrouter.ai/api/v1/models', {
        signal: AbortSignal.timeout(15000),
        headers,
      });
      if (resModels.ok) {
        const mJson = await resModels.json();
        const list = normalizeAndSort(mJson.data || []);
        if (list.length > 0) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: true,
            source: 'live',
            gateway: 'openrouter',
            count: list.length,
            models: list,
          }));
        }
        lastErr = 'OpenRouter 返回空模型列表';
      } else {
        lastErr = `OpenRouter HTTP ${resModels.status}`;
      }
    } catch (e) {
      lastErr = e.message;
      console.error('Failed to fetch openrouter models:', e.message);
    }

    const fallbackModels = [
      { id: 'google/gemini-2.5-flash', name: 'Google Gemini 2.5 Flash', supports_audio: true, input_modalities: ['text', 'image', 'audio'] },
      { id: 'google/gemini-2.5-pro', name: 'Google Gemini 2.5 Pro', supports_audio: true, input_modalities: ['text', 'image', 'audio'] },
      { id: 'openai/gpt-4o-audio-preview', name: 'OpenAI GPT-4o Audio Preview', supports_audio: true, input_modalities: ['text', 'audio'] },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', supports_audio: false, input_modalities: ['text'] },
      { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic Claude Sonnet 4.5', supports_audio: false, input_modalities: ['text', 'image'] },
      { id: 'openai/gpt-4o-mini', name: 'OpenAI GPT-4o Mini', supports_audio: false, input_modalities: ['text', 'image'] },
      { id: 'google/gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image', supports_audio: false, input_modalities: ['text', 'image'] },
    ];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      ok: true,
      source: 'fallback',
      gateway: 'fallback',
      count: fallbackModels.length,
      error: lastErr || '无法连接在线模型目录',
      models: fallbackModels,
    }));
  }

  // 4.16 获取 OpenRouter 原生支持的全部 AI 视频生成模型列表
  if (req.method === 'GET' && pathname === '/api/openrouter-video-models') {
    const curPaths = getPaths(queryProject);
    let savedKey = '';
    if (fs.existsSync(curPaths.promptConfigPath)) {
      try { savedKey = JSON.parse(fs.readFileSync(curPaths.promptConfigPath, 'utf8'))?.apiKey || ''; } catch (e) {}
    }
    const reqKey = String(url.searchParams.get('apiKey') || savedKey || process.env.OPENROUTER_API_KEY || '').trim();
    let lastErr = '';
    try {
      const headers = {
        'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
        'X-Title': 'WhyVideo Studio',
      };
      if (reqKey && reqKey.startsWith('sk-or-')) {
        headers['Authorization'] = `Bearer ${reqKey}`;
      }
      const resModels = await fetch('https://openrouter.ai/api/v1/videos/models', {
        signal: AbortSignal.timeout(15000),
        headers,
      });
      if (resModels.ok) {
        const mJson = await resModels.json();
        const list = (mJson.data || [])
          .map((m) => ({
            id: m.id,
            name: m.name || m.id,
            description: m.description ? m.description.slice(0, 100) : '',
            durations: m.supported_durations,
            aspect_ratios: m.supported_aspect_ratios,
          }))
          .filter((m) => m.id)
          .sort((a, b) => String(a.id).localeCompare(String(b.id)));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, source: 'live', count: list.length, models: list }));
      }
      lastErr = `OpenRouter HTTP ${resModels.status}`;
    } catch (e) {
      lastErr = e.message;
      console.error('Failed to fetch openrouter video models:', e.message);
    }
    const fallbackVideoModels = [
      { id: 'minimax/hailuo-3-max', name: 'MiniMax: H3 Max' },
      { id: 'minimax/hailuo-3', name: 'MiniMax: H3 (海螺视频 3)' },
      { id: 'bytedance/seedance-2.0', name: 'ByteDance: Seedance 2.0' },
      { id: 'alibaba/wan-2.6', name: 'Alibaba: Wan 2.6' },
      { id: 'kwaivgi/kling-v3.0-std', name: 'Kling: Video v3.0 Standard' },
      { id: 'google/veo-3.1-fast', name: 'Google: Veo 3.1 Fast' },
      { id: 'runway/gen-4.5', name: 'Runway: Gen-4.5' },
    ];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, source: 'fallback', count: fallbackVideoModels.length, error: lastErr, models: fallbackVideoModels }));
  }

  // 4.17 获取 OpenRouter 原生支持的全部 AI 生图模型列表
  if (req.method === 'GET' && pathname === '/api/openrouter-image-models') {
    const curPaths = getPaths(queryProject);
    let savedKey = '';
    if (fs.existsSync(curPaths.promptConfigPath)) {
      try { savedKey = JSON.parse(fs.readFileSync(curPaths.promptConfigPath, 'utf8'))?.apiKey || ''; } catch (e) {}
    }
    const reqKey = String(url.searchParams.get('apiKey') || savedKey || process.env.OPENROUTER_API_KEY || '').trim();
    let lastErr = '';
    try {
      const headers = {
        'HTTP-Referer': 'https://github.com/mingdewu/WhyVideo',
        'X-Title': 'WhyVideo Studio',
      };
      if (reqKey && reqKey.startsWith('sk-or-')) {
        headers['Authorization'] = `Bearer ${reqKey}`;
      }
      const resModels = await fetch('https://openrouter.ai/api/v1/images/models', {
        signal: AbortSignal.timeout(15000),
        headers,
      });
      if (resModels.ok) {
        const mJson = await resModels.json();
        const list = (mJson.data || [])
          .map((m) => ({
            id: m.id,
            name: m.name || m.id,
            description: m.description ? m.description.slice(0, 100) : '',
          }))
          .filter((m) => m.id)
          .sort((a, b) => String(a.id).localeCompare(String(b.id)));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, source: 'live', count: list.length, models: list }));
      }
      lastErr = `OpenRouter HTTP ${resModels.status}`;
    } catch (e) {
      lastErr = e.message;
      console.error('Failed to fetch openrouter image models:', e.message);
    }
    const fallbackImageModels = [
      { id: 'black-forest-labs/flux-3-image', name: 'FLUX 3 Image' },
      { id: 'black-forest-labs/flux.2-max', name: 'FLUX.2 Max' },
      { id: 'recraft/recraft-v4.1', name: 'Recraft V4.1' },
      { id: 'google/gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image' },
      { id: 'openai/gpt-image-2', name: 'GPT Image 2' },
    ];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, source: 'fallback', count: fallbackImageModels.length, error: lastErr, models: fallbackImageModels }));
  }

  // 4.2 保存模型网关配置 (统一 OpenRouter / 网关多模型映射)
  if (req.method === 'POST' && (pathname === '/api/save-visual-config' || pathname === '/api/save-openrouter-config')) {
    const body = await readBody(req);
    const targetProject = body.projectId || queryProject;
    const curPaths = getPaths(targetProject);
    let existing = {};
    if (fs.existsSync(curPaths.promptConfigPath)) {
      try { existing = JSON.parse(fs.readFileSync(curPaths.promptConfigPath, 'utf8')); } catch (e) {}
    }
    const rawTavily = typeof body.tavilyApiKey === 'string' ? body.tavilyApiKey.trim() : '';
    const updated = {
      ...existing,
      provider: 'openrouter',
      baseUrl: body.baseUrl || existing.baseUrl || 'https://openrouter.ai/api/v1',
      apiKey: body.apiKey !== undefined ? body.apiKey : (existing.apiKey || ''),
      tavilyApiKey: (rawTavily && !/^•+$/.test(rawTavily))
        ? rawTavily : (existing.tavilyApiKey || getWriterTavilyKey(curPaths.projectDir)),
      meowloadApiKey: typeof body.meowloadApiKey === 'string' && body.meowloadApiKey.trim()
        ? body.meowloadApiKey.trim() : (existing.meowloadApiKey || ''),
      writerModel: body.writerModel || existing.writerModel || 'deepseek/deepseek-chat',
      textModel: body.textModel || body.model || existing.textModel || 'deepseek/deepseek-chat',
      keywordModel: body.keywordModel || existing.keywordModel || body.textModel || existing.textModel || 'deepseek/deepseek-chat',
      videoModel: body.videoModel || existing.videoModel || 'minimax/hailuo-3-max',
      imageModel: body.imageModel || existing.imageModel || 'black-forest-labs/flux-3-image',
      bgmModel: body.bgmModel || existing.bgmModel || 'google/gemini-2.5-flash',
      model: body.textModel || body.model || existing.textModel || 'deepseek/deepseek-chat',
      selected_visual_model: 'openrouter',
      updated_at: new Date().toISOString()
    };

    fs.writeFileSync(curPaths.promptConfigPath, JSON.stringify(updated, null, 2), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      ok: true,
      config: {
        ...updated,
        tavilyApiKey: undefined,
        tavilyKeyConfigured: Boolean(getWriterTavilyKey(curPaths.projectDir, updated.tavilyApiKey)),
        meowloadApiKey: undefined,
        meowloadKeyConfigured: Boolean(getMeowloadApiKey(curPaths.projectDir, updated.meowloadApiKey)),
      },
      message: '模型网关配置已保存！'
    }));
  }

  return false;
}

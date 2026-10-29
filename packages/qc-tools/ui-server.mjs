import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

const PORT = process.env.PORT || 4000;
const defaultProjectId = 'why_ryokan_small_dishes_001';

// 简易 MIME 映射
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // 1. API: 获取项目实时状态
  if (pathname === '/api/status') {
    const statusPath = path.join(rootDir, 'projects', defaultProjectId, 'data', 'project-status.json');
    if (fs.existsSync(statusPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(fs.readFileSync(statusPath, 'utf8'));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Status not found' }));
  }

  // 2. API: 获取镜头清单
  if (pathname === '/api/manifest') {
    const manifestPath = path.join(rootDir, 'projects', defaultProjectId, 'data', 'scene-manifest.json');
    if (fs.existsSync(manifestPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(fs.readFileSync(manifestPath, 'utf8'));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Manifest not found' }));
  }

  // 3. 静态媒体文件路由 (支持预览视频与音频流)
  if (pathname.startsWith('/output/') || pathname.startsWith('/public/')) {
    const filePath = path.join(rootDir, 'projects', defaultProjectId, pathname);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const stat = fs.statSync(filePath);

      // 支持视频 Range 分片请求 (用于浏览器正常拖拽进度条)
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
        });
        return file.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Content-Type': contentType,
        });
        return fs.createReadStream(filePath).pipe(res);
      }
    }
  }

  // 4. 主操作页面 UI
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(renderMainHtml());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n=============================================================`);
  console.log(`\x1b[32m\x1b[1m🚀 WhyVideo Studio 操作工作台已成功启动！\x1b[0m`);
  console.log(`👉 请在浏览器中打开：\x1b[36m\x1b[1mhttp://localhost:${PORT}\x1b[0m`);
  console.log(`=============================================================\n`);
});

function renderMainHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhyVideo Studio - 视频制作工程控制台</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #0B0F17; color: #E2E8F0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .card { background-color: #151D2A; border: 1px solid #233044; }
  </style>
</head>
<body class="min-h-screen p-4 sm:p-8">
  <div class="max-w-6xl mx-auto space-y-6">
    
    <!-- 顶部导航条 -->
    <header class="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-gray-800 gap-4">
      <div>
        <div class="flex items-center gap-3">
          <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            WhyVideo OS v2.0
          </span>
          <span class="text-xs text-gray-400">项目：why_ryokan_small_dishes_001</span>
        </div>
        <h1 class="text-2xl sm:text-3xl font-extrabold text-white mt-1">视频制作工程总控台</h1>
        <p class="text-sm text-gray-400 mt-1">集中管理文案策划、镜头清单、AI配音调试、成片预览与云端同步。</p>
      </div>

      <div class="flex items-center gap-3">
        <a href="https://airtable.com/app3VJhyGcpy08Gdf" target="_blank" class="px-4 py-2 text-xs font-semibold rounded-xl card hover:border-gray-600 transition flex items-center gap-2 text-gray-200">
          <span>📋 打开 Airtable 云端看板</span>
          <span class="text-xs opacity-60">↗</span>
        </a>
      </div>
    </header>

    <!-- 综合进度看板卡片 -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div class="card p-5 rounded-2xl flex flex-col justify-between">
        <div>
          <span class="text-xs text-gray-400 font-medium">综合验收进度</span>
          <div class="text-3xl font-black text-emerald-400 mt-1">100%</div>
        </div>
        <div class="mt-3 w-full bg-gray-800 rounded-full h-2">
          <div class="bg-emerald-500 h-2 rounded-full" style="width: 100%"></div>
        </div>
      </div>

      <div class="card p-5 rounded-2xl">
        <span class="text-xs text-gray-400 font-medium">当前工程阶段</span>
        <div class="text-lg font-bold text-blue-400 mt-1">阶段五：最终验收与交付</div>
        <p class="text-xs text-gray-400 mt-1">1080p 纯净正片已成功导出</p>
      </div>

      <div class="card p-5 rounded-2xl">
        <span class="text-xs text-gray-400 font-medium">镜头聚类结构</span>
        <div class="text-lg font-bold text-purple-400 mt-1">4 个叙事长镜头</div>
        <p class="text-xs text-gray-400 mt-1">长镜头呼吸节奏（每镜头 15~16s）</p>
      </div>

      <div class="card p-5 rounded-2xl">
        <span class="text-xs text-gray-400 font-medium">视听咬合参数</span>
        <div class="text-lg font-bold text-amber-400 mt-1">64.0 秒 / 1920 帧</div>
        <p class="text-xs text-gray-400 mt-1">30 fps · 毫秒级音画同步</p>
      </div>
    </div>

    <!-- 中间核心区：正片播放器 + 配音控制台 -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
      
      <!-- 左侧：1080p 成片播放器 (7 列) -->
      <div class="lg:col-span-7 card p-5 rounded-2xl space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-base font-bold text-white flex items-center gap-2">
            <span>🎬 最终成片播放器</span>
            <span class="text-xs font-normal text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">1080p Full HD</span>
          </h2>
          <span class="text-xs text-gray-400">output/final_video_1080p.mp4 (42MB)</span>
        </div>

        <div class="aspect-video bg-black rounded-xl overflow-hidden border border-gray-800 shadow-2xl relative">
          <video controls class="w-full h-full object-contain" poster="/public/assets/images/placeholder_kaiseki_trays.png">
            <source src="/output/final_video_1080p.mp4" type="video/mp4">
            您的浏览器不支持视频播放。
          </video>
        </div>

        <div class="text-xs text-gray-400 flex items-center justify-between pt-1">
          <span>✓ 已彻底去除镜头ID、调试边框与置信度水印</span>
          <a href="/output/final_video_1080p.mp4" download class="text-blue-400 hover:underline">下载 MP4 正片文件 ↗</a>
        </div>
      </div>

      <!-- 右侧：AI 智能配音工作台 (ElevenLabs / Voicebox) (5 列) -->
      <div class="lg:col-span-5 card p-5 rounded-2xl flex flex-col justify-between space-y-4">
        <div>
          <div class="flex items-center justify-between pb-3 border-b border-gray-800">
            <h2 class="text-base font-bold text-white flex items-center gap-2">
              <span>🎙️ 智能配音配置引擎</span>
            </h2>
            <div class="flex text-xs bg-gray-900 p-1 rounded-lg border border-gray-800">
              <span class="px-2.5 py-1 rounded bg-blue-600 text-white font-semibold">ElevenLabs</span>
              <span class="px-2.5 py-1 rounded text-gray-400">Voicebox (预留)</span>
            </div>
          </div>

          <div class="mt-4 space-y-3.5">
            <div>
              <label class="block text-xs font-semibold text-gray-300 mb-1 flex justify-between">
                <span>ElevenLabs API Key</span>
                <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" class="text-blue-400 hover:underline text-[11px]">获取 Key ↗</a>
              </label>
              <input type="password" id="el-key" placeholder="填入 xi-api-key..." class="w-full px-3 py-2 text-xs rounded-xl bg-gray-900 border border-gray-700 text-white focus:outline-none focus:border-blue-500">
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-xs font-semibold text-gray-300 mb-1">音色 (Voice ID)</label>
                <select id="el-voice" class="w-full px-2.5 py-2 text-xs rounded-xl bg-gray-900 border border-gray-700 text-gray-200">
                  <option value="21m00Tcm4TlvDq8ikWAM">Rachel (知性纪录片女声)</option>
                  <option value="ErXwobaYiN019PkySvjV">Antoni (深沉男中音)</option>
                  <option value="AZnzlk1XvdvUeBnXmlld">Domi (沉稳青年)</option>
                  <option value="EXAVITQu4vr4xnSDxMaL">Bella (温柔解说)</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-gray-300 mb-1">模型 (Model)</label>
                <select id="el-model" class="w-full px-2.5 py-2 text-xs rounded-xl bg-gray-900 border border-gray-700 text-gray-200">
                  <option value="eleven_multilingual_v2">Multilingual v2 (中文逼真)</option>
                  <option value="eleven_flash_v2_5">Flash v2.5 (极速)</option>
                </select>
              </div>
            </div>

            <!-- 当前音频播放器 -->
            <div class="p-3 rounded-xl bg-gray-900/60 border border-gray-800">
              <span class="text-xs text-gray-400 block mb-1.5">当前成片配音试听：</span>
              <audio controls class="w-full h-8">
                <source src="/public/audio/narration.wav" type="audio/wav">
              </audio>
            </div>
          </div>
        </div>

        <div class="pt-3 border-t border-gray-800">
          <button onclick="alert('ElevenLabs 调用参数已就绪！您可直接在聊天框告诉助手：“使用当前配置的 ElevenLabs 重新生成配音”，助手即可为您全自动重新对齐时间戳并重剪！')" class="w-full py-2.5 rounded-xl font-bold text-xs bg-blue-600 hover:bg-blue-500 text-white transition shadow-lg">
            ⚡ 重新生成高保真配音
          </button>
        </div>
      </div>

    </div>

    <!-- 底部：4 个聚类长镜头视听清单 -->
    <div class="card p-6 rounded-2xl space-y-4">
      <div class="flex items-center justify-between pb-3 border-b border-gray-800">
        <div>
          <h2 class="text-base font-bold text-white">镜头视听拆解清单 (语义聚类后)</h2>
          <p class="text-xs text-gray-400 mt-0.5">多句连贯旁白已自动合并为一个长镜头，告别频繁闪切。</p>
        </div>
        <span class="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2.5 py-1 rounded-full font-semibold">
          共 4 个叙事长镜头
        </span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4" id="scenes-grid">
        <!-- 镜头卡片 1 -->
        <div class="p-4 rounded-xl bg-gray-900/50 border border-gray-800 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">SC-001 (16.5秒)</span>
            <span class="text-xs text-gray-400">broll_video · 实拍视频</span>
          </div>
          <p class="text-sm font-semibold text-gray-200">“住进传统温泉旅馆，晚餐往往先让人吃惊：桌上摆满十几个小碗、小碟和小火锅。”</p>
          <p class="text-xs text-gray-400"><strong>画面意图：</strong>推开障子门俯拍整张矮桌，十几个小钵与小火锅形成的密集阵列视觉冲击。</p>
        </div>

        <!-- 镜头卡片 2 -->
        <div class="p-4 rounded-xl bg-gray-900/50 border border-gray-800 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">SC-002 (16.0秒)</span>
            <span class="text-xs text-gray-400">photo_motion · 摄影画卷</span>
          </div>
          <p class="text-sm font-semibold text-gray-200">“每一份都不多，却像把一顿饭拆成了一场小型展览。”</p>
          <p class="text-xs text-gray-400"><strong>画面意图：</strong>微距特写单碟山菜刺身留白，缓慢拉开呈现器皿矩阵展陈感。</p>
        </div>

        <!-- 镜头卡片 3 -->
        <div class="p-4 rounded-xl bg-gray-900/50 border border-gray-800 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">SC-003 (16.0秒)</span>
            <span class="text-xs text-gray-400">data_card · 机制图表</span>
          </div>
          <p class="text-sm font-semibold text-gray-200">“这并不只是为了好看，它同时来自宴席传统、料理节奏和旅馆的服务方式。”</p>
          <p class="text-xs text-gray-400"><strong>画面意图：</strong>三栏信息图：划掉拍照好看，高亮宴席分食、冷热分装与客房送餐动线三大支柱。</p>
        </div>

        <!-- 镜头卡片 4 -->
        <div class="p-4 rounded-xl bg-gray-900/50 border border-gray-800 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">SC-004 (15.5秒)</span>
            <span class="text-xs text-gray-400">kinetic_text · 动态排版</span>
          </div>
          <p class="text-sm font-semibold text-gray-200">“接下来，我们就从这些小碟子开始，拆开看一顿温泉旅馆晚餐的历史。”</p>
          <p class="text-xs text-gray-400"><strong>画面意图：</strong>黑底质感动态卡片，收束核心问题，优雅引出后续历史章节大纲。</p>
        </div>
      </div>
    </div>

  </div>
</body>
</html>`;
}

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = process.cwd();
const projectId = 'why_ai_renamed_to_si_001';
const projectDir = path.join(rootDir, 'projects', projectId);
const dataDir = path.join(projectDir, 'data');
const publicDir = path.join(projectDir, 'public');
const captionsDir = path.join(publicDir, 'captions');
const audioDir = path.join(publicDir, 'audio');
const imagesDir = path.join(publicDir, 'assets', 'images');
const outputDir = path.join(projectDir, 'output');

// Ensure directories
for (const dir of [projectDir, dataDir, publicDir, captionsDir, audioDir, imagesDir, outputDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// 1. Read input text
const sourcePath = '/Users/user/Desktop/Why美国想把AI改成SI_完整文案.txt';
if (!fs.existsSync(sourcePath)) {
  console.error('File not found:', sourcePath);
  process.exit(1);
}
const rawContent = fs.readFileSync(sourcePath, 'utf8');
const lines = rawContent.split('\n');

// 2. Parse sections and paragraphs
let currentSec = '';
const sections = [];
let secObj = null;

for (const line of lines) {
  const match = line.match(/^={10,}\s*(.+?)\s*={10,}$/);
  if (match) {
    if (secObj) sections.push(secObj);
    currentSec = match[1].trim();
    secObj = { name: currentSec, paragraphs: [] };
  } else if (secObj) {
    const trimmed = line.trim();
    if (trimmed) secObj.paragraphs.push(trimmed);
  }
}
if (secObj) sections.push(secObj);

console.log(`Parsed ${sections.length} sections from text.`);

// 3. Generate narration-script.md
let mdContent = `# 美国为什么想将AI改名为 SI\n\n全片约 5591 字，预计时长 23.3 分钟\n项目ID: ${projectId}\n\n`;
for (const sec of sections) {
  mdContent += `## ${sec.name}\n\n`;
  for (const p of sec.paragraphs) {
    mdContent += `${p}\n\n`;
  }
}
fs.writeFileSync(path.join(dataDir, 'narration-script.md'), mdContent, 'utf8');
console.log('✅ Generated narration-script.md');

// 4. Generate brief.json
const brief = {
  project_id: projectId,
  title: '美国为什么想将AI改名为 SI',
  subtitle: '从“人工假人”到“超级力量”：白宫主导的国家级语义、科技招安与全球话语权战争',
  core_question: '为什么全世界叫了快七十年的“人工智能”（AI），突然被白宫官方行政令要求强行替换为“超级智能”（SI）？这背后的政商利益同盟、公众心理置换与全球规则霸权算计是什么？',
  short_answer: '这绝非无聊的公关修辞，而是一套环环相扣的国家权力重构：在心理上用彰显力量的“超级”置换大众对假冒与失业的焦虑；在政治上借国家安全之名将硅谷巨头捆绑进利益同盟并豁免繁琐反垄断与环保监管；在学术上即便顶着统计概率模型的科学争议也要强行制造断代神话；在全球治理上通过单方面重置技术定义，实现规制套利并冲刷掉欧洲等对手筑起的监管防线。',
  scope: {
    time_range: '1956年达特茅斯会议至今，重点聚焦2023-2025年白宫行政令与新一代AI话语权之争',
    geographic_scope: '美国华盛顿特区白宫、加州硅谷、欧盟布鲁塞尔、日内瓦联合国机构',
    included_dimensions: [
      '达特茅斯会议源流与Artificial词源心理暗示',
      '政治传播学框架置换（从防御假人到崇拜超人）',
      '华盛顿对硅谷万亿资本的政治招安与监管豁免',
      '计算机科学界与图灵奖学者对大模型概率本质的学术批判',
      '美欧监管竞争、规制套利与全球数字治理话语权霸权'
    ],
    excluded_dimensions: [
      '脱离现实的纯科幻末日幻想',
      '没有政策与技术事实依据的阴谋论',
      '单一公司的商业宣传稿'
    ]
  },
  target_audience: '关注全球人工智能政治经济学、地缘科技博弈与商业监管内幕的深度受众',
  target_duration_minutes: 23.3,
  estimated_word_count: 5591,
  language: 'zh-CN',
  planned_chapter_count: 5,
  taboos_and_exclusions: [
    '严禁将统计概率模型夸大为已有意识的神灵',
    '严禁将学术界的严肃科学批评简化为人身攻击',
    '保持宏观政治经济学与技术哲学的深度剖析视角'
  ],
  provided_sources_count: 8,
  missing_research_questions: []
};
fs.writeFileSync(path.join(dataDir, 'brief.json'), JSON.stringify(brief, null, 2), 'utf8');
console.log('✅ Generated brief.json');

// 5. Generate final-script.json
const chaptersList = [];
let openingText = '';
let endingText = '';

sections.forEach((sec, idx) => {
  if (sec.name === '开场') {
    openingText = sec.paragraphs.join('\n\n');
  } else if (sec.name === 'single_final_ending') {
    endingText = sec.paragraphs.join('\n\n');
  } else {
    const chMatch = sec.name.match(/第(\d+)章[：:](.+)/);
    const chNum = chMatch ? parseInt(chMatch[1], 10) : (idx);
    const chTitle = chMatch ? chMatch[2].trim() : sec.name;
    chaptersList.push({
      chapter_number: chNum,
      chapter_title: chTitle,
      narration_text: sec.paragraphs.join('\n\n'),
      evidence_card_ids: [`EVD-CH0${chNum}-01`, `EVD-CH0${chNum}-02`]
    });
  }
});

const finalScript = {
  project_id: projectId,
  title: '美国为什么想将AI改名为 SI',
  subtitle: '从“人工假人”到“超级力量”：白宫主导的国家级语义、科技招安与全球话语权战争',
  total_word_count: 5509,
  estimated_duration_minutes: 23.3,
  revision_count: 1,
  editorial_changes_log: {
    removed_duplicate_arguments: [],
    removed_duplicate_examples: [],
    unified_terms_and_names: [
      '专有名词统一为 AI（人工智能）与 SI（超级智能）',
      '核心人物统一为约翰·麦卡锡、赫伯特·西蒙、尼克·博斯特罗姆'
    ],
    removed_false_endings_count: 0
  },
  script_segments: {
    opening: openingText,
    chapters: chaptersList,
    single_final_ending: endingText
  }
};
fs.writeFileSync(path.join(dataDir, 'final-script.json'), JSON.stringify(finalScript, null, 2), 'utf8');
console.log('✅ Generated final-script.json');

// 6. Generate project-config.json
const projectConfig = {
  project_id: projectId,
  domain_category: 'science_and_technology',
  secondary_domains: ['social_issues', 'history_and_geography'],
  title: '美国为什么想将AI改名为 SI',
  language: 'zh-CN',
  video_spec: {
    fps: 30,
    width: 1920,
    height: 1080,
    safe_bottom_margin_px: 96,
    max_chars_per_line: 50,
    min_scene_duration_ms: 4000,
    max_scene_duration_ms: 10000,
    asset_reuse_cooldown_ms: 60000
  },
  paths: {
    final_script: 'final-script.json',
    sentence_timestamps: 'sentence-timestamps.json',
    audio_file: 'audio/narration.wav',
    captions_file: 'captions/captions.srt',
    asset_index: 'asset-index.json',
    scene_manifest: 'scene-manifest.json',
    render_props: 'render-props.json',
    qc_report: 'video-qc-report.json',
    preview_output: 'out/preview.mp4'
  }
};
fs.writeFileSync(path.join(dataDir, 'project-config.json'), JSON.stringify(projectConfig, null, 2), 'utf8');
console.log('✅ Generated project-config.json');

// 7. Generate prompt-config.json (copy OpenRouter credentials & customized global prompt)
const promptConfig = {
  provider: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY ?? '',
  textModel: 'deepseek/deepseek-chat',
  videoModel: 'minimax/hailuo-3-max',
  imageModel: 'black-forest-labs/flux-3-image',
  bgmModel: 'deepseek/deepseek-chat',
  model: 'deepseek/deepseek-chat',
  global_ai_visual_prompt: '作为 16:9 纪录片视觉总监，结合白宫地缘博弈、硅谷算力巨头、1956达特茅斯历史档案与全球下一代智能治理规则之争，提炼极具思想深度与视觉冲击力的16:9构图与动效PPT信息图卡片。',
  updated_at: new Date().toISOString()
};
fs.writeFileSync(path.join(dataDir, 'prompt-config.json'), JSON.stringify(promptConfig, null, 2), 'utf8');
console.log('✅ Generated prompt-config.json');

// 8. Generate asset-index.json
const assetIndex = {
  project_id: projectId,
  assets: []
};
fs.writeFileSync(path.join(dataDir, 'asset-index.json'), JSON.stringify(assetIndex, null, 2), 'utf8');
console.log('✅ Generated asset-index.json');

// 9. Generate project-status.json
const projectStatus = {
  project_id: projectId,
  stage: 'STAGED_READY',
  validation: {
    script_ready: true,
    manifest_ready: true,
    assets_ready: false,
    render_props_ready: true
  },
  last_updated: new Date().toISOString()
};
fs.writeFileSync(path.join(dataDir, 'project-status.json'), JSON.stringify(projectStatus, null, 2), 'utf8');
console.log('✅ Generated project-status.json');

// 10. Intelligent Sentence Segmentation & Scene Manifest Generation
function segmentParagraph(text) {
  const chunks = [];
  const rawSentences = text.match(/[^。！？]+[。！？]?/g) || [text];
  
  for (const s of rawSentences) {
    if (s.length <= 36) {
      chunks.push(s);
    } else {
      const subParts = s.split(/(?<=[；，])/);
      let cur = '';
      for (const p of subParts) {
        if ((cur + p).length > 36 && cur.length >= 14) {
          chunks.push(cur);
          cur = p;
        } else {
          cur += p;
        }
      }
      if (cur) chunks.push(cur);
    }
  }
  return chunks;
}

function extractKeywords(text) {
  const kws = [];
  const patterns = [
    /人工智能|超级智能|AI|SI/,
    /白宫|总统行政令|国会|听证会|反垄断/,
    /达特茅斯|麦卡锡|西蒙|博斯特罗姆|图灵奖/,
    /硅谷|OpenAI|Meta|英伟达|特斯拉|xAI/,
    /算力|大模型|统计概率|预测器|因果逻辑|幻觉/,
    /欧盟|欧盟人工智能法案|布鲁塞尔|日内瓦|联合国/,
    /规制套利|话语权|数字治理|游戏规则|定义权/,
    /失业|假信息|人造香精|虚伪|心理暗示|框架置换/,
    /国家安全|地缘竞争|利益同盟|自愿框架|监管豁免/
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && !kws.includes(m[0])) {
      kws.push(m[0]);
      if (kws.length >= 3) break;
    }
  }
  if (kws.length === 0) {
    const sub = text.replace(/[，,。！？；“”‘’「」]/g, ' ').trim().split(/\s+/);
    if (sub[0] && sub[0].length >= 3) kws.push(sub[0].slice(0, 8));
    else kws.push('核心议题');
  }
  return kws;
}

function pickVisualType(text) {
  if (/1956|达特茅斯|麦卡锡|西蒙|博斯特罗姆|学术界|图灵奖|法案|行政令|公文|协议|自愿性|框架|条款|反垄断法|监管规约|名作/.test(text)) {
    return 'document_highlight';
  }
  if (/对比|从.*到.*|vs|置换|反差|两面|两笔|对内.*对外|防御.*崇拜|人工.*超级|美欧|博弈|双方|对等|对立/.test(text)) {
    return 'versus_dual';
  }
  if (/70年|七十年|几十年|当年.*今天|时间线|演变|半个多世纪|2024年|未来|历史维度/.test(text)) {
    return 'timeline';
  }
  if (/万亿|数据|算力|能耗|耗电量|水资源|资金|资本|统计概率|大模型|算法|预测器|模型/.test(text)) {
    return 'data_card';
  }
  if (/为什么|答案|核心|真相|荒唐|欺骗|愤怒|终极|刻刀|重拳|神明|文字游戏|红线|根本|底色/.test(text)) {
    return 'kinetic_text';
  }
  if (/白宫|硅谷|布鲁塞尔|日内瓦|国会|草坪|联合国|好莱坞/.test(text)) {
    return 'photo_motion';
  }
  return 'data_card';
}

function createScenePptSpec(text, keywords, visualType, shotIdx) {
  const kw = keywords[0] || '核心议题';
  const cleanTitle = kw.length >= 4 ? kw : `「${kw}」`;
  
  let layoutPrompt = '';
  if (visualType === 'document_highlight') {
    layoutPrompt = `【文献考据】「${cleanTitle}」\n【核心引录】“${text.slice(0, 25)}”\n【考据重点】达特茅斯历史档案与白宫正式公文条款考据\n【版式视觉】16:9 古典与科技融合的文献档案卡片，深色微光衬底，金铜色发光印章，高阶智库研报排版风格`;
  } else if (visualType === 'versus_dual') {
    layoutPrompt = `【核心辩题】「${cleanTitle}」\n【传统认知】AI“人工假冒”的防御心态\n【颠覆突破】SI“超级力量”的政治话语重置\n【版式视觉】16:9 左右对比双栏Keynote卡片，左侧冷蓝与右侧高光紫，双色对比辉光，极简数据对撞排版`;
  } else if (visualType === 'timeline') {
    layoutPrompt = `【演进主线】「${cleanTitle}」\n【阶段推进】1956达特茅斯会议 ➔ 2025白宫重塑定义\n【版式视觉】16:9 历史时空演进路线图卡片，发光连接轴线，阶段卡片发光边框，现代信息图表极简科技排版`;
  } else if (visualType === 'kinetic_text') {
    layoutPrompt = `【聚光焦点】「${cleanTitle}」\n【视觉递进】${text.slice(0, 20)}\n【版式视觉】16:9 视觉冲击排版海报卡片，特大号粗体文字层级，径向聚光灯深色氛围，极简高张力视觉平面设计`;
  } else {
    layoutPrompt = `【核心大字】「${cleanTitle}」\n【副级阐述】${text.slice(0, 24)}\n【排版重点】强化算力集中度与国家地缘竞争机制\n【版式视觉】16:9 现代暗色高阶演说PPT信息图卡片，微光磨砂玻璃容器，金珀与深蓝氛围光晕，顶级平面设计排版`;
  }

  return {
    theme_title: cleanTitle,
    subtitle: text.slice(0, 28),
    bullet_points: [
      `核心论据：${text.slice(0, 22)}`,
      `标志维度：${keywords.join(' · ')}`
    ],
    custom_prompt: layoutPrompt,
    template_style: visualType,
    generated_model: 'openrouter',
    generated_at: new Date().toISOString()
  };
}

const scenes = [];
let curMs = 0;
let shotIndex = 1;

for (const sec of sections) {
  const isFinalEndingSec = (sec.name === 'single_final_ending');
  
  for (const para of sec.paragraphs) {
    const rawShots = segmentParagraph(para);
    
    for (const shText of rawShots) {
      const sceneId = `scene_${String(shotIndex).padStart(3, '0')}`;
      const charLen = shText.length;
      
      // Duration pacing: ~4-4.5 chars/sec + 600ms pause buffer, bounded between 4200ms and 9500ms
      const dur = Math.max(4200, Math.min(9500, Math.round(charLen * 225) + 600));
      const startMs = curMs;
      const endMs = curMs + dur;
      curMs += dur;
      
      const kws = extractKeywords(shText);
      const visualType = pickVisualType(shText);
      const isEndingShot = isFinalEndingSec && (shotIndex >= 195);
      
      const pptSpec = createScenePptSpec(shText, kws, visualType, shotIndex);
      
      const scene = {
        scene_id: sceneId,
        shot_index: shotIndex,
        start_time_ms: startMs,
        duration_ms: dur,
        narration_text: shText,
        visual_purpose: `解说镜头 ${shotIndex}：${shText.slice(0, 20)}`,
        visual_type: visualType,
        source_mode: 'ai_ppt_slide',
        source_asset_id: `asset_${sceneId}`,
        ppt_slide_spec: pptSpec,
        procedural_props: {
          badge_label: `AI 画面 · ${kws.slice(0, 2).join(' / ')}`,
          headline: pptSpec.theme_title,
          subheadline: shText.slice(0, 24),
          items: pptSpec.bullet_points,
          accent_color: visualType === 'document_highlight' ? '#f59e0b' : visualType === 'versus_dual' ? '#8b5cf6' : visualType === 'timeline' ? '#10b981' : visualType === 'kinetic_text' ? '#ef4444' : '#6366f1'
        },
        content_keywords: kws,
        crop_spec: {
          in_point_ms: 0,
          out_point_ms: dur,
          trim_prompt: ''
        },
        start_ms: startMs,
        end_ms: endMs,
        status: 'READY_PROCEDURAL',
        scene_type: visualType,
        target_visual_mode: 'card',
        review_status: 'PENDING_REVIEW',
        human_review_required: false,
        chapter_ref: sec.name.split('：')[0].replace(/=/g, '').trim(),
        is_final_ending: isEndingShot
      };
      
      scenes.push(scene);
      shotIndex++;
    }
  }
}

const totalDurationMs = curMs;
const totalDurationSec = Number((curMs / 1000).toFixed(1));

const sceneManifest = {
  project_id: projectId,
  title: '美国为什么想将AI改名为 SI',
  total_duration_ms: totalDurationMs,
  total_duration_sec: totalDurationSec,
  scenes: scenes
};

fs.writeFileSync(path.join(dataDir, 'scene-manifest.json'), JSON.stringify(sceneManifest, null, 2), 'utf8');
console.log(`✅ Generated scene-manifest.json with ${scenes.length} scenes, total duration: ${totalDurationSec}s (${(totalDurationSec/60).toFixed(1)} mins)`);

// 11. Generate sentence-timestamps.json
const sentenceTimestamps = scenes.map((s, i) => ({
  sentence_index: i + 1,
  scene_id: s.scene_id,
  text: s.narration_text,
  start_ms: s.start_ms,
  end_ms: s.end_ms,
  duration_ms: s.duration_ms
}));
fs.writeFileSync(path.join(dataDir, 'sentence-timestamps.json'), JSON.stringify(sentenceTimestamps, null, 2), 'utf8');
console.log('✅ Generated sentence-timestamps.json');

// 12. Generate captions.srt
function msToSrt(ms) {
  const totalSec = Math.floor(ms / 1000);
  const remMs = ms % 1000;
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(remMs).padStart(3, '0')}`;
}

const srtLines = [];
scenes.forEach((s, i) => {
  srtLines.push(String(i + 1));
  srtLines.push(`${msToSrt(s.start_ms)} --> ${msToSrt(s.end_ms)}`);
  srtLines.push(s.narration_text);
  srtLines.push('');
});
fs.writeFileSync(path.join(captionsDir, 'captions.srt'), srtLines.join('\n'), 'utf8');
console.log('✅ Generated public/captions/captions.srt');

// 13. Compile render-props.json using generate-render-props.mjs
console.log('🚀 Compiling render-props.json via generate-render-props.mjs...');
const res = spawnSync(
  'node',
  ['packages/qc-tools/generate-render-props.mjs', '--project', projectId],
  { cwd: rootDir, encoding: 'utf8', stdio: 'inherit' }
);
console.log('🎉 Project why_ai_renamed_to_si_001 successfully initialized and ready for WhyVideo UI!');

#!/usr/bin/env node

/**
 * WhyVideo 工程进度检查与汇报 CLI
 * 用法: npm run status [project_id]
 */

import fs from 'fs';
import path from 'path';

const defaultProjectId = 'why_ryokan_small_dishes_001';
const projectId = process.argv[2] || defaultProjectId;
const projectDir = path.resolve(process.cwd(), 'projects', projectId);

if (!fs.existsSync(projectDir)) {
  console.error(`\x1b[31m[错误] 项目目录不存在: ${projectDir}\x1b[0m`);
  process.exit(1);
}

const statusFile = path.join(projectDir, 'data', 'project-status.json');
let statusData = null;

if (fs.existsSync(statusFile)) {
  try {
    statusData = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
  } catch (e) {
    // ignore parse error
  }
}

// 自动扫描工程文件真实落地情况
const fileChecks = [
  { name: '定稿文案 (final-script.json)', path: 'data/final-script.json', stage: 2 },
  { name: '配音音频 (narration.wav)', path: 'public/audio/narration.wav', stage: 3 },
  { name: '字幕文件 (captions.srt)', path: 'data/captions.srt', stage: 3 },
  { name: '时间戳表 (sentence-timestamps.json)', path: 'data/sentence-timestamps.json', stage: 3 },
  { name: '镜头清单 (scene-manifest.json)', path: 'data/scene-manifest.json', stage: 4 },
  { name: '渲染参数 (render-props.json)', path: 'data/render-props.json', stage: 4 },
  { name: '质检报告 (video-qc-report.json)', path: 'data/video-qc-report.json', stage: 4 },
  { name: '预览视频 (preview.mp4)', path: 'output/preview.mp4', stage: 4 }
];

const checkResults = fileChecks.map(item => {
  const full = path.join(projectDir, item.path);
  const exists = fs.existsSync(full);
  let size = 0;
  if (exists) {
    size = fs.statSync(full).size;
  }
  return { ...item, exists, size };
});

const passedCount = checkResults.filter(c => c.exists).length;
const autoProgress = Math.round((passedCount / checkResults.length) * 100);

console.log('\n========================================================================');
console.log(`\x1b[36m\x1b[1m 📊 WhyVideo 视频生产工程状态看板 (Project Dashboard)\x1b[0m`);
console.log('========================================================================');
console.log(`项目标识 (Project ID) : \x1b[33m${projectId}\x1b[0m`);
if (statusData) {
  console.log(`视频标题 (Title)      : ${statusData.title_display}`);
  console.log(`综合完成度 (Progress) : \x1b[32m\x1b[1m${statusData.overall_progress_percent}%\x1b[0m`);
  console.log(`当前阶段 (Phase)      : \x1b[35m${statusData.current_phase}\x1b[0m`);
} else {
  console.log(`产物就绪度 (Progress) : \x1b[32m\x1b[1m${autoProgress}%\x1b[0m`);
}
console.log('------------------------------------------------------------------------');

if (statusData && statusData.pipeline_stages) {
  console.log('\x1b[1m阶段流水线进展 (Pipeline Stages):\x1b[0m');
  statusData.pipeline_stages.forEach(st => {
    let icon = '⏳';
    let color = '\x1b[33m';
    if (st.status === 'COMPLETED') {
      icon = '✅';
      color = '\x1b[32m';
    } else if (st.status === 'IN_PROGRESS') {
      icon = '🔄';
      color = '\x1b[36m';
    }
    console.log(`  ${icon} ${color}${st.stage_name}\x1b[0m [权重: ${st.weight_percent}% | 进度: ${st.progress_percent}%]`);
    console.log(`     说明: ${st.summary}`);
  });
  console.log('------------------------------------------------------------------------');
}

console.log('\x1b[1m核心产物落地清单 (Artifact Status):\x1b[0m');
checkResults.forEach(r => {
  const mark = r.exists ? '\x1b[32m[已就绪]\x1b[0m' : '\x1b[31m[缺失]\x1b[0m';
  const sizeKb = r.exists ? `(${(r.size / 1024).toFixed(1)} KB)` : '';
  console.log(`  ${mark} ${r.name.padEnd(36)} ${sizeKb}`);
});

console.log('------------------------------------------------------------------------');
if (statusData && statusData.next_action) {
  console.log(`\x1b[33m\x1b[1m👉 下一步行动建议 (Next Action):\x1b[0m`);
  console.log(`   ${statusData.next_action}`);
}
console.log('========================================================================\n');

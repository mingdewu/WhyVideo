#!/usr/bin/env node

/**
 * WhyVideo Airtable 双向同步 CLI
 * 用法: npm run airtable:sync [project_id]
 */

import fs from 'fs';
import path from 'path';

// 优先从环境变量或本地 .env 读取，杜绝代码泄露 Token
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    lines.forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2] || '';
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (!process.env[key]) process.env[key] = val;
      }
    });
  }
}
loadEnv();

const defaultProjectId = 'why_ryokan_small_dishes_001';
const projectId = process.argv[2] || defaultProjectId;
const projectDir = path.resolve(process.cwd(), 'projects', projectId);

const token = process.env.AIRTABLE_API_KEY;
const baseId = process.env.AIRTABLE_BASE_ID || 'app3VJhyGcpy08Gdf';

if (!token) {
  console.error('\x1b[31m[错误] 未检测到 AIRTABLE_API_KEY 环境变量，请在 .env 中配置。\x1b[0m');
  process.exit(1);
}

async function sync() {
  console.log(`\n\x1b[36m🔄 正在将项目 [${projectId}] 的最新进展同步到 Airtable (Base: ${baseId})...\x1b[0m`);

  const statusPath = path.join(projectDir, 'data', 'project-status.json');
  const manifestPath = path.join(projectDir, 'data', 'scene-manifest.json');

  if (!fs.existsSync(statusPath) || !fs.existsSync(manifestPath)) {
    console.error('\x1b[31m[错误] 缺少 project-status.json 或 scene-manifest.json\x1b[0m');
    process.exit(1);
  }

  const statusData = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // 1. 同步 Projects 表
  const findProjRes = await fetch(`https://api.airtable.com/v0/${baseId}/Projects?filterByFormula={Project ID}='${projectId}'`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const findProjData = await findProjRes.json();

  const projFields = {
    'Project ID': projectId,
    'Title': statusData.title_display,
    'Overall Progress': `${statusData.overall_progress_percent}%`,
    'Current Phase': statusData.current_phase,
    'Next Action': statusData.next_action
  };

  if (findProjData.records && findProjData.records.length > 0) {
    const recordId = findProjData.records[0].id;
    await fetch(`https://api.airtable.com/v0/${baseId}/Projects/${recordId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: projFields })
    });
    console.log(`  ✅ 已更新 Projects 表记录 (${recordId})`);
  } else {
    await fetch(`https://api.airtable.com/v0/${baseId}/Projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ records: [{ fields: projFields }] })
    });
    console.log(`  ✅ 已创建 Projects 表记录`);
  }

  // 2. 同步 Scenes 表
  const findScenesRes = await fetch(`https://api.airtable.com/v0/${baseId}/Scenes?filterByFormula={Project ID}='${projectId}'`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const findScenesData = await findScenesRes.json();
  const existingMap = {};
  (findScenesData.records || []).forEach(r => {
    existingMap[r.fields['Scene ID']] = r.id;
  });

  for (const s of manifestData.scenes || []) {
    const fields = {
      'Scene ID': s.scene_id,
      'Project ID': projectId,
      'Time Range': `${(s.start_ms / 1000).toFixed(1)}s - ${(s.end_ms / 1000).toFixed(1)}s`,
      'Narration': s.narration_text,
      'Visual Type': s.visual_type,
      'Review Status': s.status,
      'Visual Purpose': s.visual_purpose
    };

    if (existingMap[s.scene_id]) {
      await fetch(`https://api.airtable.com/v0/${baseId}/Scenes/${existingMap[s.scene_id]}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
      });
    } else {
      await fetch(`https://api.airtable.com/v0/${baseId}/Scenes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ records: [{ fields }] })
      });
    }
  }

  console.log(`  ✅ 已同步 ${manifestData.scenes.length} 个镜头记录至 Scenes 表！`);
  console.log(`\x1b[32m✨ Airtable 同步完成: https://airtable.com/${baseId}\x1b[0m\n`);
}

sync().catch(err => {
  console.error('\x1b[31m[Airtable 同步失败]:\x1b[0m', err);
});

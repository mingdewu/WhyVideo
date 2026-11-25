import fs from 'node:fs';
import path from 'node:path';
import { requestContext } from '../../request-context.mjs';
import { ROOT_DIR, defaultProjectId, getProjectPaths } from '../../project-paths.mjs';

const secrets = ['apiKey', 'tavilyApiKey', 'meowloadApiKey', 'elevenlabsApiKey'];
const fields = [...secrets, 'baseUrl', 'writerModel', 'textModel', 'keywordModel', 'videoModel', 'imageModel', 'bgmModel'];
const configPath = () => path.join(process.env.WHYVIDEO_AUTH_DIR || path.join(ROOT_DIR, '.whyvideo-auth'), 'shared-services.json');
export function readSharedServices() {
  let legacy = {};
  try { legacy = JSON.parse(fs.readFileSync(getProjectPaths(defaultProjectId()).promptConfigPath, 'utf8')); } catch {}
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch {}
  return { ...legacy, apiKey: process.env.OPENROUTER_API_KEY || legacy.apiKey || '', tavilyApiKey: process.env.TAVILY_API_KEY || legacy.tavilyApiKey || '', elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || '', ...saved };
}
export function publicSharedServices(config = readSharedServices()) {
  const result = {};
  for (const field of fields) if (!secrets.includes(field)) result[field] = config[field] || '';
  for (const field of secrets) result[field + 'Configured'] = Boolean(config[field]);
  result.tavilyKeyConfigured = result.tavilyApiKeyConfigured;
  result.meowloadKeyConfigured = result.meowloadApiKeyConfigured;
  return result;
}
export function saveSharedServices(body) {
  const config = readSharedServices();
  for (const field of fields) {
    if (typeof body[field] !== 'string') continue;
    const value = body[field].trim();
    if (secrets.includes(field) && (!value || /^•+$/.test(value))) continue;
    config[field] = value;
  }
  if (config.baseUrl) {
    const url = new URL(config.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('服务地址无效');
  }
  const file = configPath(); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(fields.map(field => [field, config[field] || ''])), null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
  return publicSharedServices(config);
}
export const sharedRuntimeConfig = () => requestContext.getStore()?.services;
export const setSharedRuntimeUser = user => { if (requestContext.getStore()) requestContext.getStore().user = user; };
export const setSharedProjectOwner = id => { if (requestContext.getStore()) requestContext.getStore().projectOwnerId = id; };
export const withSharedServices = (user, callback) => requestContext.run({ user, services: readSharedServices() }, callback);

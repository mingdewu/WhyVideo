import { openAccountStore } from './ui-server/lib/account-store.mjs';

const username = process.argv[2];
if (!username || process.stdin.isTTY) {
  console.error('用法：将密码通过标准输入传入 node packages/qc-tools/create-superuser.mjs 用户名');
  process.exit(1);
}
let password = '';
for await (const chunk of process.stdin) password += chunk;
password = password.replace(/\r?\n$/, '');
const store = openAccountStore();
try {
  if (store.hasUsers()) throw new Error('已有账号，请使用账号管理功能创建其他用户');
  await store.createUser(username, password, 'superuser');
  console.log('超级用户已创建');
} finally {
  store.close();
}

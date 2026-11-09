/**
 * 웹스토어에 올릴 zip — manifest.json·installed.json·src·icons 만 담는다.  npm run pack → dist/naver-shopping-rank-{버전}.zip
 * PowerShell 7(pwsh)의 Compress-Archive 를 쓴다(외부 패키지 없음).
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const manifest = require(path.join(root, 'manifest.json'));
const installed = require(path.join(root, 'installed.json'));
if (manifest.version !== installed.version) {
  console.error(`버전이 다릅니다: manifest ${manifest.version} / installed.json ${installed.version}`);
  process.exit(1);
}
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const out = path.join(dist, `naver-shopping-rank-${manifest.version}.zip`);
// Windows PowerShell 5 의 Compress-Archive 는 zip 안 경로를 'src\x.js' 로 써서 웹스토어가 못 읽는다 — PowerShell 7(pwsh)은 '/' 로 쓴다
fs.rmSync(out, { force: true });
execFileSync('pwsh', [
  '-NoProfile', '-Command',
  `Compress-Archive -Force -Path manifest.json,installed.json,src,icons -DestinationPath '${out}'`,
], { cwd: root, stdio: 'inherit' });
console.log(`만들었습니다: ${out}`);

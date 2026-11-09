/**
 * GitHub 릴리스 올리기 — npm run release (pack 뒤에 실행된다).
 *
 * 렌탈 SaaS 의 [순위검색 확장 설치] 모달은 아래 고정 주소로 최신 릴리스를 읽는다. 그래서 파일 이름을 바꾸면 안 된다.
 *   https://github.com/wwizcorp/naver-shopping-rank-extension/releases/latest/download/naver-shopping-rank.zip  ← 다운로드
 *   https://github.com/wwizcorp/naver-shopping-rank-extension/releases/latest/download/installed.json          ← 최신 버전
 *
 * 태그는 v{manifest 버전}. 같은 태그가 이미 있으면 멈춘다 — manifest.json·installed.json 버전을 먼저 올린다.
 * main 에 병합된 상태에서 실행한다(태그는 원격 main 에 붙는다).
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO = 'wwizcorp/naver-shopping-rank-extension';
const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'manifest.json'));
const tag = `v${version}`;
const dist = path.join(root, 'dist');
const versioned = path.join(dist, `naver-shopping-rank-${version}.zip`);
const zip = path.join(dist, 'naver-shopping-rank.zip');
const installed = path.join(dist, 'installed.json');

const gh = (args, opts = {}) => execFileSync('gh', args, { cwd: root, encoding: 'utf8', ...opts });

try {
  gh(['release', 'view', tag, '-R', REPO], { stdio: 'pipe' });
  console.error(`${tag} 릴리스가 이미 있습니다. manifest.json·installed.json 버전을 올린 뒤 다시 실행하세요.`);
  process.exit(1);
} catch {
  // 없으면 계속
}

fs.copyFileSync(versioned, zip);
fs.copyFileSync(path.join(root, 'installed.json'), installed);
gh([
  'release', 'create', tag, zip, installed,
  '-R', REPO, '--target', 'main', '--title', `N쇼핑순위검색 ${tag}`,
  '--notes', '압축을 풀어 chrome://extensions → 개발자 모드 → [압축해제된 확장 프로그램 로드]로 설치합니다. 업데이트는 같은 폴더에 덮어쓴 뒤 새로고침(↻).',
], { stdio: 'inherit' });
console.log(`올렸습니다: https://github.com/${REPO}/releases/tag/${tag}`);

/**
 * content script 공통 — 탭별 작업 읽기·쓰기, 결과 상자, 결과 보내기, 로그인·보안 확인 검사.
 * 네이버 메인(naver-main.js) · 통합검색(naver-search.js) · 쇼핑 결과(naver-content.js) 앞에 먼저 실린다.
 *
 * 작업 단계(job.stage): search(메인에서 검색 제출) → shopping(통합검색에서 쇼핑 링크 누름) → 쇼핑 결과에서 순위 확인.
 */
(function () {
  'use strict';

  const Core = globalThis.MubloRankCore;
  const VERSION = chrome.runtime.getManifest().version;
  const JOB_TTL_MS = 10 * 60 * 1000;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function loadJob() {
    const res = await chrome.runtime.sendMessage({ type: 'mublo-rank:job:get' }).catch(() => null);
    const job = res && res.job;
    return job && Date.now() - job.startedAt < JOB_TTL_MS ? job : null;
  }
  async function saveJob(job) {
    await chrome.runtime.sendMessage({ type: 'mublo-rank:job:set', job }).catch(() => null);
  }

  /** 주소의 #mublo-rank= 작업을 꺼내고 주소창에서 지운다 */
  function takeHashJob() {
    const fresh = Core.parseJobHash(location.hash);
    if (!fresh) return null;
    history.replaceState(null, '', location.href.split('#')[0]);
    return fresh;
  }

  async function isLoggedIn() {
    const res = await chrome.runtime.sendMessage({ type: 'mublo-rank:login' }).catch(() => null);
    return Boolean(res && res.loggedIn);
  }

  /** 보안 확인·접속 제한 화면인가 — 문구 또는 화면에 보이는 captcha 요소 (허브 security_hits 와 같음) */
  function securityBlocked() {
    if (Core.isSecurityText(document.body && document.body.innerText)) return true;
    if ((location.href + ' ' + document.title).toLowerCase().includes('captcha')) return true;
    return Array.from(document.querySelectorAll('[id*="captcha" i],[class*="captcha" i],[name*="captcha" i],img[src*="captcha" i],iframe[src*="captcha" i]'))
      .some((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width >= 80 && rect.height >= 30;
      });
  }

  // ─── 결과 상자 ───────────────────────────────
  let box = null;
  function show(html, tone) {
    if (!box) {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647';
      const shadow = host.attachShadow({ mode: 'closed' });
      shadow.innerHTML = `<style>
        .b{font:14px/1.5 -apple-system,'Malgun Gothic',sans-serif;background:#fff;color:#222;border-radius:10px;
           box-shadow:0 6px 24px rgba(0,0,0,.18);padding:14px 16px;width:300px;border-top:4px solid #888}
        .b.ok{border-color:#03c75a}.b.no{border-color:#f59f00}.b.err{border-color:#e03131}
        .t{font-weight:700;margin-bottom:6px}.s{color:#666;font-size:12px}
        a.btn{display:inline-block;margin-top:8px;padding:6px 12px;border-radius:6px;background:#03c75a;color:#fff;text-decoration:none}
        button.x{float:right;border:0;background:none;font-size:16px;cursor:pointer;color:#999}
      </style><div class="b"><button class="x" title="닫기">×</button><div class="c"></div></div>`;
      shadow.querySelector('.x').addEventListener('click', () => host.remove());
      document.documentElement.appendChild(host);
      box = shadow.querySelector('.b');
    }
    box.className = `b ${tone || ''}`;
    box.querySelector('.c').innerHTML = html;
  }
  const head = (keyword) => `<div class="s">순위 확인 · ${esc(keyword)}</div>`;

  function showLogin(keyword, backUrl) {
    show(`${head(keyword)}<div class="t">네이버 로그인이 필요합니다</div>
      <div class="s">로그인하고 돌아오면 이어서 확인합니다.</div>
      <a class="btn" href="https://nid.naver.com/nidlogin.login?url=${encodeURIComponent(backUrl)}">네이버 로그인</a>`, 'err');
  }
  function showSecurity(keyword) {
    show(`${head(keyword)}<div class="t">네이버 보안 확인을 풀어 주세요</div>
      <div class="s">이 창에서 보안 확인(영수증 등)을 직접 풀면 이어서 순위를 확인합니다.</div>`, 'no');
  }

  /** 결과를 상자에 보이고 관리자 화면(window.opener)에 보낸다 */
  async function finish(job, result) {
    job.done = true;
    job.result = result;
    await saveJob(job);
    const payload = { type: 'mublo-rank:result', nonce: job.nonce, version: VERSION, keyword: job.keyword, ...result };
    if (job.origin && window.opener) {
      try { window.opener.postMessage(payload, job.origin); } catch (e) { /* 관리자 창이 닫혔다 */ }
    }
    if (result.status === 'found') {
      show(`${head(job.keyword)}<div class="t">${result.page}페이지 ${result.position}위 (전체 ${result.rank}위)</div>
        <div>${esc(result.title)}</div><div class="s">${esc(result.mallName)} · 상품번호 ${esc(result.mid)}</div>`, 'ok');
    } else if (result.status === 'not_found') {
      show(`${head(job.keyword)}<div class="t">${job.max}페이지 안에 없습니다</div>
        <div class="s">${result.seen}개 상품을 확인했습니다. 다른 키워드를 골라 주세요.</div>`, 'no');
    } else {
      show(`${head(job.keyword)}<div class="t">확인하지 못했습니다</div><div class="s">${esc(result.message)}</div>`, 'err');
    }
  }

  /** 조건이 맞을 때까지 기다린다(밀리초) — 맞으면 그 값, 아니면 null */
  async function waitFor(fn, timeout) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const value = fn();
      if (value) return value;
      await sleep(250);
    }
    return null;
  }

  globalThis.MubloRank = { Core, VERSION, sleep, esc, loadJob, saveJob, takeHashJob, isLoggedIn, securityBlocked, show, head, showLogin, showSecurity, finish, waitFor };
})();

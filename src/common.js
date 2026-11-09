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
    await chrome.runtime.sendMessage({ type: 'mublo-rank:detach' }).catch(() => null); // '디버깅 중' 줄을 걷는다
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

  // ─── 사람 입력 (0.3.0~) ──────────────────────────────────────────────
  // 키워드 허브 dom.py 와 같은 모양: 휠은 커서 아래 문서를 굴리고, 멈출 때까지 기다린 뒤 실제 이동량을 읽는다.
  // 클릭은 요소를 휠로 화면에 들인 뒤 중앙이 다른 것에 덮이지 않았는지 보고 마우스를 옮겨 누른다.
  // CDP(background 의 chrome.debugger)가 안 되면 DOM 스크롤·click() 으로 대신한다.
  const rand = (min, max) => min + Math.random() * (max - min);
  let pointer = null; // 마지막 마우스 자리

  async function cdp(steps) {
    const res = await chrome.runtime.sendMessage({ type: 'mublo-rank:input', steps }).catch(() => null);
    return Boolean(res && res.ok);
  }

  /** 휠을 굴릴 자리 — 안쪽 스크롤 상자·iframe 위는 피한다(허브 _WHEEL_POINT_EXPRESSION) */
  function wheelPoint() {
    const ok = (x, y) => {
      let el = document.elementFromPoint(x, y);
      if (!el) return false;
      while (el && el !== document.body && el !== document.documentElement) {
        if (el.tagName === 'IFRAME') return false;
        const style = getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 2) return false;
        el = el.parentElement;
      }
      return true;
    };
    for (const fy of [0.5, 0.3, 0.7]) {
      for (const fx of [0.5, 0.3, 0.7]) {
        const x = Math.round(window.innerWidth * fx + rand(-20, 20));
        const y = Math.round(window.innerHeight * fy + rand(-20, 20));
        if (ok(x, y)) return [x, y];
      }
    }
    return null;
  }

  /** 마우스를 몇 걸음에 나눠 옮기는 명령들 */
  function moveSteps(x, y) {
    const from = pointer || [Math.round(window.innerWidth * rand(0.3, 0.7)), Math.round(window.innerHeight * rand(0.3, 0.7))];
    const count = 3 + Math.floor(Math.random() * 4);
    const steps = [];
    for (let i = 1; i <= count; i++) {
      const t = i / count;
      steps.push({ method: 'Input.dispatchMouseEvent', params: {
        type: 'mouseMoved', button: 'none',
        x: Math.round(from[0] + (x - from[0]) * t + (i < count ? rand(-6, 6) : 0)),
        y: Math.round(from[1] + (y - from[1]) * t + (i < count ? rand(-6, 6) : 0)),
      } });
    }
    pointer = [x, y];
    return steps;
  }

  async function settleScroll(before) {
    const until = Date.now() + 1200;
    let last = before;
    let stable = 0;
    while (Date.now() < until) {
      await sleep(70);
      const current = window.scrollY;
      if (Math.abs(current - last) < 0.5) {
        stable += 1;
        if (stable >= (Math.abs(current - before) >= 0.5 ? 2 : 4)) return current;
      } else {
        stable = 0;
      }
      last = current;
    }
    return last;
  }

  /** 휠로 deltaY 만큼 굴린다. 돌아온 자리 */
  async function wheel(deltaY) {
    const before = window.scrollY;
    const point = wheelPoint();
    if (point && await cdp([...moveSteps(point[0], point[1]), { method: 'Input.dispatchMouseEvent', params: {
      type: 'mouseWheel', x: point[0], y: point[1], deltaX: 0, deltaY: Math.round(deltaY), button: 'none',
    } }])) {
      const after = await settleScroll(before);
      if (Math.abs(after - before) >= 0.5) return after;
    }
    window.scrollBy({ top: deltaY, left: 0, behavior: 'smooth' }); // CDP 가 안 되면 문서 스크롤
    return settleScroll(before);
  }

  /** 한 화면 내려 읽기 — 화면 높이의 85%(320~900px, 허브 scroll_forward) */
  function forwardStep() {
    return Math.max(320, Math.min(window.innerHeight * 0.85, 900)) * rand(0.85, 1.1);
  }

  /** 휠로 position 근처까지 굴린다 */
  async function scrollToY(position) {
    for (let i = 0; i < 30; i++) {
      const gap = position - window.scrollY;
      if (Math.abs(gap) < 40) break;
      const step = Math.sign(gap) * Math.min(Math.abs(gap), forwardStep());
      const before = window.scrollY;
      const after = await wheel(step);
      if (Math.abs(after - before) < 0.5) break; // 끝에 닿았다
      await sleep(rand(250, 600));
    }
    return window.scrollY;
  }

  /** 결과를 내려 읽다가 가끔 되짚어 올려 본다(허브 search_result_dwell). top=true 면 끝나고 맨 위로 */
  async function dwell(seconds, { top = true } = {}) {
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      const before = window.scrollY;
      const after = await wheel(forwardStep());
      await sleep(rand(400, 1100));
      if (Math.abs(after - before) < 0.5) { await sleep(Math.max(0, end - Date.now())); break; }
      if (Math.random() < 0.25 && Date.now() < end) {
        await wheel(-rand(220, 520));
        await sleep(rand(300, 800));
      }
    }
    if (top) {
      await scrollToY(0);
      await sleep(rand(300, 700));
    }
  }

  function comfortablyVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.height > 0 && rect.top >= window.innerHeight * 0.15 && rect.bottom <= window.innerHeight * 0.85;
  }

  /** 요소를 휠로 서서히 화면 가운데쯤에 들인다 */
  async function bringIntoView(el) {
    for (let i = 0; i < 30 && !comfortablyVisible(el); i++) {
      const rect = el.getBoundingClientRect();
      const gap = rect.top + rect.height / 2 - window.innerHeight / 2;
      const before = window.scrollY;
      const after = await wheel(Math.sign(gap) * Math.min(Math.abs(gap), forwardStep()));
      if (Math.abs(after - before) < 0.5) break;
      await sleep(rand(400, 1000));
    }
    if (!comfortablyVisible(el)) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await sleep(rand(250, 500));
  }

  /** 결과를 한 화면씩 내려 읽으며(가끔 되짚기) getEl() 요소가 보일 때까지 간다 — 페이지 번호 줄 찾아가기 */
  async function readDownTo(getEl) {
    for (let i = 0; i < 60; i++) {
      const el = getEl();
      if (el && el.getBoundingClientRect().top < window.innerHeight * 0.85) break;
      const before = window.scrollY;
      const after = await wheel(forwardStep());
      await sleep(rand(400, 1100));
      if (Math.abs(after - before) < 0.5) break; // 문서 끝
      if (Math.random() < 0.2) {
        await wheel(-rand(220, 520));
        await sleep(rand(300, 800));
      }
    }
    const el = getEl();
    if (el) await bringIntoView(el);
  }

  /** 요소를 마우스로 누른다 — 덮였거나 CDP 가 안 되면 click() */
  async function clickElement(el) {
    await bringIntoView(el);
    const rect = el.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width * rand(0.35, 0.65));
    const y = Math.round(rect.top + rect.height * rand(0.35, 0.65));
    const top = document.elementFromPoint(x, y);
    const press = { x, y, button: 'left', clickCount: 1 };
    if (top && (top === el || el.contains(top))) {
      const moved = await cdp(moveSteps(x, y));
      if (moved) {
        await sleep(rand(120, 320));
        if (await cdp([
          { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', buttons: 1, ...press } },
          { method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', buttons: 0, ...press } },
        ])) return 'cdp';
      }
    }
    el.click();
    return 'dom';
  }

  /** 포커스된 입력칸에 한 글자씩 친다(허브 Input.insertText) — CDP 가 안 되면 값을 넣고 input 이벤트 */
  async function typeText(input, text) {
    for (const character of text) {
      if (!(await cdp([{ method: 'Input.insertText', params: { text: character } }]))) {
        input.value += character;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: character, inputType: 'insertText' }));
      }
      await sleep(rand(70, 160));
    }
  }

  globalThis.MubloRank = {
    Core, VERSION, sleep, rand, esc, loadJob, saveJob, takeHashJob, isLoggedIn, securityBlocked, show, head, showLogin, showSecurity, finish, waitFor,
    wheel, scrollToY, dwell, bringIntoView, readDownTo, clickElement, typeText,
  };
})();

/**
 * 네이버 쇼핑 검색 탭에서 도는 순위 확인.
 *
 * 관리자 화면이 연 주소의 #mublo-rank= 작업이 있을 때만 움직이고, 일반 검색에서는 아무것도 하지 않는다.
 * 1페이지부터 __NEXT_DATA__ 를 읽어 우리 상품을 찾고, 없으면 페이지 번호를 눌러 다음 페이지로(최대 5페이지).
 * 페이지 번호 클릭은 주소만 바꾸고 JSON 은 예전 값으로 남기므로 새로고침해 다시 읽는다(허브 실측과 같음).
 * 작업 상태는 페이지가 바뀌어도 남도록 이 탭의 sessionStorage 에 둔다.
 * 결과는 화면 오른쪽 위 상자에 보이고, 관리자 탭(window.opener)에도 보낸다.
 */
(function () {
  'use strict';

  const Core = globalThis.MubloRankCore;
  const STORE_KEY = 'mubloRankJob';
  const JOB_TTL_MS = 10 * 60 * 1000;
  const VERSION = chrome.runtime.getManifest().version;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const pause = () => sleep(1500 + Math.random() * 1500); // 사람처럼 쉬었다 넘긴다

  function loadJob() {
    try {
      const job = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
      return job && Date.now() - job.startedAt < JOB_TTL_MS ? job : null;
    } catch (e) {
      return null;
    }
  }
  function saveJob(job) {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(job));
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
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const keywordOf = () => new URL(location.href).searchParams.get('query') || '';
  const head = () => `<div class="s">순위 확인 · ${esc(keywordOf())}</div>`;

  // ─── 결과 보내기 ─────────────────────────────
  function finish(job, result) {
    job.done = true;
    job.result = result;
    saveJob(job);
    const payload = { type: 'mublo-rank:result', nonce: job.nonce, version: VERSION, keyword: keywordOf(), ...result };
    if (job.origin && window.opener) {
      try { window.opener.postMessage(payload, job.origin); } catch (e) { /* 관리자 탭이 닫혔다 */ }
    }
    if (result.status === 'found') {
      show(`${head()}<div class="t">${result.page}페이지 ${result.position}위 (전체 ${result.rank}위)</div>
        <div>${esc(result.title)}</div><div class="s">${esc(result.mallName)} · 상품번호 ${esc(result.mid)}</div>`, 'ok');
      highlight(result.mid);
    } else if (result.status === 'not_found') {
      show(`${head()}<div class="t">${job.max}페이지 안에 없습니다</div>
        <div class="s">${result.seen}개 상품을 확인했습니다. 다른 키워드를 골라 주세요.</div>`, 'no');
    } else {
      show(`${head()}<div class="t">확인하지 못했습니다</div><div class="s">${esc(result.message)}</div>`, 'err');
    }
  }

  /** 찾은 카드를 화면에서 표시 — 링크의 data-shp-contents-id 로 찾는다(없으면 넘어간다) */
  function highlight(mid) {
    const anchor = mid && document.querySelector(`a[data-shp-contents-id="${CSS.escape(mid)}"]`);
    const card = anchor && (anchor.closest('[class*="product_item__"],[class*="adProduct_item__"],li') || anchor);
    if (card) {
      card.style.outline = '3px solid #03c75a';
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  // ─── 페이지 넘기기 ───────────────────────────
  const PAGE_BUTTONS = '[class*="pagination_btn_page__"],[data-shp-inventory="prd_pgn"][data-shp-contents-type="pageNo"]';

  async function goToPage(page) {
    const button = Array.from(document.querySelectorAll(PAGE_BUTTONS))
      .find((el) => (el.textContent || '').replace(/[^0-9]/g, '') === String(page));
    if (button) {
      button.click();
      for (let i = 0; i < 40; i++) {
        await sleep(250);
        if (Core.pageFromUrl(location.href) === page) {
          location.reload(); // 주소만 바뀌고 JSON 은 예전 값 — 새로고침해 그 페이지 JSON 을 받는다
          return;
        }
      }
    }
    // 번호를 못 찾았거나 이동하지 않았다 — 고정 조건을 채운 주소로 간다
    location.assign(Core.resultPageUrl(location.href, page));
  }

  // ─── 실행 ───────────────────────────────────
  async function run() {
    let job = loadJob();
    const fresh = Core.parseJobHash(location.hash);
    if (fresh) {
      job = { ...fresh, page: 1, seen: 0, reloaded: {}, startedAt: Date.now(), done: false };
      saveJob(job);
      history.replaceState(null, '', location.href.split('#')[0]); // 주소창에서 작업 정보를 지운다
    }
    if (!job || job.done) return;

    show(`${head()}<div class="t">${job.page}/${job.max}페이지 확인 중…</div>`);

    const login = await chrome.runtime.sendMessage({ type: 'mublo-rank:login' }).catch(() => null);
    if (!login || !login.loggedIn) {
      const back = encodeURIComponent(location.href.split('#')[0]);
      show(`${head()}<div class="t">네이버 로그인이 필요합니다</div>
        <div class="s">로그인하고 이 화면으로 돌아오면 이어서 확인합니다.</div>
        <a class="btn" href="https://nid.naver.com/nidlogin.login?url=${back}">네이버 로그인</a>`, 'err');
      return; // 작업은 남겨 둔다 — 로그인 뒤 돌아오면 다시 시작
    }

    const page = Core.pageFromUrl(location.href);
    if (page !== job.page) {
      location.assign(Core.resultPageUrl(location.href, job.page));
      return;
    }

    const script = document.getElementById('__NEXT_DATA__');
    const parsed = Core.parseNextData(script && script.textContent, page);
    if (!parsed.valid) {
      if (parsed.cause === 'next_data_stale' && !job.reloaded[page]) {
        job.reloaded[page] = 1;
        saveJob(job);
        location.reload();
        return;
      }
      finish(job, { status: 'error', cause: parsed.cause, message: `네이버 화면을 읽지 못했습니다 (${parsed.cause}). 잠시 뒤 다시 시도하거나 직접 확인해 주세요.` });
      return;
    }

    job.seen = (page - 1) * Core.PER_PAGE + parsed.cards.length;
    const hit = Core.findTarget(parsed.cards, job);
    if (hit) {
      finish(job, Core.foundResult(hit));
      return;
    }
    if (parsed.last || page >= job.max) {
      finish(job, { status: 'not_found', seen: job.seen, pages: page });
      return;
    }
    job.page = page + 1;
    saveJob(job);
    show(`${head()}<div class="t">${job.page}/${job.max}페이지로 넘어갑니다…</div>`);
    await pause();
    await goToPage(job.page);
  }

  run().catch((error) => {
    const job = loadJob();
    if (job && !job.done) finish(job, { status: 'error', cause: 'exception', message: String(error && error.message || error) });
  });
})();

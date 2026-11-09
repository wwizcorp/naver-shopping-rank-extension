/**
 * 네이버 쇼핑 검색 결과(search.shopping.naver.com)에서 도는 순위 확인.
 *
 * 이 탭에 작업이 있을 때만 움직인다 — 0.2.0~ 은 네이버 메인 → 통합검색을 거쳐 온 작업(stage=shopping, background 저장),
 * 0.1.x 관리자 화면처럼 주소의 #mublo-rank= 로 바로 연 작업도 받는다. 일반 검색에서는 아무것도 하지 않는다.
 * 1페이지부터 __NEXT_DATA__ 를 읽어 우리 상품을 찾고, 없으면 페이지 번호를 눌러 다음 페이지로(최대 5페이지).
 * 페이지 번호 클릭은 주소만 바꾸고 JSON 은 예전 값으로 남기므로 새로고침해 다시 읽는다(허브 실측과 같음).
 * 보안 확인이 뜨면 끝내지 않고 풀어 달라고 안내한다 — 풀면 화면이 다시 열리며 이어서 확인한다.
 */
(function () {
  'use strict';

  const R = globalThis.MubloRank;
  const Core = R.Core;
  const keywordOf = () => new URL(location.href).searchParams.get('query') || '';

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

  /**
   * 다음 페이지로 — 키워드 허브 _move_to_result_page 와 같은 모양(0.3.0~).
   * 결과를 휠로 내려 읽으며 페이지 번호 줄까지 서서히 가고, 1.4~2.2초 쉰 뒤 번호를 마우스로 누른다.
   * 주소가 바뀌면 새로고침해 그 페이지 JSON 을 받는다(번호 클릭은 주소·카드만 바꾸고 JSON 은 예전 값 — 허브도 새로고침).
   * 세 번 눌러도 안 넘어가면 그때만 고정 조건을 채운 주소로 간다(허브 allow_direct_recovery).
   */
  async function goToPage(page) {
    const bar = () => document.querySelector('div[class*="pagination_pagination__"]');
    const findButton = () => Array.from(document.querySelectorAll(PAGE_BUTTONS))
      .find((el) => (el.textContent || '').replace(/[^0-9]/g, '') === String(page));
    await R.readDownTo(() => bar() || findButton());
    await R.sleep(R.rand(1400, 2200));
    for (let attempt = 0; attempt < 3; attempt++) {
      const button = findButton();
      if (!button) break;
      await R.clickElement(button);
      for (let i = 0; i < 40; i++) {
        await R.sleep(250);
        if (Core.pageFromUrl(location.href) === page) {
          await R.sleep(R.rand(600, 1200));
          // 새로고침은 스크롤 자리를 되살린다 — 맨 아래면 다음 페이지에서 결과를 읽지 않고 바로 번호를 누르게 된다.
          // 네이버도 페이지를 넘기면 맨 위에서 시작하므로 맨 위로 올려 두고 새로고침한다.
          window.scrollTo(0, 0);
          location.reload();
          return;
        }
      }
      await R.sleep(R.rand(800, 1200));
    }
    location.assign(Core.resultPageUrl(location.href, page));
  }

  // ─── 실행 ───────────────────────────────────
  async function run() {
    let job = await R.loadJob();
    const fresh = R.takeHashJob();
    if (fresh) {
      job = { ...fresh, keyword: fresh.keyword || keywordOf(), stage: 'shopping', page: 1, seen: 0, reloaded: {}, startedAt: Date.now(), done: false };
      await R.saveJob(job);
    }
    if (!job || job.done || job.stage !== 'shopping') return;
    job.keyword = job.keyword || keywordOf();

    if (R.securityBlocked()) {
      R.showSecurity(job.keyword);
      return; // 작업은 남겨 둔다 — 풀면 다시 시작
    }
    R.show(`${R.head(job.keyword)}<div class="t">${job.page}/${job.max}페이지 확인 중…</div>`);

    if (!(await R.isLoggedIn())) {
      R.showLogin(job.keyword, location.href.split('#')[0]);
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
        await R.saveJob(job);
        location.reload();
        return;
      }
      await R.finish(job, { status: 'error', cause: parsed.cause, message: `네이버 화면을 읽지 못했습니다 (${parsed.cause}). 잠시 뒤 다시 시도하거나 직접 확인해 주세요.` });
      return;
    }

    job.seen = (page - 1) * Core.PER_PAGE + parsed.cards.length;
    const hit = Core.findTarget(parsed.cards, job);
    if (hit) {
      const result = Core.foundResult(hit);
      await R.finish(job, result);
      highlight(result.mid);
      return;
    }
    if (parsed.last || page >= job.max) {
      await R.finish(job, { status: 'not_found', seen: job.seen, pages: page });
      return;
    }
    job.page = page + 1;
    await R.saveJob(job);
    R.show(`${R.head(job.keyword)}<div class="t">${job.page}/${job.max}페이지로 넘어갑니다…</div>`);
    await R.sleep(R.rand(800, 1600)); // 화면이 그려진 뒤 읽기 시작한다
    await goToPage(job.page);
  }

  run().catch(async (error) => {
    const job = await R.loadJob();
    if (job && !job.done && job.stage === 'shopping') {
      await R.finish(job, { status: 'error', cause: 'exception', message: String((error && error.message) || error) });
    }
  });
})();

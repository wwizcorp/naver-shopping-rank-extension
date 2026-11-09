/**
 * 네이버 통합검색(search.naver.com)에서 — 메인에서 검색을 제출한 작업(stage=search)이 이 탭에 있을 때만 움직인다.
 *
 * 화면에 이미 있는 '네이버 가격비교 더보기' 링크(없으면 상단 '쇼핑' 탭)를 누른다. 주소를 만들어 이동하지 않는다
 * (허브 click_price_compare_more 와 같음). 링크가 새 창으로 열리면 결과를 관리자 화면에 돌려보낼 수 없어
 * 이 탭에서 열리게 한다. 그래도 새 탭이 열리면 background 가 작업을 그 탭으로 옮긴다.
 */
(function () {
  'use strict';

  const R = globalThis.MubloRank;

  const linkName = (anchor) => (anchor.getAttribute('aria-label') || anchor.getAttribute('title')
    || anchor.innerText || anchor.textContent || '').trim();

  async function run() {
    const job = await R.loadJob();
    if (!job || job.done || job.stage !== 'search') return;

    if (R.securityBlocked()) {
      R.showSecurity(job.keyword); // 풀면 화면이 다시 열리고 이 스크립트가 다시 돈다
      return;
    }
    R.show(`${R.head(job.keyword)}<div class="t">쇼핑 결과로 이동하는 중…</div>`);

    // 사람처럼 결과를 2~8초 내려 읽고 위로 돌아온다(허브 search_result_dwell)
    await R.sleep(R.rand(600, 1400));
    await R.dwell(R.rand(2, 8));

    // 쇼핑 영역은 늦게 그려질 수 있다 — 최대 10초 기다린다
    const findLink = () => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const index = R.Core.pickShoppingLink(anchors.map((a) => ({ name: linkName(a), href: a.href })));
      return index === -1 ? null : anchors[index];
    };
    const anchor = await R.waitFor(findLink, 10000);
    if (!anchor) {
      await R.finish(job, { status: 'error', cause: 'shopping_link_absent', message: '통합검색에서 쇼핑(가격비교) 결과 링크를 찾지 못했습니다. 이 창에서 [쇼핑]을 눌러 직접 확인해 주세요.' });
      return;
    }

    job.stage = 'shopping';
    await R.saveJob(job);
    anchor.removeAttribute('target'); // 새 창으로 열리면 결과를 관리자 화면에 돌려보낼 수 없다
    await R.clickElement(anchor);     // 휠로 링크까지 내려가 마우스로 누른다
  }

  run().catch(() => { /* 통합검색 화면은 건드리지 않는다 */ });
})();

/**
 * 네이버 메인(www.naver.com)에서 — 관리자 화면이 연 #mublo-rank= 작업이 있을 때만 움직인다.
 *
 * 쇼핑 검색 주소를 바로 열면 네이버가 영수증 보안 확인을 띄운다(소유자 2026-11-09). 그래서 사람처럼
 * 메인 검색창을 눌러 한 글자씩 치고 검색 폼을 제출한다(허브 dom.py submit_main_search 와 같음).
 * 다음 단계(통합검색 → 쇼핑 결과)는 naver-search.js 가 이어 간다.
 */
(function () {
  'use strict';

  const R = globalThis.MubloRank;

  async function run() {
    const fresh = R.takeHashJob();
    if (!fresh) return;
    if (!fresh.keyword) {
      R.show(`${R.head('')}<div class="t">검색어가 없습니다</div><div class="s">관리자 화면에서 다시 [순위 확인]을 눌러 주세요.</div>`, 'err');
      return;
    }
    const job = { ...fresh, stage: 'search', page: 1, seen: 0, reloaded: {}, startedAt: Date.now(), done: false };

    if (!(await R.isLoggedIn())) {
      R.showLogin(job.keyword, R.Core.mainUrl(fresh)); // 로그인 뒤 같은 작업으로 메인에 돌아온다
      return;
    }
    await R.saveJob(job);
    R.show(`${R.head(job.keyword)}<div class="t">네이버에서 검색하는 중…</div>`);

    const input = await R.waitFor(() => document.querySelector('#query') || document.querySelector('input[name="query"]'), 10000);
    const form = input && (input.form || document.querySelector('form#sform'));
    if (!input || !form || typeof form.requestSubmit !== 'function') {
      await R.finish(job, { status: 'error', cause: 'main_search_absent', message: '네이버 메인 검색창을 찾지 못했습니다. 직접 검색해 주세요.' });
      return;
    }

    // 사람처럼 잠깐 화면을 보고, 검색창을 마우스로 눌러 한 글자씩 친다(허브 type_main_search — CDP insertText)
    await R.sleep(R.rand(800, 1800));
    await R.clickElement(input);
    input.focus();
    if (input.value) input.select(); // 남은 글자는 골라 두면 다음 글자가 덮어 쓴다
    await R.typeText(input, job.keyword);
    if (input.value !== job.keyword) {
      // 한 글자씩 넣기가 어긋났을 때만 값을 통째로 넣는다(허브와 같음)
      input.value = job.keyword;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await R.sleep(R.rand(400, 800));

    // 자동완성 창이 Enter 를 가로챌 수 있어 폼을 검색 버튼과 함께 제출한다(허브와 같음)
    const submitter = form.querySelector('#search-btn') || Array.from(form.elements).find((el) =>
      !el.disabled && ((el instanceof HTMLButtonElement && (!el.type || el.type === 'submit'))
        || (el instanceof HTMLInputElement && el.type === 'submit'))) || null;
    if (submitter) form.requestSubmit(submitter);
    else form.requestSubmit();
  }

  run().catch(() => { /* 메인 화면은 건드리지 않는다 */ });
})();

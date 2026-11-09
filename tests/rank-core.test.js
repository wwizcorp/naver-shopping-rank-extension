const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/rank-core.js');

/** __NEXT_DATA__ 모양 — 광고 adCount 개를 앞에 끼우고 일반 상품 count 개 (허브 실측: 광고 16 + 일반 40) */
function nextData({ page = 1, count = 40, adCount = 4, patch = {}, sourcePage } = {}) {
  const offset = (page - 1) * 40;
  const list = [];
  for (let i = 0; i < adCount; i++) {
    list.push({ item: { collection: 'product', id: `9${i}`, rank: i + 1, adId: `ad${i}`, mallName: '광고몰' } });
  }
  for (let i = 0; i < count; i++) {
    const rank = offset + i + 1;
    list.push({
      item: {
        collection: 'product', id: String(80000000000 + rank), rank,
        productName: `상품 ${rank}`, mallName: `몰${rank}`, mallId: `m${rank}`, mallCount: 1,
        mallProductId: `${rank}_1`, lowPrice: 10000 + rank, ...(patch[rank] || {}),
      },
    });
  }
  list.push({ item: { collection: 'banner', id: 'x' } });
  return JSON.stringify({
    props: { pageProps: { searchParam: { pagingIndex: sourcePage ?? page }, compositeList: { list } } },
  });
}

test('광고를 빼고 40개를 1..40 자리로 읽는다', () => {
  const r = core.parseNextData(nextData({ page: 2 }), 2);
  assert.equal(r.valid, true);
  assert.equal(r.cards.length, 40);
  assert.equal(r.adCount, 4);
  assert.equal(r.cards[0].rank, 41);
  assert.equal(r.cards[0].position, 1);
  assert.equal(r.last, false);
});

test('페이지 번호 클릭 뒤 남은 예전 JSON 은 stale', () => {
  const r = core.parseNextData(nextData({ page: 1, sourcePage: 1 }), 3);
  assert.deepEqual([r.valid, r.cause], [false, 'next_data_stale']);
});

test('40개 미만이 이어서 오면 마지막 페이지', () => {
  const r = core.parseNextData(nextData({ page: 3, count: 12 }), 3);
  assert.equal(r.valid, true);
  assert.equal(r.last, true);
});

test('순위가 끊기면 읽지 않는다', () => {
  const r = core.parseNextData(nextData({ page: 1, patch: { 5: { rank: 99 } } }), 1);
  assert.deepEqual([r.valid, r.cause], [false, 'organic_page_incomplete']);
});

test('JSON 이 없거나 구조가 다르면 실패 원인', () => {
  assert.equal(core.parseNextData('', 1).cause, 'next_data_absent');
  assert.equal(core.parseNextData('{', 1).cause, 'next_data_invalid');
  assert.equal(core.parseNextData('{"props":{}}', 1).cause, 'composite_list_absent');
});

test('MID 로 찾는다 — id·nvMid·링크 속 번호', () => {
  const page = core.parseNextData(nextData({
    page: 1,
    patch: { 7: { id: '111', nvMid: '222' }, 9: { crUrl: 'https://cr.shopping.naver.com/x?nvMid=333&catId=1' } },
  }), 1);
  assert.equal(core.findTarget(page.cards, { mid: '222' }).rank, 7);
  assert.equal(core.findTarget(page.cards, { mid: '333' }).rank, 9);
  assert.equal(core.findTarget(page.cards, { mid: '444' }), null);
});

test('EP id 는 쇼핑몰명이 같을 때만 (공백·대소문자 무시)', () => {
  const page = core.parseNextData(nextData({
    page: 2,
    patch: {
      45: { mallProductId: '11_3', mallName: '다른몰' },
      52: { mallProductId: '11_3', mallName: 'Wiz  샵' },
    },
  }), 2);
  const hit = core.findTarget(page.cards, { ep: '11_3', mall: 'wiz 샵' });
  assert.equal(hit.rank, 52);
  assert.deepEqual(core.foundResult(hit), {
    status: 'found', rank: 52, page: 2, position: 12, mid: String(80000000052),
    title: '상품 52', mallName: 'Wiz  샵', price: 10052,
  });
  assert.equal(core.findTarget(page.cards, { ep: '11_3', mall: '' }), null);
});

test('originalMallProductId 도 쇼핑몰 상품 ID 로 본다', () => {
  const page = core.parseNextData(nextData({ patch: { 3: { mallProductId: '', originalMallProductId: '7_2', mallName: '위즈샵' } } }), 1);
  assert.equal(core.findTarget(page.cards, { ep: '7_2', mall: '위즈샵' }).rank, 3);
});

test('가격비교 카드는 번호가 같아도 우리 상품이 아니다', () => {
  const page = core.parseNextData(nextData({
    patch: { 4: { id: '555', mallId: '', mallCount: 12, mallProductId: '11_3', mallName: '위즈샵' } },
  }), 1);
  assert.equal(page.cards[3].catalog, true);
  assert.equal(core.findTarget(page.cards, { mid: '555' }), null);
  assert.equal(core.findTarget(page.cards, { ep: '11_3', mall: '위즈샵' }), null);
});

test('페이지 주소 — 고정 조건을 채우고 pagingIndex 를 바꾼다', () => {
  const url = new URL(core.resultPageUrl('https://search.shopping.naver.com/search/all?query=%EC%A0%95%EC%88%98%EA%B8%B0&frm=NVSHATC#x', 3));
  const p = url.searchParams;
  assert.equal(p.get('pagingIndex'), '3');
  assert.equal(p.get('frm'), 'NVSHATC'); // 있는 값은 그대로
  assert.equal(p.get('origQuery'), '정수기');
  assert.equal(p.get('adQuery'), '정수기');
  assert.equal(p.get('pagingSize'), '40');
  assert.equal(p.get('productSet'), 'total');
  assert.equal(p.get('sort'), 'rel');
  assert.equal(p.get('viewType'), 'list');
  assert.equal(url.hash, '');
  assert.equal(core.pageFromUrl(url.toString()), 3);
});

test('1페이지 주소와 작업 정보가 왕복된다', () => {
  const job = { nonce: 'n1', origin: 'https://seller1.example.com', ep: '11_3', mall: '위즈샵', mid: '', max: 5, keyword: '' };
  const href = core.firstPageUrl('  코웨이  정수기 렌탈 ', job);
  const url = new URL(href);
  assert.equal(url.searchParams.get('query'), '코웨이 정수기 렌탈');
  assert.equal(url.searchParams.get('pagingIndex'), '1');
  assert.deepEqual(core.parseJobHash(url.hash), job);
});

test('작업 정보 검증 — nonce 필수, EP id 는 쇼핑몰명과 함께, http 는 localhost 만', () => {
  const enc = (o) => `#mublo-rank=${encodeURIComponent(JSON.stringify(o))}`;
  assert.equal(core.parseJobHash(enc({ ep: '1_1', mall: 'a' })), null);
  assert.equal(core.parseJobHash(enc({ nonce: 'n', ep: '1_1' })), null);
  assert.equal(core.parseJobHash('#mublo-rank=%7B'), null);
  assert.equal(core.parseJobHash(enc({ nonce: 'n', mid: '12a3', origin: 'http://evil.com' })).origin, '');
  assert.equal(core.parseJobHash(enc({ nonce: 'n', mid: '12a3', origin: 'http://localhost:8080' })).origin, 'http://localhost:8080');
  assert.equal(core.parseJobHash(enc({ nonce: 'n', mid: '12a3', max: 99 })).max, 5);
  assert.equal(core.parseJobHash(enc({ nonce: 'n', mid: '12a3' })).mid, '123');
});

test('installed.json 버전이 manifest 와 같다', () => {
  const manifest = require('../manifest.json');
  const installed = require('../installed.json');
  assert.equal(installed.version, manifest.version);
});

test('네이버 메인 주소 — 작업 정보(검색어 포함)가 왕복된다', () => {
  const job = { nonce: 'n1', origin: 'https://seller1.example.com', ep: '11_3', mall: '위즈샵', mid: '8812', max: 5, keyword: '코웨이 정수기 렌탈' };
  const url = new URL(core.mainUrl(job));
  assert.equal(url.origin + url.pathname, 'https://www.naver.com/');
  assert.equal(url.search, '', '검색 주소를 만들지 않는다');
  assert.deepEqual(core.parseJobHash(url.hash), job);
});

test('검색어는 공백을 하나로, 100자까지', () => {
  const enc = (o) => `#mublo-rank=${encodeURIComponent(JSON.stringify(o))}`;
  assert.equal(core.parseJobHash(enc({ nonce: 'n', mid: '1', keyword: '  업소용   정수기 ' })).keyword, '업소용 정수기');
  assert.equal(core.parseJobHash(enc({ nonce: 'n', mid: '1', keyword: 'a'.repeat(150) })).keyword.length, 100);
});

test('통합검색에서 쇼핑 결과로 가는 링크 — 가격비교 더보기, 없으면 쇼핑 탭', () => {
  const more = { name: '네이버 가격비교 더보기', href: 'https://search.shopping.naver.com/search/all?query=a' };
  const tab = { name: '쇼핑 새 창 열림', href: 'https://search.shopping.naver.com/search/all?query=a&frm=NVSHTTL' };
  const live = { name: '쇼핑라이브', href: 'https://shoppinglive.naver.com/search?query=a' };
  const other = { name: '더보기', href: 'https://search.naver.com/x' };
  assert.equal(core.pickShoppingLink([other, tab, more]), 2);
  assert.equal(core.pickShoppingLink([other, live, tab]), 2);
  assert.equal(core.pickShoppingLink([other, live]), -1);
});

test('보안 확인 화면 문구를 알아본다', () => {
  assert.equal(core.isSecurityText('정답을 입력해주세요 영수증'), true);
  assert.equal(core.isSecurityText('쇼핑 서비스 접속이 일시적으로 제한되었습니다'), true);
  assert.equal(core.isSecurityText('업소용 정수기 렌탈 최저가'), false);
});

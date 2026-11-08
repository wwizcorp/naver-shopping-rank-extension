/**
 * 네이버 쇼핑 PC 검색 결과에서 우리 상품의 순위를 찾는 순수 함수 모음.
 *
 * 규칙은 키워드 허브(rental-keyword-hub) 엔진과 같다.
 * - naver_shopping_uia/dom.py  _NEXT_DATA_RESULTS_EXPRESSION : __NEXT_DATA__ 읽기·광고 제외·40개 검증
 * - naver_shopping_uia/core.py _dom_card_matches             : MID / 쇼핑몰 상품 ID(EP id)+쇼핑몰명 매칭
 * - naver_shopping_uia/dom.py  result_page_url                : 페이지 주소의 고정 조건
 *
 * 브라우저(content script)에서는 globalThis.MubloRankCore, 테스트(node)에서는 require 로 쓴다.
 */
(function (root) {
  'use strict';

  const PER_PAGE = 40;
  const MAX_PAGES = 5;
  const HASH_KEY = 'mublo-rank';
  const RESULT_HOST = 'search.shopping.naver.com';

  const clean = (value) => String(value == null ? '' : value).trim();
  const unique = (values) => Array.from(new Set(values.map(clean).filter(Boolean)));
  /** 쇼핑몰명 비교 — 공백을 하나로, 소문자 (허브와 같음) */
  const normalizeMall = (value) => clean(value).replace(/\s+/g, ' ').toLowerCase();

  /** 주소의 pagingIndex (없으면 1) */
  function pageFromUrl(href) {
    try {
      return Number(new URL(href).searchParams.get('pagingIndex')) || 1;
    } catch (e) {
      return 1;
    }
  }

  /**
   * 결과 페이지 주소. pagingIndex 만 붙이면 '비정상적인 접근' 차단이 걸렸으므로(허브 실측)
   * 사람이 정상 이동한 목록 주소의 고정 조건을 없는 것만 채운다.
   */
  function resultPageUrl(href, page) {
    const url = new URL(href);
    const params = url.searchParams;
    const word = params.get('query') || params.get('origQuery') || params.get('adQuery') || '';
    const defaults = [
      ['adQuery', word], ['frm', 'NVSCPRO'], ['origQuery', word], ['pagingSize', String(PER_PAGE)],
      ['productSet', 'total'], ['query', word], ['sort', 'rel'], ['timestamp', ''], ['viewType', 'list'],
    ];
    for (const [key, value] of defaults) {
      if (!params.has(key)) params.append(key, value);
    }
    params.set('pagingIndex', String(page));
    url.hash = '';
    return url.toString();
  }

  /** 관리자 화면이 여는 1페이지 주소 (#mublo-rank= 작업 정보 포함) */
  function firstPageUrl(keyword, job) {
    const word = clean(keyword).replace(/\s+/g, ' ');
    const base = resultPageUrl(`https://${RESULT_HOST}/search/all?query=${encodeURIComponent(word)}`, 1);
    return job ? `${base}#${HASH_KEY}=${encodeURIComponent(JSON.stringify(job))}` : base;
  }

  /**
   * #mublo-rank= 작업 정보 → {nonce, origin, ep, mall, mid, max} (형식이 틀리면 null).
   * ep(쇼핑몰 상품 ID)는 쇼핑몰명과 함께여야 하고, mid 와 ep 중 하나는 있어야 한다.
   */
  function parseJobHash(hash) {
    const match = String(hash || '').match(new RegExp(`(?:^#|&)${HASH_KEY}=([^&]*)`));
    if (!match) return null;
    let raw;
    try {
      raw = JSON.parse(decodeURIComponent(match[1]));
    } catch (e) {
      return null;
    }
    if (!raw || typeof raw !== 'object') return null;
    const job = {
      nonce: clean(raw.nonce).slice(0, 64),
      origin: '',
      ep: clean(raw.ep).slice(0, 80),
      mall: clean(raw.mall).slice(0, 100),
      mid: clean(raw.mid).replace(/\D/g, '').slice(0, 20),
      max: Math.min(MAX_PAGES, Math.max(1, Number(raw.max) || MAX_PAGES)),
    };
    try {
      const origin = new URL(clean(raw.origin));
      const local = origin.hostname === 'localhost' || origin.hostname === '127.0.0.1';
      if (origin.protocol === 'https:' || (origin.protocol === 'http:' && local)) job.origin = origin.origin;
    } catch (e) { /* 결과를 돌려보낼 곳이 없으면 네이버 탭에만 표시한다 */ }
    if (!job.nonce) return null;
    if (!job.mid && !(job.ep && job.mall)) return null;
    return job;
  }

  /** 가격비교 카드 — 판매처가 여럿이고 단일 쇼핑몰 id 가 없다 (허브와 같음) */
  function isCatalog(item) {
    return Number(item.mallCount || 0) > 1 && !clean(item.mallId);
  }

  const advertised = (item) => Boolean(clean(item.adId) || clean(item.adcrUrl));

  /** URL 안의 네이버 상품번호 */
  function idsFromUrl(href) {
    const ids = [];
    const re = /[?&](?:nvMid|nv_mid|productId|product_id)=(\d+)/gi;
    let m;
    while ((m = re.exec(String(href || ''))) !== null) ids.push(m[1]);
    return ids;
  }

  function cardFromItem(item, offset) {
    const conditions = Array.isArray(item.purchaseConditionInfos) ? item.purchaseConditionInfos : [];
    const hrefs = unique([item.crUrl, ...conditions.map((c) => c && c.crUrl), item.mallPcUrl, item.mallProductUrl]);
    const id = clean(item.id);
    return {
      rank: Number(item.rank),
      position: Number(item.rank) - offset,
      id,
      ids: unique([id, item.nvMid, ...hrefs.flatMap(idsFromUrl)]),
      catalog: isCatalog(item),
      title: clean(item.productName || item.productTitle),
      mallName: clean(item.mallName),
      mallProductId: clean(item.mallProductId || item.originalMallProductId),
      price: Number(item.lowPrice || item.price || 0) || null,
      imageUrl: clean(item.imageUrl),
      href: hrefs[0] || '',
    };
  }

  /**
   * __NEXT_DATA__ 글자 → 한 페이지의 광고 제외 상품.
   * @returns {{valid:true, page:number, cards:object[], last:boolean, adCount:number}
   *          | {valid:false, cause:string, page?:number, sourcePage?:number}}
   *  - next_data_stale: 페이지 번호 클릭 뒤 JSON 이 처음 페이지 값으로 남음 → 새로고침하면 된다
   *  - organic_page_incomplete: 순위가 이어지지 않음(화면 구조 변경 등)
   *  last: 40개보다 적게 왔다 — 마지막 페이지다.
   */
  function parseNextData(text, pageFromAddress) {
    if (!text) return { valid: false, cause: 'next_data_absent' };
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { valid: false, cause: 'next_data_invalid' };
    }
    const props = data && data.props && data.props.pageProps;
    const list = props && props.compositeList && props.compositeList.list;
    if (!Array.isArray(list)) return { valid: false, cause: 'composite_list_absent' };
    const page = Number(pageFromAddress) || 1;
    const sourcePage = Number(props.searchParam && props.searchParam.pagingIndex) || 1;
    if (sourcePage !== page) return { valid: false, cause: 'next_data_stale', page, sourcePage };

    const products = list.map((entry) => entry && entry.item).filter((item) => item && item.collection === 'product');
    const organic = products.filter((item) => !advertised(item));
    const offset = (page - 1) * PER_PAGE;
    const ranks = organic.map((item) => Number(item.rank));
    const contiguous = organic.length <= PER_PAGE
      && ranks.every((rank, index) => Number.isInteger(rank) && rank === offset + index + 1);
    if (!contiguous || (organic.length === 0 && page === 1 && products.length > 0)) {
      return { valid: false, cause: 'organic_page_incomplete', page, organicCount: organic.length };
    }
    return {
      valid: true,
      page,
      cards: organic.map((item) => cardFromItem(item, offset)),
      last: organic.length < PER_PAGE,
      adCount: products.length - organic.length,
    };
  }

  /**
   * 우리 상품인가. 가격비교 카드는 어느 경우에도 우리 상품으로 치지 않는다(허브와 같음).
   * - mid: 카드의 상품번호(id·nvMid·링크 속 번호) 중 하나와 같다
   * - ep : 쇼핑몰 상품 ID 가 같고 쇼핑몰명도 같다 — EP id 는 몰마다 겹칠 수 있다
   */
  function matchCard(card, target) {
    if (card.catalog) return false;
    const mid = clean(target.mid);
    if (mid && card.ids.includes(mid)) return true;
    const ep = clean(target.ep);
    const mall = normalizeMall(target.mall);
    return Boolean(ep && mall && card.mallProductId === ep && normalizeMall(card.mallName) === mall);
  }

  function findTarget(cards, target) {
    return cards.find((card) => matchCard(card, target)) || null;
  }

  /** 찾은 카드 → 관리자 화면에 돌려줄 결과 */
  function foundResult(card) {
    return {
      status: 'found',
      rank: card.rank,
      page: Math.ceil(card.rank / PER_PAGE),
      position: card.position,
      mid: card.id,
      title: card.title,
      mallName: card.mallName,
      price: card.price,
    };
  }

  const api = {
    PER_PAGE, MAX_PAGES, HASH_KEY, RESULT_HOST,
    normalizeMall, pageFromUrl, resultPageUrl, firstPageUrl, parseJobHash,
    isCatalog, idsFromUrl, parseNextData, matchCard, findTarget, foundResult,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MubloRankCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

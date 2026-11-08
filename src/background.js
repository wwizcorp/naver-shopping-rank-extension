/**
 * 네이버 로그인 확인 — content script 는 쿠키를 볼 수 없어 여기서 본다.
 * NID_AUT 는 네이버 로그인 쿠키(.naver.com)라 search.shopping.naver.com 주소로 조회된다.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'mublo-rank:login') return false;
  chrome.cookies.get({ url: 'https://search.shopping.naver.com/', name: 'NID_AUT' }, (cookie) => {
    sendResponse({ loggedIn: Boolean(cookie && cookie.value) });
  });
  return true; // 비동기 응답
});

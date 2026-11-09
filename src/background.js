/**
 * 백그라운드 — content script 가 못 하는 세 가지.
 *
 * 1) 네이버 로그인 확인: content script 는 쿠키를 볼 수 없다.
 *    NID_AUT 는 네이버 로그인 쿠키(.naver.com)라 search.shopping.naver.com 주소로 조회된다.
 * 2) 탭별 작업 저장(0.2.0~): 네이버 메인 → 통합검색 → 쇼핑 결과로 주소(origin)가 바뀌어도 작업이 이어지도록
 *    chrome.storage.session 에 탭 번호로 둔다. 브라우저를 닫으면 지워진다.
 *    통합검색의 쇼핑 링크가 새 탭으로 열리면 그 탭으로 작업을 옮긴다.
 * 3) 스스로 다시 불러오기(0.2.1~): Chrome 은 압축해제 확장을 자동 업데이트하지 않는다. 렌탈 스튜디오가 폴더 파일을
 *    새 릴리스로 바꾸면, 폴더의 installed.json 버전이 지금 돌고 있는 manifest 버전과 달라진다 — 그때 reload 해
 *    Chrome 을 다시 켜지 않아도 새 버전이 돈다. 압축해제 확장의 파일은 디스크에서 바로 읽힌다.
 */
const key = (tabId) => `job:${tabId}`;
const FILES_ALARM = 'mublo-rank:files';

async function reloadIfFilesChanged() {
  let disk = '';
  try {
    const res = await fetch(chrome.runtime.getURL('installed.json'), { cache: 'no-store' });
    disk = String((await res.json()).version || '');
  } catch (e) {
    return; // 파일을 바꾸는 중일 수 있다 — 다음에 다시 본다
  }
  const running = chrome.runtime.getManifest().version;
  if (!disk || disk === running) return;
  // 같은 버전으로 두 번 reload 하지 않는다(파일이 어긋나 manifest 가 그대로면 계속 돌게 된다)
  const { reloadedFor } = await chrome.storage.local.get('reloadedFor');
  if (reloadedFor === disk) return;
  await chrome.storage.local.set({ reloadedFor: disk });
  chrome.runtime.reload();
}
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create(FILES_ALARM, { periodInMinutes: 5 }));
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(FILES_ALARM, { periodInMinutes: 5 });
  reloadIfFilesChanged();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FILES_ALARM) reloadIfFilesChanged();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message && message.type;
  const tabId = sender.tab && sender.tab.id;

  if (type === 'mublo-rank:login') {
    chrome.cookies.get({ url: 'https://search.shopping.naver.com/', name: 'NID_AUT' }, (cookie) => {
      sendResponse({ loggedIn: Boolean(cookie && cookie.value) });
    });
    return true; // 비동기 응답
  }
  if (typeof tabId !== 'number') return false;

  if (type === 'mublo-rank:job:get') {
    chrome.storage.session.get(key(tabId)).then((items) => sendResponse({ job: items[key(tabId)] || null }));
    return true;
  }
  if (type === 'mublo-rank:job:set') {
    chrome.storage.session.set({ [key(tabId)]: message.job }).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

// 쇼핑 링크가 새 탭으로 열렸다 — 쇼핑 결과로 넘어가던 작업을 새 탭으로 옮긴다
chrome.tabs.onCreated.addListener(async (tab) => {
  if (typeof tab.openerTabId !== 'number') return;
  const items = await chrome.storage.session.get(key(tab.openerTabId));
  const job = items[key(tab.openerTabId)];
  if (!job || job.done || job.stage !== 'shopping') return;
  await chrome.storage.session.set({ [key(tab.id)]: job });
  await chrome.storage.session.remove(key(tab.openerTabId));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(key(tabId));
});

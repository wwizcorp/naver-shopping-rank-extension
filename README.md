# N쇼핑순위검색 (Chrome 익스텐션)

렌탈 SaaS 관리자의 **미션카드 제작 요청** 창에서 목표 키워드나 미션 키워드로 [순위 확인]을 누르면,
네이버 쇼핑 **PC 검색 5페이지(200위)** 안에 우리 상품이 있는지 관리자 본인 브라우저(네이버 로그인 상태)에서 확인합니다.

- 네이버 쇼핑 순위를 주는 API는 없습니다. 서버에서 검색하면 네이버가 막기 때문에 관리자 브라우저에서 1회 검색합니다.
- PC 순위와 모바일 순위는 같으므로 PC 결과를 기준으로 합니다.
- 상품 찾기 규칙은 키워드 허브(`D:\project\python\rental-keyword-hub`) 엔진과 같습니다(`src/rank-core.js` 머리말 참고).
  - 광고(`adId`·`adcrUrl`)는 빼고, `__NEXT_DATA__`의 일반 상품 40개가 이어진 순위일 때만 믿습니다.
  - **MID**: 상품번호(`id`·`nvMid`·링크 속 번호)가 일치하면 우리 상품입니다.
  - **쇼핑몰 상품 ID(EP id)**: `mallProductId`와 **쇼핑몰명**이 모두 일치해야 합니다. EP id는 몰마다 겹칠 수 있습니다.
  - 가격비교 카드는 번호가 같아도 우리 상품으로 치지 않습니다.

## 구성

| 파일 | 하는 일 |
|---|---|
| `src/rank-core.js` | 순수 함수: `__NEXT_DATA__` 읽기, 상품 매칭, 페이지 주소, 작업 정보 검증 |
| `src/naver-content.js` | 네이버 쇼핑 검색 탭에서 실행: 로그인 확인, 1→5페이지 넘기기, 결과 상자 표시, 관리자 탭으로 결과 보내기 |
| `src/background.js` | 네이버 로그인 쿠키(`NID_AUT`) 확인 |
| `installed.json` | 관리자 화면이 설치 여부와 버전을 확인하는 파일. 버전은 `manifest.json`과 같아야 합니다(테스트가 확인) |

권한은 `cookies`와 `https://search.shopping.naver.com/*`만 씁니다. 관리자 화면 쪽 권한은 쓰지 않습니다.

## 관리자 화면과 주고받는 형식

### 1. 설치 여부 확인
```js
fetch(`chrome-extension://${EXTENSION_ID}/installed.json`)
  .then(r => r.json())            // {name: "naver-shopping-rank", version: "0.1.0"}
  .catch(() => null);              // 설치되지 않음
```

### 2. 순위 확인 열기
`window.open`으로 엽니다. 결과를 돌려받으려면 `noopener`를 쓰면 안 됩니다.
```
https://search.shopping.naver.com/search/all?adQuery=…&frm=NVSCPRO&origQuery=…&pagingSize=40
  &productSet=total&query=키워드&sort=rel&timestamp=&viewType=list&pagingIndex=1
  #mublo-rank=<encodeURIComponent(JSON)>
```
| 키 | 필수 | 설명 |
|---|---|---|
| `nonce` | ✔ | 요청마다 새로 만드는 값. 결과 메시지와 비교합니다 |
| `origin` | | 관리자 화면 `location.origin`. https만 받고, http는 localhost만 받습니다 |
| `mid` | △ | 네이버 상품번호 |
| `ep` + `mall` | △ | EP id(`{goods_id}_{plan_id}`)와 네이버 쇼핑몰명(`rental_config.naver_shop_name`) |
| `max` | | 확인할 페이지 수(1~5, 기본 5) |

`mid`와 `ep`+`mall` 중 하나는 반드시 있어야 합니다.

### 3. 결과 받기
```js
window.addEventListener('message', (e) => {
  if (e.origin !== 'https://search.shopping.naver.com') return;
  if (e.data?.type !== 'mublo-rank:result' || e.data.nonce !== nonce) return;
  // found     : {status, rank, page, position, mid, title, mallName, price, keyword, version}
  // not_found : {status, seen, pages, keyword, version}
  // error     : {status, cause, message, keyword, version}
});
```
네이버가 `Cross-Origin-Opener-Policy`로 연결을 끊으면 관리자 화면으로 결과가 오지 않습니다. 그래도 네이버 탭의 결과 상자에는 항상 결과가 표시됩니다.

## 개발과 테스트

```bash
npm run check   # 문법 검사와 파서 단위 테스트
```

직접 테스트하는 방법:
1. `chrome://extensions`를 열고 개발자 모드를 켭니다. [압축해제된 확장 프로그램 로드]로 이 폴더를 고릅니다.
2. 네이버에 로그인합니다.
3. 개발자 도구 콘솔에서 주소를 만들어 엽니다.
   ```js
   // 이 폴더의 src/rank-core.js 내용을 콘솔에 붙여 넣은 뒤
   open(MubloRankCore.firstPageUrl('정수기 렌탈', {nonce:'t1', ep:'11_3', mall:'위즈샵', max:5}))
   ```
4. 오른쪽 위 결과 상자를 확인합니다. 키워드 허브의 `find_rank` 결과와 같은지도 비교합니다.

## 배포 (웹스토어 없음 — 렌탈 스튜디오 또는 GitHub 릴리스)

웹스토어에 올리지 않는다(2026-11-09). 설치 길은 둘이다.

1. **렌탈 스튜디오**: 설치본에 이 확장을 담고, 회원이 [설치]를 누르면 회원 Chrome 에 '압축해제된 확장 프로그램'으로 넣는다
   (스튜디오 `app/rental/chrome_extension.py`).
2. **GitHub 릴리스**(공개 저장소): 렌탈 SaaS 네이버 EP 상품 **[순위검색 확장 설치]** 모달이 최신 릴리스의
   `naver-shopping-rank.zip` 을 내려받게 하고, `installed.json` 으로 최신 버전을 알아본다(1시간 캐시).
   ```
   https://github.com/wwizcorp/naver-shopping-rank-extension/releases/latest/download/naver-shopping-rank.zip
   https://github.com/wwizcorp/naver-shopping-rank-extension/releases/latest/download/installed.json
   ```
   `npm run release` 가 검사·zip 만들기·릴리스(`v{버전}`)까지 한다. 두 파일 이름은 바꾸지 않는다.

- **확장 ID 는 `manifest.json` 의 `key` 로 고정된다: `njjglppimiohnemnmepcenogmccioimp`.** 모든 PC 에서 같다.
  `key` 를 바꾸거나 지우면 ID 가 바뀌어 SaaS 가 설치를 못 알아본다. 짝이 되는 개인키 `extension-key.pem` 은
  git 에 넣지 않는다(지금 방식에서는 쓰지 않지만 crx 로 묶을 일이 생기면 필요하다).
- 렌탈 SaaS `.env` 는 비워 둔다. ID 는 고정값을, 최신 버전은 GitHub 릴리스를 쓴다(다른 key 로 시험할 때만 `RENTAL_RANK_EXTENSION_ID`).
- 업데이트:
  1. `manifest.json`·`installed.json` 버전을 함께 올리고 PR 을 main 에 병합한다.
  2. `npm run release` — GitHub 릴리스가 올라가면 SaaS 모달이 1시간 안에 새 버전을 안내한다. SaaS 는 다시 올릴 필요 없다.
  3. 스튜디오 저장소에서 `python tools/port_rank_extension.py D:/project/mublo/naver-shopping-rank-extension` 로 복사해
     스튜디오를 배포한다. 스튜디오가 켜질 때 회원 PC 의 확장 폴더를 새 파일로 바꾸고, 회원이 Chrome 을 다시 켜면 반영된다.

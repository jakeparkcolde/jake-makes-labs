# 스크린샷 한 장을 실제 웹페이지로 · Jake Makes

영상에서 사용한 입력 디자인, 글자 없는 제품 사진, 첫 출력, 최종 코드와 실제 수정 요청문입니다. PULSE는 가상의 실습용 브랜드입니다.

- [입력 디자인 PNG](source-design-v1.png)
- [수정에 사용한 제품 사진 PNG](pulse-product-v1.png)
- [도구에서 내려받은 최종 코드 ZIP](screenshot-to-code-export.zip)
- [실제 수정 요청문](ACTUAL-FIX-REQUEST.txt) · [공개용 URL 치환 안내](REQUEST-NOTE.md)
- [첫 출력 HTML](first-demo/index.html) · [최종 HTML](exported-demo/index.html)

압축 파일을 내려받아 풀고 이 폴더에서 `python3 -m http.server 8080`을 실행한 뒤 `http://localhost:8080/exported-demo/`를 열면 결과를 확인할 수 있습니다.

이미지: Codex GPT image_gen. 코드: screenshot-to-code의 Gemini 후보 생성. 첫 결과의 글자 겹침을 제품 전용 사진과 수정 요청으로 개선했습니다. 완성 쇼핑몰을 만든 사례는 아닙니다.

## 실제 실행

공식 저장소: https://github.com/abi/screenshot-to-code
검증 커밋: d026163f586dfa8c5c10d28c36edd59a9d3b0e88
macOS, Python3.11.15, Poetry 잠금 의존성81개, pnpm.

아래는 이번 디렉터리 구성의 실행 절차입니다. 표준 README의 선택적 Chromium 설치는 생략하고, 제공한 launch_backend.py로 자동 미리보기를 비활성화했습니다. 실제 코드 생성 구현은 바꾸지 않았습니다. 설치 장면은 실제 사용한 명령을 읽기 쉽게 요약한 재구성입니다.

```sh
mkdir -p vendor
git clone https://github.com/abi/screenshot-to-code.git vendor/screenshot-to-code
git -C vendor/screenshot-to-code checkout d026163f586dfa8c5c10d28c36edd59a9d3b0e88
cd vendor/screenshot-to-code/backend
poetry config virtualenvs.in-project true --local
poetry env use python3.11
poetry install
```

backend/.env에 본인 GEMINI_API_KEY를 저장합니다. 기존 파일을 덮어쓰지 말고 필요한 항목만 설정합니다. 키 자체는 영상과 배포 자료에서 제외했습니다. 

프로젝트 루트의 launch_backend.py와 vendor 디렉터리를 같은 위치에 둡니다.

```sh
# 터미널 A: 프로젝트 루트
vendor/screenshot-to-code/backend/.venv/bin/python launch_backend.py
```

```sh
# 터미널 B: vendor/screenshot-to-code/frontend
PUPPETEER_SKIP_DOWNLOAD=true pnpm install --frozen-lockfile --ignore-scripts
pnpm dev --host 127.0.0.1 --port 9371 --strictPort
```

Aside에서 http://127.0.0.1:9371/ 을 엽니다. Settings에서 이미지 자동 생성 OFF를 확인합니다. HTML+Tailwind 선택 후 원본 디자인을 업로드하고 첫 생성을 실행합니다. 위 포트가 다른 작업에서 사용 중이면 가용 포트로 조정해야 합니다. Windows 설치는 이번에 검증하지 않았습니다.

## 실제 결과와 수정

첫 생성4개 후보를 보존했습니다. 원본 글자가 포함된 이미지 위에 새 HTML 제목이 겹치는 문제가 있었습니다. 후보1은 겹침이 특히 뚜렷했고, 후보4도 잔여 글자와 이미지 확대 문제가 남았습니다.

후보4에서 GPT image_gen으로 별도 제작한 글자 없는 제품 사진을 제공하고 ACTUAL-FIX-REQUEST.txt의 수정 요청을 1회 보냈습니다. 도구가 반환한 수정 후보2개 중 두 번째를 선택했습니다. 수정 후보1은 모바일 메뉴 텍스트 잔상이 남아 최종 선택하지 않았습니다.

실제 Download Code에서 ZIP을 내려받았습니다. ZIP의 index.html과 assets/image-1.png를 풀어 재실행했습니다. 최종 데모의 HTML 로직은 수동 수정하지 않았습니다. 원본 보존용 첫 데모는 로컬 자산 주소만 상대 경로로 변경했습니다.

## 검증된 범위

- 데스크톱1280px: document scrollWidth1280. 이미지4개 로드 성공.
- 데스크톱 CTA: #details 이동, scrollY326 확인.
- 모바일375px: document scrollWidth375. 메뉴 열기/닫기 확인.
- 모바일 CTA: #details 이동, scrollY653 확인.
- 위 메뉴 SOUND/DESIGN/SPECS는 모두 같은 #details로 이동합니다. 개별 섹션은 구현되지 않았습니다.
- 모바일 실기기, 키보드/스크린리더 접근성, 로그인, 결제, 주문 관리는 검증/구현 범위 밖입니다. 메뉴 버튼에는 접근성 이름이 부족합니다.
- 외부 Tailwind CDN과 Google Fonts가 필요합니다. 완전한 오프라인 배포물은 아닙니다.

## 시간·비용

첫 생성 마지막 후보 약2분7초, 선택한 수정 후보 약2분15초. 코드 생성 토큰 로그6개 합계 추정 $0.8864. 실제 청구 금액이 아니며, 이미지 생성·음성 비용은 제외했고 자산 추출 등 추가 비용이 있을 수 있습니다. 검증 기록의 코드 생성 로그 합계이며 실제 청구서가 아닙니다.


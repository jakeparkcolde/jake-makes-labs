# 글로 된 설명을 Manim 영상으로 만들기

제이크메이크스 Manim 실습 자료입니다. 입력 숫자 `[5, 2, 4, 1, 3]`을 버블 정렬하는 실제 예제를 제공합니다.

- `bubble_sort.py`: 실행할 코드. 숫자와 막대를 한 그룹으로 묶습니다.
- `input.json`: 영상에서 사용한 입력.
- `INITIAL-REQUEST.txt`: 첫 장면의 재현용 요청문.
- `EDIT-REQUEST.txt`: 비교 대상 강조와 멈춤을 추가하는 재현용 수정 요청문.
- `pyproject.toml`, `uv.lock`, `.python-version`: 확인한 의존성과 Python 버전.

요청문 파일은 제작 조건을 정리한 따라하기 자료입니다. 특정 서비스의 대화 내보내기 파일은 아닙니다. Plain과 Explained는 같은 코드에서 편집 조건을 의도적으로 달리한 두 장면입니다. 첫 실패와 성공의 성능 비교로 해석하지 않습니다.

## macOS에서 실행

이번 영상은 Apple Silicon Mac, Python 3.12.13, Manim Community 0.21.0, Cairo 렌더러에서 확인했습니다. 아래 명령은 터미널에 한 줄씩 입력합니다.

Homebrew가 설치되어 있다면:

```sh
brew install uv cairo pango pkg-config
```

이 저장소를 받은 뒤:

```sh
git clone https://github.com/jakeparkcolde/jake-makes-labs.git
cd jake-makes-labs/manim
uv sync --python 3.12.13 --link-mode copy
uv run manim -ql bubble_sort.py Plain
uv run manim -ql bubble_sort.py Explained
```

저화질 출력은 `media/videos/bubble_sort/480p15/` 아래의 MP4 파일입니다. 이번 예제는 Text와 기본 도형만 사용하므로 LaTeX 없이 실행했습니다.

최종 720p 영상:

```sh
uv run manim -r 1280,720 --fps 30 bubble_sort.py Explained
```

출력: `media/videos/bubble_sort/720p30/Explained.mp4`.

Manim CLI를 직접 실행할 때 PATH가 잡히지 않으면 프로젝트 안에서 `uv run manim`을 사용하세요. 작업 폴더 밖의 기존 Python 환경을 변경할 필요는 없습니다.

## 어디를 바꾸나요?

`VALUES`는 입력 숫자, `FONT`는 설치된 글꼴 이름, `BLUE`는 강조색입니다. 예제의 화면 크기는 숫자 다섯 개를 기준으로 했습니다. 큰 숫자나 많은 항목을 넣으면 막대 배치도 조정해야 합니다.

`Explained`는 비교 전에 0.65초 멈추고, 교환을 0.9초에 걸쳐 보여줍니다. `Plain`은 설명 표시 없이 0.25초에 교환합니다. 영상 본편의 일부 확대 장면은 설명을 위해 느리게 재생했고 해당 구간에 표시했습니다.

`FONT = "Apple SD Gothic Neo"`는 이번 Mac에서 확인한 글꼴입니다. 다른 OS에서는 설치된 한국어 글꼴 이름으로 바꾸세요. Windows/Linux의 설치 및 실행은 이번 제작에서 검증하지 않았습니다. 공식 환경별 안내를 확인해 주세요.

코드 끝에서 최종 배열이 정렬됐는지와 막대의 좌우 위치를 검사합니다. 이 검사가 자막 겹침이나 가독성까지 보증하지는 않으므로 MP4도 직접 확인하세요.

## 설치가 지연되거나 네이티브 라이브러리를 못 찾을 때

외장 드라이브의 패키지 캐시를 심볼릭 링크로 연결한 환경에서 네이티브 라이브러리 로딩 문제를 경험했습니다. 위 설치 명령은 프로젝트 환경으로 파일을 복사하도록 설정했습니다. 기존 자료나 캐시를 지울 필요는 없습니다.

## 출처와 사용 범위

- [Manim 공식 저장소](https://github.com/ManimCommunity/manim)
- [공식 설치 안내](https://docs.manim.community/en/stable/installation/uv.html)

이 저장소의 실습 코드는 직접 수정해 사용할 수 있습니다. Manim 및 각 의존 패키지에는 해당 프로젝트의 라이선스가 적용됩니다. 폰트 파일은 포함하지 않았습니다. 코딩 에이전트의 구독/API 비용은 사용 중인 서비스에 따라 별도입니다.

## 실제 출력 파일

[빠른 동작 Plain.mp4](examples/Plain.mp4)와 [설명을 추가한 Explained.mp4](examples/Explained.mp4)를 함께 제공합니다. 새 Python 3.12.13 환경에서도 두 장면의 저화질 렌더와 코드의 정렬 검사를 통과했습니다.

[실습 자료 ZIP 다운로드](https://github.com/jakeparkcolde/jake-makes-labs/raw/refs/heads/main/manim/jake-makes-manim-lab-v1.zip)

# 개발 안내

도토의 빌드, 검사와 구현 구조를 설명합니다. 앱 소개와 사용 흐름은 [README](../README.md)를 확인하세요.

## 실행하기

macOS 13 이상, Xcode Command Line Tools와 인터넷 연결이 필요해요. 터미널에 아래 세 줄을 붙여넣으면 빌드 후 도토가 열립니다.

```sh
git clone https://github.com/JeonJe/doto.git &&
cd doto &&
bash macos/build.sh && open dist/Doto.app
```

다음부터는 `doto/dist/Doto.app`을 더블클릭하면 돼요. Node나 npm 패키지를 따로 설치할 필요는 없습니다.

<details>
<summary>Xcode Command Line Tools가 없다면</summary>

아래 명령으로 설치 창을 열고, 설치를 마친 뒤 위 실행 명령을 입력하세요.

```sh
xcode-select --install
```

</details>

## 검사하기 (선택)

앱을 실행하는 데 테스트는 필요하지 않아요. 코드를 변경했다면 저장소 폴더에서 실행하세요. 검사는 임시 데이터와 가짜 설치 도구를 사용하며 사용자 패키지를 업데이트하지 않습니다.

```sh
./dist/Doto.app/Contents/Resources/runtime/node --test tests/*.test.mjs
```

## 설치 파일 만들기 (선택)

설치 파일을 만들려면 다음 명령을 실행합니다.

```sh
bash macos/package.sh
```

생성 파일과 SHA256SUMS는 `submission/artifacts/`에 있습니다. 번들만으로 빈 환경에서 실행되는지 확인할 수 있어요.

```sh
bash submission/verify-mac.sh dist/Doto.app
```

이 검사는 Finder 최초 실행, macOS 보안 승인, 다른 맥 실기 검증을 대신하지 않습니다.

첫 빌드에서 공식 Node 22.23.3을 다운로드하고 SHA-256을 검증합니다. 런타임은 앱에 포함되며 npm 의존성 설치는 없습니다.

## 지원 범위와 데이터

설치 목록은 Homebrew 공식 core/cask와 PATH에서 찾은 npm 전역 패키지를 사용합니다. 일반 macOS 앱 전체와 별도 Homebrew tap, PATH 밖의 설치는 탐색하지 않습니다. CLI 또는 npm 설치 위치가 여러 개면 사용자가 하나를 고릅니다.

GitHub의 `stablyai/orca` 주소는 `/Applications/Orca.app`과 `~/Applications/Orca.app`의 번들 식별자를 확인해 설치 버전과 비교합니다. 여러 위치에 있으면 사용할 위치를 선택해 주세요. 업데이트 적용은 Orca에서 진행합니다. 그 밖의 GitHub 저장소는 릴리스 소식 구독이며, 로컬 설치 버전과 비교하지 않습니다.

업데이트는 수동으로 실행합니다. 앱 종료와 맥 잠자기 중에는 확인하지 않으며 로그인 시 자동 실행은 제공하지 않습니다. 실제 패키지 업데이트에는 설치 관리자와 권한이 필요합니다.

데이터는 `~/Library/Application Support/MomoPrototype`에 저장됩니다. 기존 데이터와 설정의 호환성을 위해 내부 식별자와 데이터 경로를 유지했습니다.

Developer ID 서명과 Apple 공증, 실제 다른 맥의 최초 실행 검증은 남아 있습니다. 최소 지원 OS를 대상으로 빌드했다는 사실이 해당 OS의 실기 검증을 의미하지는 않습니다.

## 구조와 진단

- `macos/Momo.swift`: 맥 창, 메뉴 막대, 알림과 번들 서버 실행
- `server.mjs`: 버전 조회, 설치 위치 선택, 업데이트와 상태 저장
- `inventory.mjs`: 설치 관리자와 CLI 경로 탐색
- `app.js`, `index.html`, `style.css`, `pet.svg`: 화면과 캐릭터
- `tests/`: 경로 선택, 일괄 업데이트, 버전 비교, 예약, 장애와 독립 환경 검사
- `submission/`: 전달 안내와 검증 결과

서버는 준비되면 `MOMO http://127.0.0.1:<port>`를 출력합니다. 해당 주소의 `/api/state`는 준비 상태와 목록을 반환해요. 상태 변경 요청은 같은 로컬 출처만 허용합니다.

개발 실행은 번들 Node로 `server.mjs`를 실행합니다. `MOMO_DATA_DIR`로 절대 경로의 별도 데이터를, `MOMO_PORT=0`으로 빈 포트를 지정할 수 있어요. 맥 앱에서 `MOMO_TOOL_PATH`를 지정하면 도구 탐색 환경을 분리할 수 있습니다. `MOMO_RUNTIME_CACHE`는 빌드 런타임 캐시 경로입니다.

## 검증 현황과 협업 기록

최신 판정은 [배포 준비 상태](../submission/RELEASE-READINESS.md), 다른 맥 실기 항목은 [수신 환경 확인표](../submission/SECOND-MAC-CHECK.md)에 기록합니다. 직접 설치 업데이트는 모의 도구로 검사하며 모든 실제 패키지 조합의 성공을 보장하지 않습니다.

[설계와 AI 협업 기록](../submission/DECISIONS.md)에 사용자가 결정한 범위와 AI 구현 결과의 수정 과정을 남겼습니다.

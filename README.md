# 도토 (Doto)

내가 쓰는 개발 도구에 새 버전이 나오면 알려주는 macOS 앱이에요. 도구별 확인 주기를 정하고, 변경 내용을 확인한 뒤 원하는 항목을 함께 업데이트할 수 있습니다. AI 계정이나 별도 서버는 필요하지 않아요.

## 어떤 불편을 줄이나요?

개발 도구마다 새 버전이 나왔는지 찾아보고, 설치한 위치와 업데이트 방법을 다시 확인하는 일을 줄입니다. 도토에 필요한 도구만 등록해 두고 새 버전이 나왔을 때 확인하세요.

## 사용 흐름

1. Claude Code, Codex, Gemini CLI, Grok Build 중 고르거나 ‘다른 도구 찾기’로 설치 목록을 엽니다.
2. 도구별 확인 주기를 정합니다. 설치 위치가 여러 개면 사용할 위치를 선택해요.
3. 새 버전 알림에서 해당 도구를 열어 변경 내용을 확인합니다.
4. 원하는 항목을 선택해 함께 업데이트하고, 각각의 결과를 확인하세요.

<table>
<tr><td align="center"><strong>모니터링 목록</strong></td><td align="center"><strong>설치 위치 선택</strong></td></tr>
<tr><td><img src="docs/images/current-monitoring.jpg" alt="도토의 모니터링 목록" width="340"></td><td><img src="docs/images/current-installation.jpg" alt="설치된 경로와 버전을 비교해 선택하는 화면" width="340"></td></tr>
</table>

위 화면은 별도 검증 데이터입니다. 경로와 버전은 시연용이며 실제 사용자 환경과 다를 수 있어요. 업데이트 동작은 사용자 도구를 변경하지 않는 모의 환경에서 검사했습니다.

## 현재 제공 상태

**소스와 시연 화면을 공개합니다. 일반 설치 파일 배포는 준비 중입니다.** Developer ID 서명과 Apple 공증, 실제 다른 맥의 최초 실행 검증이 남아 있어요. 이 저장소에 DMG나 계정 정보, 제작자의 모니터링 데이터는 포함하지 않습니다.

Apple Silicon, macOS 13 이상을 대상으로 만들었습니다. 최소 지원 OS와 다른 맥의 실기 검증은 아직 완료하지 않았어요. 앱 이름은 **도토**, 파일명은 **Doto.app**입니다. 창을 닫아도 메뉴 막대에서 계속 실행되며 Cmd+Q로 종료할 수 있어요.

## 소스에서 빌드하고 검사하기

필수 환경은 macOS 13 이상, Xcode Command Line Tools와 인터넷 연결입니다. 이 저장소를 복제한 뒤 아래 명령을 실행하세요. 첫 빌드에서 공식 Node 22.23.3을 다운로드하고 SHA-256을 검증합니다. npm 의존성 설치는 없습니다.

```sh
git clone https://github.com/JeonJe/doto.git
cd doto
bash macos/build.sh
./dist/Doto.app/Contents/Resources/runtime/node --test tests/*.test.mjs
```

빌드된 `dist/Doto.app`을 Finder에서 열어 실행하세요. 검사는 임시 데이터와 가짜 설치 도구를 사용하며 사용자 패키지를 업데이트하지 않습니다.

설치 파일을 만들려면 다음 명령을 실행합니다.

```sh
bash macos/package.sh
```

생성 파일과 SHA256SUMS는 `submission/artifacts/`에 있습니다. 번들만으로 빈 환경에서 실행되는지 확인할 수 있어요.

```sh
bash submission/verify-mac.sh dist/Doto.app
```

이 검사는 Finder 최초 실행, macOS 보안 승인, 다른 맥 실기 검증을 대신하지 않습니다.

## 기능과 범위

- 네 가지 프리셋, Homebrew 공식 core/cask와 npm 전역 설치 목록, 공개 GitHub 릴리스 구독
- 검색, 정렬, 상태 필터, 여러 항목 추가와 개별 확인 주기
- 수동 일괄 업데이트와 항목별 결과, 실패 항목 재선택
- CLI 또는 npm 설치 위치가 여러 개면 사용자 선택. 선택한 위치의 버전을 업데이트 전후 확인
- Codex와 GitHub 항목의 버전별 릴리스 노트. 다른 항목은 패키지 정보 제공
- 맥 기본 창 버튼, 창 크기 복원, 메뉴 막대와 새 버전 알림

자동 업데이트와 로그인 시 자동 실행은 제공하지 않아요. 모든 macOS 앱, PATH 밖의 설치, 별도 Homebrew tap은 탐색하지 않습니다. 터미널마다 PATH가 다를 수 있으므로 상세에 표시된 위치를 확인해 주세요. 설치하지 않은 항목은 새 버전 소식만 받을 수 있습니다.

실제 패키지 업데이트에는 설치 권한과 해당 설치 관리자가 필요합니다. 실패하면 항목별로 안내해요. 다른 위치의 설치본까지 자동으로 함께 업데이트하지 않습니다.

앱이 종료되거나 맥이 잠들면 확인하지 않습니다. 데이터는 `~/Library/Application Support/MomoPrototype`에 저장됩니다. 기존 사용자 데이터 호환성을 위해 데이터 경로와 앱 식별자는 유지했습니다.

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

최신 판정은 [배포 준비 상태](submission/RELEASE-READINESS.md), 다른 맥 실기 항목은 [수신 환경 확인표](submission/SECOND-MAC-CHECK.md)에 기록합니다. 직접 설치 업데이트는 모의 도구로 검사하며 모든 실제 패키지 조합의 성공을 보장하지 않습니다.

[설계와 AI 협업 기록](submission/DECISIONS.md)에 사용자가 결정한 범위와 AI 구현 결과의 수정 과정을 남겼습니다.

# 기어 제너레이터 (Gear Generator)

기어/감속기 형상을 파라미터 몇 개만 입력해서 즉시 생성하는 도구 모음입니다.
브라우저에서 바로 써볼 수 있는 웹 미리보기(SVG + DXF 내보내기)와, Fusion 360
안에서 실제 3D 솔리드를 생성하는 애드인 3종으로 구성되어 있습니다.

## 웹 미리보기 (`web/`)

`web/index.html`을 정적 서버로 열면 됩니다 (예: `python -m http.server` 로
`web/` 디렉터리를 서빙). 상단 탭으로 생성기를 전환합니다.

- **하모닉 드라이브** — 모듈 / 외경 / 내경만 입력하면 서큘러스플라인 +
  플렉스스플라인 + 웨이브제너레이터 캠을 실시간 SVG로 미리보고 DXF로
  내보낼 수 있습니다. 수식은 `web/core-math.js`에 정리되어 있으며,
  Yao et al., *"A Novel Cycloid Tooth Profile for Harmonic Drive with Fully
  Conjugate Features"*, Actuators 2025, 14(4), 187 의 사이클로이드 치형
  구성식(Eq. 9–13)을 기반으로 합니다. 자세한 단순화 내역은 파일 상단 주석과
  `fusion360_addin/HarmonicDriveGenerator/hd_math.py` 참고.
- **사이클로이드 감속기** — 감속비 / 핀 피치원 반지름 / 핀 반지름 / 편심량을
  입력하면 디스크 외곽선(포락선 방식)과 핀 배치를 실시간으로 계산합니다.
  고급 설정에서 2단 디스크(twin, 180° 위상), 편심 축(중앙 축 + 저널),
  베어링 보어/출력핀 구멍 생성 여부, 각 부위별 공차까지
  `CycloidalGearGenerator` 애드인과 동일하게 조정할 수 있습니다. 수식은
  `web/cycloidal-math.js`에 있으며, `fusion360_addin/CycloidalGearGenerator`와
  동일한 식을 사용합니다.
- **범용 기어** — 기어 종류(평기어/헬리컬/내치/베벨/웜/랙 피니언)와 감속비,
  모듈만 입력하면 바로 생성됩니다. 잇수·축간거리 산정은
  `UniversalGearGenerator` 애드인과 같지만, 치형은 표준 20° 전깊이
  **인벌류트**(`web/involute-math.js`)로 그려 한 쌍이 간섭 없이 맞물려
  회전합니다(▶ 재생). 애드인의 단순 근사보다 정밀하며, 웹은 항상 2D입니다.
- **유성 감속기** — 선기어·유성기어·링기어·캐리어로 구성된 단일 스테이지
  유성기어열입니다. 링 잇수 = 선 + 2·유성 구속을 자동 적용하고, 선-유성
  외접 / 유성-링 내접 인벌류트 맞물림을 ▶ 재생으로 확인합니다. 링/선/캐리어
  고정 3가지 감속 구성을 지원하며, 조립 조건 (Zs+Zr)이 유성 개수로 나누어
  떨어지지 않으면 경고합니다. 수식은 `web/planetary-app.js`에 있습니다.

네 탭 모두 계산된 파라미터(감속비, 잇수/핀수, 각종 반경 등)를 사이드바에
표시하고, 형상이 성립하지 않는 조합은 경고/오류로 알려줍니다.

### 로컬 실행

`web/` 디렉터리 루트에서 `run.bat`을 더블클릭하면 로컬 서버를 띄우고
기본 브라우저로 자동으로 엽니다 (Python 3 필요). GitHub Pages 배포는
`.github/workflows/deploy.yml`이 `master` 브랜치 푸시 시 `web/`를 자동
배포합니다 (저장소 Settings → Pages → Source를 "GitHub Actions"로 설정).

## Fusion 360 애드인 (`fusion360_addin/`)

세 애드인 모두 `Shift+S` (Scripts and Add-Ins) → Add-Ins 탭 → 초록색 "+" →
해당 폴더 선택 → Run 으로 설치합니다.

| 폴더 | 생성 대상 | 제작 |
|---|---|---|
| `HarmonicDriveGenerator` | 하모닉 드라이브 3부품 (서큘러스플라인/플렉스스플라인/웨이브제너레이터 캠), 모듈·외경·내경 입력 | 이 저장소 |
| `CycloidalGearGenerator` | 사이클로이드 핀휠 감속기 (디스크/편심축/핀), 감속비 입력 | 별도 제작 (저장소에 원본 그대로 포함) |
| `UniversalGearGenerator` | 평/헬리컬/내치/베벨/웜/웜휠/랙 7종 기어, 감속비·모듈 입력 | Antigravity CAD AI (저장소에 원본 그대로 포함) |

각 폴더 안의 `README.md`에 더 자세한 사용법과 검증 내역이 있습니다.

### 알려진 단순화 사항

- **HarmonicDriveGenerator**: 논문의 envelope 기반 이뿌리(dedendum) 정밀
  보정은 생략하고 안전 여유가 있는 필렛으로 대체했습니다 (이뿌리는 접촉면이
  아니므로 치형 성능에는 영향 없음). 플렉스스플라인은 단순 링 형태로
  생성되며 실제 컵(다이어프램+보스) 형상은 미포함. 웨이브제너레이터는
  볼베어링 레이스가 없는 순수 타원 캠입니다.
- **CycloidalGearGenerator**: 핀만 생성하고 하우징은 만들지 않습니다.
  조인트 자동 생성도 제외했습니다 — 해당 폴더 README 참고.
- **UniversalGearGenerator**: 정밀 인벌류트 치형보다 안정적으로 생성되는
  단순 치형 근사를 우선합니다 — 해당 폴더 README 참고.

생성된 형상은 모두 개념 검증용 기하 데이터이며, 실제 제작 전 반드시
강도·탄성·공차 검증이 필요합니다.

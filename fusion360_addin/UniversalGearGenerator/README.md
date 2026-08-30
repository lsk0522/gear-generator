# Universal Gear Generator (종합 기어 생성기)

An advanced Autodesk Fusion 360 add-in written in Python to generate mathematically accurate 3D gear geometry. Designed for mechanical designers, educators, and makers.

Autodesk Fusion 360용 Python 기반 종합 기어 생성기 애드인입니다. 기계 설계, 교육용, 3D 프린팅 등을 위해 정확한 인벌류트(Involute) 치형 수학 모델을 바탕으로 기어를 자동 생성합니다.

---

## Supported Gear Types (지원하는 기어 유형)

1. **Spur Gear (평기어)**: The most fundamental gear type with teeth parallel to the rotation axis.
   - 회전축과 이빨이 평행한 가장 기본적이고 널리 사용되는 기어입니다.
2. **Helical Gear (헬리컬 기어)**: Teeth cut at an angle (helix angle) for smoother, quieter operation.
   - 치형이 비틀려 있어 작동 소음이 적고 더 부드러운 토크 전달이 가능한 기어입니다 (우선/좌선 방향 지정 가능).
3. **Internal Gear (내치 기어)**: Gear with teeth facing inwards on the inner circumference of a ring.
   - 링 내부 원주에 이빨이 배열된 내치 기어입니다.
4. **Bevel Gear (베벨 기어)**: Cone-shaped gear used to transmit power between intersecting shafts (usually at 90°).
   - 서로 교차하는 두 축 사이(보통 90도 각도)에서 동력을 전달하는 원추형 기어입니다.
5. **Worm (웜)**: A screw-like threaded cylinder that drives a mating worm wheel.
   - 나사처럼 실처럼 말려 들어간 원통형 스크루 드라이브로, 감속비가 매우 큰 기어 시스템에 쓰입니다.
6. **Worm Wheel (웜 휠)**: A helical-like mating gear designed specifically to mesh with the worm.
   - 웜과 완벽히 맞물리도록 리드각(Lead Angle)을 자동으로 매칭하여 헬릭스 각도를 자동 계산해주는 매칭용 기어입니다.
7. **Rack Gear (랙 기어)**: A flat bar with teeth that converts rotational motion into linear motion.
   - 평평한 직선 바에 이빨이 배열되어 있어 피니언 기어의 회전 운동을 직선 운동으로 바꾸는 기어입니다.

---

## Math & Modeling Approach (수학적 및 모델링 접근 방식)

- **Involute Curve (인벌류트 곡선)**: Generated using exact parametric equations:
  $$x(\phi) = r_b (\cos\phi + \phi\sin\phi)$$
  $$y(\phi) = r_b (\sin\phi - \phi\cos\phi)$$
  where $r_b$ is the base circle radius.
  - 베이스 서클(기저원)에서 풀려나오는 정확한 기하학적 인벌류트 프로파일을 점 세트로 계산하여 Fitted Spline으로 2D 치형을 생성합니다.
- **Transverse Plane Helical Profile (사치차 단면 계산)**:
  For helical gears, the transverse pitch radius $r_p$ and transverse pressure angle $\alpha_t$ are automatically adjusted to match normal standards:
  $$d_p = \frac{m_n \cdot z}{\cos\beta}, \quad \alpha_t = \arctan\left(\frac{\tan\alpha_n}{\cos\beta}\right)$$
  - 헬리컬 기어의 비틀림 각도로 발생하는 단면 형상 왜곡을 방지하기 위해 법선 모듈($m_n$)과 법선 압력각($\alpha_n$)을 회전 평면상의 횡방향(Transverse) 치수로 변환하여 곡선 스케치를 그리고, 비틀림 스윕(Sweep with Twist)을 통해 3D로 형성합니다.
- **Tredgold Bevel Gear Approximation (베벨 기어 트레드골드 근사)**:
  Calculates the virtual tooth profile at the back cone using the virtual tooth count:
  $$z_v = \frac{z}{\cos\delta}$$
  It sketches this virtual profile at the large end and scales it exactly to the small end relative to the cone apex, creating a perfect taper through Lofting.
  - 배면 원추에 가상의 평기어를 펼쳐 형상을 그리는 Tredgold 방식을 적용하여 가상 잇수($z_v$)를 구하고 대단부(Large End) 프로파일을 그린 후, 원추 꼭짓점(Apex) 방향으로 정확히 축소된 소단부(Small End) 프로파일을 생성하여 Loft(로프트) 결합합니다.
- **Worm Helix Math (웜 3D 나선 스플라인)**:
  Worm paths are drawn as high-resolution 3D splines:
  $$x(t) = r_{w1}\cos t, \quad y(t) = r_{w1}\sin t, \quad z(t) = \frac{L \cdot t}{2\pi}$$
  A trapezoidal cutter is swept along this path to join with the root cylinder.
  - 웜 샤프트는 3D 나선(Helix) 스플라인 경로를 3차원으로 직접 그리고, 이에 맞게 경사진 사다리꼴(Trapezoid) 치형 단면을 스윕으로 결합하여 모델링합니다.

---

## Installation & Usage (설치 및 실행 방법)

1. Open **Autodesk Fusion 360**.
2. Go to the top menu and select the **Utilities (도구)** tab.
3. Click on **Scripts and Add-Ins (스크립트 및 애드인)** (Shortcut: `Shift + S`).
4. Select the **Add-Ins (애드인)** tab.
5. You should see **Universal Gear Generator** in the list.
   - If not, click **My Add-Ins** or the Green Plus icon, select this folder, and load it.
6. Select it and click **Run (실행)**.
7. A new button **종합 기어 생성기 (Universal Gear Generator)** will appear under the **Create (작성)** panel in the Solid toolbar.
8. Click the button to open the gear generation dialog, choose your gear type, set parameters, and click **OK**!

1. **Autodesk Fusion 360**을 실행합니다.
2. 상단 메뉴의 **도구 (Utilities)** 탭으로 이동합니다.
3. **스크립트 및 애드인 (Scripts and Add-Ins)** (단축키: `Shift + S`)을 선택합니다.
4. **애드인 (Add-Ins)** 탭을 누릅니다.
5. 리스트에서 **종합 기어 생성기 (Universal Gear Generator)**를 찾을 수 있습니다.
   - 만약 리스트에 없다면 초록색 플러스(+) 버튼을 누르고 이 폴더(`UniversalGearGenerator`)를 지정하여 추가하세요.
6. 애드인을 선택하고 **실행 (Run)**을 클릭합니다.
7. 솔리드 메뉴의 **작성 (Create)** 패널 내에 **종합 기어 생성기** 명령 버튼이 생성됩니다.
8. 해당 버튼을 클릭하고 생성할 기어 유형을 선택한 뒤 원하는 파라메트릭 변수를 입력하여 확인(OK)을 누르면 파트 컴포넌트가 자동으로 구축됩니다!

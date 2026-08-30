# -*- coding: utf-8 -*-
"""
Cycloidal Drive Generator - Autodesk Fusion Add-In
사이클로이드 감속기 생성기 - Autodesk Fusion 애드인
------------------------------------------------------------------
Generates a full cycloidal reducer: disc(s), eccentric shaft, pin ring +
housing - each as its own component, with per-feature clearances, and an
optional revolute joint on the input shaft for motion checking.

전체 사이클로이드 감속기 생성: 디스크, 편심 축, 핀 링 + 하우징을 각각 별도
컴포넌트로 만들고, 부위별 공차를 적용하며, 입력축에 선택적 회전 조인트를 걸어
모션 확인의 출발점을 제공합니다.

Profile math:
    ratio i -> pin count N = i + 1, lobes = N - 1.
    psi = atan2( sin((1-N)t), (R/(E*N)) - cos((1-N)t) )
    x =  R cos t - Rr' cos(t+psi) - E cos(Nt)
    y = -R sin t + Rr' sin(t+psi) + E sin(Nt)
    where Rr' = Rr + disc_clearance (enlarging the effective roller radius
    shrinks the disc so it does not bind on the pins).

All geometry in internal units (cm). Verify against a reference before
machining; sign/clearance conventions vary by source.
"""

import adsk.core
import adsk.fusion
import adsk.cam
import traceback
import math

_app = None
_ui = None
_handlers = []
_lang = 'en'

CMD_ID = 'cycloidalDiscCmd'
PANEL_ID = 'SolidCreatePanel'

# ----------------------------------------------------------------------
# Localization
# ----------------------------------------------------------------------
STRINGS = {
    'en': {
        'cmd_name': 'Cycloidal Drive',
        'cmd_desc': 'Generate a parametric cycloidal reducer.',
        'grp_basic': 'Basic',
        'grp_disc': 'Disc features',
        'grp_twin': 'Twin disc',
        'grp_shaft': 'Eccentric shaft',
        'grp_ring': 'Pin ring / housing',
        'grp_tol': 'Clearances (tolerances)',
        'grp_asm': 'Assembly',
        'ratio': 'Reduction ratio (1 : i)',
        'pinR': 'Pin circle radius (R)',
        'rollerR': 'Pin / roller radius (Rr)',
        'ecc': 'Eccentricity (E)',
        'thickness': 'Disc thickness',
        'points': 'Profile resolution (points)',
        'fix': 'Fully constrain (fix geometry)',
        'make_bore': 'Generate bearing bore',
        'bore_dia': 'Bearing bore diameter',
        'make_holes': 'Generate output pin holes',
        'hole_count': 'Output pin hole count',
        'hole_pcd': 'Output hole circle radius (PCD/2)',
        'hole_pin_dia': 'Output pin diameter',
        'twin': 'Twin disc (2 stacked, 180 deg)',
        'gap': 'Gap between discs',
        'make_shaft': 'Generate eccentric shaft',
        'shaft_dia': 'Central shaft diameter',
        'journal_dia': 'Eccentric journal diameter',
        'shaft_below': 'Shaft extension below',
        'shaft_above': 'Shaft extension above',
        'make_ring': 'Generate pin ring + housing',
        'pin_len_margin': 'Pin length margin (per side)',
        'tol_disc': 'Disc-pin clearance',
        'tol_bore': 'Bore clearance (radius)',
        'tol_hole': 'Output hole clearance (radius)',
        'tol_pin': 'Pin clearance (radius)',
        'i_pins': 'Pins (N)',
        'i_lobes': 'Lobes (N-1)',
        'i_ratio': 'Reduction ratio',
        'sketch_name': 'Cycloidal disc profile',
        'comp_disc': 'Disc',
        'comp_disc2': 'Disc 2',
        'comp_shaft': 'Eccentric shaft',
        'comp_ring': 'Pin ring',
        'shaft_name': 'Eccentric shaft',
        'pin_name': 'Pin',
        'err_empty': 'Profile is empty. Check that eccentricity and pin count are non-zero.',
        'err_no_design': 'No active Fusion design. Open or create a design first.',
        'err_no_profile': ('No closed profile was formed. The spline may be self-intersecting; '
                           'try increasing the number of points or adjusting parameters.'),
        'done': ('Cycloidal drive created.\nPins (N): {0}   Lobes: {1}   Ratio: 1 : {1}\n'
                 'Components: {2}\n\nNOTE: For motion, enable a Contact Set in Fusion and '
                 'drag/drive the shaft joint. Full meshing motion is not auto-driven.'),
        'err_setup': 'Command setup failed:\n{0}',
        'err_change': 'Input update failed:\n{0}',
        'err_gen': 'Generation failed:\n{0}',
        'err_start': 'Add-in failed to start:\n{0}',
        'err_stop': 'Add-in failed to stop:\n{0}',
    },
    'ko': {
        'cmd_name': '사이클로이드 감속기',
        'cmd_desc': '파라메트릭 사이클로이드 감속기를 생성합니다.',
        'grp_basic': '기본',
        'grp_disc': '디스크 피처',
        'grp_twin': '2단 디스크',
        'grp_shaft': '편심 축',
        'grp_ring': '핀 링 / 하우징',
        'grp_tol': '공차 (틈새)',
        'grp_asm': '어셈블리',
        'ratio': '감속비 (1 : i)',
        'pinR': '핀 피치원 반지름 (R)',
        'rollerR': '핀/롤러 반지름 (Rr)',
        'ecc': '편심량 (E)',
        'thickness': '디스크 두께',
        'points': '외곽선 해상도 (점 개수)',
        'fix': '완전구속 (형상 고정)',
        'make_bore': '베어링 보어 생성',
        'bore_dia': '베어링 보어 지름',
        'make_holes': '출력핀 구멍 생성',
        'hole_count': '출력핀 구멍 개수',
        'hole_pcd': '출력핀 구멍 피치원 반지름 (PCD/2)',
        'hole_pin_dia': '출력핀 지름',
        'twin': '2단 디스크 (2장 적층, 180도 위상)',
        'gap': '디스크 사이 간격',
        'make_shaft': '편심 축 생성',
        'shaft_dia': '중앙 축 지름',
        'journal_dia': '편심 저널 지름',
        'shaft_below': '축 아래쪽 연장',
        'shaft_above': '축 위쪽 연장',
        'make_ring': '핀 링 + 하우징 생성',
        'pin_len_margin': '핀 길이 여유 (한쪽당)',
        'tol_disc': '디스크-핀 공차',
        'tol_bore': '보어 공차 (반경)',
        'tol_hole': '출력 구멍 공차 (반경)',
        'tol_pin': '핀 공차 (반경)',
        'i_pins': '핀 개수 (N)',
        'i_lobes': '로브 수 (N-1)',
        'i_ratio': '감속비',
        'sketch_name': '사이클로이드 디스크 외곽선',
        'comp_disc': '디스크',
        'comp_disc2': '디스크 2',
        'comp_shaft': '편심 축',
        'comp_ring': '핀 링',
        'shaft_name': '편심 축',
        'pin_name': '핀',
        'err_empty': '외곽선이 비어 있습니다. 편심량과 핀 개수가 0이 아닌지 확인하세요.',
        'err_no_design': '활성화된 Fusion 디자인이 없습니다. 먼저 디자인을 열거나 생성하세요.',
        'err_no_profile': ('닫힌 프로파일이 형성되지 않았습니다. 스플라인이 자기교차했을 수 있습니다. '
                           '해상도(점 개수)를 늘리거나 파라미터를 조정하세요.'),
        'done': ('사이클로이드 감속기를 생성했습니다.\n핀 개수 (N): {0}   로브 수: {1}   감속비: 1 : {1}\n'
                 '컴포넌트 수: {2}\n\n참고: 모션 확인은 Fusion에서 Contact Set을 켜고 축 조인트를 '
                 '드래그/구동하세요. 완전한 맞물림 회전은 자동 구동되지 않습니다.'),
        'err_setup': '명령 설정 실패:\n{0}',
        'err_change': '입력 갱신 실패:\n{0}',
        'err_gen': '생성 실패:\n{0}',
        'err_start': '애드인 시작 실패:\n{0}',
        'err_stop': '애드인 종료 실패:\n{0}',
    },
}


def t(key):
    table = STRINGS.get(_lang, STRINGS['en'])
    return table.get(key, STRINGS['en'].get(key, key))


def detect_language(app):
    try:
        if app.preferences.generalPreferences.userLanguage == adsk.core.UserLanguages.KoreanLanguage:
            return 'ko'
    except Exception:
        pass
    return 'en'


# ----------------------------------------------------------------------
# Geometry helpers
# ----------------------------------------------------------------------
def compute_profile(R, Rr, E, N, num_points, phase_180=False, clearance=0.0):
    if E == 0 or N == 0:
        return []
    Rr_eff = Rr + clearance         # larger effective roller => smaller disc
    pts = []
    two_pi = 2.0 * math.pi
    cos = math.cos
    sin = math.sin
    atan2 = math.atan2
    inv = R / (E * N)
    for i in range(num_points):
        a = two_pi * i / num_points
        m = (1 - N) * a
        psi = atan2(sin(m), inv - cos(m))
        ap = a + psi
        x = R * cos(a) - Rr_eff * cos(ap) - E * cos(N * a)
        y = -R * sin(a) + Rr_eff * sin(ap) + E * sin(N * a)
        if phase_180:
            x, y = -x, -y
        pts.append((x, y))
    return pts


def fix_entity(entity):
    for attr in ('isFixed',):
        try:
            setattr(entity, attr, True)
        except Exception:
            pass
    try:
        for fp in entity.fitPoints:
            fp.isFixed = True
    except Exception:
        pass
    try:
        entity.centerSketchPoint.isFixed = True
    except Exception:
        pass


def new_component(root, name):
    occ = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
    occ.component.name = name
    return occ.component, occ


def offset_plane(comp, z):
    if abs(z) < 1e-12:
        return comp.xYConstructionPlane
    planes = comp.constructionPlanes
    pin = planes.createInput()
    pin.setByOffset(comp.xYConstructionPlane, adsk.core.ValueInput.createByReal(z))
    return planes.add(pin)


def extrude_profile(comp, prof, z_dist, operation):
    extrudes = comp.features.extrudeFeatures
    ei = extrudes.createInput(prof, operation)
    ei.setDistanceExtent(False, adsk.core.ValueInput.createByReal(z_dist))
    return extrudes.add(ei)


def cylinder(comp, cx, cy, z0, radius, height, operation, name):
    sk = comp.sketches.add(offset_plane(comp, z0))
    sk.name = name + ' sk'
    sk.isComputeDeferred = True
    try:
        sk.sketchCurves.sketchCircles.addByCenterRadius(
            adsk.core.Point3D.create(cx, cy, 0), radius)
    finally:
        sk.isComputeDeferred = False
    return extrude_profile(comp, sk.profiles.item(0), height, operation)


# ----------------------------------------------------------------------
# Component builders
# ----------------------------------------------------------------------
def build_one_disc(comp, p, z_offset, phase_180, name):
    sketch = comp.sketches.add(offset_plane(comp, z_offset))
    sketch.name = name

    sketch.isComputeDeferred = True
    try:
        profile_pts = compute_profile(p['R'], p['Rr'], p['E'], p['N'],
                                      p['points'], phase_180, p['tol_disc'])
        if not profile_pts:
            raise ValueError(t('err_empty'))

        coll = adsk.core.ObjectCollection.create()
        for (x, y) in profile_pts:
            coll.add(adsk.core.Point3D.create(x, y, 0))

        splines = sketch.sketchCurves.sketchFittedSplines
        spline = splines.add(coll)
        try:
            spline.isClosed = True
        except Exception:
            try:
                spline.deleteMe()
            except Exception:
                pass
            coll.add(adsk.core.Point3D.create(profile_pts[0][0], profile_pts[0][1], 0))
            spline = splines.add(coll)

        to_fix = [spline]
        circles = sketch.sketchCurves.sketchCircles
        origin = adsk.core.Point3D.create(0, 0, 0)

        if p['make_bore'] and p['bore_dia'] > 0:
            br = p['bore_dia'] / 2.0 + p['tol_bore']
            to_fix.append(circles.addByCenterRadius(origin, br))

        if p['make_holes'] and p['hole_count'] > 0 and p['hole_pin_dia'] > 0:
            hole_r = (p['hole_pin_dia'] + 2.0 * p['E']) / 2.0 + p['tol_hole']
            for k in range(p['hole_count']):
                ang = 2.0 * math.pi * k / p['hole_count']
                cx = p['hole_pcd_r'] * math.cos(ang)
                cy = p['hole_pcd_r'] * math.sin(ang)
                to_fix.append(circles.addByCenterRadius(
                    adsk.core.Point3D.create(cx, cy, 0), hole_r))

        if p['fully_constrain']:
            for e in to_fix:
                fix_entity(e)
    finally:
        sketch.isComputeDeferred = False

    profs = sketch.profiles
    if profs.count == 0:
        raise ValueError(t('err_no_profile'))
    target = profs.item(0)
    max_area = target.areaProperties().area
    for i in range(1, profs.count):
        a = profs.item(i).areaProperties().area
        if a > max_area:
            max_area = a
            target = profs.item(i)

    ext = extrude_profile(comp, target, p['thickness'],
                          adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    ext.bodies.item(0).name = name
    return ext.bodies.item(0)


def build_shaft(comp, p):
    E = p['E']
    shaft_r = p['shaft_dia'] / 2.0
    journal_r = p['journal_dia'] / 2.0
    below = p['shaft_below']
    above = p['shaft_above']
    stack_top = (2.0 * p['thickness'] + p['gap']) if p['twin'] else p['thickness']

    total_len = below + stack_top + above
    central = cylinder(comp, 0, 0, -below, shaft_r, total_len,
                       adsk.fusion.FeatureOperations.NewBodyFeatureOperation,
                       t('shaft_name'))
    body = central.bodies.item(0)
    body.name = t('shaft_name')

    cylinder(comp, E, 0, 0.0, journal_r, p['thickness'],
             adsk.fusion.FeatureOperations.JoinFeatureOperation, t('shaft_name') + ' j1')
    if p['twin']:
        z2 = p['thickness'] + p['gap']
        cylinder(comp, -E, 0, z2, journal_r, p['thickness'],
                 adsk.fusion.FeatureOperations.JoinFeatureOperation, t('shaft_name') + ' j2')
    return body


def build_ring(comp, p):
    """Pins only: N solid cylinders on the pitch circle R. No housing.
    (Housing/contact can be added manually in Fusion if desired.)"""
    N = p['N']
    R = p['R']
    pin_r = p['Rr'] + p['tol_pin']
    stack = (2.0 * p['thickness'] + p['gap']) if p['twin'] else p['thickness']
    pin_len = stack + 2.0 * p['pin_len_margin']
    z0 = -p['pin_len_margin']

    for k in range(N):
        ang = 2.0 * math.pi * k / N
        px = R * math.cos(ang)
        py = R * math.sin(ang)
        pe = cylinder(comp, px, py, z0, pin_r, pin_len,
                      adsk.fusion.FeatureOperations.NewBodyFeatureOperation,
                      '{0} {1}'.format(t('pin_name'), k + 1))
        pe.bodies.item(0).name = '{0} {1}'.format(t('pin_name'), k + 1)
    return comp


def build_drive(design, p):
    root = design.rootComponent
    made = []

    disc_comp, _ = new_component(root, t('comp_disc'))
    build_one_disc(disc_comp, p, 0.0, False, t('sketch_name'))
    made.append(disc_comp)

    if p['twin']:
        disc2, _ = new_component(root, t('comp_disc2'))
        build_one_disc(disc2, p, p['thickness'] + p['gap'], True, t('sketch_name'))
        made.append(disc2)

    shaft_comp = None
    if p['make_shaft']:
        shaft_comp, _ = new_component(root, t('comp_shaft'))
        build_shaft(shaft_comp, p)
        made.append(shaft_comp)

    if p['make_ring']:
        ring_comp, _ = new_component(root, t('comp_ring'))
        build_ring(ring_comp, p)
        made.append(ring_comp)

    return made


def _update_info(inputs):
    ratio = inputs.itemById('ratio').value
    info = inputs.itemById('info')
    if info:
        N = ratio + 1
        info.formattedText = ('{0} = {1}<br>{2} = {3}<br>{4} = 1 : {3}'
                              .format(t('i_pins'), N, t('i_lobes'), ratio, t('i_ratio')))


# ----------------------------------------------------------------------
# Event handlers
# ----------------------------------------------------------------------
class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self):
        super().__init__()

    def notify(self, args):
        try:
            inputs = args.command.commandInputs
            if inputs.itemById('ratio'):
                return
            v = adsk.core.ValueInput.createByReal

            inputs.addIntegerSpinnerCommandInput('ratio', t('ratio'), 2, 199, 1, 11)
            info = inputs.addTextBoxCommandInput('info', '', '', 3, True)
            info.isFullWidth = True

            inputs.addValueInput('pinR', t('pinR'), 'mm', v(3.0))
            inputs.addValueInput('rollerR', t('rollerR'), 'mm', v(0.3))
            inputs.addValueInput('ecc', t('ecc'), 'mm', v(0.15))
            inputs.addValueInput('thickness', t('thickness'), 'mm', v(0.5))
            inputs.addIntegerSpinnerCommandInput('numPoints', t('points'), 60, 2000, 20, 360)
            inputs.addBoolValueInput('fix', t('fix'), True, '', True)

            inputs.addBoolValueInput('makeBore', t('make_bore'), True, '', True)
            inputs.addValueInput('boreDia', t('bore_dia'), 'mm', v(1.5))

            inputs.addBoolValueInput('makeHoles', t('make_holes'), True, '', True)
            inputs.addIntegerSpinnerCommandInput('holeCount', t('hole_count'), 3, 60, 1, 6)
            inputs.addValueInput('holePCDr', t('hole_pcd'), 'mm', v(1.8))
            inputs.addValueInput('holePinDia', t('hole_pin_dia'), 'mm', v(0.6))

            inputs.addBoolValueInput('twin', t('twin'), True, '', False)
            gap_in = inputs.addValueInput('gap', t('gap'), 'mm', v(0.1))
            gap_in.isVisible = False

            inputs.addBoolValueInput('makeShaft', t('make_shaft'), True, '', True)
            inputs.addValueInput('shaftDia', t('shaft_dia'), 'mm', v(1.1))
            inputs.addValueInput('journalDia', t('journal_dia'), 'mm', v(1.4))
            inputs.addValueInput('shaftBelow', t('shaft_below'), 'mm', v(1.0))
            inputs.addValueInput('shaftAbove', t('shaft_above'), 'mm', v(1.0))

            inputs.addBoolValueInput('makeRing', t('make_ring'), True, '', True)
            inputs.addValueInput('pinMargin', t('pin_len_margin'), 'mm', v(0.2))

            # Clearances.
            inputs.addValueInput('tolDisc', t('tol_disc'), 'mm', v(0.01))   # 0.1 mm
            inputs.addValueInput('tolBore', t('tol_bore'), 'mm', v(0.005))
            inputs.addValueInput('tolHole', t('tol_hole'), 'mm', v(0.01))
            inputs.addValueInput('tolPin', t('tol_pin'), 'mm', v(0.0))

            _update_info(inputs)

            oc = InputChangedHandler()
            args.command.inputChanged.add(oc)
            _handlers.append(oc)
            oe = CommandExecuteHandler()
            args.command.execute.add(oe)
            _handlers.append(oe)
        except Exception:
            if _ui:
                _ui.messageBox(t('err_setup').format(traceback.format_exc()))


class InputChangedHandler(adsk.core.InputChangedEventHandler):
    def __init__(self):
        super().__init__()

    def notify(self, args):
        try:
            i = args.input
            inputs = args.inputs
            if i.id == 'ratio':
                _update_info(inputs)
            elif i.id == 'makeBore':
                inputs.itemById('boreDia').isVisible = i.value
            elif i.id == 'makeHoles':
                for iid in ('holeCount', 'holePCDr', 'holePinDia'):
                    inputs.itemById(iid).isVisible = i.value
            elif i.id == 'twin':
                inputs.itemById('gap').isVisible = i.value
            elif i.id == 'makeShaft':
                for iid in ('shaftDia', 'journalDia', 'shaftBelow', 'shaftAbove'):
                    inputs.itemById(iid).isVisible = i.value
            elif i.id == 'makeRing':
                inputs.itemById('pinMargin').isVisible = i.value
        except Exception:
            if _ui:
                _ui.messageBox(t('err_change').format(traceback.format_exc()))


class CommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()

    def notify(self, args):
        try:
            inputs = args.command.commandInputs
            ratio = inputs.itemById('ratio').value
            p = {
                'N': ratio + 1,
                'R': inputs.itemById('pinR').value,
                'Rr': inputs.itemById('rollerR').value,
                'E': inputs.itemById('ecc').value,
                'thickness': inputs.itemById('thickness').value,
                'points': inputs.itemById('numPoints').value,
                'fully_constrain': inputs.itemById('fix').value,
                'make_bore': inputs.itemById('makeBore').value,
                'bore_dia': inputs.itemById('boreDia').value,
                'make_holes': inputs.itemById('makeHoles').value,
                'hole_count': inputs.itemById('holeCount').value,
                'hole_pcd_r': inputs.itemById('holePCDr').value,
                'hole_pin_dia': inputs.itemById('holePinDia').value,
                'twin': inputs.itemById('twin').value,
                'gap': inputs.itemById('gap').value,
                'make_shaft': inputs.itemById('makeShaft').value,
                'shaft_dia': inputs.itemById('shaftDia').value,
                'journal_dia': inputs.itemById('journalDia').value,
                'shaft_below': inputs.itemById('shaftBelow').value,
                'shaft_above': inputs.itemById('shaftAbove').value,
                'make_ring': inputs.itemById('makeRing').value,
                'pin_len_margin': inputs.itemById('pinMargin').value,
                'tol_disc': inputs.itemById('tolDisc').value,
                'tol_bore': inputs.itemById('tolBore').value,
                'tol_hole': inputs.itemById('tolHole').value,
                'tol_pin': inputs.itemById('tolPin').value,
            }
            design = adsk.fusion.Design.cast(_app.activeProduct)
            if not design:
                _ui.messageBox(t('err_no_design'))
                return
            made = build_drive(design, p)
            _ui.messageBox(t('done').format(p['N'], ratio, len(made)))
        except Exception:
            if _ui:
                _ui.messageBox(t('err_gen').format(traceback.format_exc()))


# ----------------------------------------------------------------------
def run(context):
    global _app, _ui, _lang
    try:
        _app = adsk.core.Application.get()
        _ui = _app.userInterface
        _lang = detect_language(_app)

        cmd_defs = _ui.commandDefinitions
        existing = cmd_defs.itemById(CMD_ID)
        if existing:
            existing.deleteMe()
        cmd_def = cmd_defs.addButtonDefinition(CMD_ID, t('cmd_name'), t('cmd_desc'))

        oc = CommandCreatedHandler()
        cmd_def.commandCreated.add(oc)
        _handlers.append(oc)

        panel = _ui.allToolbarPanels.itemById(PANEL_ID)
        if panel and not panel.controls.itemById(CMD_ID):
            panel.controls.addCommand(cmd_def)
    except Exception:
        if _ui:
            _ui.messageBox(t('err_start').format(traceback.format_exc()))


def stop(context):
    try:
        panel = _ui.allToolbarPanels.itemById(PANEL_ID)
        if panel:
            ctrl = panel.controls.itemById(CMD_ID)
            if ctrl:
                ctrl.deleteMe()
        cmd_def = _ui.commandDefinitions.itemById(CMD_ID)
        if cmd_def:
            cmd_def.deleteMe()
    except Exception:
        if _ui:
            _ui.messageBox(t('err_stop').format(traceback.format_exc()))

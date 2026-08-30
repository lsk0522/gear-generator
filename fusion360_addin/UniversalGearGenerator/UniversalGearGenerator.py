# -*- coding: utf-8 -*-
"""
Universal Gear Generator v2 - Autodesk Fusion 360 Add-In
종합 기어 생성기 v2

목표:
- 기본 모드: 기어 종류, 감속비, 모듈만 넣어도 자동 생성
- 고급 모드: 잇수, 두께, 구멍, 압력각, 헬릭스각 등 직접 설정
- 평기어/헬리컬/내치/베벨/웜/웜휠/랙이 전부 다른 형상으로 생성

주의:
이 v2는 Fusion 360에서 실패 확률을 줄이기 위해 안정적인 단순 치형 기반으로 작성했습니다.
정밀 인벌류트 치형보다는 실제로 잘 생성되는 파라메트릭 형상을 우선합니다.
"""

import adsk.core
import adsk.fusion
import traceback
import math

_app = None
_ui = None
_handlers = []

CMD_ID = 'UniversalGearGeneratorV2Cmd'
PANEL_ID = 'SolidCreatePanel'

# Fusion internal length unit is cm. UI expressions are evaluated to cm.

GEAR_TYPES = [
    '평기어 세트 (Spur Pair)',
    '헬리컬 기어 세트 (Helical Pair)',
    '내치 기어 세트 (Internal Gear Set)',
    '베벨 기어 세트 (Bevel Pair)',
    '웜 기어 세트 (Worm + Wheel)',
    '랙 피니언 세트 (Rack + Pinion)',
]

RIGHT_HAND = '우선 / Right Hand'
LEFT_HAND = '좌선 / Left Hand'

# -----------------------------------------------------------------------------
# Basic helpers
# -----------------------------------------------------------------------------

def app_objects():
    global _app, _ui
    _app = adsk.core.Application.get()
    _ui = _app.userInterface
    return _app, _ui


def msg(text):
    if _ui:
        _ui.messageBox(text)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def new_component(root, name, x=0.0, y=0.0, z=0.0):
    m = adsk.core.Matrix3D.create()
    m.translation = adsk.core.Vector3D.create(x, y, z)
    occ = root.occurrences.addNewComponent(m)
    comp = occ.component
    comp.name = name
    return comp


def offset_plane(comp, base_plane, offset_cm):
    if abs(offset_cm) < 1e-9:
        return base_plane
    planes = comp.constructionPlanes
    inp = planes.createInput()
    inp.setByOffset(base_plane, adsk.core.ValueInput.createByReal(offset_cm))
    return planes.add(inp)


def extrude_profile(comp, profile, distance_cm, operation):
    extrudes = comp.features.extrudeFeatures
    inp = extrudes.createInput(profile, operation)
    inp.setDistanceExtent(False, adsk.core.ValueInput.createByReal(distance_cm))
    return extrudes.add(inp)


def cut_center_hole(comp, hole_dia_cm, height_cm):
    if hole_dia_cm <= 0:
        return
    sk = comp.sketches.add(comp.xYConstructionPlane)
    sk.name = 'Center Hole'
    sk.sketchCurves.sketchCircles.addByCenterRadius(
        adsk.core.Point3D.create(0, 0, 0), hole_dia_cm / 2.0
    )
    if sk.profiles.count:
        extrude_profile(comp, sk.profiles.item(0), height_cm * 1.2, adsk.fusion.FeatureOperations.CutFeatureOperation)


def choose_largest_profile(sketch):
    if sketch.profiles.count == 0:
        raise RuntimeError('닫힌 프로파일을 찾지 못했습니다.')
    best = sketch.profiles.item(0)
    best_area = best.areaProperties().area
    for i in range(1, sketch.profiles.count):
        p = sketch.profiles.item(i)
        a = p.areaProperties().area
        if a > best_area:
            best = p
            best_area = a
    return best


def choose_ring_profile(sketch, target_area=None):
    if sketch.profiles.count == 0:
        raise RuntimeError('링 프로파일을 찾지 못했습니다.')
    if target_area is None:
        return choose_largest_profile(sketch)
    best = sketch.profiles.item(0)
    best_diff = abs(best.areaProperties().area - target_area)
    for i in range(1, sketch.profiles.count):
        p = sketch.profiles.item(i)
        d = abs(p.areaProperties().area - target_area)
        if d < best_diff:
            best = p
            best_diff = d
    return best

# -----------------------------------------------------------------------------
# Sketch profile generators
# -----------------------------------------------------------------------------

def add_external_gear_outline(sketch, z_teeth, root_r, tip_r, rotation=0.0):
    """Create one closed polygon-like external gear outline."""
    lines = sketch.sketchCurves.sketchLines
    pts = []
    z_teeth = int(max(6, z_teeth))
    pitch = 2.0 * math.pi / z_teeth
    # 4 points per tooth: root valley, rising flank, tip, falling flank
    for i in range(z_teeth):
        a0 = rotation + i * pitch
        pts.append(adsk.core.Point3D.create(root_r * math.cos(a0 - pitch * 0.45), root_r * math.sin(a0 - pitch * 0.45), 0))
        pts.append(adsk.core.Point3D.create(tip_r * math.cos(a0 - pitch * 0.18), tip_r * math.sin(a0 - pitch * 0.18), 0))
        pts.append(adsk.core.Point3D.create(tip_r * math.cos(a0 + pitch * 0.18), tip_r * math.sin(a0 + pitch * 0.18), 0))
        pts.append(adsk.core.Point3D.create(root_r * math.cos(a0 + pitch * 0.45), root_r * math.sin(a0 + pitch * 0.45), 0))
    for i in range(len(pts)):
        lines.addByTwoPoints(pts[i], pts[(i + 1) % len(pts)])


def add_internal_gear_profile(sketch, z_teeth, inner_root_r, inner_tip_r, outer_r, rotation=0.0):
    """Outer circle + toothed inner hole. The teeth face inward."""
    sketch.sketchCurves.sketchCircles.addByCenterRadius(adsk.core.Point3D.create(0, 0, 0), outer_r)
    lines = sketch.sketchCurves.sketchLines
    pts = []
    z_teeth = int(max(8, z_teeth))
    pitch = 2.0 * math.pi / z_teeth
    # Inner boundary alternates between larger radius gaps and smaller radius tooth tips.
    for i in range(z_teeth):
        a0 = rotation + i * pitch
        pts.append(adsk.core.Point3D.create(inner_root_r * math.cos(a0 - pitch * 0.45), inner_root_r * math.sin(a0 - pitch * 0.45), 0))
        pts.append(adsk.core.Point3D.create(inner_tip_r * math.cos(a0 - pitch * 0.18), inner_tip_r * math.sin(a0 - pitch * 0.18), 0))
        pts.append(adsk.core.Point3D.create(inner_tip_r * math.cos(a0 + pitch * 0.18), inner_tip_r * math.sin(a0 + pitch * 0.18), 0))
        pts.append(adsk.core.Point3D.create(inner_root_r * math.cos(a0 + pitch * 0.45), inner_root_r * math.sin(a0 + pitch * 0.45), 0))
    # Reverse order helps Fusion treat it as inner loop, but profiles normally work either way.
    for i in range(len(pts)):
        lines.addByTwoPoints(pts[i], pts[(i + 1) % len(pts)])


def add_rack_tooth(sketch, x_center, module_cm, base_y, tip_y, pressure_angle_rad):
    lines = sketch.sketchCurves.sketchLines
    pitch = math.pi * module_cm
    top_w = pitch * 0.42
    bot_w = pitch * 0.82
    p1 = adsk.core.Point3D.create(x_center - bot_w / 2.0, base_y, 0)
    p2 = adsk.core.Point3D.create(x_center - top_w / 2.0, tip_y, 0)
    p3 = adsk.core.Point3D.create(x_center + top_w / 2.0, tip_y, 0)
    p4 = adsk.core.Point3D.create(x_center + bot_w / 2.0, base_y, 0)
    lines.addByTwoPoints(p1, p2)
    lines.addByTwoPoints(p2, p3)
    lines.addByTwoPoints(p3, p4)
    lines.addByTwoPoints(p4, p1)

# -----------------------------------------------------------------------------
# Gear body builders
# -----------------------------------------------------------------------------

def make_spur_gear(comp, name, module_cm, z_teeth, face_cm, hole_cm, rotation=0.0):
    comp.name = name
    pitch_r = module_cm * z_teeth / 2.0
    root_r = max(module_cm * 0.8, pitch_r - 1.25 * module_cm)
    tip_r = pitch_r + module_cm
    sk = comp.sketches.add(comp.xYConstructionPlane)
    sk.name = 'Spur Gear Outline'
    add_external_gear_outline(sk, z_teeth, root_r, tip_r, rotation)
    prof = choose_largest_profile(sk)
    feat = extrude_profile(comp, prof, face_cm, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    if feat.bodies.count:
        feat.bodies.item(0).name = name + ' Body'
    cut_center_hole(comp, hole_cm, face_cm)
    return comp


def make_helical_gear(comp, name, module_cm, z_teeth, face_cm, hole_cm, helix_angle_rad, hand):
    comp.name = name
    pitch_r = module_cm * z_teeth / 2.0
    root_r = max(module_cm * 0.8, pitch_r - 1.25 * module_cm)
    tip_r = pitch_r + module_cm
    twist = (face_cm * math.tan(abs(helix_angle_rad))) / max(pitch_r, 0.001)
    if hand == LEFT_HAND:
        twist = -twist

    sk1 = comp.sketches.add(comp.xYConstructionPlane)
    sk1.name = 'Helical Gear Bottom'
    add_external_gear_outline(sk1, z_teeth, root_r, tip_r, 0.0)

    top_plane = offset_plane(comp, comp.xYConstructionPlane, face_cm)
    sk2 = comp.sketches.add(top_plane)
    sk2.name = 'Helical Gear Top Twisted'
    add_external_gear_outline(sk2, z_teeth, root_r, tip_r, twist)

    lofts = comp.features.loftFeatures
    loft_in = lofts.createInput(adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    loft_in.loftSections.add(choose_largest_profile(sk1))
    loft_in.loftSections.add(choose_largest_profile(sk2))
    feat = lofts.add(loft_in)
    if feat.bodies.count:
        feat.bodies.item(0).name = name + ' Twisted Body'
    cut_center_hole(comp, hole_cm, face_cm)
    return comp


def make_internal_ring(comp, name, module_cm, z_ring, face_cm, helix_angle_rad=0.0):
    comp.name = name
    pitch_r = module_cm * z_ring / 2.0
    inner_root_r = pitch_r + 1.25 * module_cm
    inner_tip_r = max(module_cm, pitch_r - module_cm)
    outer_r = inner_root_r + 3.0 * module_cm

    if abs(helix_angle_rad) < math.radians(0.5):
        sk = comp.sketches.add(comp.xYConstructionPlane)
        sk.name = 'Internal Gear Ring'
        add_internal_gear_profile(sk, z_ring, inner_root_r, inner_tip_r, outer_r)
        target = math.pi * (outer_r * outer_r - ((inner_root_r + inner_tip_r) / 2.0) ** 2)
        prof = choose_ring_profile(sk, target)
        feat = extrude_profile(comp, prof, face_cm, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    else:
        # Twisted inner profile by loft. Looks like an internal helical gear.
        twist = (face_cm * math.tan(abs(helix_angle_rad))) / max(pitch_r, 0.001)
        sk1 = comp.sketches.add(comp.xYConstructionPlane)
        add_internal_gear_profile(sk1, z_ring, inner_root_r, inner_tip_r, outer_r, 0.0)
        sk2 = comp.sketches.add(offset_plane(comp, comp.xYConstructionPlane, face_cm))
        add_internal_gear_profile(sk2, z_ring, inner_root_r, inner_tip_r, outer_r, twist)
        lofts = comp.features.loftFeatures
        loft_in = lofts.createInput(adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
        loft_in.loftSections.add(choose_ring_profile(sk1))
        loft_in.loftSections.add(choose_ring_profile(sk2))
        feat = lofts.add(loft_in)
    if feat.bodies.count:
        feat.bodies.item(0).name = name + ' Body'
    return comp


def make_bevel_gear(comp, name, module_cm, z_teeth, face_cm, hole_cm, cone_angle_rad, flip=False):
    comp.name = name
    pitch_r = module_cm * z_teeth / 2.0
    root_r_big = max(module_cm, pitch_r - 1.25 * module_cm)
    tip_r_big = pitch_r + module_cm
    # Taper amount. Keep small end from becoming impossible.
    taper = clamp(face_cm * math.tan(clamp(cone_angle_rad, math.radians(15), math.radians(75))), module_cm * 0.5, pitch_r * 0.65)
    root_r_small = max(module_cm * 0.8, root_r_big - taper)
    tip_r_small = max(root_r_small + module_cm * 0.4, tip_r_big - taper)

    z0 = 0.0
    z1 = face_cm
    if flip:
        z0, z1 = z1, z0

    sk_big = comp.sketches.add(offset_plane(comp, comp.xYConstructionPlane, z0))
    sk_big.name = 'Bevel Large End'
    add_external_gear_outline(sk_big, z_teeth, root_r_big, tip_r_big, 0.0)
    sk_small = comp.sketches.add(offset_plane(comp, comp.xYConstructionPlane, z1))
    sk_small.name = 'Bevel Small End'
    add_external_gear_outline(sk_small, z_teeth, root_r_small, tip_r_small, math.pi / z_teeth * 0.15)

    lofts = comp.features.loftFeatures
    loft_in = lofts.createInput(adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    loft_in.loftSections.add(choose_largest_profile(sk_big))
    loft_in.loftSections.add(choose_largest_profile(sk_small))
    feat = lofts.add(loft_in)
    if feat.bodies.count:
        feat.bodies.item(0).name = name + ' Tapered Body'
    cut_center_hole(comp, hole_cm, face_cm)
    return comp


def make_worm(comp, name, module_cm, starts, length_cm, pitch_dia_cm, hole_cm, hand):
    comp.name = name
    pitch_r = pitch_dia_cm / 2.0
    root_r = max(module_cm * 0.8, pitch_r - 0.8 * module_cm)
    outer_r = pitch_r + 0.8 * module_cm

    # Root cylinder
    sk = comp.sketches.add(comp.xYConstructionPlane)
    sk.name = 'Worm Root Cylinder'
    sk.sketchCurves.sketchCircles.addByCenterRadius(adsk.core.Point3D.create(0, 0, 0), root_r)
    extrude_profile(comp, sk.profiles.item(0), length_cm, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)

    lead = math.pi * module_cm * max(1, starts)
    turns = max(0.5, length_cm / max(lead, 0.001))
    total_angle = 2.0 * math.pi * turns
    direction = -1.0 if hand == LEFT_HAND else 1.0

    for s in range(max(1, starts)):
        phase = 2.0 * math.pi * s / max(1, starts)
        path_sk = comp.sketches.add(comp.xYConstructionPlane)
        path_sk.name = 'Worm Helix Path'
        pts = adsk.core.ObjectCollection.create()
        n = int(clamp(turns * 80, 60, 360))
        for i in range(n + 1):
            t = total_angle * i / n
            a = direction * t + phase
            x = pitch_r * math.cos(a)
            y = pitch_r * math.sin(a)
            z = length_cm * i / n
            pts.add(adsk.core.Point3D.create(x, y, z))
        spline = path_sk.sketchCurves.sketchFittedSplines.add(pts)
        path = comp.features.createPath(spline)

        # Small circular-ish thread section on XZ plane. Sweep along helix.
        prof_sk = comp.sketches.add(comp.xZConstructionPlane)
        prof_sk.name = 'Worm Thread Profile'
        lines = prof_sk.sketchCurves.sketchLines
        w = module_cm * 0.7
        p1 = adsk.core.Point3D.create(root_r, -w / 2, 0)
        p2 = adsk.core.Point3D.create(outer_r, 0, 0)
        p3 = adsk.core.Point3D.create(root_r, w / 2, 0)
        lines.addByTwoPoints(p1, p2)
        lines.addByTwoPoints(p2, p3)
        lines.addByTwoPoints(p3, p1)
        sweeps = comp.features.sweepFeatures
        sweep_in = sweeps.createInput(prof_sk.profiles.item(0), path, adsk.fusion.FeatureOperations.JoinFeatureOperation)
        sweep_in.orientation = adsk.fusion.SweepOrientationTypes.PerpendicularOrientation
        sweeps.add(sweep_in)

    cut_center_hole(comp, hole_cm, length_cm)
    return comp


def make_rack(comp, name, module_cm, z_teeth, width_cm, face_cm, pressure_angle_rad):
    comp.name = name
    pitch = math.pi * module_cm
    length = z_teeth * pitch
    base_y = 0.0
    tip_y = 2.25 * module_cm
    bar_h = 2.0 * module_cm

    # Bar
    sk_bar = comp.sketches.add(comp.xYConstructionPlane)
    sk_bar.name = 'Rack Bar'
    lines = sk_bar.sketchCurves.sketchLines
    p1 = adsk.core.Point3D.create(-length / 2, -bar_h, 0)
    p2 = adsk.core.Point3D.create(length / 2, -bar_h, 0)
    p3 = adsk.core.Point3D.create(length / 2, base_y, 0)
    p4 = adsk.core.Point3D.create(-length / 2, base_y, 0)
    lines.addByTwoPoints(p1, p2)
    lines.addByTwoPoints(p2, p3)
    lines.addByTwoPoints(p3, p4)
    lines.addByTwoPoints(p4, p1)
    extrude_profile(comp, sk_bar.profiles.item(0), face_cm, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)

    # Teeth as one sketch with many trapezoids, then join all profiles.
    sk_teeth = comp.sketches.add(comp.xYConstructionPlane)
    sk_teeth.name = 'Rack Teeth'
    start_x = -length / 2 + pitch / 2
    for i in range(z_teeth):
        add_rack_tooth(sk_teeth, start_x + i * pitch, module_cm, base_y, tip_y, pressure_angle_rad)
    profs = adsk.core.ObjectCollection.create()
    for i in range(sk_teeth.profiles.count):
        profs.add(sk_teeth.profiles.item(i))
    extrudes = comp.features.extrudeFeatures
    inp = extrudes.createInput(profs, adsk.fusion.FeatureOperations.JoinFeatureOperation)
    inp.setDistanceExtent(False, adsk.core.ValueInput.createByReal(face_cm))
    extrudes.add(inp)
    return comp

# -----------------------------------------------------------------------------
# Gear set dispatchers
# -----------------------------------------------------------------------------

def derive_teeth(ratio, pinion_teeth, advanced, gear_teeth_value, gear_type_index, worm_starts):
    pinion = int(max(6, pinion_teeth))
    if gear_type_index == 4:  # worm set
        starts = int(max(1, worm_starts))
        wheel = int(max(8, round(ratio * starts)))
        return starts, wheel
    if advanced and gear_teeth_value > 0:
        gear = int(max(6, gear_teeth_value))
    else:
        gear = int(max(6, round(pinion * ratio)))
    return pinion, gear


def build_spur_pair(root, p):
    z1, z2 = derive_teeth(p['ratio'], p['pinionTeeth'], p['advanced'], p['gearTeeth'], 0, p['wormStarts'])
    center = p['module'] * (z1 + z2) / 2.0 + p['module'] * 0.15
    c1 = new_component(root, 'Pinion Spur z{}'.format(z1), 0, 0, 0)
    make_spur_gear(c1, 'Pinion Spur z{}'.format(z1), p['module'], z1, p['face'], p['hole'])
    c2 = new_component(root, 'Gear Spur z{}'.format(z2), center, 0, 0)
    make_spur_gear(c2, 'Gear Spur z{}'.format(z2), p['module'], z2, p['face'], p['hole'], math.pi / max(z2, 1))
    return '평기어 세트 생성 완료: {} : {} ≈ {:.2f}:1'.format(z1, z2, z2 / z1)


def build_helical_pair(root, p):
    z1, z2 = derive_teeth(p['ratio'], p['pinionTeeth'], p['advanced'], p['gearTeeth'], 1, p['wormStarts'])
    beta = p['helixAngle']
    center = (p['module'] * z1 / (2 * math.cos(beta)) + p['module'] * z2 / (2 * math.cos(beta))) + p['module'] * 0.15
    c1 = new_component(root, 'Pinion Helical z{}'.format(z1), 0, 0, 0)
    make_helical_gear(c1, 'Pinion Helical z{}'.format(z1), p['module'], z1, p['face'], p['hole'], beta, p['hand'])
    opposite = LEFT_HAND if p['hand'] == RIGHT_HAND else RIGHT_HAND
    c2 = new_component(root, 'Gear Helical z{}'.format(z2), center, 0, 0)
    make_helical_gear(c2, 'Gear Helical z{}'.format(z2), p['module'], z2, p['face'], p['hole'], beta, opposite)
    return '헬리컬 기어 세트 생성 완료: {} : {} ≈ {:.2f}:1'.format(z1, z2, z2 / z1)


def build_internal_set(root, p):
    z1, z2 = derive_teeth(p['ratio'], p['pinionTeeth'], p['advanced'], p['gearTeeth'], 2, p['wormStarts'])
    if z2 <= z1 + 4:
        z2 = z1 + max(8, int(z1 * 0.5))
    offset = p['module'] * (z2 - z1) / 2.0
    ring = new_component(root, 'Internal Ring z{}'.format(z2), 0, 0, 0)
    make_internal_ring(ring, 'Internal Ring z{}'.format(z2), p['module'], z2, p['face'], p['helixAngle'] if p['advanced'] else 0.0)
    pin = new_component(root, 'Internal Pinion z{}'.format(z1), offset, 0, 0)
    make_spur_gear(pin, 'Internal Pinion z{}'.format(z1), p['module'], z1, p['face'], p['hole'])
    return '내치 기어 세트 생성 완료: 피니언 {} / 링 {}'.format(z1, z2)


def build_bevel_pair(root, p):
    z1, z2 = derive_teeth(p['ratio'], p['pinionTeeth'], p['advanced'], p['gearTeeth'], 3, p['wormStarts'])
    offset = p['module'] * (z1 + z2) / 2.0 + p['module'] * 2.0
    c1 = new_component(root, 'Bevel Pinion z{}'.format(z1), 0, 0, 0)
    make_bevel_gear(c1, 'Bevel Pinion z{}'.format(z1), p['module'], z1, p['face'], p['hole'], p['coneAngle'], False)
    c2 = new_component(root, 'Bevel Gear z{}'.format(z2), offset, 0, 0)
    make_bevel_gear(c2, 'Bevel Gear z{}'.format(z2), p['module'], z2, p['face'], p['hole'], p['coneAngle'], True)
    return '베벨 기어 세트 생성 완료: {} : {}'.format(z1, z2)


def build_worm_set(root, p):
    starts, wheel_teeth = derive_teeth(p['ratio'], p['pinionTeeth'], p['advanced'], p['gearTeeth'], 4, p['wormStarts'])
    worm_d = p['wormPitchDia'] if p['wormPitchDia'] > 0 else p['module'] * 8.0
    worm = new_component(root, 'Worm {} start'.format(starts), 0, 0, 0)
    make_worm(worm, 'Worm {} start'.format(starts), p['module'], starts, p['face'] * 1.6, worm_d, p['hole'], p['hand'])
    wheel_center = worm_d / 2.0 + (p['module'] * wheel_teeth / 2.0) + p['module'] * 1.2
    wheel = new_component(root, 'Worm Wheel z{}'.format(wheel_teeth), wheel_center, 0, 0)
    # Worm wheel is helical-looking, using lead-based angle.
    lead_angle = math.atan((math.pi * p['module'] * starts) / max(math.pi * worm_d, 0.001))
    make_helical_gear(wheel, 'Worm Wheel z{}'.format(wheel_teeth), p['module'], wheel_teeth, p['face'], p['hole'], max(lead_angle, math.radians(8)), p['hand'])
    return '웜 기어 세트 생성 완료: 웜 {}줄 / 웜휠 {}T / 감속비 ≈ {:.2f}:1'.format(starts, wheel_teeth, wheel_teeth / starts)


def build_rack_pinion(root, p):
    z1, z_rack = derive_teeth(p['ratio'], p['pinionTeeth'], p['advanced'], p['gearTeeth'], 5, p['wormStarts'])
    pin = new_component(root, 'Rack Pinion z{}'.format(z1), 0, p['module'] * (z1 / 2.0 + 3.0), 0)
    make_spur_gear(pin, 'Rack Pinion z{}'.format(z1), p['module'], z1, p['face'], p['hole'])
    rack = new_component(root, 'Rack {} teeth'.format(z_rack), 0, 0, 0)
    make_rack(rack, 'Rack {} teeth'.format(z_rack), p['module'], z_rack, p['module'] * z_rack, p['face'], p['pressureAngle'])
    return '랙 피니언 세트 생성 완료: 피니언 {}T / 랙 {}칸'.format(z1, z_rack)

# -----------------------------------------------------------------------------
# UI
# -----------------------------------------------------------------------------

def set_advanced_visibility(inputs):
    adv = inputs.itemById('advanced').value
    gear_idx = inputs.itemById('gearType').selectedItem.index

    advanced_ids = [
        'pinionTeeth', 'gearTeeth', 'pressureAngle', 'face', 'hole',
        'helixAngle', 'hand', 'coneAngle', 'wormStarts', 'wormPitchDia'
    ]
    for iid in advanced_ids:
        inp = inputs.itemById(iid)
        if inp:
            inp.isVisible = adv

    # Type-specific fields only inside advanced mode.
    if adv:
        inputs.itemById('helixAngle').isVisible = gear_idx in (1, 2)
        inputs.itemById('hand').isVisible = gear_idx in (1, 2, 4)
        inputs.itemById('coneAngle').isVisible = gear_idx == 3
        inputs.itemById('wormStarts').isVisible = gear_idx == 4
        inputs.itemById('wormPitchDia').isVisible = gear_idx == 4
        inputs.itemById('hole').isVisible = gear_idx != 5
        inputs.itemById('gearTeeth').isVisible = gear_idx != 4  # Worm wheel teeth auto from ratio*starts.


def collect_parameters(design, inputs):
    u = design.unitsManager
    gear_idx = inputs.itemById('gearType').selectedItem.index
    ratio = inputs.itemById('ratio').value
    ratio = max(1.0, ratio)
    module_cm = u.evaluateExpression(inputs.itemById('module').expression, 'cm')

    p = {
        'gearIdx': gear_idx,
        'ratio': ratio,
        'module': max(module_cm, 0.001),
        'advanced': inputs.itemById('advanced').value,
        'pinionTeeth': inputs.itemById('pinionTeeth').value,
        'gearTeeth': inputs.itemById('gearTeeth').value,
        'pressureAngle': u.evaluateExpression(inputs.itemById('pressureAngle').expression, 'rad'),
        'face': u.evaluateExpression(inputs.itemById('face').expression, 'cm'),
        'hole': u.evaluateExpression(inputs.itemById('hole').expression, 'cm'),
        'helixAngle': abs(u.evaluateExpression(inputs.itemById('helixAngle').expression, 'rad')),
        'hand': inputs.itemById('hand').selectedItem.name,
        'coneAngle': abs(u.evaluateExpression(inputs.itemById('coneAngle').expression, 'rad')),
        'wormStarts': inputs.itemById('wormStarts').value,
        'wormPitchDia': u.evaluateExpression(inputs.itemById('wormPitchDia').expression, 'cm'),
    }

    # Safe defaults when advanced is off.
    if not p['advanced']:
        p['pinionTeeth'] = 20
        p['gearTeeth'] = 0
        p['pressureAngle'] = math.radians(20)
        p['face'] = p['module'] * 8.0
        p['hole'] = p['module'] * 2.5
        p['helixAngle'] = math.radians(20)
        p['hand'] = RIGHT_HAND
        p['coneAngle'] = math.radians(45)
        p['wormStarts'] = 1
        p['wormPitchDia'] = p['module'] * 8.0

    p['face'] = max(p['face'], p['module'] * 2.0)
    p['helixAngle'] = clamp(p['helixAngle'], math.radians(1), math.radians(40))
    p['coneAngle'] = clamp(p['coneAngle'], math.radians(15), math.radians(75))
    return p


class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self):
        super().__init__()

    def notify(self, args):
        try:
            cmd = args.command
            inputs = cmd.commandInputs
            v = adsk.core.ValueInput.createByReal

            dd = inputs.addDropDownCommandInput('gearType', '기어 종류', adsk.core.DropDownStyles.TextListDropDownStyle)
            for i, name in enumerate(GEAR_TYPES):
                dd.listItems.add(name, i == 0, '')

            inputs.addValueInput('ratio', '감속비', '', v(3.0))
            inputs.addValueInput('module', '모듈 (mm)', 'mm', v(0.2))  # 2 mm
            inputs.addBoolValueInput('advanced', '고급 옵션 켜기', True, '', False)

            inputs.addIntegerSpinnerCommandInput('pinionTeeth', '피니언 잇수', 6, 200, 1, 20)
            inputs.addIntegerSpinnerCommandInput('gearTeeth', '큰 기어/링/랙 잇수', 6, 500, 1, 60)
            inputs.addValueInput('pressureAngle', '압력각 (deg)', 'deg', v(math.radians(20)))
            inputs.addValueInput('face', '두께 / 폭 (mm)', 'mm', v(1.6))  # 16 mm
            inputs.addValueInput('hole', '중앙 구멍 지름 (mm)', 'mm', v(0.5))  # 5 mm
            inputs.addValueInput('helixAngle', '헬릭스 각도 (deg)', 'deg', v(math.radians(20)))

            hand = inputs.addDropDownCommandInput('hand', '방향', adsk.core.DropDownStyles.TextListDropDownStyle)
            hand.listItems.add(RIGHT_HAND, True, '')
            hand.listItems.add(LEFT_HAND, False, '')

            inputs.addValueInput('coneAngle', '베벨 원추각 (deg)', 'deg', v(math.radians(45)))
            inputs.addIntegerSpinnerCommandInput('wormStarts', '웜 줄 수', 1, 12, 1, 1)
            inputs.addValueInput('wormPitchDia', '웜 피치 지름 (mm)', 'mm', v(1.6))  # 16 mm

            set_advanced_visibility(inputs)

            ih = InputChangedHandler()
            cmd.inputChanged.add(ih)
            _handlers.append(ih)

            eh = ExecuteHandler()
            cmd.execute.add(eh)
            _handlers.append(eh)
        except Exception:
            msg('명령 UI 생성 실패:\n' + traceback.format_exc())


class InputChangedHandler(adsk.core.InputChangedEventHandler):
    def __init__(self):
        super().__init__()

    def notify(self, args):
        try:
            ev = adsk.core.InputChangedEventArgs.cast(args)
            if ev.input.id in ('advanced', 'gearType'):
                set_advanced_visibility(ev.inputs)
        except Exception:
            msg('입력 변경 처리 실패:\n' + traceback.format_exc())


class ExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()

    def notify(self, args):
        try:
            design = adsk.fusion.Design.cast(_app.activeProduct)
            if not design:
                msg('활성화된 Fusion 디자인이 없습니다. 먼저 새 디자인을 열어주세요.')
                return
            inputs = args.firingEvent.sender.commandInputs
            p = collect_parameters(design, inputs)
            root = design.rootComponent

            idx = p['gearIdx']
            if idx == 0:
                result = build_spur_pair(root, p)
            elif idx == 1:
                result = build_helical_pair(root, p)
            elif idx == 2:
                result = build_internal_set(root, p)
            elif idx == 3:
                result = build_bevel_pair(root, p)
            elif idx == 4:
                result = build_worm_set(root, p)
            elif idx == 5:
                result = build_rack_pinion(root, p)
            else:
                raise RuntimeError('알 수 없는 기어 종류입니다.')

            msg(result)
        except Exception:
            msg('생성 실패:\n' + traceback.format_exc())

# -----------------------------------------------------------------------------
# Add-in entry points
# -----------------------------------------------------------------------------

def run(context):
    global _app, _ui
    try:
        _app, _ui = app_objects()
        cmd_defs = _ui.commandDefinitions
        old = cmd_defs.itemById(CMD_ID)
        if old:
            old.deleteMe()

        cmd_def = cmd_defs.addButtonDefinition(
            CMD_ID,
            '종합 기어 생성기 v2',
            '감속비와 모듈 기반으로 여러 기어 세트를 자동 생성합니다.'
        )
        ch = CommandCreatedHandler()
        cmd_def.commandCreated.add(ch)
        _handlers.append(ch)

        panel = _ui.allToolbarPanels.itemById(PANEL_ID)
        if panel and not panel.controls.itemById(CMD_ID):
            panel.controls.addCommand(cmd_def)
    except Exception:
        if _ui:
            _ui.messageBox('애드인 시작 실패:\n' + traceback.format_exc())


def stop(context):
    try:
        app, ui = app_objects()
        panel = ui.allToolbarPanels.itemById(PANEL_ID)
        if panel:
            ctrl = panel.controls.itemById(CMD_ID)
            if ctrl:
                ctrl.deleteMe()
        cmd_def = ui.commandDefinitions.itemById(CMD_ID)
        if cmd_def:
            cmd_def.deleteMe()
    except Exception:
        if _ui:
            _ui.messageBox('애드인 종료 실패:\n' + traceback.format_exc())

"""
Fusion 360 command: generate a 3-part harmonic drive (circular spline,
flexspline, wave-generator cam) using the rev-2 cycloid tooth profile math
in hd_math.py (real numerical envelope, alpha0-truncated cycloid, tangent
root fillet — see that file's module docstring).

Simplifications (documented, not hidden):
  - The flexspline is generated as a toothed ring of constant face width,
    not the full cup (diaphragm + boss).
  - The wave-generator is a plain elliptical cam solid (no separate ball
    bearing race).
  - Detail (samples-per-flank / envelope bins / sweep steps) defaults are
    much coarser here than the web preview uses, because each point becomes
    an individual Fusion API call (SketchLines.addByTwoPoints) and that is
    the dominant cost of generation - see build_circular_spline's docstring.
"""
import math
import traceback

import adsk.core
import adsk.fusion

from .. import hd_math

MM_TO_CM = 0.1

CMD_ID = "harmonicDriveGeneratorCmd"
PANEL_ID = "SolidCreatePanel"


def mm(v):
    return v * MM_TO_CM


class GenerateCommand:
    def __init__(self, app, ui):
        self.app = app
        self.ui = ui
        self.handlers = []

    def start(self):
        cmd_def = self.ui.commandDefinitions.itemById(CMD_ID)
        if not cmd_def:
            cmd_def = self.ui.commandDefinitions.addButtonDefinition(
                CMD_ID,
                "하모닉 드라이브 생성",
                "사이클로이드 치형 하모닉 드라이브\n"
                "(서큘러스플라인 + 플렉스스플라인 + 웨이브제너레이터 캠)를 생성합니다.",
            )
        on_created = CommandCreatedHandler(self)
        cmd_def.commandCreated.add(on_created)
        self.handlers.append(on_created)

        panel = self.ui.allToolbarPanels.itemById(PANEL_ID)
        if panel:
            control = panel.controls.itemById(CMD_ID)
            if not control:
                panel.controls.addCommand(cmd_def)

    def stop(self):
        panel = self.ui.allToolbarPanels.itemById(PANEL_ID)
        if panel:
            control = panel.controls.itemById(CMD_ID)
            if control:
                control.deleteMe()
        cmd_def = self.ui.commandDefinitions.itemById(CMD_ID)
        if cmd_def:
            cmd_def.deleteMe()


# ---------------------------------------------------------------------
# Input reading + live summary
# ---------------------------------------------------------------------


def _read_geometry(inputs):
    """Read every shape-defining command input and derive the HD geometry.
    Returns None if the current values aren't usable yet (still typing)."""
    try:
        b = inputs.itemById("basic").children
        m_ = b.itemById("module").value / MM_TO_CM
        zf = int(round(b.itemById("zf").value))
        zc = int(round(b.itemById("zc").value))
        if m_ <= 0 or zf <= 0 or zc <= 0:
            return None

        a = inputs.itemById("advanced").children
        return hd_math.derive_geometry(
            module=m_, zf=zf, zc=zc,
            w0_ratio=a.itemById("w0").value,
            ha=a.itemById("ha").value,
            hd=a.itemById("hd").value,
            tooth_angle=a.itemById("toothangle").value,
            tooth_thickness=a.itemById("toothick").value,
            root_fillet=a.itemById("rootfillet").value,
            clearance=a.itemById("clearance").value,
            wall_flex=b.itemById("wallflex").value / MM_TO_CM,
            wall_circ=b.itemById("wallcirc").value / MM_TO_CM,
        )
    except Exception:
        return None


def _summary_text(d):
    if d is None:
        return "값을 입력해주세요 (모듈 > 0, zf/zc > 0)."

    dz = d["zc"] - d["zf"]
    ratio = d["zf"] / dz if dz else float("inf")
    lines = [
        "감속비           1 : %.2f" % ratio,
        "피치 반경 (rp)      %.3f mm" % d["rp"],
        "WG 장축/단축 (a/b)   %.3f / %.3f mm" % (d["a"], d["b"]),
        "이빨각 α0 (적용값)    %.2f°" % (d["alpha0"] * 180 / math.pi),
        "",
        "FS 이끝/이뿌리 높이   %.3f / %.3f mm" % (d["ha"], d["hd"]),
        "이뿌리 필렛         %.3f mm" % d["rootFillet"],
        "백래시 공차         %.3f mm" % d["clearance"],
        "FS 벽 / CS 벽 두께   %.2f / %.2f mm" % (d["wallFlex"], d["wallCirc"]),
        "",
        "스트로크 여유        %.1f µm" % (d["strokeMargin"] * 1000),
    ]
    if d["warnings"]:
        lines.append("")
        for w in d["warnings"]:
            lines.append("⚠ " + w)
    if not d["feasible"]:
        lines.append("")
        lines.append("✕ 이 조합은 생성할 수 없습니다.")
    return "\n".join(lines)


class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self, owner: GenerateCommand):
        super().__init__()
        self.owner = owner

    def notify(self, args):
        try:
            cmd = args.command
            inputs = cmd.commandInputs

            basic = inputs.addGroupCommandInput("basic", "기본 치수")
            basic.isExpanded = True
            b = basic.children
            b.addValueInput("module", "모듈 (Module)", "mm", adsk.core.ValueInput.createByString("1.25 mm"))
            b.addIntegerSpinnerCommandInput("zf", "플렉스스플라인 잇수 (zf)", 20, 400, 1, 100)
            b.addIntegerSpinnerCommandInput("zc", "서큘러스플라인 잇수 (zc)", 21, 402, 1, 102)
            b.addValueInput("wallflex", "FS 벽 두께", "mm", adsk.core.ValueInput.createByString("0.75 mm"))
            b.addValueInput("wallcirc", "CS 벽 두께", "mm", adsk.core.ValueInput.createByString("3.0 mm"))
            b.addValueInput("cswidth", "CS 폭 (Face Width)", "mm", adsk.core.ValueInput.createByString("15 mm"))
            b.addValueInput("fswidth", "FS 폭 (Face Width)", "mm", adsk.core.ValueInput.createByString("12 mm"))
            b.addValueInput("wgwidth", "WG 캠 폭 (Face Width)", "mm", adsk.core.ValueInput.createByString("10 mm"))

            adv = inputs.addGroupCommandInput("advanced", "치형 고급 설정")
            adv.isExpanded = False
            a = adv.children
            a.addValueInput("ha", "이끝 높이 계수 ha*", "", adsk.core.ValueInput.createByReal(1.0))
            a.addValueInput("hd", "이뿌리 깊이 계수 hd*", "", adsk.core.ValueInput.createByReal(1.0))
            a.addValueInput("w0", "최대 반경변형 계수 w0*", "", adsk.core.ValueInput.createByReal(1.0))
            a.addValueInput("toothangle", "이빨각 α0 (deg)", "", adsk.core.ValueInput.createByReal(9.17))
            a.addValueInput("toothick", "이 두께 비율 (원주피치 대비)", "", adsk.core.ValueInput.createByReal(0.5))
            a.addValueInput("rootfillet", "이뿌리 필렛 (x module)", "", adsk.core.ValueInput.createByReal(0.15))
            a.addValueInput("clearance", "백래시 공차 (x module)", "", adsk.core.ValueInput.createByReal(0.05))
            a.addIntegerSpinnerCommandInput("spf", "치형 정밀도 (샘플/flank)", 6, 48, 1, 12)
            a.addIntegerSpinnerCommandInput("nbins", "공액 계산 해상도 (bins)", 24, 256, 1, 48)

            opt = inputs.addGroupCommandInput("options", "실용 옵션")
            opt.isExpanded = False
            o = opt.children
            o.addBoolValueInput("csholes", "CS 마운팅 홀 생성", True, "", False)
            o.addIntegerSpinnerCommandInput("csholecount", "CS 홀 개수", 3, 24, 1, 6)
            o.addValueInput("csholedia", "CS 홀 지름", "mm", adsk.core.ValueInput.createByString("5 mm"))
            o.addValueInput("csholepcd", "CS 홀 PCD 반지름", "mm", adsk.core.ValueInput.createByString("65 mm"))
            o.addBoolValueInput("fsholes", "FS 출력 마운팅 홀 생성", True, "", False)
            o.addIntegerSpinnerCommandInput("fsholecount", "FS 홀 개수", 3, 24, 1, 6)
            o.addValueInput("fsholedia", "FS 홀 지름", "mm", adsk.core.ValueInput.createByString("4 mm"))
            o.addValueInput("fsholepcd", "FS 홀 PCD 반지름", "mm", adsk.core.ValueInput.createByString("20 mm"))

            inputs.addTextBoxCommandInput("summary", "계산 결과", _summary_text(_read_geometry(inputs)), 14, True)

            on_execute = ExecuteHandler(self.owner)
            cmd.execute.add(on_execute)
            self.owner.handlers.append(on_execute)

            on_validate = ValidateHandler(self.owner)
            cmd.validateInputs.add(on_validate)
            self.owner.handlers.append(on_validate)

            on_changed = InputChangedHandler(self.owner)
            cmd.inputChanged.add(on_changed)
            self.owner.handlers.append(on_changed)
        except Exception:
            if self.owner.ui:
                self.owner.ui.messageBox("CommandCreated 실패:\n{}".format(traceback.format_exc()))


class InputChangedHandler(adsk.core.InputChangedEventHandler):
    def __init__(self, owner: GenerateCommand):
        super().__init__()
        self.owner = owner

    def notify(self, args):
        try:
            inputs = args.inputs
            d = _read_geometry(inputs)
            summary = inputs.itemById("summary")
            if summary:
                summary.formattedText = _summary_text(d)
        except Exception:
            pass


class ValidateHandler(adsk.core.ValidateInputsEventHandler):
    def __init__(self, owner: GenerateCommand):
        super().__init__()
        self.owner = owner

    def notify(self, args):
        # Only gate on inputs being minimally sane; infeasible shape
        # combinations are surfaced with a clear message box in
        # ExecuteHandler instead of silently disabling OK.
        try:
            inputs = args.firingEvent.sender.commandInputs
            b = inputs.itemById("basic").children
            m_ = b.itemById("module").value
            zf = b.itemById("zf").value
            zc = b.itemById("zc").value
            args.areInputsValid = m_ > 0 and zf > 0 and zc > zf
        except Exception:
            args.areInputsValid = False


class ExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self, owner: GenerateCommand):
        super().__init__()
        self.owner = owner

    def notify(self, args):
        ui = self.owner.ui
        app = self.owner.app
        try:
            inputs = args.command.commandInputs
            d = _read_geometry(inputs)
            if d is None:
                ui.messageBox("입력값을 확인해주세요.")
                return

            b = inputs.itemById("basic").children
            cs_width = b.itemById("cswidth").value
            fs_width = b.itemById("fswidth").value
            wg_width = b.itemById("wgwidth").value

            adv = inputs.itemById("advanced").children
            spf = int(adv.itemById("spf").value)
            n_bins = int(adv.itemById("nbins").value)

            opt = inputs.itemById("options").children
            cs_holes = opt.itemById("csholes").value
            cs_hole_count = int(opt.itemById("csholecount").value)
            cs_hole_dia = opt.itemById("csholedia").value  # cm (Fusion internal unit)
            cs_hole_pcd = opt.itemById("csholepcd").value
            fs_holes = opt.itemById("fsholes").value
            fs_hole_count = int(opt.itemById("fsholecount").value)
            fs_hole_dia = opt.itemById("fsholedia").value
            fs_hole_pcd = opt.itemById("fsholepcd").value

            if d["warnings"]:
                msg = "\n".join(d["warnings"])
                if not d["feasible"]:
                    ui.messageBox("생성 중단:\n" + msg)
                    return
                else:
                    ui.messageBox("경고:\n" + msg + "\n\n생성을 계속합니다.")

            design = adsk.fusion.Design.cast(app.activeProduct)
            root = design.rootComponent

            progress = ui.createProgressDialog()
            progress.cancelButtonText = "취소"
            progress.isBackgroundTranslucent = False
            progress.show("하모닉 드라이브 생성 중", "공액 치형 계산 중...", 0, 3, 1)

            flex = hd_math.flexspline_profile(d, d["zf"], samples_per_flank=spf)
            progress.progressValue = 1
            progress.message = "서큘러스플라인 치형(공액 envelope) 계산 중..."
            if progress.wasCancelled:
                progress.hide()
                return

            circ = hd_math.spline_profile(d, d["zc"], d["zf"], d["wallCirc"], d["clearance"], n_bins=n_bins, steps=max(200, n_bins * 4))
            progress.progressValue = 2
            progress.message = "Fusion 지오메트리 생성 중..."
            if progress.wasCancelled:
                progress.hide()
                return

            # cs_width/fs_width/wg_width/*_hole_pcd are read directly from
            # "mm"-unitType ValueInputs above, so .value is already cm - do
            # NOT pass them through mm() again (that would be a second,
            # erroneous x0.1 conversion). Only genuine-millimeter values
            # computed in Python (hd_math's outputs) go through mm().
            build_circular_spline(
                root, d, circ, cs_width,
                holes=cs_holes, hole_count=cs_hole_count, hole_dia_cm=cs_hole_dia, hole_pcd_cm=cs_hole_pcd,
            )
            build_flexspline(
                root, d, flex, fs_width,
                holes=fs_holes, hole_count=fs_hole_count, hole_dia_cm=fs_hole_dia, hole_pcd_cm=fs_hole_pcd,
            )
            build_wave_generator(root, d, wg_width)
            progress.progressValue = 3
            progress.hide()

            ui.messageBox("생성 완료\n\n" + _summary_text(d))

        except Exception:
            if ui:
                ui.messageBox("생성 실패:\n{}".format(traceback.format_exc()))


# ---------------------------------------------------------------------
# Geometry builders
# ---------------------------------------------------------------------


def _add_circle(sketch, r_mm, cx_mm=0.0, cy_mm=0.0):
    center = adsk.core.Point3D.create(mm(cx_mm), mm(cy_mm), 0.0)
    return sketch.sketchCurves.sketchCircles.addByCenterRadius(center, mm(r_mm))


def _add_closed_polyline(sketch, pts_mm, dedup_eps_mm=1e-4):
    """
    Build a closed loop out of straight line segments (SketchLines), not a
    fitted spline: fitted splines are dramatically slower to create in bulk
    via the API. Near-duplicate consecutive points (e.g. from a
    near-zero-width root land at full tooth depth) are dropped first -
    Fusion can reject or choke on a zero-length line segment.
    """
    pts = []
    for p in pts_mm:
        if not pts or (p[0] - pts[-1][0]) ** 2 + (p[1] - pts[-1][1]) ** 2 > dedup_eps_mm ** 2:
            pts.append(p)
    if len(pts) > 1 and (pts[0][0] - pts[-1][0]) ** 2 + (pts[0][1] - pts[-1][1]) ** 2 <= dedup_eps_mm ** 2:
        pts.pop()
    if pts[0] != pts[-1]:
        pts = pts + [pts[0]]

    p3d = [adsk.core.Point3D.create(mm(x), mm(y), 0.0) for x, y in pts]
    lines = sketch.sketchCurves.sketchLines
    for i in range(len(p3d) - 1):
        lines.addByTwoPoints(p3d[i], p3d[i + 1])


def _extrude_largest_profile(comp, sketch, depth_cm, operation, participant_body=None):
    """
    Extrude only the LARGEST-area profile Fusion finds in `sketch`. Each of
    our sketches here has exactly two closed curves - an outer boundary and
    an inner one - which Fusion always decomposes into exactly two regions:
    the annulus between them (what we want) and the small interior disk
    inside the inner curve (a bore or, for the circular spline, the tooth
    envelope's own interior) - which is reliably the smaller of the two, so
    picking the larger profile needs no special-casing per part. Same
    pattern as the bundled UniversalGearGenerator/CycloidalGearGenerator
    add-ins' own profile selection.
    """
    if sketch.profiles.count == 0:
        raise RuntimeError("스케치에서 닫힌 프로파일을 찾지 못했습니다: " + sketch.name)
    best = sketch.profiles.item(0)
    best_area = best.areaProperties().area
    for i in range(1, sketch.profiles.count):
        prof = sketch.profiles.item(i)
        area = prof.areaProperties().area
        if area > best_area:
            best, best_area = prof, area

    extrudes = comp.features.extrudeFeatures
    ext_input = extrudes.createInput(best, operation)
    ext_input.setDistanceExtent(False, adsk.core.ValueInput.createByReal(depth_cm))
    if participant_body is not None:
        try:
            bodies_coll = adsk.core.ObjectCollection.create()
            bodies_coll.add(participant_body)
            ext_input.participantBodies = bodies_coll
        except Exception:
            pass  # older API versions: falls back to Fusion's default participant detection
    return extrudes.add(ext_input)


def _extrude_all_profiles(comp, sketch, depth_cm):
    profiles = adsk.core.ObjectCollection.create()
    for i in range(sketch.profiles.count):
        profiles.add(sketch.profiles.item(i))
    extrudes = comp.features.extrudeFeatures
    ext_input = extrudes.createInput(profiles, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    ext_input.setDistanceExtent(False, adsk.core.ValueInput.createByReal(depth_cm))
    return extrudes.add(ext_input)


def _target_component(root):
    """
    Prefer a real sub-component, but some Fusion documents are created as
    single-component "Part" documents where addNewComponent raises
    RuntimeError 3. Fall back to building bodies directly in `root` in that
    case - that always works, regardless of document type.
    """
    try:
        occ = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
        return occ.component, True
    except RuntimeError:
        return root, False


def _cut_mounting_holes(comp, body, pcd_cm, count, hole_dia_cm, depth_cm, base_angle=0.0):
    if count <= 0 or hole_dia_cm <= 0 or pcd_cm <= 0:
        return
    sketch = comp.sketches.add(comp.xYConstructionPlane)
    sketch.name = "MountingHoles"
    sketch.isComputeDeferred = True
    try:
        for k in range(count):
            ang = base_angle + k * 2 * math.pi / count
            cx = (pcd_cm / 2.0) * math.sin(ang)
            cy = (pcd_cm / 2.0) * math.cos(ang)
            sketch.sketchCurves.sketchCircles.addByCenterRadius(
                adsk.core.Point3D.create(cx, cy, 0.0), hole_dia_cm / 2.0
            )
    finally:
        sketch.isComputeDeferred = False
    profiles = adsk.core.ObjectCollection.create()
    for i in range(sketch.profiles.count):
        profiles.add(sketch.profiles.item(i))
    extrudes = comp.features.extrudeFeatures
    ext_input = extrudes.createInput(profiles, adsk.fusion.FeatureOperations.CutFeatureOperation)
    ext_input.setDistanceExtent(False, adsk.core.ValueInput.createByReal(depth_cm))
    try:
        bodies_coll = adsk.core.ObjectCollection.create()
        bodies_coll.add(body)
        ext_input.participantBodies = bodies_coll
    except Exception:
        pass
    extrudes.add(ext_input)


def build_circular_spline(root, d, circ, face_width_cm, holes=False, hole_count=6, hole_dia_cm=0.5, hole_pcd_cm=0.0):
    comp, is_new = _target_component(root)
    if is_new:
        comp.name = "CircularSpline"

    sketch = comp.sketches.add(comp.xYConstructionPlane)
    sketch.name = "CS_Profile"
    sketch.isComputeDeferred = True
    try:
        _add_circle(sketch, circ["outerRadius"])
        _add_closed_polyline(sketch, circ["inner"])
    finally:
        sketch.isComputeDeferred = False

    feature = _extrude_largest_profile(comp, sketch, face_width_cm, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    body = feature.bodies.item(0) if feature.bodies.count else None
    if not is_new and body:
        body.name = "CircularSpline"

    if holes and body:
        _cut_mounting_holes(comp, body, hole_pcd_cm, hole_count, hole_dia_cm, face_width_cm)
    return comp


def build_flexspline(root, d, flex, face_width_cm, holes=False, hole_count=6, hole_dia_cm=0.4, hole_pcd_cm=0.0):
    comp, is_new = _target_component(root)
    if is_new:
        comp.name = "FlexSpline"

    bore_r = flex["rootRadius"] - d["wallFlex"]
    sketch = comp.sketches.add(comp.xYConstructionPlane)
    sketch.name = "FS_Profile"
    sketch.isComputeDeferred = True
    try:
        _add_closed_polyline(sketch, flex["outer"])
        _add_circle(sketch, bore_r)
    finally:
        sketch.isComputeDeferred = False

    feature = _extrude_largest_profile(comp, sketch, face_width_cm, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    body = feature.bodies.item(0) if feature.bodies.count else None
    if not is_new and body:
        body.name = "FlexSpline"

    if holes and body:
        _cut_mounting_holes(comp, body, hole_pcd_cm, hole_count, hole_dia_cm, face_width_cm)
    return comp


def build_wave_generator(root, d, width_cm):
    comp, is_new = _target_component(root)
    if is_new:
        comp.name = "WaveGenerator"

    sketch = comp.sketches.add(comp.xYConstructionPlane)
    sketch.name = "WG_Profile"
    sketch.isComputeDeferred = True
    try:
        cam_pts = hd_math.wave_generator_cam(d, 240)
        _add_closed_polyline(sketch, cam_pts)
    finally:
        sketch.isComputeDeferred = False

    feature = _extrude_all_profiles(comp, sketch, width_cm)
    if not is_new:
        for i in range(feature.bodies.count):
            feature.bodies.item(i).name = "WaveGenerator"
    return comp

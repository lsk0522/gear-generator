"""
Fusion 360 command: generate a 3-part harmonic drive (circular spline,
flexspline, wave-generator cam) from just module / outer diameter / inner
diameter, using the cycloid tooth profile math in hd_math.py.

Simplifications (documented, not hidden):
  - The flexspline is generated as a toothed ring of constant face width,
    not the full cup (diaphragm + boss). Adding the cup shape is a
    reasonable follow-up (revolve + shell), but is out of scope here.
  - The wave-generator is a plain elliptical cam solid (no separate ball
    bearing race).
  - Root (dedendum) fillets are a simple clearance-safe cycloidal fillet,
    not the paper's full envelope-refined dedendum (see hd_math.py).
  - Face widths (CS/FS/WG thickness) are auto-derived from module/OD, not
    user input - see hd_math.derive_hd_params().
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
                "모듈 / 외경 / 내경으로 사이클로이드 치형 하모닉 드라이브\n"
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


def _read_params(inputs):
    """Read every command input and derive the full HD parameter set.
    Returns None if the current values aren't usable yet (still typing)."""
    try:
        m_ = inputs.itemById("m").value / MM_TO_CM
        od_ = inputs.itemById("od").value / MM_TO_CM
        id_ = inputs.itemById("id").value / MM_TO_CM
        if m_ <= 0 or od_ <= 0 or id_ <= 0:
            return None

        adv = inputs.itemById("advanced").children
        ha = adv.itemById("ha").value
        hf = adv.itemById("hf").value
        w0 = adv.itemById("w0").value
        csrim_mult = adv.itemById("csrim").value
        tooth_diff = adv.itemById("toothdiff").value

        p = hd_math.derive_hd_params(
            m_, od_, id_,
            ha_star=ha, hf_star=hf, w0_star=w0,
            cs_rim=csrim_mult * m_, tooth_diff=int(tooth_diff),
        )
        return p
    except Exception:
        return None


def _summary_text(p):
    if p is None:
        return "값을 입력해주세요 (모듈 > 0, 외경 > 내경 > 0)."

    lines = []
    lines.append("감속비          1 : %.2f" % p["ratio"])
    lines.append("FS 잇수 (z1)     %d" % p["z1"])
    lines.append("CS 잇수 (z2)     %d" % p["z2"])
    lines.append("")
    lines.append("FS 피치/이끝/이뿌리   %.2f / %.2f / %.2f mm" % (p["R1"], p["Ra1"], p["Rf1"]))
    lines.append("CS 피치/이끝/이뿌리   %.2f / %.2f / %.2f mm" % (p["R2"], p["Ra2"], p["Rf2"]))
    lines.append("FS 벽 두께        %.3f mm" % p["wallFS"])
    lines.append("WG 장축/단축      %.3f / %.3f mm" % (p["rhoA"], p["rhoB"]))
    lines.append("")
    lines.append("CS/FS/WG 폭(자동)   %.1f / %.1f / %.1f mm" % (p["csWidth"], p["fsWidth"], p["wgWidth"]))

    if p["warnings"]:
        lines.append("")
        for w in p["warnings"]:
            lines.append("⚠ " + w)
    if not p["feasible"]:
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
            b.addValueInput("m", "모듈 (Module)", "mm", adsk.core.ValueInput.createByString("1.0 mm"))
            b.addValueInput("od", "외경 (CS Outer Diameter)", "mm", adsk.core.ValueInput.createByString("120 mm"))
            b.addValueInput("id", "내경 (FS Bore Diameter)", "mm", adsk.core.ValueInput.createByString("109 mm"))

            adv = inputs.addGroupCommandInput("advanced", "치형 고급 설정")
            adv.isExpanded = False
            a = adv.children
            a.addValueInput("ha", "이끝 높이 계수 ha*", "", adsk.core.ValueInput.createByReal(1.0))
            a.addValueInput("hf", "이뿌리 높이 계수 hf*", "", adsk.core.ValueInput.createByReal(1.25))
            a.addValueInput("w0", "최대 반경변형 계수 w0*", "", adsk.core.ValueInput.createByReal(1.0))
            a.addValueInput("csrim", "CS 림 두께 (x module)", "", adsk.core.ValueInput.createByReal(3.0))
            a.addIntegerSpinnerCommandInput("toothdiff", "잇수차 (z2-z1)", 2, 6, 2, 2)
            a.addIntegerSpinnerCommandInput("nseg", "치형 정밀도 (세그먼트/flank)", 4, 40, 1, 10)

            opt = inputs.addGroupCommandInput("options", "실용 옵션")
            opt.isExpanded = False
            o = opt.children
            o.addBoolValueInput("csholes", "CS 마운팅 홀 생성", True, "", False)
            o.addIntegerSpinnerCommandInput("csholecount", "CS 홀 개수", 3, 24, 1, 6)
            o.addValueInput("csholedia", "CS 홀 지름", "mm", adsk.core.ValueInput.createByString("5 mm"))
            o.addBoolValueInput("fsholes", "FS 출력 마운팅 홀 생성", True, "", False)
            o.addIntegerSpinnerCommandInput("fsholecount", "FS 홀 개수", 3, 24, 1, 6)
            o.addValueInput("fsholedia", "FS 홀 지름", "mm", adsk.core.ValueInput.createByString("4 mm"))

            inputs.addTextBoxCommandInput("summary", "계산 결과", _summary_text(_read_params(inputs)), 12, True)

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
            p = _read_params(inputs)
            summary = inputs.itemById("summary")
            if summary:
                summary.formattedText = _summary_text(p)
        except Exception:
            pass


class ValidateHandler(adsk.core.ValidateInputsEventHandler):
    def __init__(self, owner: GenerateCommand):
        super().__init__()
        self.owner = owner

    def notify(self, args):
        # Only gate on inputs being minimally sane (m>0, od>0, id>0, od>id).
        # Whether the resulting geometry is "feasible" (wall thickness etc.)
        # is intentionally NOT required here - that case is handled with a
        # clear message box in ExecuteHandler instead, because a disabled
        # OK button gives the user no way to see *why* it's disabled.
        try:
            inputs = args.firingEvent.sender.commandInputs
            m_ = inputs.itemById("m").value
            od_ = inputs.itemById("od").value
            id_ = inputs.itemById("id").value
            args.areInputsValid = m_ > 0 and od_ > 0 and id_ > 0 and od_ > id_
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
            p = _read_params(inputs)
            if p is None:
                ui.messageBox("입력값을 확인해주세요.")
                return

            opt = inputs.itemById("options").children
            cs_holes = opt.itemById("csholes").value
            cs_hole_count = int(opt.itemById("csholecount").value)
            cs_hole_dia = opt.itemById("csholedia").value  # already cm (Fusion internal unit)
            fs_holes = opt.itemById("fsholes").value
            fs_hole_count = int(opt.itemById("fsholecount").value)
            fs_hole_dia = opt.itemById("fsholedia").value  # already cm (Fusion internal unit)

            n_seg = int(inputs.itemById("advanced").children.itemById("nseg").value)

            if p["warnings"]:
                msg = "\n".join(p["warnings"])
                if not p["feasible"]:
                    ui.messageBox("생성 중단:\n" + msg)
                    return
                else:
                    ui.messageBox("경고:\n" + msg + "\n\n생성을 계속합니다.")

            design = adsk.fusion.Design.cast(app.activeProduct)
            root = design.rootComponent

            progress = ui.createProgressDialog()
            progress.cancelButtonText = "취소"
            progress.isBackgroundTranslucent = False
            progress.show(
                "하모닉 드라이브 생성 중",
                "서큘러스플라인 생성 중... (%d개 치형)" % p["z2"], 0, 3, 1
            )

            build_circular_spline(
                root, p, mm(p["csWidth"]), n_seg,
                holes=cs_holes, hole_count=cs_hole_count, hole_dia_cm=cs_hole_dia,
            )
            progress.progressValue = 1
            progress.message = "플렉스스플라인 생성 중... (%d개 치형)" % p["z1"]
            if progress.wasCancelled:
                progress.hide()
                return

            build_flexspline(
                root, p, mm(p["fsWidth"]), n_seg,
                holes=fs_holes, hole_count=fs_hole_count, hole_dia_cm=fs_hole_dia,
            )
            progress.progressValue = 2
            progress.message = "웨이브제너레이터 캠 생성 중..."
            if progress.wasCancelled:
                progress.hide()
                return

            build_wave_generator(root, p, mm(p["wgWidth"]))
            progress.progressValue = 3
            progress.hide()

            ui.messageBox("생성 완료\n\n" + _summary_text(p))

        except Exception:
            if ui:
                ui.messageBox("생성 실패:\n{}".format(traceback.format_exc()))


# ---------------------------------------------------------------------
# Geometry builders
# ---------------------------------------------------------------------


def _pts3d(pts_mm, z_cm=0.0):
    coll = adsk.core.ObjectCollection.create()
    for x, y in pts_mm:
        coll.add(adsk.core.Point3D.create(mm(x), mm(y), z_cm))
    return coll


def _add_circle(sketch, r_mm):
    center = adsk.core.Point3D.create(0, 0, 0)
    return sketch.sketchCurves.sketchCircles.addByCenterRadius(center, mm(r_mm))


def _add_closed_polyline(sketch, pts_mm):
    """
    Build a closed loop out of straight line segments (SketchLines), not a
    fitted spline. Fitted splines are dramatically slower to create in bulk
    via the API (each one runs a curve-fit solve); with a few hundred teeth,
    that is the difference between seconds and many minutes. Straight
    segments through the same sample points are visually smooth enough at
    the segment counts this add-in uses, and are far faster and more
    predictable for the sketch's profile/region solver too.
    """
    pts = list(pts_mm)
    if pts[0] != pts[-1]:
        pts = pts + [pts[0]]
    p3d = [adsk.core.Point3D.create(mm(x), mm(y), 0.0) for x, y in pts]
    lines = sketch.sketchCurves.sketchLines
    for i in range(len(p3d) - 1):
        lines.addByTwoPoints(p3d[i], p3d[i + 1])


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
    Prefer a real sub-component (nicer browser tree / lets the user later
    turn this into a proper multi-body assembly), but some Fusion documents
    are created as single-component "Part" documents where addNewComponent
    raises RuntimeError 3. Fall back to building bodies directly in `root`
    in that case - that always works, regardless of document type.
    """
    try:
        occ = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
        return occ.component, True
    except RuntimeError:
        return root, False


def _cut_mounting_holes(comp, body, pcd_cm, count, hole_dia_cm, depth_cm, base_angle=0.0):
    if count <= 0 or hole_dia_cm <= 0:
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
        pass  # older API versions: falls back to Fusion's default participant detection
    extrudes.add(ext_input)


def _extrude_operation_profiles(comp, sketch, depth_cm, operation, participant_body=None):
    """
    Extrude EVERY profile found in `sketch` with the given operation. Safe
    to use with "select everything" ONLY when the sketch is known to
    contain nothing but same-purpose curves (e.g. a sketch that has only
    the tooth/notch outlines and nothing else) - see build_circular_spline
    / build_flexspline for why the sketches are deliberately kept separate.
    """
    profiles = adsk.core.ObjectCollection.create()
    for i in range(sketch.profiles.count):
        profiles.add(sketch.profiles.item(i))
    extrudes = comp.features.extrudeFeatures
    ext_input = extrudes.createInput(profiles, operation)
    ext_input.setDistanceExtent(False, adsk.core.ValueInput.createByReal(depth_cm))
    if participant_body is not None:
        try:
            bodies_coll = adsk.core.ObjectCollection.create()
            bodies_coll.add(participant_body)
            ext_input.participantBodies = bodies_coll
        except Exception:
            pass  # older API versions: falls back to Fusion's default participant detection
    return extrudes.add(ext_input)


def build_circular_spline(root, p, face_width_cm, n_seg, holes=False, hole_count=6, hole_dia_cm=0.5):
    """
    Built in two separate sketches/steps instead of one combined sketch,
    specifically so Fusion's profile solver never has to be second-guessed:
      1. outer circle + Ra2 circle -> exactly one clean annulus profile ->
         extrude as a New Body (a plain untoothed ring).
      2. a sketch containing ONLY the z2 notch (gap) outlines, nothing
         else -> each notch is its own unambiguous closed profile (no
         circles or neighboring curves to confuse the region solver) ->
         cut all of them out of the ring body at once. What's left
         standing between the notches are the teeth.
    (A single combined sketch with everything in it was tried first and
    reliably produces wrong geometry: Fusion decomposes it into 2*z2+1
    separate regions - root land x z2, gap x z2, plus the bore - and
    "select every profile" extrudes the gaps as solid material too.)
    """
    comp, is_new = _target_component(root)
    if is_new:
        comp.name = "CircularSpline"

    ring_sketch = comp.sketches.add(comp.xYConstructionPlane)
    ring_sketch.name = "CS_Ring"
    _add_circle(ring_sketch, p["csOuterActual"] / 2.0)
    _add_circle(ring_sketch, p["Ra2"])
    ring_feature = _extrude_operation_profiles(
        comp, ring_sketch, face_width_cm, adsk.fusion.FeatureOperations.NewBodyFeatureOperation
    )
    body = ring_feature.bodies.item(0) if ring_feature.bodies.count else None
    if not is_new and body:
        body.name = "CircularSpline"

    notch_sketch = comp.sketches.add(comp.xYConstructionPlane)
    notch_sketch.name = "CS_Notches"
    notch_sketch.isComputeDeferred = True
    try:
        for notch in hd_math.build_cs_ring_notches(p, n_seg, 0.0):
            _add_closed_polyline(notch_sketch, notch)
    finally:
        notch_sketch.isComputeDeferred = False
    _extrude_operation_profiles(
        comp, notch_sketch, face_width_cm, adsk.fusion.FeatureOperations.CutFeatureOperation, body
    )

    if holes and body:
        _cut_mounting_holes(comp, body, mm(p["csHolePCD"]), hole_count, hole_dia_cm, face_width_cm)
    return comp


def build_flexspline(root, p, face_width_cm, n_seg, holes=False, hole_count=6, hole_dia_cm=0.4):
    """Mirror of build_circular_spline's two-step approach: a plain hub
    ring (Rf1 to bore) first, then the z1 tooth outlines - each its own
    unambiguous profile since nothing else shares that sketch - JOINED
    (not cut) onto the hub, since teeth are solid protrusions here rather
    than gaps."""
    comp, is_new = _target_component(root)
    if is_new:
        comp.name = "FlexSpline"

    hub_sketch = comp.sketches.add(comp.xYConstructionPlane)
    hub_sketch.name = "FS_Hub"
    _add_circle(hub_sketch, p["Rf1"])
    _add_circle(hub_sketch, p["bore"])
    hub_feature = _extrude_operation_profiles(
        comp, hub_sketch, face_width_cm, adsk.fusion.FeatureOperations.NewBodyFeatureOperation
    )
    body = hub_feature.bodies.item(0) if hub_feature.bodies.count else None
    if not is_new and body:
        body.name = "FlexSpline"

    teeth_sketch = comp.sketches.add(comp.xYConstructionPlane)
    teeth_sketch.name = "FS_Teeth"
    teeth_sketch.isComputeDeferred = True
    try:
        for tooth in hd_math.build_fs_ring_teeth(p, n_seg, 0.0):
            _add_closed_polyline(teeth_sketch, tooth)
    finally:
        teeth_sketch.isComputeDeferred = False
    _extrude_operation_profiles(
        comp, teeth_sketch, face_width_cm, adsk.fusion.FeatureOperations.JoinFeatureOperation, body
    )

    if holes and body:
        _cut_mounting_holes(comp, body, mm(p["fsHolePCD"]), hole_count, hole_dia_cm, face_width_cm)
    return comp


def build_wave_generator(root, p, width_cm):
    comp, is_new = _target_component(root)
    if is_new:
        comp.name = "WaveGenerator"

    sketch = comp.sketches.add(comp.xYConstructionPlane)
    sketch.name = "WG_Profile"
    sketch.isComputeDeferred = True
    try:
        cam_pts = hd_math.build_wave_generator_cam(p, 240)
        _add_closed_polyline(sketch, cam_pts)
    finally:
        sketch.isComputeDeferred = False

    feature = _extrude_all_profiles(comp, sketch, width_cm)
    if not is_new:
        for i in range(feature.bodies.count):
            feature.bodies.item(i).name = "WaveGenerator"
    return comp

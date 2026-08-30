"""
Harmonic Drive cycloid tooth profile - shared math core (Python port).

This is a line-for-line port of core-math.js used by the companion website,
so the Fusion 360 add-in and the web preview always agree. See core-math.js
for the full derivation notes and the paper reference:

  Yao, Y.; Lu, L.; Chen, X.; Xie, Y.; Yang, Y.; Xing, J.
  "A Novel Cycloid Tooth Profile for Harmonic Drive with Fully Conjugate
  Features." Actuators 2025, 14(4), 187. https://doi.org/10.3390/act14040187

Units: millimeters, radians.
"""
import math

DEFAULTS = {
    "haStar": 1.0,
    "hfStar": 1.25,
    "w0Star": 1.0,
    "csRimFactor": 3.0,
    "dedendumXTaper": 0.6,
    "addendumXTaper": 0.92,
    "fsToothDiffFactor": 2,
}


def simpson(f, a, b, n=400):
    if n % 2 == 1:
        n += 1
    h = (b - a) / n
    s = f(a) + f(b)
    for i in range(1, n):
        s += f(a + i * h) * (4 if i % 2 else 2)
    return s * h / 3


def rho(phi1, rho_a, rho_b):
    s, c = math.sin(phi1), math.cos(phi1)
    D = rho_a * rho_a * s * s + rho_b * rho_b * c * c
    return (rho_a * rho_b) / math.sqrt(D)


def drho(phi1, rho_a, rho_b):
    s, c = math.sin(phi1), math.cos(phi1)
    D = rho_a * rho_a * s * s + rho_b * rho_b * c * c
    Dp = math.sin(2 * phi1) * (rho_a * rho_a - rho_b * rho_b)
    return (-rho_a * rho_b * Dp) / (2 * D ** 1.5)


def neutral_line_arc_length(rho_a, rho_b):
    def f(phi):
        r = rho(phi, rho_a, rho_b)
        dr = drho(phi, rho_a, rho_b)
        return math.sqrt(r * r + dr * dr)

    return simpson(f, 0, math.pi / 2, 800)


def solve_rho_b(rm, rho_a):
    target = rm * math.pi / 2
    lo, hi = rho_a * 0.5, rho_a
    flo = neutral_line_arc_length(rho_a, lo) - target
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        fm = neutral_line_arc_length(rho_a, mid) - target
        if abs(fm) < 1e-9:
            return mid
        if (fm > 0) == (flo > 0):
            lo, flo = mid, fm
        else:
            hi = mid
    return 0.5 * (lo + hi)


def d_cycloid(t, k, m):
    return (k * m * (t - math.sin(t)) / 4.0, k * m * (1 + math.cos(t)) / 2.0)


def derive_hd_params(m, OD, ID, ha_star=None, hf_star=None, w0_star=None,
                      cs_rim=None, dedendum_x_taper=None, addendum_x_taper=None,
                      tooth_diff=None):
    ha_star = DEFAULTS["haStar"] if ha_star is None else ha_star
    hf_star = DEFAULTS["hfStar"] if hf_star is None else hf_star
    w0_star = DEFAULTS["w0Star"] if w0_star is None else w0_star
    cs_rim = DEFAULTS["csRimFactor"] * m if cs_rim is None else cs_rim
    dedendum_x_taper = DEFAULTS["dedendumXTaper"] if dedendum_x_taper is None else dedendum_x_taper
    addendum_x_taper = DEFAULTS["addendumXTaper"] if addendum_x_taper is None else addendum_x_taper
    tooth_diff = DEFAULTS["fsToothDiffFactor"] if tooth_diff is None else tooth_diff

    warnings = []

    Ra2_raw = OD / 2 - cs_rim
    z2 = round(2 * (Ra2_raw / m + ha_star))
    if z2 < 60:
        warnings.append(
            "산출된 서큘러스플라인 잇수(z2=%d)가 매우 적습니다. 모듈을 줄이거나 외경을 늘려주세요." % z2
        )
        z2 = max(z2, 12)
    Ra2 = m * (z2 / 2.0 - ha_star)
    R2 = Ra2 + ha_star * m
    Rf2 = R2 + hf_star * m
    cs_outer_actual = 2 * (Rf2 + cs_rim * 0.4)

    z1 = z2 - tooth_diff
    ratio = z1 / float(tooth_diff)
    R1 = m * z1 / 2.0
    Ra1 = R1 + ha_star * m
    Rf1 = R1 - hf_star * m

    bore = ID / 2.0
    wall_fs = Rf1 - bore
    if wall_fs <= m * 0.3:
        warnings.append(
            "플렉스스플라인 벽 두께(%.2f mm)가 너무 얇습니다. 내경을 줄이거나 외경/모듈을 조정해주세요." % wall_fs
        )
    elif wall_fs > 0.05 * R1:
        warnings.append(
            "플렉스스플라인 벽 두께(%.2f mm)가 실제 하모닉 드라이브 대비 두껍습니다(탄성 변형이 어려울 수 있음). "
            "일반적으로 내경을 이뿌리원 지름에 가깝게 설정합니다. 참고 벽 두께: %.2f mm 내외."
            % (wall_fs, 0.02 * R1)
        )
    rm = R1 - wall_fs / 2.0

    rho_a = rm + m * w0_star
    rho_b = solve_rho_b(rm, rho_a)

    et2 = math.pi * m / 2.0
    s1 = math.pi * m / 2.0

    # Axial face width - auto-derived so the user never has to specify it.
    # Real harmonic drives scale face width roughly with pitch diameter
    # (~10-15%), with a floor tied to the module so fine-pitch small drives
    # don't end up unrealistically thin. CS is slightly wider than FS (extra
    # engagement margin); the WG cam is slightly narrower than FS.
    base_width = max(8.0 * m, 0.10 * OD)
    fs_width = base_width
    cs_width = base_width * 1.2
    wg_width = base_width * 0.8

    # Default pitch-circle-diameter for optional mounting holes: sits in the
    # middle of the available solid land (CS: between root and structural
    # OD; FS: between bore and root).
    cs_hole_pcd = Rf2 + (cs_outer_actual / 2.0 - Rf2) * 0.5
    fs_hole_pcd = bore + (Rf1 - bore) * 0.5

    feasible = wall_fs > m * 0.15 and z1 > 20

    return dict(
        m=m, OD=OD, ID=ID, haStar=ha_star, hfStar=hf_star, w0Star=w0_star,
        csRim=cs_rim, dedendumXTaper=dedendum_x_taper, addendumXTaper=addendum_x_taper,
        toothDiff=tooth_diff, z1=z1, z2=z2, ratio=ratio, R1=R1, Ra1=Ra1, Rf1=Rf1,
        R2=R2, Ra2=Ra2, Rf2=Rf2, csOuterActual=cs_outer_actual, wallFS=wall_fs,
        rm=rm, rhoA=rho_a, rhoB=rho_b, et2=et2, s1=s1, bore=bore,
        csWidth=cs_width, fsWidth=fs_width, wgWidth=wg_width,
        csHolePCD=cs_hole_pcd, fsHolePCD=fs_hole_pcd,
        warnings=warnings, feasible=feasible,
    )


def cs_addendum_point(t, p):
    kx = p["haStar"] * p["addendumXTaper"]
    dx, _ = d_cycloid(t, kx, p["m"])
    _, dy = d_cycloid(t, p["haStar"], p["m"])
    return (p["et2"] / 2.0 + dx, p["R2"] - p["haStar"] * p["m"] + dy)


def cs_dedendum_point(t, p):
    kx = p["hfStar"] * p["dedendumXTaper"]
    dx, _ = d_cycloid(t, kx, p["m"])
    _, dy = d_cycloid(t, p["hfStar"], p["m"])
    return (p["et2"] / 2.0 - dx, p["R2"] + p["hfStar"] * p["m"] - dy)


def fs_addendum_point(t, p):
    kx = p["haStar"] * p["addendumXTaper"]
    dx, _ = d_cycloid(t, kx, p["m"])
    _, dy = d_cycloid(t, p["haStar"], p["m"])
    return (p["s1"] / 2.0 - dx, p["haStar"] * p["m"] - dy)


def fs_dedendum_point(t, p):
    kx = p["hfStar"] * p["dedendumXTaper"]
    dx, _ = d_cycloid(t, kx, p["m"])
    _, dy = d_cycloid(t, p["hfStar"], p["m"])
    return (p["s1"] / 2.0 + dx, -p["hfStar"] * p["m"] + dy)


def place_local_on_pitch(x1, y1, R, k, z, base_angle=0.0):
    radius = R + y1
    ang = base_angle + (k * 2 * math.pi) / z + x1 / radius
    return (radius * math.sin(ang), radius * math.cos(ang))


def place_global(x2, y2, k, z, base_angle=0.0):
    ang = base_angle + (k * 2 * math.pi) / z
    c, s = math.cos(ang), math.sin(ang)
    return (x2 * c - y2 * s, x2 * s + y2 * c)


def _sample_flank(fn, p, n_seg):
    pts = []
    for i in range(n_seg + 1):
        t = math.pi * i / n_seg
        pts.append(fn(t, p))
    return pts


def build_tooth_outline(kind, p, n_seg=24):
    """Returns (outline, root_right, tip). For 'cs' this is a SPACE (notch,
    concave) profile between two adjacent teeth; for 'fs' it is a solid
    tooth (convex) profile. See core-math.js for the derivation."""
    add_fn = cs_addendum_point if kind == "cs" else fs_addendum_point
    ded_fn = cs_dedendum_point if kind == "cs" else fs_dedendum_point

    ded_right = _sample_flank(ded_fn, p, n_seg)  # 0=pitch ... last=root
    add_right = _sample_flank(add_fn, p, n_seg)  # 0=pitch ... last=tip

    root_right = ded_right[-1]
    tip = add_right[-1]

    outline = []
    for i in range(len(ded_right) - 1, -1, -1):
        x, y = ded_right[i]
        outline.append((-x, y))
    for i in range(1, len(add_right)):
        x, y = add_right[i]
        outline.append((-x, y))
    for i in range(len(add_right) - 1, -1, -1):
        outline.append(add_right[i])
    for i in range(1, len(ded_right)):
        outline.append(ded_right[i])
    return outline, root_right, tip


def build_cs_ring_notches(p, n_seg=16, base_angle=0.0):
    outline, _, _ = build_tooth_outline("cs", p, n_seg)
    z2 = p["z2"]
    all_notches = []
    for k in range(z2):
        all_notches.append([place_global(x, y, k, z2, base_angle) for x, y in outline])
    return all_notches


def build_fs_ring_teeth(p, n_seg=16, base_angle=0.0):
    outline, _, _ = build_tooth_outline("fs", p, n_seg)
    z1 = p["z1"]
    R1 = p["R1"]
    all_teeth = []
    for k in range(z1):
        all_teeth.append([place_local_on_pitch(x, y, R1, k, z1, base_angle) for x, y in outline])
    return all_teeth


def build_wave_generator_cam(p, n_seg=240):
    pts = []
    for i in range(n_seg + 1):
        phi = 2 * math.pi * i / n_seg
        r = rho(phi, p["rhoA"], p["rhoB"]) - p["wallFS"] / 2.0
        pts.append((r * math.sin(phi), r * math.cos(phi)))
    return pts


def circle_points(r, n_seg=180):
    pts = []
    for i in range(n_seg + 1):
        a = 2 * math.pi * i / n_seg
        pts.append((r * math.sin(a), r * math.cos(a)))
    return pts

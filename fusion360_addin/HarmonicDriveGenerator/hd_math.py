"""
Harmonic Drive cycloid tooth profile - shared math core (rev 2, Python port).

Line-for-line port of the rewritten web/core-math.js, so the Fusion 360
add-in and the web preview always agree. See that file for the full
derivation notes and the paper reference:

  Yao, Y.; Lu, L.; Chen, X.; Xie, Y.; Yang, Y.; Xing, J.
  "A Novel Cycloid Tooth Profile for Harmonic Drive with Fully Conjugate
  Features." Actuators 2025, 14(4), 187. https://doi.org/10.3390/act14040187

Unlike the first revision of this file, the circular-spline tooth space is
computed as the actual numerical envelope (Eq. 14-15) of the flexspline
tooth swept through one wave-generator engagement, not a closed-form
approximation - see conjugate_slot(). Units: millimeters, radians.
"""
import math

DEFAULTS = {
    "module": 1.25,
    "zf": 100,
    "zc": 102,
    "w0Ratio": 1.0,
    "ha": 1.0,
    "hd": 1.0,
    "toothAngle": 9.17,
    "toothThickness": 0.5,
    "rootFillet": 0.15,
    "clearance": 0.05,
    "wallFlex": 0.75,
    "wallCirc": 3.0,
}


def _bisect(f, lo, hi, iters=60):
    flo = f(lo)
    for _ in range(iters):
        mid = 0.5 * (lo + hi)
        fm = f(mid)
        if (fm > 0) == (flo > 0):
            lo, flo = mid, fm
        else:
            hi = mid
    return 0.5 * (lo + hi)


def max_tooth_angle(s0, ha):
    return math.atan(s0 / (2 * ha))


def solve_joint_param(s0, ha, alpha0):
    if not (alpha0 > 0):
        return 0.0
    target = math.tan(alpha0)

    def f(t):
        return s0 * math.sin(t) / (ha * (math.pi - t + math.sin(t))) - target

    return _bisect(f, 0.0, math.pi)


def derive_geometry(module=None, zf=None, zc=None, w0_ratio=None, ha=None, hd=None,
                     tooth_angle=None, tooth_thickness=None, root_fillet=None,
                     clearance=None, wall_flex=None, wall_circ=None):
    m = DEFAULTS["module"] if module is None else module
    zf = int(round(DEFAULTS["zf"] if zf is None else zf))
    zc = int(round(DEFAULTS["zc"] if zc is None else zc))
    w0_ratio = DEFAULTS["w0Ratio"] if w0_ratio is None else w0_ratio
    ha_star = DEFAULTS["ha"] if ha is None else ha
    hd_star = DEFAULTS["hd"] if hd is None else hd
    root_fillet_star = DEFAULTS["rootFillet"] if root_fillet is None else root_fillet
    clearance_star = DEFAULTS["clearance"] if clearance is None else clearance
    thick = min(0.5, max(1e-3, DEFAULTS["toothThickness"] if tooth_thickness is None else tooth_thickness))
    wall_flex = DEFAULTS["wallFlex"] if wall_flex is None else wall_flex
    wall_circ = DEFAULTS["wallCirc"] if wall_circ is None else wall_circ

    rp = m * zf / 2.0
    w0 = w0_ratio * m

    a = rp + w0
    b = (1.0 / 9.0) * (12 * rp - 7 * a + 4 * math.sqrt(max(0.0, a * (3 * rp - 2 * a))))
    if not (b > 0):
        b = 1e-6

    s0 = thick * math.pi * m / 2.0
    ha_ = ha_star * m
    hd_ = hd_star * m
    root_fillet = root_fillet_star * m
    clearance = clearance_star * m

    alpha0 = (DEFAULTS["toothAngle"] if tooth_angle is None else tooth_angle) * math.pi / 180.0
    alpha0 = max(0.0, min(alpha0, 0.98 * max_tooth_angle(s0, ha_)))
    tE = solve_joint_param(s0, ha_, alpha0)

    warnings = []
    if zc <= zf:
        warnings.append("서큘러스플라인 잇수(zc)는 플렉스스플라인 잇수(zf)보다 많아야 합니다.")
    stroke = a - b
    stroke_margin = ha_ + hd_ + clearance - stroke
    if stroke_margin < 0:
        warnings.append(
            "이 높이(ha+hd)로는 파형발생기 반경 스트로크를 다 감당하지 못합니다 — ha*/hd*를 늘리거나 w0*를 줄이세요."
        )

    return dict(
        m=m, zf=zf, zc=zc, rp=rp, rm=rp, w0=w0, a=a, b=b, ha=ha_, hd=hd_,
        haStar=ha_star, hdStar=hd_star, s0=s0, toothThickness=thick,
        rootFillet=root_fillet, clearance=clearance, alpha0=alpha0, tE=tE,
        halfPitch=math.pi * m / 2.0, wallFlex=wall_flex, wallCirc=wall_circ,
        stroke=stroke, strokeMargin=stroke_margin, warnings=warnings,
        feasible=(zc > zf and stroke_margin >= 0 and wall_flex > 0),
    )


def wave_deform(d, psi):
    a, b = d["a"], d["b"]
    s, c = math.sin(psi), math.cos(psi)
    D = a * a * s * s + b * b * c * c
    rho = a * b / math.sqrt(D)
    rho_p = -a * b * (a * a - b * b) * math.sin(2 * psi) / (2 * D ** 1.5)
    mu = -math.atan2(rho_p, rho)
    v = -(d["w0"] / 2.0) * math.sin(2 * psi)
    return dict(rho=rho, w=rho - d["rm"], v=v, mu=mu)


def rotate_into_section(x, y, cos_mu, sin_mu):
    return (x * cos_mu + y * sin_mu, -x * sin_mu + y * cos_mu)


def polar_place(R, theta, t, r):
    rad = R + r
    ang = theta + t / (rad or 1.0)
    return (rad * math.cos(ang), rad * math.sin(ang), rad, ang)


def cycloid_unit(u, tE):
    t = tE + (math.pi - tE) * u
    XE = tE - math.sin(tE)
    cE = math.cos(tE)
    fx = (t - math.sin(t) - XE) / (math.pi - XE)
    fy = (cE - math.cos(t)) / (1 + cE)
    return fx, fy


def addendum_flank(d):
    def f(u):
        fx, fy = cycloid_unit(u, d["tE"])
        return (d["s0"] * (1 - fx), d["ha"] * fy)
    return f


def dedendum_flank(add_fn, s0):
    def f(u):
        qx, qy = add_fn(u)
        return (2 * s0 - qx, -qy)
    return f


def _resample_by_arc_length(fn, u_end, n):
    M = 300
    pts = [fn(u_end * i / M) for i in range(M + 1)]
    cum = [0.0]
    for i in range(1, M + 1):
        cum.append(cum[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    total = cum[M]
    out = []
    j = 0
    for i in range(n + 1):
        target = total * i / n
        while j < M - 1 and cum[j + 1] < target:
            j += 1
        seg = cum[j + 1] - cum[j]
        f = (target - cum[j]) / seg if seg > 1e-15 else 0.0
        f = min(f, 1.0)
        out.append((pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f,
                    pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f))
    out[n] = pts[M]
    return out


def _flank_arc_length(fn, u_end):
    M = 100
    L = 0.0
    prev = fn(0)
    for i in range(1, M + 1):
        q = fn(u_end * i / M)
        L += math.hypot(q[0] - prev[0], q[1] - prev[1])
        prev = q
    return L


def _fit_root_fillet(hd, flank_fn, rf):
    if not (rf > 0):
        return None
    target = -hd + rf
    h = 1e-5

    def centre_at(u):
        qx, qy = flank_fn(u)
        ax, ay = flank_fn(max(0.0, u - h))
        bx, by = flank_fn(min(1.0, u + h))
        tx, ty = bx - ax, by - ay
        L = math.hypot(tx, ty) or 1.0
        nx, ny = -ty / L, tx / L
        return (qx + rf * nx, qy + rf * ny, qx, qy)

    lo_c = centre_at(0.0)
    hi_c = centre_at(1.0)
    if lo_c[1] < target or hi_c[1] > target:
        return None
    lo, hi = 0.0, 1.0
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        if centre_at(mid)[1] > target:
            lo = mid
        else:
            hi = mid
    u = 0.5 * (lo + hi)
    cx, cy, px, py = centre_at(u)
    return dict(cx=cx, cy=target, r=rf, u=u, px=px, py=py)


_geom_cache = {}


def tooth_geometry(d):
    key = (d["m"], d["ha"], d["hd"], d["rootFillet"], d["tE"], d["s0"])
    if key in _geom_cache:
        return _geom_cache[key]

    add_fn = addendum_flank(d)
    ded_fn = dedendum_flank(add_fn, d["s0"])
    hd_eff = min(d["hd"], d["ha"])
    at_full_depth = hd_eff > d["ha"] - 1e-9
    rf = 0.0 if at_full_depth else min(d["rootFillet"], hd_eff * 0.45)
    fil = _fit_root_fillet(hd_eff, ded_fn, rf) if rf > 0 else None

    g = dict(addFn=add_fn, dedFn=ded_fn, hdEff=hd_eff, fil=fil)
    if len(_geom_cache) > 128:
        _geom_cache.clear()
    _geom_cache[key] = g
    return g


def crest_radius(add_fn):
    h = 1e-4
    p0 = add_fn(1 - 2 * h)
    p1 = add_fn(1 - h)
    p2 = add_fn(1)
    x1, y1 = (p2[0] - p0[0]) / (2 * h), (p2[1] - p0[1]) / (2 * h)
    x2 = (p2[0] - 2 * p1[0] + p0[0]) / (h * h)
    y2 = (p2[1] - 2 * p1[1] + p0[1]) / (h * h)
    k = abs(x1 * y2 - y1 * x2)
    return (x1 * x1 + y1 * y1) ** 1.5 / k if k > 1e-12 else float("inf")


def _offset_polyline(pts, dist):
    out = []
    n = len(pts)
    for i in range(n):
        ax, ay = pts[max(0, i - 1)]
        bx, by = pts[min(n - 1, i + 1)]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy) or 1.0
        px, py = pts[i]
        out.append((px - (dy / length) * dist, py + (dx / length) * dist))
    return out


def tooth_profile(d, inflate=0.0, samples_per_flank=24):
    n = max(6, samples_per_flank)
    g = tooth_geometry(d)
    add_fn, ded_fn, fil = g["addFn"], g["dedFn"], g["fil"]
    u_root = fil["u"] if fil else 1.0

    Ld = _flank_arc_length(ded_fn, u_root)
    La = _flank_arc_length(add_fn, 1.0)
    nd = max(3, round(n * Ld / (Ld + La)))
    na = max(3, n - nd)
    ded = _resample_by_arc_length(ded_fn, u_root, nd)
    arc_step = math.pi / max(8, n / 2)

    fil_arc = []
    if fil:
        a0 = math.atan2(fil["py"] - fil["cy"], fil["px"] - fil["cx"])
        a1 = -math.pi / 2
        da = a1 - a0
        while da > math.pi:
            da -= 2 * math.pi
        while da < -math.pi:
            da += 2 * math.pi
        nf = max(4, math.ceil(abs(da) / arc_step))
        for i in range(1, nf + 1):
            aa = a0 + da * i / nf
            fil_arc.append((fil["cx"] + fil["r"] * math.cos(aa), fil["cy"] + fil["r"] * math.sin(aa)))
    else:
        fil_arc.append(ded_fn(u_root))

    add = _resample_by_arc_length(add_fn, 1.0, na)[1:]

    right = []
    right.extend(reversed(fil_arc))
    right.extend(reversed(ded))
    right.extend(add)

    pts = []
    for i in range(len(right) - 1):
        pts.append((-right[i][0], right[i][1]))
    for i in range(len(right) - 1, -1, -1):
        pts.append(right[i])

    return _offset_polyline(pts, inflate) if inflate else pts


def tooth_with_root_land(d, inflate=0.0, samples_per_flank=28):
    tooth = tooth_profile(d, inflate, samples_per_flank)
    y_root = -tooth_geometry(d)["hdEff"] + (inflate or 0.0)
    x_end = d["halfPitch"]
    xL, xR = tooth[0][0], tooth[-1][0]
    n_land = 10
    pts = []
    if xL + x_end > 1e-9:
        for i in range(n_land):
            pts.append((-x_end + (xL + x_end) * (i / n_land), y_root))
    pts.extend(tooth)
    if x_end - xR > 1e-9:
        for i in range(1, n_land + 1):
            pts.append((xR + (x_end - xR) * (i / n_land), y_root))
    return pts


def flexspline_profile(d, zf, samples_per_flank=48):
    tooth = tooth_profile(d, 0.0, samples_per_flank)
    g = tooth_geometry(d)
    root_r = d["rp"] - g["hdEff"]
    pitch_angle = 2 * math.pi / zf
    outer = []
    for k in range(zf):
        theta0 = k * pitch_angle
        for x, y in tooth:
            ang = theta0 + x / d["rp"]
            r = d["rp"] + y
            outer.append((r * math.cos(ang), r * math.sin(ang)))
        a0 = theta0 + tooth[-1][0] / d["rp"]
        a1 = theta0 + pitch_angle + tooth[0][0] / d["rp"]
        arc_n = 10
        if (a1 - a0) * root_r > 1e-9:
            for i in range(1, arc_n):
                aa = a0 + (a1 - a0) * (i / arc_n)
                outer.append((root_r * math.cos(aa), root_r * math.sin(aa)))
    return dict(outer=outer, rootRadius=root_r, tipRadius=d["rp"] + d["ha"])


def _rasterize_core(env, n_bins, half_pitch, a0, r0, a1, r1):
    if a1 < -half_pitch or a0 > half_pitch:
        return
    bin_w = 2 * half_pitch / n_bins
    b0 = max(0, int(math.floor((a0 + half_pitch) / bin_w)))
    b1 = min(n_bins - 1, int(math.floor((a1 + half_pitch) / bin_w)))
    for b in range(b0, b1 + 1):
        ac = -half_pitch + (b + 0.5) * bin_w
        if a1 - a0 < 1e-12:
            r = max(r0, r1)
        else:
            f = max(0.0, min(1.0, (ac - a0) / (a1 - a0)))
            r = r0 + f * (r1 - r0)
        if r > env[b]:
            env[b] = r


def _rasterize_segment(env, n_bins, half_pitch, a0, r0, a1, r1):
    if a0 > a1:
        a0, a1 = a1, a0
        r0, r1 = r1, r0
    pitch = 2 * half_pitch
    k_lo = int(math.floor((-half_pitch - a1) / pitch))
    k_hi = int(math.ceil((half_pitch - a0) / pitch))
    for k in range(k_lo, k_hi + 1):
        _rasterize_core(env, n_bins, half_pitch, a0 + k * pitch, r0, a1 + k * pitch, r1)


def conjugate_slot(d, zs, zf, clearance, n_bins=256, steps=500):
    pitch = 2 * math.pi / zs
    half_pitch = pitch / 2.0
    dz = zs - zf
    tooth = tooth_with_root_land(d, clearance, 28)
    env = [0.0] * n_bins

    phi_max = math.pi / 2 / (1 + dz / zf)
    for s in range(steps + 1):
        phi = -phi_max + (2 * phi_max * s) / steps
        theta_body = -phi * dz / zf
        psi = theta_body - phi
        deform = wave_deform(d, psi)
        theta = theta_body + deform["v"] / d["rm"]
        R = deform["rho"]
        cos_m, sin_m = math.cos(deform["mu"]), math.sin(deform["mu"])

        prev_a, prev_r = None, None
        for x, y in tooth:
            t, r = rotate_into_section(x, y, cos_m, sin_m)
            px, py, rad, ang = polar_place(R, theta, t, r)
            if prev_a is not None:
                _rasterize_segment(env, n_bins, half_pitch, prev_a, prev_r, ang, rad)
            prev_a, prev_r = ang, rad

    for j in range(n_bins // 2):
        mj = n_bins - 1 - j
        mx = max(env[j], env[mj])
        env[j] = mx
        env[mj] = mx

    r_floor = wave_deform(d, math.pi / 2)["rho"] + d["ha"] + clearance
    blend = max(clearance, 0.02 * d["m"])
    for k in range(n_bins):
        e = env[k] - r_floor
        env[k] = r_floor + 0.5 * (e + math.sqrt(e * e + blend * blend))

    return dict(radii=env, halfPitch=half_pitch, nBins=n_bins)


def spline_profile(d, zs, zf, wall, clearance, n_bins=256, steps=500):
    slot = conjugate_slot(d, zs, zf, clearance, n_bins, steps)
    inner = []
    max_r = 0.0
    pitch = 2 * math.pi / zs
    for k in range(zs):
        base = k * pitch
        for b in range(slot["nBins"]):
            ang = base - slot["halfPitch"] + (b + 0.5) * (2 * slot["halfPitch"] / slot["nBins"])
            r = slot["radii"][b]
            if r > max_r:
                max_r = r
            inner.append((r * math.cos(ang), r * math.sin(ang)))
    return dict(inner=inner, outerRadius=max_r + wall, slotBottomRadius=max_r)


def wave_generator_cam(d, n_seg=240):
    """Physical cam profile: the deformed neutral line pulled in by half the
    flexspline wall. Angles measured from +X via (r*cos, r*sin), matching
    every other curve here, so the major axis (psi=0, where rho peaks) sits
    at angle 0 - see the note in core-math.js waveGeneratorCam()."""
    pts = []
    for i in range(n_seg + 1):
        phi = 2 * math.pi * i / n_seg
        deform = wave_deform(d, phi)
        r = deform["rho"] - d["wallFlex"] / 2.0
        pts.append((r * math.cos(phi), r * math.sin(phi)))
    return pts


def circle_points(r, cx=0.0, cy=0.0, n_seg=180):
    pts = []
    for i in range(n_seg + 1):
        a = 2 * math.pi * i / n_seg
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def generate(m, zf, zc, w0_ratio=None, ha=None, hd=None, tooth_angle=None,
             tooth_thickness=None, root_fillet=None, clearance=None,
             wall_flex=None, wall_circ=None, samples_per_flank=48, n_bins=256, steps=500):
    d = derive_geometry(m, zf, zc, w0_ratio, ha, hd, tooth_angle, tooth_thickness,
                         root_fillet, clearance, wall_flex, wall_circ)
    flex = flexspline_profile(d, d["zf"], samples_per_flank)
    circ = spline_profile(d, d["zc"], d["zf"], d["wallCirc"], d["clearance"], n_bins, steps)
    return d, flex, circ

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

S = lambda v: np.array(v, float)


# ----------------------------------------------------------------- materials
def lin(h):
    h = h.lstrip('#')
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return [float(x) for x in c] + [1.0]


_mats = {}


def mat(name, hexcol, rough=0.7, metal=0.0):
    if name not in _mats:
        _mats[name] = PBRMaterial(name=name, baseColorFactor=lin(hexcol),
                                  roughnessFactor=rough, metallicFactor=metal)
    return _mats[name]


# ----------------------------------------------------------------- geometry
def loft(rings, seg=20, cap=True):
    """rings ascending in y: (y, rx, rz, cx, cz). Tiny radius => pole."""
    ang = np.linspace(0, 2 * np.pi, seg, endpoint=False)
    V, R = [], []
    for (y, rx, rz, cx, cz) in rings:
        if rx < 1e-3 and rz < 1e-3:
            V.append([cx, y, cz])
            R.append(np.full(seg, len(V) - 1))
        else:
            b = len(V)
            for a in ang:
                V.append([cx + rx * np.cos(a), y, cz + rz * np.sin(a)])
            R.append(np.arange(b, b + seg))
    F = []
    for i in range(len(R) - 1):
        for j in range(seg):
            j2 = (j + 1) % seg
            a, b, c, d = R[i][j], R[i][j2], R[i + 1][j], R[i + 1][j2]
            F += [[a, c, b], [b, c, d]]
    if cap:
        for ri, top in ((0, False), (len(R) - 1, True)):
            r = rings[ri]
            if r[1] > 1e-3 or r[2] > 1e-3:
                V.append([r[3], r[0], r[4]])
                c = len(V) - 1
                for j in range(seg):
                    j2 = (j + 1) % seg
                    a, b = R[ri][j], R[ri][j2]
                    F.append([c, b, a] if top else [c, a, b])
    F = np.array(F)
    keep = (F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])
    return trimesh.Trimesh(np.array(V), F[keep], process=False)


def tube(p0, p1, rf, t0=0.0, t1=1.0, n=8, seg=18, rd0=False, rd1=False):
    """Tapered tube from p0->p1, radius function rf(t). Optional rounded ends."""
    p0, p1 = S(p0), S(p1)
    d = p1 - p0
    L = np.linalg.norm(d)
    ts = np.linspace(t0, t1, n)
    rings = [(t * L, rf(t), rf(t), 0, 0) for t in ts]
    if rd0:
        rr = rf(t0)
        pre = [(t0 * L - rr * np.sin(np.radians(a)), rr * np.cos(np.radians(a)),
                rr * np.cos(np.radians(a)), 0, 0) for a in (90, 72, 50, 25)]
        rings = pre + rings
    if rd1:
        rr = rf(t1)
        post = [(t1 * L + rr * np.sin(np.radians(a)), rr * np.cos(np.radians(a)),
                 rr * np.cos(np.radians(a)), 0, 0) for a in (25, 50, 72, 90)]
        rings = rings + post
    m = loft(rings, seg)
    T = trimesh.geometry.align_vectors([0, 1, 0], d / L)
    m.apply_transform(T)
    m.apply_translation(p0)
    return m


def ell(c, r, sub=2):
    m = trimesh.creation.icosphere(subdivisions=sub, radius=1.0)
    m.apply_scale(S(r))
    m.apply_translation(S(c))
    return m


def box(c, e, rot=None):
    m = trimesh.creation.box(extents=S(e))
    if rot is not None:
        m.apply_transform(rot)
    m.apply_translation(S(c))
    m.unmerge_vertices()  # flat shading on hard-surface parts
    return m


def torus(R, r, nu=20, nv=8):
    V, F = [], []
    for i in range(nu):
        u = 2 * np.pi * i / nu
        for j in range(nv):
            v = 2 * np.pi * j / nv
            V.append([(R + r * np.cos(v)) * np.cos(u), (R + r * np.cos(v)) * np.sin(u), r * np.sin(v)])
    for i in range(nu):
        for j in range(nv):
            a = i * nv + j
            b = ((i + 1) % nu) * nv + j
            c = ((i + 1) % nu) * nv + (j + 1) % nv
            d = i * nv + (j + 1) % nv
            F += [[a, b, c], [a, c, d]]
    m = trimesh.Trimesh(V, F, process=False)
    trimesh.repair.fix_inversion(m)
    return m


def rotx(deg):
    return trimesh.transformations.rotation_matrix(np.radians(deg), [1, 0, 0])


def roty(deg):
    return trimesh.transformations.rotation_matrix(np.radians(deg), [0, 1, 0])


def rotz(deg):
    return trimesh.transformations.rotation_matrix(np.radians(deg), [0, 0, 1])


# ----------------------------------------------------------------- rig
class Rig:
    def __init__(self):
        self.scene = trimesh.Scene()
        self.pos = {}
        self.count = 0

    def joint(self, name, parent, world):
        world = S(world)
        self.pos[name] = world
        rel = world - (self.pos[parent] if parent else 0)
        T = np.eye(4)
        T[:3, 3] = rel
        self.scene.graph.update(frame_to=name,
                                frame_from=parent if parent else self.scene.graph.base_frame,
                                matrix=T)

    def add(self, joint, name, mesh, material):
        m = mesh.copy()
        m.apply_translation(-self.pos[joint])
        trimesh.repair.fix_inversion(m)
        m.visual = trimesh.visual.TextureVisuals(material=material)
        _ = m.vertex_normals  # cache normals so they are exported
        self.scene.add_geometry(m, node_name=f'{name}', geom_name=f'{name}', parent_node_name=joint)
        self.count += len(m.faces)


# ----------------------------------------------------------------- character
def build(gender):
    M = gender == 'male'
    s = 1.0 if M else 0.93            # height scale (male ~1.86 m, female ~1.73 m)
    k = 1.0 if M else 0.84            # arm girth
    kl = 1.0 if M else 0.95           # leg girth
    wsh = 1.08 if M else 0.82         # shoulder width
    hs = 1.12 if M else 1.04          # head scale
    Y = lambda v: v * s

    # palette --------------------------------------------------------------
    skin = mat('skin', '#7B4B30' if M else '#4A2A1C', 0.55)
    skin_dark = mat('skin_shadow', '#5A3421' if M else '#33190F', 0.6)
    hair_m = mat('hair', '#0D0907', 0.8)
    eye_w = mat('eye_white', '#E9E4DA', 0.3)
    iris = mat('iris', '#1A0F0A', 0.2)
    lips = mat('lips', '#5B2E26' if M else '#4A1E1E', 0.4)
    shorts_m = mat('shorts_olive', '#5B5B3A', 0.9)
    shorts_d = mat('shorts_pocket', '#505034', 0.9)
    belt_m = mat('belt_leather', '#2A2019', 0.6)
    buckle = mat('buckle_metal', '#9A9A9A', 0.3, 0.9)
    boot_m = mat('boot_leather', '#6E5A3D', 0.75)
    sole_m = mat('boot_sole', '#25211D', 0.9)
    sock_m = mat('socks', '#2B2B2B', 0.9)
    pack_m = mat('backpack_olive', '#3E4230', 0.85)
    strap_m = mat('backpack_strap', '#1F2117', 0.85)
    metal_dark = mat('metal_dark', '#141414', 0.3, 0.8)

    rig = Rig()
    rig.joint('Root', None, (0, 0, 0))
    rig.joint('Hips', 'Root', (0, Y(0.93), 0))
    rig.joint('Spine', 'Hips', (0, Y(1.05), 0))
    rig.joint('Chest', 'Spine', (0, Y(1.22), 0))
    rig.joint('Neck', 'Chest', (0, Y(1.52), 0))
    rig.joint('Head', 'Neck', (0, Y(1.62), 0))

    hipx = 0.095 if M else 0.10
    arm = {}
    for sg, side in ((1, 'L'), (-1, 'R')):
        sh = (sg * 0.215 * wsh, Y(1.46), 0)
        el = (sg * 0.285 * wsh, Y(1.19), -0.012)
        wr = (sg * 0.315 * wsh, Y(0.93), 0.02)
        arm[side] = (S(sh), S(el), S(wr))
        rig.joint(f'UpperArm_{side}', 'Chest', sh)
        rig.joint(f'LowerArm_{side}', f'UpperArm_{side}', el)
        rig.joint(f'Hand_{side}', f'LowerArm_{side}', wr)
        rig.joint(f'UpperLeg_{side}', 'Hips', (sg * hipx, Y(0.90), 0))
        rig.joint(f'LowerLeg_{side}', f'UpperLeg_{side}', (sg * (hipx + 0.01), Y(0.50), 0.005))
        rig.joint(f'Foot_{side}', f'LowerLeg_{side}', (sg * (hipx + 0.015), Y(0.10), 0))

    # ------------------------------------------------------------- torso
    if M:
        prof = [(0.86, .160, .100), (.93, .165, .105), (1.02, .155, .100), (1.12, .170, .108),
                (1.24, .198, .118), (1.36, .215, .122), (1.44, .222, .115), (1.50, .155, .095),
                (1.56, .050, .050)]
    else:
        prof = [(0.86, .155, .100), (.93, .162, .102), (1.02, .124, .082), (1.12, .126, .086),
                (1.24, .142, .098), (1.36, .150, .096), (1.44, .158, .088), (1.50, .115, .075),
                (1.56, .045, .045)]
    py = np.array([p[0] for p in prof]) * s
    prx = np.array([p[1] for p in prof])
    prz = np.array([p[2] for p in prof])
    Tp = lambda y: (np.interp(y, py, prx), np.interp(y, py, prz))

    rig.add('Spine', 'torso_skin', loft([(py[i], prx[i], prz[i], 0, 0) for i in range(len(prof))], 24), skin)

    # top ---------------------------------------------------------------
    if M:
        tank = mat('tank_top', '#D8D5CB', 0.9)
        ys = np.linspace(Y(0.95), Y(1.47), 9)
        rings = [(y, Tp(y)[0] * 1.07 + 0.004, Tp(y)[1] * 1.08 + 0.004, 0, 0) for y in ys]
        rig.add('Spine', 'tank_top', loft(rings, 24), tank)
        # dirt/wear band at hem
        rig.add('Spine', 'tank_hem_wear', loft([(Y(0.95), Tp(Y(0.95))[0] * 1.075 + 0.005, Tp(Y(0.95))[1] * 1.085 + 0.005, 0, 0),
                                                (Y(0.99), Tp(Y(0.99))[0] * 1.075 + 0.005, Tp(Y(0.99))[1] * 1.085 + 0.005, 0, 0)], 24, cap=False),
                mat('tank_dirt', '#8C8676', 0.95))
    else:
        tank = mat('crop_top_red', '#B3241F', 0.85)
        ys = np.linspace(Y(1.15), Y(1.46), 8)
        rings = [(y, Tp(y)[0] * 1.05 + 0.004, Tp(y)[1] * 1.06 + 0.004, 0, 0) for y in ys]
        rig.add('Spine', 'crop_top', loft(rings, 24), tank)
        for sg in (1, -1):
            rig.add('Chest', f'bust_shell_{"L" if sg > 0 else "R"}', ell((sg * 0.058, Y(1.285), 0.074), (0.056, 0.050, 0.044), 2), tank)

    # neck / head ---------------------------------------------------------
    nk = 0.060 if M else 0.047
    rig.add('Neck', 'neck', tube((0, Y(1.50), 0), (0, Y(1.66), 0.012), lambda t: nk * (1 - 0.1 * t), n=4), skin)

    hc = S((0, Y(1.72), 0.012))
    Hp = lambda dx, dy, dz: hc + hs * S((dx, dy, dz))
    rig.add('Head', 'head', ell(hc, hs * S((0.087, 0.108, 0.100)), 3), skin)
    rig.add('Head', 'jaw', ell(Hp(0, -0.078, 0.052), hs * S((0.058 if M else 0.050, 0.046, 0.052)), 2), skin)
    rig.add('Head', 'nose', ell(Hp(0, -0.020, 0.098), hs * S((0.013, 0.022, 0.018)), 2), skin)
    for sg in (1, -1):
        sd = 'L' if sg > 0 else 'R'
        rig.add('Head', f'nostril_wing_{sd}', ell(Hp(sg * 0.012, -0.036, 0.097), hs * S((0.009, 0.008, 0.009)), 2), skin)
        rig.add('Head', f'ear_{sd}', ell(Hp(sg * 0.087, -0.002, -0.005), hs * S((0.010, 0.028, 0.020)), 2), skin_dark)
        rig.add('Head', f'ear_inner_{sd}', ell(Hp(sg * 0.088, -0.002, -0.001), hs * S((0.005, 0.017, 0.012)), 1), skin)
        rig.add('Head', f'eye_white_{sd}', ell(Hp(sg * 0.036, 0.012, 0.088), hs * S((0.014, 0.010, 0.008)), 2), eye_w)
        rig.add('Head', f'iris_{sd}', ell(Hp(sg * 0.036, 0.012, 0.094), hs * S((0.0065, 0.0065, 0.004)), 2), iris)
        rig.add('Head', f'eyelid_{sd}', box(Hp(sg * 0.036, 0.021, 0.089), hs * S((0.018, 0.005, 0.010)),
                                             rotz(-sg * 4)), skin)
        rig.add('Head', f'brow_{sd}', box(Hp(sg * 0.037, 0.040, 0.086), hs * S((0.034, 0.007, 0.010)),
                                            rotz(-sg * (8 if M else 14))), hair_m)
        rig.add('Head', f'cheekbone_{sd}', ell(Hp(sg * 0.058, -0.018, 0.066), hs * S((0.024, 0.020, 0.026)), 2), skin)
        rig.add('Neck', f'collarbone_{sd}', ell((sg * 0.062 * wsh, Y(1.475), 0.044), (0.045, 0.014, 0.020), 2), skin)
    rig.add('Head', 'upper_lip', ell(Hp(0, -0.058, 0.088), hs * S((0.024, 0.008, 0.010)), 2), lips)
    rig.add('Head', 'lower_lip', ell(Hp(0, -0.069, 0.086), hs * S((0.020, 0.007, 0.009)), 2), lips)
    rig.add('Head', 'chin', ell(Hp(0, -0.096, 0.058), hs * S((0.030, 0.020, 0.028)), 2), skin)

    if M:
        # short crop + full beard + moustache
        rig.add('Head', 'hair_crop', ell(hc + S((0, 0.038, -0.022)), S((0.093, 0.086, 0.106)), 3), hair_m)
        rig.add('Head', 'beard', ell(Hp(0, -0.090, 0.055), S((0.068, 0.046, 0.062)), 2), hair_m)
        rig.add('Head', 'beard_sides', ell(Hp(0, -0.045, 0.02), S((0.090, 0.055, 0.075)), 2), hair_m)
        rig.add('Head', 'moustache', box(Hp(0, -0.046, 0.094), S((0.048, 0.008, 0.012)), None), hair_m)
    else:
        # afro puff + twisted locs + headwrap
        rig.add('Head', 'hair_puff', ell(hc + S((0, 0.068, -0.040)), S((0.118, 0.095, 0.110)), 3), hair_m)
        rng = np.random.default_rng(7)
        pc = hc + S((0, 0.068, -0.040))
        for i in range(46):
            a = rng.uniform(0, 2 * np.pi)
            e = rng.uniform(0.05, 1.35)
            d = S((np.cos(a) * np.cos(e), np.sin(e), np.sin(a) * np.cos(e) * 0.95 - 0.10))
            d /= np.linalg.norm(d)
            c = pc + d * S((0.115, 0.095, 0.108))
            rig.add('Head', f'curl_{i:02d}', ell(c, S((0.030, 0.030, 0.030)) * rng.uniform(0.8, 1.2), 1), hair_m)
        # a few twisted locs falling down the back
        for i in range(7):
            x = (i - 3) * 0.028
            base = hc + S((x, 0.005, -0.098))
            tip = base + S((x * 0.5, -0.115 - 0.02 * (i % 3), -0.030))
            rig.add('Head', f'back_loc_{i}', tube(base, tip, lambda t: 0.014 * (1 - 0.3 * t), n=3, seg=8, rd1=True), hair_m)
        wrap_r = mat('headwrap_red', '#BE2A20', 0.85)
        wrap_g = mat('headwrap_gold', '#E2B231', 0.8)
        wrap_gr = mat('headwrap_green', '#2E7D3A', 0.8)
        wy = hc[1]
        rig.add('Head', 'headwrap', loft([(wy + 0.028, 0.089, 0.098, 0, hc[2]), (wy + 0.048, 0.093, 0.100, 0, hc[2]),
                                          (wy + 0.078, 0.090, 0.098, 0, hc[2] - 0.004)], 28), wrap_r)
        rig.add('Head', 'headwrap_stripe_gold', loft([(wy + 0.040, 0.0945, 0.1012, 0, hc[2]), (wy + 0.046, 0.0948, 0.1014, 0, hc[2])], 28, cap=False), wrap_g)
        rig.add('Head', 'headwrap_stripe_green', loft([(wy + 0.056, 0.0945, 0.1012, 0, hc[2]), (wy + 0.061, 0.0948, 0.1014, 0, hc[2])], 28, cap=False), wrap_gr)
        rig.add('Head', 'headwrap_knot', ell(hc + S((0.0, 0.070, 0.090)), S((0.040, 0.026, 0.024)), 2), wrap_r)
        rig.add('Head', 'headwrap_knot_tail_L', ell(hc + S((0.034, 0.078, 0.095)), S((0.020, 0.030, 0.014)), 1), wrap_r)
        rig.add('Head', 'headwrap_knot_tail_R', ell(hc + S((-0.034, 0.078, 0.095)), S((0.020, 0.030, 0.014)), 1), wrap_r)
        # hoop earrings
        for sg in (1, -1):
            sd = 'L' if sg > 0 else 'R'
            h = torus(0.022, 0.0035)
            h.apply_transform(roty(90))
            h.apply_translation(Hp(sg * 0.093, -0.040, 0.0) + S((0, -0.010, 0)))
            rig.add('Head', f'hoop_earring_{sd}', h, buckle)

    # ------------------------------------------------------------- necklace
    if M:
        chain = mat('chain_steel', '#B0B0B0', 0.3, 0.9)
        for sg in (1, -1):
            sd = 'L' if sg > 0 else 'R'
            rig.add('Chest', f'chain_{sd}', tube((sg * 0.050, Y(1.535), 0.045), (0, Y(1.375), 0.128), lambda t: 0.0028, n=3, seg=6), chain)
        tooth = mat('shark_tooth', '#EDE7D9', 0.35)
        rig.add('Chest', 'pendant_tooth', ell((0, Y(1.355), 0.128), (0.014, 0.026, 0.006), 2), tooth)
        rig.add('Chest', 'pendant_tooth_cap', box((0, Y(1.378), 0.128), (0.020, 0.008, 0.008), None), metal_dark)
    else:
        gold = mat('jewel_gold', '#D4A72C', 0.3, 0.9)
        for sg in (1, -1):
            sd = 'L' if sg > 0 else 'R'
            rig.add('Chest', f'necklace_{sd}', tube((sg * 0.040, Y(1.535), 0.040), (0, Y(1.40), 0.108), lambda t: 0.0025, n=3, seg=6), gold)
        pr = torus(0.013, 0.0028)
        pr.apply_translation((0, Y(1.392), 0.112))
        rig.add('Chest', 'pendant_ring', pr, gold)
        rig.add('Chest', 'pendant', ell((0, Y(1.372), 0.113), (0.010, 0.014, 0.005), 2), mat('pendant_green', '#3E9A6B', 0.3, 0.2))

    # ------------------------------------------------------------- backpack
    rig.add('Chest', 'backpack_body', box((0, Y(1.29), -0.190), (0.29 * (1 if M else 0.85), 0.40 * s, 0.12), None), pack_m)
    rig.add('Chest', 'backpack_flap', box((0, Y(1.485), -0.190), (0.28 * (1 if M else 0.85), 0.07 * s, 0.14), None), strap_m)
    for sg in (1, -1):
        sd = 'L' if sg > 0 else 'R'
        rig.add('Chest', f'backpack_pocket_{sd}', box((sg * 0.140 * (1 if M else 0.85), Y(1.18), -0.200), (0.05, 0.18 * s, 0.09), None), pack_m)
        sx = sg * 0.125 * (1 if M else 0.82)
        rig.add('Chest', f'strap_top_{sd}', box((sx, Y(1.505), -0.02), (0.045, 0.02, 0.26), rotx(0)), strap_m)
        rig.add('Chest', f'strap_front_{sd}', box((sx, Y(1.34), 0.124 if M else 0.114), (0.045, 0.30 * s, 0.018), rotx(-3)), strap_m)
        rig.add('Chest', f'strap_back_{sd}', box((sx, Y(1.34), -0.125), (0.045, 0.30 * s, 0.018), None), strap_m)
    rig.add('Chest', 'chest_strap', box((0, Y(1.36), 0.122 if M else 0.112), (0.20 * wsh, 0.014, 0.014), None), strap_m)
    rig.add('Chest', 'chest_strap_buckle', box((0, Y(1.36), 0.126 if M else 0.116), (0.028, 0.020, 0.008), None), buckle)
    rig.add('Chest', 'pack_zipper_pull', box((0, Y(1.10), -0.256), (0.010, 0.024, 0.006), None), metal_dark)
    rig.add('Chest', 'pack_zipper_line', box((0, Y(1.30), -0.253), (0.004, 0.42 * s, 0.004), None), metal_dark)
    for sg in (1, -1):
        sd = 'L' if sg > 0 else 'R'
        sx = sg * 0.125 * (1 if M else 0.82)
        rig.add('Chest', f'strap_buckle_top_{sd}', box((sx, Y(1.42), 0.02), (0.040, 0.018, 0.020), None), buckle)
        rig.add('Chest', f'compression_strap_{sd}', box((sg * 0.150 * (1 if M else 0.85), Y(1.16), -0.24), (0.018, 0.22 * s, 0.014), None), strap_m)

    # ------------------------------------------------------------- shorts / belt
    y_hem = Y(0.55) if M else Y(0.72)
    ys = np.linspace(Y(0.86), Y(1.03), 6)
    rings = [(y, Tp(y)[0] * 1.10 + 0.008, Tp(y)[1] * 1.12 + 0.008, 0, 0) for y in ys]
    rig.add('Hips', 'shorts_waist', loft(rings, 24), shorts_m)
    rig.add('Spine', 'belt', loft([(Y(0.995), Tp(Y(0.995))[0] * 1.10 + 0.014, Tp(Y(0.995))[1] * 1.12 + 0.014, 0, 0),
                                   (Y(1.035), Tp(Y(1.035))[0] * 1.10 + 0.014, Tp(Y(1.035))[1] * 1.12 + 0.014, 0, 0)], 24, cap=False), belt_m)
    rig.add('Spine', 'belt_buckle', box((0, Y(1.015), Tp(Y(1.015))[1] * 1.12 + 0.02), (0.045, 0.034, 0.010), None), buckle)
    for i, ang in enumerate(np.linspace(20, 340, 7)):
        a = np.radians(ang)
        bx, bz = Tp(Y(1.015))[0] * 1.12 * np.sin(a), Tp(Y(1.015))[1] * 1.14 * np.cos(a)
        if bz > -0.02:
            rig.add('Spine', f'belt_loop_{i}', box((bx, Y(1.015), bz), (0.018, 0.044, 0.012), None), belt_m)

    for sg, side in ((1, 'L'), (-1, 'R')):
        hip = (sg * hipx, Y(0.90), 0.0)
        kn = (sg * (hipx + 0.01), Y(0.50), 0.005)
        an = (sg * (hipx + 0.015), Y(0.10), 0.0)
        # skin: thigh, knee, shin
        rig.add(f'UpperLeg_{side}', f'thigh_{side}', tube(hip, kn, lambda t: kl * (0.092 - 0.036 * t), n=6, rd0=True), skin)
        rig.add(f'LowerLeg_{side}', f'knee_{side}', ell(kn, (0.058 * kl, 0.055 * kl, 0.056 * kl), 2), skin)
        shin_end = (an[0], 0.27, 0.0)
        rig.add(f'LowerLeg_{side}', f'shin_{side}', tube(kn, shin_end, lambda t: kl * (0.056 - 0.018 * t + 0.016 * np.sin(np.pi * min(1, t * 1.25))), n=7), skin)
        # shorts leg
        top = S(hip) + S((0, 0.02, 0))
        bot_y = y_hem
        bot = S((sg * (hipx + 0.008), bot_y, 0.004))
        rf = (lambda t: (0.106 - 0.006 * t)) if M else (lambda t: (0.094 - 0.006 * t))
        rig.add(f'UpperLeg_{side}', f'shorts_leg_{side}', tube(top, bot, rf, n=5, rd0=True), shorts_m)
        rig.add(f'UpperLeg_{side}', f'shorts_hem_{side}', tube(bot + S((0, 0.03, 0)), bot, lambda t: rf(1) + 0.003, n=2, seg=14), shorts_d)
        rig.add(f'UpperLeg_{side}', f'shorts_side_seam_{side}', box(((top[0] + bot[0]) / 2, (top[1] + bot[1]) / 2, rf(0.5) + 0.003), (0.006, abs(top[1] - bot[1]) * 0.95, 0.006), None), shorts_d)
        if M:
            # cargo pocket + flap on outer thigh, with rivets and a stitched flap edge
            px = sg * (hipx + 0.008 + 0.104)
            rig.add(f'UpperLeg_{side}', f'cargo_pocket_{side}', box((px, Y(0.71), 0.01), (0.040, 0.15, 0.10), None), shorts_d)
            rig.add(f'UpperLeg_{side}', f'cargo_flap_{side}', box((px + sg * 0.003, Y(0.775), 0.01), (0.044, 0.045, 0.106), None), shorts_m)
            for cy in (Y(0.785), Y(0.640)):
                for cz in (-0.03, 0.045):
                    rig.add(f'UpperLeg_{side}', f'rivet_{side}_{int(cy*1000)}_{int(cz*1000)}', ell((px + sg * 0.024, cy, cz), (0.005, 0.005, 0.003), 1), buckle)
        else:
            px = sg * (hipx + 0.008 + 0.092)
            rig.add(f'UpperLeg_{side}', f'shorts_pocket_{side}', box((px, Y(0.80), 0.012), (0.030, 0.10, 0.08), None), shorts_d)

        # boots
        x = an[0]
        bh = 1.0 if M else 0.92
        rig.add(f'Foot_{side}', f'sock_{side}', tube((x, 0.24 * bh, 0), (x, 0.32 * bh, 0.0), lambda t: 0.050 * (1.0 if M else 0.9), n=2), sock_m)
        rig.add(f'Foot_{side}', f'boot_shaft_{side}', tube((x, 0.035, 0.0), (x, 0.28 * bh, -0.004), lambda t: (0.066 - 0.008 * t) * (1.0 if M else 0.92), n=5), boot_m)
        bw = 1.0 if M else 0.92
        rig.add(f'Foot_{side}', f'boot_foot_{side}', ell((x, 0.072, 0.092), (0.056 * bw, 0.072, 0.150), 2), boot_m)
        rig.add(f'Foot_{side}', f'boot_instep_{side}', ell((x, 0.130, 0.040), (0.054 * bw, 0.055, 0.075), 2), boot_m)
        rig.add(f'Foot_{side}', f'boot_toe_{side}', ell((x, 0.052, 0.188), (0.052 * bw, 0.048, 0.064), 2), boot_m)
        rig.add(f'Foot_{side}', f'boot_sole_{side}', box((x, 0.014, 0.065), (0.112 * (1 if M else .92), 0.030, 0.315), None), sole_m)
        rig.add(f'Foot_{side}', f'boot_heel_{side}', box((x, 0.012, -0.070), (0.108 * (1 if M else .92), 0.032, 0.070), None), sole_m)
        rig.add(f'Foot_{side}', f'boot_collar_{side}', tube((x, 0.245 * bh, 0), (x, 0.285 * bh, -0.004), lambda t: 0.066 * (1.0 if M else 0.92), n=2), strap_m)
        if not M:
            ab = torus(0.062, 0.0032, nu=24, nv=6)
            ab.apply_transform(rotx(90))
            ab.apply_translation((x, 0.300 * bh, -0.004))
            rig.add(f'Foot_{side}', f'anklet_{side}', ab, mat('jewel_gold', '#D4A72C', 0.3, 0.9))
        # tongue + eyelets + laces across the front of the boot
        lace_m = mat('laces', '#1D1A17', 0.9)
        eyelet_m = mat('eyelet_metal', '#8A8A8A', 0.35, 0.85)
        rig.add(f'Foot_{side}', f'boot_tongue_{side}', box((x, 0.175 * bh, 0.052 * bw), (0.034 * bw, 0.110 * bh, 0.014), None), boot_m)
        for i in range(5):
            yy = (0.155 + i * 0.024) * bh
            rig.add(f'Foot_{side}', f'lace_{side}_{i}', box((x, yy, 0.062 * bw + 0.004 - i * 0.002), (0.046 * bw, 0.006, 0.008), None), lace_m)
            for sgn in (1, -1):
                ee = torus(0.0065, 0.0022, nu=10, nv=6)
                ee.apply_translation((x + sgn * 0.030 * bw, yy, 0.058 * bw - i * 0.002))
                rig.add(f'Foot_{side}', f'eyelet_{side}_{i}_{sgn}', ee, eyelet_m)


    # ------------------------------------------------------------- arms
    for side, sg in (('L', 1), ('R', -1)):
        sh, el, wr = arm[side]
        rig.add(f'UpperArm_{side}', f'shoulder_{side}', ell(sh + S((0, 0, 0)), (0.074 * k if M else 0.066 * k,) + (0.070 * k if M else 0.062 * k,) * 2, 2), skin)
        rf_u = lambda t: k * (0.060 + 0.012 * np.sin(np.pi * min(1, t * 1.4)) - 0.012 * t) + (0.012 if M else 0)
        rig.add(f'UpperArm_{side}', f'upper_arm_{side}', tube(sh, el, rf_u, n=7), skin)
        rig.add(f'LowerArm_{side}', f'elbow_{side}', ell(el, (0.045 * k,) * 3, 2), skin)
        rf_f = lambda t: k * (0.047 - 0.012 * t + 0.005 * np.sin(np.pi * t)) + (0.005 if M else 0)
        rig.add(f'LowerArm_{side}', f'forearm_{side}', tube(el, wr, rf_f, n=6), skin)
        # hand: palm + four separate fingers + thumb
        d = (wr - el) / np.linalg.norm(wr - el)
        fk = 1.0 if M else 0.92
        palm_len = 0.050 * fk * k
        palm_top = wr + d * palm_len
        rig.add(f'Hand_{side}', f'palm_{side}', tube(wr, palm_top, lambda t: k * (0.037 - 0.007 * t), n=4, seg=14), skin)
        rig.add(f'Hand_{side}', f'palm_back_{side}', ell(wr + d * palm_len * 0.55, (k * 0.033, k * 0.020, k * 0.030), 2), skin)
        fnames = ('pinky', 'ring', 'middle', 'index')
        flens = (0.044 * fk, 0.057 * fk, 0.062 * fk, 0.055 * fk)
        foffs = (-0.0265, -0.0095, 0.0075, 0.0235)
        for name, ln, ox in zip(fnames, flens, foffs):
            fb = palm_top + S((sg * ox * k, 0, 0.014))
            fe = fb + d * ln + S((0, 0, 0.007 + 0.10 * ln))
            rig.add(f'Hand_{side}', f'finger_{name}_{side}', tube(fb, fe, lambda t: k * (0.0083 - 0.0033 * t), n=3, seg=8, rd1=True), skin)
            rig.add(f'Hand_{side}', f'knuckle_{name}_{side}', ell(fb, (k * 0.0078,) * 3, 2), skin)
        thumb0 = wr + d * palm_len * 0.28 + S((sg * 0.032 * k, 0, 0.020))
        thumb1 = thumb0 + d * 0.030 * fk + S((sg * 0.026 * k, 0, 0.032 * fk))
        rig.add(f'Hand_{side}', f'thumb_{side}', tube(thumb0, thumb1, lambda t: k * (0.0098 - 0.0033 * t), n=3, seg=8, rd1=True), skin)
        rig.add(f'Hand_{side}', f'thumb_base_{side}', ell(thumb0, (k * 0.0105,) * 3, 2), skin)

        if M and side == 'L':
            # tattoo sleeve (banded pattern) + watch
            tat = mat('tattoo_ink', '#2A1912', 0.6)
            for i, (ta, tb) in enumerate([(0.06, 0.13), (0.18, 0.26), (0.31, 0.42), (0.47, 0.55), (0.60, 0.72), (0.78, 0.9)]):
                rig.add(f'UpperArm_{side}', f'tattoo_upper_{i}', tube(sh, el, lambda t: rf_u(t) + 0.0035, t0=ta, t1=tb, n=3), tat)
            for i, (ta, tb) in enumerate([(0.08, 0.20), (0.26, 0.40), (0.46, 0.60)]):
                rig.add(f'LowerArm_{side}', f'tattoo_fore_{i}', tube(el, wr, lambda t: rf_f(t) + 0.0035, t0=ta, t1=tb, n=3), tat)
            rig.add(f'Hand_{side}', 'watch_band', tube(wr - d * 0.04, wr + d * 0.005, lambda t: rf_f(1) + 0.004, n=2), metal_dark)
            rig.add(f'Hand_{side}', 'watch_face', box(wr - d * 0.018 + S((0.0, 0, 0.0)) + S((sg * 0.043, 0, 0.0)), (0.008, 0.032, 0.030), None), mat('watch_face', '#3A3F44', 0.2, 0.7))
        if M and side == 'R':
            for i, col in enumerate(['#8B4A2B', '#1F1F1F', '#B9903A']):
                rig.add(f'Hand_{side}', f'bracelet_{i}', tube(wr - d * (0.045 - i * 0.014), wr - d * (0.035 - i * 0.014), lambda t: rf_f(1) + 0.004, n=2, seg=12), mat(f'bracelet{i}', col, 0.7))
        if not M:
            cols = ['#D6A12A', '#2E7D3A', '#B3241F', '#111111'] if side == 'R' else ['#B3241F', '#D6A12A', '#2E7D3A']
            for i, col in enumerate(cols):
                rig.add(f'Hand_{side}', f'bracelet_{i}', tube(wr - d * (0.055 - i * 0.012), wr - d * (0.047 - i * 0.012), lambda t: rf_f(1) + 0.004, n=2, seg=12), mat(f'fbracelet{i}', col, 0.6))
            if side == 'L':
                rig.add(f'UpperArm_{side}', 'armband', tube(sh, el, lambda t: rf_u(t) + 0.004, t0=0.50, t1=0.56, n=2), mat('armband', '#C7A24A', 0.4, 0.8))

    # ------------------------------------------------------------- hip pouches
    pouch = mat('pouch', '#4A4C33', 0.9)
    if M:
        rig.add('Hips', 'holster_pouch_R', box((-0.205, Y(0.93), 0.02), (0.045, 0.12, 0.08), None), pouch)
        rig.add('Hips', 'utility_pouch_L', box((0.195, Y(0.94), 0.045), (0.05, 0.09, 0.075), None), pouch)
    else:
        rig.add('Hips', 'pouch_L', box((0.185, Y(0.91), 0.03), (0.06, 0.09, 0.08), None), pouch)
        rig.add('Hips', 'pouch_L_flap', box((0.186, Y(0.955), 0.03), (0.064, 0.03, 0.084), None), shorts_m)
    return rig


def _merge_scene_by_material(scene):
    """Few meshes per material — for app14 web preview (desktop browser)."""
    from collections import defaultdict
    buckets = defaultdict(list)
    for geom in scene.geometry.values():
        mat = getattr(geom.visual, 'material', None)
        key = getattr(mat, 'name', None) or 'default'
        buckets[key].append(geom)
    merged = trimesh.Scene()
    for key, geoms in buckets.items():
        combined = trimesh.util.concatenate(geoms)
        combined.visual = geoms[0].visual
        merged.add_geometry(combined, node_name=f'merged_{key}')
    return merged


def export_engine(gender, path):
    """Full named-part kit for Unreal / Unity / download (many meshes)."""
    rig = build(gender)
    rig.scene.export(path, file_type='glb', include_normals=True)
    return rig


def export_web(gender, path):
    """Merged-by-material GLB for OPNassetBUILDER Design / World preview only."""
    rig = build(gender)
    web_scene = _merge_scene_by_material(rig.scene)
    web_scene.export(path, file_type='glb', include_normals=True)
    return rig, web_scene


def export(gender, path):
    """Alias: engine export (backward compatible)."""
    return export_engine(gender, path)


if __name__ == '__main__':
    import argparse
    import os

    parser = argparse.ArgumentParser(description='Belize / Trinidad parametric kits — web + engine GLB exports')
    parser.add_argument('--out', default='assets', help='Output directory (default: assets/)')
    parser.add_argument('--gender', choices=('male', 'female', 'both'), default='both')
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)

    jobs = []
    if args.gender in ('male', 'both'):
        jobs.append(('male', 'male_belizean'))
    if args.gender in ('female', 'both'):
        jobs.append(('female', 'female_trinidadian'))

    for gender, base in jobs:
        web_path = os.path.join(args.out, f'{base}_web.glb')
        engine_path = os.path.join(args.out, f'{base}_engine.glb')
        rig, web_scene = export_web(gender, web_path)
        export_engine(gender, engine_path)
        print(
            gender,
            '| web (preview):', web_path,
            'meshes:', len(web_scene.geometry),
            '| engine (parts):', engine_path,
            'meshes:', len(rig.scene.geometry),
            'tris:', rig.count,
        )
    print('Register in app14: kit.derivatives.web -> *_web.glb ; kit.derivatives.engine -> *_engine.glb')

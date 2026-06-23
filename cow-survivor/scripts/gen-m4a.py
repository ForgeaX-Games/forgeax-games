#!/usr/bin/env python3
# One-off M4a generator:
#   1. extract the Player's lowpoly parts out of scenes/level1.pack.json into
#      assets/characters/player.pack.json (root-relative, slot-named — the same
#      editable asset format as assets/monsters/*)
#   2. strip PlayerTorso/Head/Arm/Leg from BOTH level packs (the Player entity
#      stays as a Transform-only spawn marker)
#   3. regenerate scenes/level2.pack.json as a REAL graveyard scene tree —
#      different entity set from level1 (gravestones / dead trees / fences /
#      glowing lanterns / crypts), not just a recolor.
import json, math, random, uuid

NS = uuid.UUID('7b4d43d4-5b19-5903-8966-f89671d21565')
def guid(key): return str(uuid.uuid5(NS, key))

CUBE = 'cbe42beb-8975-5096-b3a1-3dda4cb4c077'
SPHERE = '95730fd2-9846-5f84-8658-0b3c971eb263'

def mat(key, color, metallic=0.0, roughness=0.9, emissive=None, ei=0):
    pv = {'baseColor': [color[0], color[1], color[2], 1], 'metallic': metallic, 'roughness': roughness}
    if emissive: pv['emissive'] = list(emissive); pv['emissiveIntensity'] = ei
    return {'guid': guid('mat:' + key), 'kind': 'material',
            'payload': {'kind': 'material',
                        'passes': [{'name': 'Forward', 'shader': 'forgeax::default-standard-pbr', 'tags': {'LightMode': 'Forward'}, 'queue': 2000}],
                        'paramValues': pv},
            'refs': []}

def quat_y(rot):
    return {'quatX': 0.0, 'quatY': math.sin(rot / 2), 'quatZ': 0.0, 'quatW': math.cos(rot / 2)}

# ── 1+2: player character asset + strip parts from level packs ──────────────
lv1 = json.load(open('scenes/level1.pack.json'))
sc1 = next(a for a in lv1['assets'] if a['kind'] == 'scene')
ents1 = sc1['payload']['entities']
refs1 = sc1['refs']

player_root = next(e for e in ents1 if (e['components'].get('Name') or {}).get('value') == 'Player')
rt = player_root['components']['Transform']
rx, ry, rz = rt.get('posX', 0), rt.get('posY', 0), rt.get('posZ', 0)

# material refIdx → slot key (3 distinct mats: torso / skin / legs)
SLOT_BY_MAT = {4: 'body', 5: 'horn', 6: 'spot'}
char_parts, char_mats, seen_mats = [], [], {}
slot_counts = {}
for e in ents1:
    nm = (e['components'].get('Name') or {}).get('value', '')
    if not nm.startswith('Player') or nm == 'Player':
        continue
    t = e['components']['Transform']
    mr = e['components']['MeshRenderer']
    mf = e['components']['MeshFilter']
    slot = SLOT_BY_MAT.get(mr['material'], 'body')
    if slot not in seen_mats:
        src_guid = refs1[mr['material']]
        src = next(a for a in lv1['assets'] if a['guid'] == src_guid)
        m = {'guid': guid('char:player:mat:' + slot), 'kind': 'material', 'payload': src['payload'], 'refs': []}
        seen_mats[slot] = m
        char_mats.append(m)
    slot_counts[slot] = slot_counts.get(slot, 0) + 1
    char_parts.append({
        'slot': slot, 'n': slot_counts[slot],
        'pos': [t.get('posX', 0) - rx, t.get('posY', 0) - ry, t.get('posZ', 0) - rz],
        'scale': [t.get('scaleX', 1), t.get('scaleY', 1), t.get('scaleZ', 1)],
        'mesh': mf['assetHandle'],
    })

char_refs = [CUBE, SPHERE] + [m['guid'] for m in char_mats]
mat_idx = {m['guid']: i + 2 for i, m in enumerate(char_mats)}
slot_total = {}
for p in char_parts: slot_total[p['slot']] = slot_total.get(p['slot'], 0) + 1
char_entities = []
for i, p in enumerate(char_parts):
    name = p['slot'] if slot_total[p['slot']] == 1 else f"{p['slot']}_{p['n']}"
    char_entities.append({'localId': i, 'components': {
        'Name': {'value': name},
        'Transform': {'posX': p['pos'][0], 'posY': p['pos'][1], 'posZ': p['pos'][2],
                      'scaleX': p['scale'][0], 'scaleY': p['scale'][1], 'scaleZ': p['scale'][2]},
        'MeshFilter': {'assetHandle': p['mesh']},
        'MeshRenderer': {'material': mat_idx[seen_mats[p['slot']]['guid']]},
    }})
char_pack = {'schemaVersion': '1.0.0', 'kind': 'internal-text-package', 'assets': [
    {'guid': guid('char:player:scene'), 'kind': 'scene', 'payload': {'kind': 'scene', 'entities': char_entities}, 'refs': char_refs},
    *char_mats,
]}
import os
os.makedirs('assets/characters', exist_ok=True)
json.dump(char_pack, open('assets/characters/player.pack.json', 'w'), indent=1)
print(f'player.pack.json: {len(char_entities)} parts, {len(char_mats)} materials')

# strip parts from level1 (keep the Player marker)
keep = [e for e in ents1 if not ((e['components'].get('Name') or {}).get('value', '').startswith('Player')
                                 and (e['components'].get('Name') or {}).get('value') != 'Player')]
removed = len(ents1) - len(keep)
sc1['payload']['entities'] = keep
json.dump(lv1, open('scenes/level1.pack.json', 'w'), indent=1)
print(f'level1: stripped {removed} player part entities, {len(keep)} remain')

# ── 3: graveyard level2 — a genuinely different scene tree ──────────────────
rng = random.Random(20260612)
mats = {
    'ground':   mat('gy:ground',   (0.10, 0.13, 0.16), roughness=0.95),
    'obelisk':  mat('gy:obelisk',  (0.12, 0.11, 0.18), roughness=0.6, metallic=0.15),
    'grave':    mat('gy:grave',    (0.34, 0.37, 0.44), roughness=0.85),
    'graveold': mat('gy:graveold', (0.24, 0.27, 0.30), roughness=0.95),
    'wood':     mat('gy:wood',     (0.16, 0.11, 0.08), roughness=0.9),
    'bone':     mat('gy:bone',     (0.72, 0.70, 0.60), roughness=0.7),
    'crypt':    mat('gy:crypt',    (0.20, 0.21, 0.28), roughness=0.8),
    'lantern':  mat('gy:lantern',  (0.55, 1.0, 0.45), emissive=(0.45, 1.0, 0.35), ei=6, roughness=0.4),
    'runeglow': mat('gy:runeglow', (0.55, 0.35, 1.0), emissive=(0.5, 0.3, 1.0), ei=4, roughness=0.4),
    'soil':     mat('gy:soil',     (0.13, 0.11, 0.10), roughness=1.0),
}
mat_order = list(mats.values())
refs2 = [CUBE, SPHERE] + [m['guid'] for m in mat_order]
mref = {k: i + 2 for i, k in enumerate(mats.keys())}

ents2 = []
def add(name, px, py, pz, sx, sy, sz, matkey, shape='cube', roty=None):
    comps = {
        'Name': {'value': name},
        'Transform': {'posX': round(px, 3), 'posY': round(py, 3), 'posZ': round(pz, 3),
                      'scaleX': round(sx, 3), 'scaleY': round(sy, 3), 'scaleZ': round(sz, 3),
                      **(quat_y(roty) if roty else {})},
        'MeshFilter': {'assetHandle': 0 if shape == 'cube' else 1},
        'MeshRenderer': {'material': mref[matkey]},
    }
    ents2.append({'localId': len(ents2), 'components': comps})

# ground + moon
add('Ground', 0, -0.1, 0, 60, 0.2, 60, 'ground')
ents2.append({'localId': len(ents2), 'components': {
    'Name': {'value': 'Sun'},
    'Transform': {'posX': 0, 'posY': 8, 'posZ': 0, 'scaleX': 1, 'scaleY': 1, 'scaleZ': 1},
    # Shadow fields merged onto DirectionalLight (engine #479); castShadow gates
    # them. orthoHalfExtent dropped (engine feat-20260613-csm auto-fits per-cascade
    # AABB to the visible scene).
    'DirectionalLight': {'directionX': 0.25, 'directionY': -1, 'directionZ': 0.35,
                         'colorR': 0.45, 'colorG': 0.55, 'colorB': 1.0, 'intensity': 0.55,
                         'castShadow': True, 'mapSize': 2048, 'farPlane': 60},
}})
# player spawn marker (Transform only)
ents2.append({'localId': len(ents2), 'components': {
    'Name': {'value': 'Player'},
    'Transform': {'posX': 0, 'posY': 0.75, 'posZ': 0, 'scaleX': 1, 'scaleY': 1, 'scaleZ': 1},
}})

def free_spot(used, min_r=7.0, lo=-25, hi=25, gap=3.4):
    while True:
        x, z = rng.uniform(lo, hi), rng.uniform(lo, hi)
        if math.hypot(x, z) < min_r: continue
        if all(math.hypot(x - ux, z - uz) >= gap for ux, uz in used): used.append((x, z)); return x, z

used = []
# 6 obsidian obelisks (ring, replaces the day steles — taller, thinner)
for i in range(6):
    ang = i * math.pi / 3 + 0.26
    x, z = math.cos(ang) * 14, math.sin(ang) * 14
    used.append((x, z))
    add(f'Stele{i+1}', x, 1.5, z, 0.7, 3.0, 0.7, 'obelisk', roty=rng.uniform(-0.2, 0.2))
    add(f'Decor_SteleRune{i+1}', x, 1.7, z + 0.001, 0.74, 0.5, 0.74, 'runeglow')
# ritual circle (altar reskinned)
add('AltarCore', 0, 0.05, -6.5, 2.6, 0.12, 2.6, 'obelisk')
add('AltarRune1', 0, 0.14, -6.5, 1.9, 0.05, 1.9, 'runeglow')
add('AltarRune2', 0, 0.2, -6.5, 1.0, 0.05, 1.0, 'lantern')
used.append((0, -6.5))
# 14 gravestone plots: slab + cross/headstone + soil mound
for i in range(14):
    x, z = free_spot(used)
    tilt = rng.uniform(-0.35, 0.35)
    old = rng.random() < 0.5
    m = 'graveold' if old else 'grave'
    add(f'Blocker_Grave_{i+1:02d}', x, 0.55, z, 0.72, 1.1, 0.16, m, roty=tilt)
    add(f'Decor_GraveCap_{i+1:02d}', x, 1.18, z, 0.5, 0.18, 0.2, m, roty=tilt)
    add(f'Decor_GraveSoil_{i+1:02d}', x, 0.06, z + 0.55, 0.8, 0.12, 1.1, 'soil', roty=tilt)
# 6 dead trees: trunk + 2 twisted branches
for i in range(6):
    x, z = free_spot(used)
    h = rng.uniform(2.2, 3.2)
    add(f'Blocker_DeadTree_{i+1:02d}', x, h / 2, z, 0.34, h, 0.34, 'wood', roty=rng.uniform(0, 3.1))
    add(f'Decor_DeadBranch_{i+1:02d}a', x + 0.5, h * 0.82, z, 1.2, 0.12, 0.12, 'wood', roty=rng.uniform(0, 3.1))
    add(f'Decor_DeadBranch_{i+1:02d}b', x - 0.3, h * 0.62, z + 0.2, 0.9, 0.1, 0.1, 'wood', roty=rng.uniform(0, 3.1))
# 5 glowing lantern posts
for i in range(5):
    x, z = free_spot(used)
    add(f'Blocker_Lantern_{i+1:02d}', x, 0.9, z, 0.16, 1.8, 0.16, 'wood')
    add(f'Decor_LanternGlow_{i+1:02d}', x, 1.85, z, 0.34, 0.34, 0.34, 'lantern')
# 2 crypts (big mausoleum blocks + roof)
for i in range(2):
    x, z = free_spot(used, min_r=12, gap=8)
    r = rng.uniform(0, 3.1)
    add(f'Blocker_Crypt_{i+1:02d}', x, 1.1, z, 3.0, 2.2, 2.2, 'crypt', roty=r)
    add(f'Decor_CryptRoof_{i+1:02d}', x, 2.45, z, 3.4, 0.5, 2.6, 'obelisk', roty=r)
    add(f'Decor_CryptDoor_{i+1:02d}', x, 0.8, z, 0.9, 1.6, 2.26, 'graveold', roty=r)
# 8 fence segments around plots
for i in range(8):
    x, z = free_spot(used, gap=3.0)
    r = rng.uniform(0, 3.1)
    add(f'Decor_Fence_{i+1:02d}', x, 0.45, z, 2.2, 0.08, 0.08, 'wood', roty=r)
    add(f'Decor_FencePostA_{i+1:02d}', x - 0.9, 0.35, z, 0.1, 0.7, 0.1, 'wood', roty=r)
    add(f'Decor_FencePostB_{i+1:02d}', x + 0.9, 0.35, z, 0.1, 0.7, 0.1, 'wood', roty=r)
# 6 bone piles
for i in range(6):
    x, z = free_spot(used, gap=2.2)
    for j in range(3):
        add(f'Decor_Bone_{i+1:02d}{chr(97+j)}', x + rng.uniform(-0.4, 0.4), 0.08, z + rng.uniform(-0.4, 0.4),
            rng.uniform(0.15, 0.5), 0.12, 0.14, 'bone', roty=rng.uniform(0, 3.1))

pack2 = {'schemaVersion': '1.0.0', 'kind': 'internal-text-package', 'assets': [
    {'guid': guid('gy:scene:v2'), 'kind': 'scene', 'payload': {'kind': 'scene', 'entities': ents2}, 'refs': refs2},
    *mat_order,
]}
json.dump(pack2, open('scenes/level2.pack.json', 'w'), indent=1)
print(f'level2 graveyard: {len(ents2)} entities, {len(mat_order)} materials')

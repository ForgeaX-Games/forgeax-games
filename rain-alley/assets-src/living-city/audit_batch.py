"""Compare shipped source/candidate GLB contracts without a renderer dependency."""
import hashlib, json, struct
from pathlib import Path
G = Path(__file__).resolve().parents[2]
def inspect(path):
    raw = path.read_bytes()
    size = struct.unpack_from('<I', raw, 12)[0]
    gltf = json.loads(raw[20:20+size])
    binary = raw[28+size:]
    images = {}
    for im in gltf.get('images', []):
        view = gltf['bufferViews'][im['bufferView']]
        offset = view.get('byteOffset', 0)
        images[im['name']] = hashlib.sha256(binary[offset:offset+view['byteLength']]).hexdigest()
    primitives = [p for m in gltf['meshes'] for p in m['primitives']]
    triangles = sum(sum(gltf['accessors'][p['indices']]['count']//3 for p in gltf['meshes'][node['mesh']]['primitives']) for node in gltf['nodes'] if 'mesh' in node)
    return {
        'path': str(path.relative_to(G)), 'sha256': hashlib.sha256(raw).hexdigest(),
        'bytes':len(raw), 'meshes':len(gltf['meshes']), 'primitives':len(primitives),
        'instantiatedTriangles':triangles, 'materials':len(gltf['materials']),
        'texturedMaterials':sum('baseColorTexture' in m.get('pbrMetallicRoughness', {}) for m in gltf['materials']),
        'tangents':sum('TANGENT' in p['attributes'] for p in primitives),
        'images':images,
        'markers':{n['name']: {k:v for k,v in n.items() if k not in ['mesh','children']} for n in gltf['nodes'] if n.get('name','').startswith(('PORTAL_', 'POI_', 'SPAWN_'))},
        'doors':sorted(n['name'] for n in gltf['nodes'] if n.get('name','').startswith('DOOR_')),
    }
a = inspect(G/'assets/living-city/district-lived.glb')
b = inspect(G/'assets/performance/district-batched.glb')
assert a['instantiatedTriangles'] == b['instantiatedTriangles'] <= 450000
assert b['primitives'] == b['tangents']
assert a['images'] == b['images'], 'Image bytes changed'
assert a['markers'] == b['markers'], 'Gameplay marker changed'
assert a['doors'] == b['doors']
assert b['materials'] == b['texturedMaterials'] == a['materials']
out = G/'docs/fps/evidence/performance'
out.mkdir(parents=True, exist_ok=True)
enemies = []
for kind in ['lookout', 'enforcer', 'boss']:
    source = inspect(G/f'assets/arsenal/{kind}.glb')
    low = inspect(G/f'assets/performance/{kind}-lod.glb')
    assert source['instantiatedTriangles'] == low['instantiatedTriangles']
    assert source['images'] == low['images']
    assert low['meshes'] == 3
    assert low['primitives'] == low['tangents']
    enemies.append({'source':source,'low':low})
(out/'asset-comparison.json').write_text(json.dumps({'pass':True,'source':a,'candidate':b,'enemyLods':enemies},indent=2)+'\n')
print('PASS', {k:b[k] for k in ['meshes','primitives','instantiatedTriangles','texturedMaterials','tangents']})

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/sundering-world-forms.pack.json');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalise = (v) => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};

function meshBuilder() {
  const vertices = [];
  const indices = [];
  const attributes = { position: [], normal: [], uv: [], tangent: [] };

  const triangle = (a, b, c, uvs) => {
    const n = normalise(cross(sub(b, a), sub(c, a)));
    const projectedUvs = uvs ?? [a, b, c].map((p) => {
      const axis = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
      if (axis[1] >= axis[0] && axis[1] >= axis[2]) return [p[0] + 0.5, p[2] + 0.5];
      if (axis[0] >= axis[2]) return [p[2] + 0.5, p[1] + 0.5];
      return [p[0] + 0.5, p[1] + 0.5];
    });
    const first = vertices.length / 12;
    for (let index = 0; index < 3; index += 1) {
      const p = [a, b, c][index];
      const uv = projectedUvs[index];
      vertices.push(...p, ...n, ...uv, 1, 0, 0, 1);
      attributes.position.push(...p);
      attributes.normal.push(...n);
      attributes.uv.push(...uv);
      attributes.tangent.push(1, 0, 0, 1);
    }
    indices.push(first, first + 1, first + 2);
  };

  const outward = (a, b, c, centre = [0, 0, 0]) => {
    const n = cross(sub(b, a), sub(c, a));
    const centroid = [
      (a[0] + b[0] + c[0]) / 3 - centre[0],
      (a[1] + b[1] + c[1]) / 3 - centre[1],
      (a[2] + b[2] + c[2]) / 3 - centre[2],
    ];
    if (dot(n, centroid) < 0) triangle(a, c, b);
    else triangle(a, b, c);
  };

  const append = (other, transform = (p) => p) => {
    for (let index = 0; index < other.vertices.length; index += 36) {
      const a = transform(other.vertices.slice(index, index + 3));
      const b = transform(other.vertices.slice(index + 12, index + 15));
      const c = transform(other.vertices.slice(index + 24, index + 27));
      triangle(a, b, c);
    }
  };

  const build = () => {
    const xs = attributes.position.filter((_, i) => i % 3 === 0);
    const ys = attributes.position.filter((_, i) => i % 3 === 1);
    const zs = attributes.position.filter((_, i) => i % 3 === 2);
    return {
      vertices,
      indices,
      attributes,
      aabb: [Math.min(...xs), Math.min(...ys), Math.min(...zs), Math.max(...xs), Math.max(...ys), Math.max(...zs)],
      submeshes: [{ indexOffset: 0, indexCount: indices.length, vertexCount: vertices.length / 12, topology: 'triangle-list' }],
    };
  };

  return { triangle, outward, append, build };
}

function ringPoints({ y, rx, rz, segments, offset = 0, roughness = 0, phase = 0 }) {
  return Array.from({ length: segments }, (_, index) => {
    const angle = offset + (index / segments) * Math.PI * 2;
    const variation = 1 + roughness * (0.55 * Math.sin(index * 2.17 + phase) + 0.45 * Math.cos(index * 3.73 - phase));
    return [Math.cos(angle) * rx * variation, y, Math.sin(angle) * rz * variation];
  });
}

function ringForm(rings, segments, centre = [0, 0, 0]) {
  const mesh = meshBuilder();
  const points = rings.map((ring) => ringPoints({ ...ring, segments }));
  for (let ring = 0; ring < points.length - 1; ring += 1) {
    for (let index = 0; index < segments; index += 1) {
      const next = (index + 1) % segments;
      const a = points[ring][index];
      const b = points[ring][next];
      const c = points[ring + 1][next];
      const d = points[ring + 1][index];
      if ((index + ring) % 2 === 0) {
        mesh.outward(a, c, b, centre);
        mesh.outward(a, d, c, centre);
      } else {
        mesh.outward(a, d, b, centre);
        mesh.outward(b, d, c, centre);
      }
    }
  }
  const top = points.at(-1);
  const bottom = points[0];
  const topCentre = [0, rings.at(-1).y, 0];
  const bottomCentre = [0, rings[0].y, 0];
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    mesh.outward(topCentre, top[index], top[next], centre);
    mesh.outward(bottomCentre, bottom[next], bottom[index], centre);
  }
  return mesh.build();
}

function cragMesh() {
  return ringForm([
    { y: -1.18, rx: 0.13, rz: 0.12, offset: 0.12, roughness: 0.08, phase: 0.4 },
    { y: -0.72, rx: 0.72, rz: 0.66, offset: -0.08, roughness: 0.22, phase: 1.1 },
    { y: -0.08, rx: 1.02, rz: 0.86, offset: 0.04, roughness: 0.18, phase: 2.3 },
    { y: 0.58, rx: 0.63, rz: 0.57, offset: 0.19, roughness: 0.24, phase: 0.8 },
    { y: 1.12, rx: 0.11, rz: 0.10, offset: -0.14, roughness: 0.05, phase: 1.7 },
  ], 9, [0, -0.05, 0]);
}

function islandShelfMesh() {
  return ringForm([
    { y: -1.25, rx: 0.12, rz: 0.10, offset: 0.07, roughness: 0.08, phase: 1.5 },
    { y: -0.82, rx: 0.55, rz: 0.50, offset: -0.04, roughness: 0.20, phase: 0.3 },
    { y: -0.28, rx: 0.84, rz: 0.73, offset: 0.06, roughness: 0.14, phase: 2.1 },
    { y: 0.78, rx: 1.08, rz: 0.94, offset: -0.02, roughness: 0.12, phase: 0.8 },
    { y: 1.0, rx: 0.94, rz: 0.82, offset: 0.03, roughness: 0.10, phase: 1.8 },
  ], 14, [0, -0.35, 0]);
}

function bridgeDeckMesh() {
  const top = [
    [-0.84, 0.94, -1], [-0.48, 0.99, -1.04], [-0.08, 0.96, -0.97], [0.36, 1.0, -1.06], [0.82, 0.93, -0.94],
    [0.92, 0.92, -0.38], [0.79, 0.98, 0.08], [0.9, 0.92, 0.55], [0.68, 0.96, 1.02],
    [0.24, 1.0, 0.94], [-0.18, 0.95, 1.06], [-0.62, 0.98, 0.91], [-0.9, 0.91, 0.45], [-0.78, 0.97, -0.12],
  ];
  const bottom = top.map(([x, , z], index) => [x * (0.92 + (index % 3) * 0.03), -0.88 - (index % 2) * 0.1, z]);
  const mesh = meshBuilder();
  const centreTop = [0, 0.97, 0];
  const centreBottom = [0, -0.93, 0];
  for (let index = 0; index < top.length; index += 1) {
    const next = (index + 1) % top.length;
    mesh.outward(centreTop, top[next], top[index], [0, 0, 0]);
    mesh.outward(centreBottom, bottom[index], bottom[next], [0, 0, 0]);
    mesh.outward(top[index], top[next], bottom[next], [0, 0, 0]);
    mesh.outward(top[index], bottom[next], bottom[index], [0, 0, 0]);
  }
  return mesh.build();
}

function columnMesh() {
  return ringForm([
    { y: -1, rx: 0.62, rz: 0.62, offset: 0, roughness: 0.04, phase: 0.2 },
    { y: -0.82, rx: 0.74, rz: 0.74, offset: 0, roughness: 0.03, phase: 0.7 },
    { y: -0.67, rx: 0.48, rz: 0.48, offset: 0.05, roughness: 0.04, phase: 1.2 },
    { y: 0.68, rx: 0.42, rz: 0.42, offset: -0.02, roughness: 0.07, phase: 1.9 },
    { y: 0.88, rx: 0.56, rz: 0.56, offset: 0.04, roughness: 0.10, phase: 2.4 },
    { y: 1.03, rx: 0.36, rz: 0.34, offset: 0.12, roughness: 0.28, phase: 0.5 },
  ], 8, [0, 0, 0]);
}

function obeliskMesh() {
  return ringForm([
    { y: -1, rx: 0.58, rz: 0.58, offset: Math.PI / 4, roughness: 0.01 },
    { y: -0.78, rx: 0.72, rz: 0.72, offset: Math.PI / 4, roughness: 0.01 },
    { y: -0.58, rx: 0.42, rz: 0.42, offset: Math.PI / 4, roughness: 0.01 },
    { y: 0.58, rx: 0.27, rz: 0.27, offset: Math.PI / 4, roughness: 0.01 },
    { y: 1.12, rx: 0.035, rz: 0.035, offset: Math.PI / 4, roughness: 0 },
  ], 4, [0, 0, 0]);
}

function crystalMesh() {
  return ringForm([
    { y: -1.1, rx: 0.025, rz: 0.025, offset: 0.11 },
    { y: -0.25, rx: 0.58, rz: 0.48, offset: 0.11, roughness: 0.06, phase: 1.2 },
    { y: 0.32, rx: 0.48, rz: 0.4, offset: 0.11, roughness: 0.05, phase: 0.4 },
    { y: 1.2, rx: 0.025, rz: 0.025, offset: 0.11 },
  ], 7, [0, 0.02, 0]);
}

function torusMesh() {
  const mesh = meshBuilder();
  const majorSegments = 18;
  const minorSegments = 6;
  const point = (major, minor) => {
    const u = (major / majorSegments) * Math.PI * 2;
    const v = (minor / minorSegments) * Math.PI * 2;
    const radius = 0.72 + 0.14 * Math.cos(v);
    return [Math.cos(u) * radius, 0.14 * Math.sin(v), Math.sin(u) * radius];
  };
  for (let major = 0; major < majorSegments; major += 1) {
    for (let minor = 0; minor < minorSegments; minor += 1) {
      const a = point(major, minor);
      const b = point(major + 1, minor);
      const c = point(major + 1, minor + 1);
      const d = point(major, minor + 1);
      mesh.outward(a, c, b);
      mesh.outward(a, d, c);
    }
  }
  return mesh.build();
}

function grassMesh() {
  const mesh = meshBuilder();
  const blades = 11;
  for (let index = 0; index < blades; index += 1) {
    const angle = index * 2.399963;
    const rootRadius = 0.1 + (index % 4) * 0.12;
    const root = [Math.cos(angle) * rootRadius, -0.5, Math.sin(angle) * rootRadius];
    const width = 0.045 + (index % 3) * 0.018;
    const height = 0.7 + (index % 5) * 0.15;
    const side = [-Math.sin(angle) * width, 0, Math.cos(angle) * width];
    const bend = [Math.cos(angle + 0.6) * 0.16, height, Math.sin(angle + 0.6) * 0.16];
    const left = [root[0] - side[0], root[1], root[2] - side[2]];
    const right = [root[0] + side[0], root[1], root[2] + side[2]];
    const tip = [root[0] + bend[0], root[1] + bend[1], root[2] + bend[2]];
    mesh.triangle(left, right, tip);
    mesh.triangle(right, left, tip);
  }
  return mesh.build();
}

function riftFragmentMesh() {
  const mesh = meshBuilder();
  const front = [[-1, -0.24, 0.2], [0.72, -0.42, 0.2], [1, 0.08, 0.2], [0.18, 0.52, 0.2], [-0.78, 0.34, 0.2]];
  const back = front.map(([x, y]) => [x * 0.92, y * 0.92, -0.2]);
  const cf = [0, 0.04, 0.2];
  const cb = [0, 0.04, -0.2];
  for (let index = 0; index < front.length; index += 1) {
    const next = (index + 1) % front.length;
    mesh.outward(cf, front[index], front[next]);
    mesh.outward(cb, back[next], back[index]);
    mesh.outward(front[index], back[next], back[index]);
    mesh.outward(front[index], front[next], back[next]);
  }
  return mesh.build();
}

function scaled(mesh, factor) {
  for (let index = 0; index < mesh.vertices.length; index += 12) {
    mesh.vertices[index] *= factor;
    mesh.vertices[index + 1] *= factor;
    mesh.vertices[index + 2] *= factor;
  }
  for (let index = 0; index < mesh.attributes.position.length; index += 1) mesh.attributes.position[index] *= factor;
  mesh.aabb = mesh.aabb.map((value) => value * factor);
  return mesh;
}

function importedRockMesh() {
  const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/world/rock');
  const gltf = JSON.parse(readFileSync(resolve(sourceDir, 'rock.gltf'), 'utf8'));
  const binary = readFileSync(resolve(sourceDir, gltf.buffers[0].uri));
  const primitive = gltf.meshes[0].primitives[0];
  const componentCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const componentBytes = { 5123: 2, 5125: 4, 5126: 4 };
  const accessor = (index) => {
    const source = gltf.accessors[index];
    const view = gltf.bufferViews[source.bufferView];
    const count = componentCount[source.type];
    const bytes = componentBytes[source.componentType];
    const stride = view.byteStride ?? count * bytes;
    const start = (view.byteOffset ?? 0) + (source.byteOffset ?? 0);
    const values = [];
    for (let row = 0; row < source.count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        const offset = start + row * stride + column * bytes;
        if (source.componentType === 5126) values.push(binary.readFloatLE(offset));
        else if (source.componentType === 5125) values.push(binary.readUInt32LE(offset));
        else values.push(binary.readUInt16LE(offset));
      }
    }
    return values;
  };
  const positions = accessor(primitive.attributes.POSITION);
  const normals = accessor(primitive.attributes.NORMAL);
  const uvs = accessor(primitive.attributes.TEXCOORD_0);
  const indices = accessor(primitive.indices);
  const centre = [-0.168177, 0.52909, -0.018093];
  const factor = [0.275, 0.595, 0.275];
  const vertices = [];
  const attributes = { position: [], normal: [], uv: [], tangent: [] };
  for (let index = 0; index < positions.length / 3; index += 1) {
    const p = [
      (positions[index * 3] - centre[0]) * factor[0],
      (positions[index * 3 + 1] - centre[1]) * factor[1],
      (positions[index * 3 + 2] - centre[2]) * factor[2],
    ];
    const n = normals.slice(index * 3, index * 3 + 3);
    const uv = uvs.slice(index * 2, index * 2 + 2);
    vertices.push(...p, ...n, ...uv, 1, 0, 0, 1);
    attributes.position.push(...p);
    attributes.normal.push(...n);
    attributes.uv.push(...uv);
    attributes.tangent.push(1, 0, 0, 1);
  }
  const xs = attributes.position.filter((_, i) => i % 3 === 0);
  const ys = attributes.position.filter((_, i) => i % 3 === 1);
  const zs = attributes.position.filter((_, i) => i % 3 === 2);
  return {
    vertices,
    indices,
    attributes,
    aabb: [Math.min(...xs), Math.min(...ys), Math.min(...zs), Math.max(...xs), Math.max(...ys), Math.max(...zs)],
    submeshes: [{ indexOffset: 0, indexCount: indices.length, vertexCount: positions.length / 3, topology: 'triangle-list' }],
  };
}

const assets = [
  ['5c4c2f30-955e-4ae6-b864-e00100000001', 'sundering-crag', scaled(cragMesh(), 0.5)],
  ['5c4c2f30-955e-4ae6-b864-e00100000002', 'sundering-island-shelf', scaled(islandShelfMesh(), 0.5)],
  ['5c4c2f30-955e-4ae6-b864-e00100000003', 'sundering-bridge-deck', scaled(bridgeDeckMesh(), 0.5)],
  ['5c4c2f30-955e-4ae6-b864-e00100000004', 'sundering-ruin-column', scaled(columnMesh(), 0.5)],
  ['5c4c2f30-955e-4ae6-b864-e00100000005', 'sundering-obelisk', scaled(obeliskMesh(), 0.5)],
  ['5c4c2f30-955e-4ae6-b864-e00100000006', 'sundering-echo-crystal', scaled(crystalMesh(), 0.5)],
  ['5c4c2f30-955e-4ae6-b864-e00100000007', 'sundering-beacon-halo', scaled(torusMesh(), 0.5)],
  ['5c4c2f30-955e-4ae6-b864-e00100000008', 'sundering-wind-grass', scaled(grassMesh(), 0.5)],
  ['5c4c2f30-955e-4ae6-b864-e00100000009', 'sundering-rift-fragment', scaled(riftFragmentMesh(), 0.5)],
  ['5c4c2f30-955e-4ae6-b864-e00100000010', 'sundering-licensed-rock', importedRockMesh()],
].map(([guid, name, payload]) => ({ guid, kind: 'mesh', payload: { name, ...payload }, refs: [], artifacts: {} }));

const pack = { schemaVersion: '2.0.0', kind: 'internal-text-package', assets };
writeFileSync(output, `${JSON.stringify(pack, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, output, assets: assets.length, triangles: assets.reduce((sum, asset) => sum + asset.payload.indices.length / 3, 0) }));

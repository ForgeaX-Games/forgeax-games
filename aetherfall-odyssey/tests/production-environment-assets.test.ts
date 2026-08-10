import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Primitive {
  readonly attributes: Readonly<Record<string, number>> & {
    readonly POSITION: number;
  };
  readonly indices?: number;
  readonly mode?: number;
}

interface GltfDocument {
  readonly accessors: ReadonlyArray<{
    readonly bufferView?: number;
    readonly componentType?: number;
    readonly count: number;
    readonly min?: readonly number[];
    readonly max?: readonly number[];
    readonly type?: string;
  }>;
  readonly bufferViews?: ReadonlyArray<{
    readonly buffer: number;
    readonly byteLength: number;
    readonly byteOffset?: number;
    readonly byteStride?: number;
  }>;
  readonly buffers?: ReadonlyArray<{
    readonly byteLength: number;
    readonly uri?: string;
  }>;
  readonly images?: ReadonlyArray<{
    readonly bufferView?: number;
    readonly mimeType?: string;
    readonly uri?: string;
  }>;
  readonly materials?: ReadonlyArray<{
    readonly normalTexture?: { readonly index: number };
    readonly occlusionTexture?: { readonly index: number };
    readonly pbrMetallicRoughness?: {
      readonly baseColorTexture?: { readonly index: number };
      readonly metallicFactor?: number;
      readonly metallicRoughnessTexture?: { readonly index: number };
    };
  }>;
  readonly meshes: ReadonlyArray<{ readonly primitives: readonly Primitive[] }>;
  readonly nodes: ReadonlyArray<{
    readonly mesh?: number;
    readonly translation?: readonly number[];
    readonly rotation?: readonly number[];
    readonly scale?: readonly number[];
    readonly matrix?: readonly number[];
  }>;
  readonly samplers?: readonly unknown[];
  readonly scenes?: readonly unknown[];
  readonly textures?: readonly unknown[];
  readonly extensionsRequired?: readonly string[];
  readonly extensionsUsed?: readonly string[];
}

interface Sidecar {
  readonly importer: string;
  readonly kind: string;
  readonly schemaVersion: number;
  readonly source: string;
  readonly importSettings: {
    readonly diagnostics: {
      readonly matrixTrsCoexistNodes: readonly unknown[];
      readonly unsupportedExtensions: readonly unknown[];
    };
  };
  readonly subAssets: ReadonlyArray<{
    readonly guid: string;
    readonly kind: string;
  }>;
}

const modelsRoot = new URL("../assets/models/", import.meta.url);
const guidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

function sha256(url: URL): string {
  return createHash("sha256").update(readFileSync(url)).digest("hex");
}

function readGlb(url: URL): {
  readonly document: GltfDocument;
  readonly binaryBytes: number;
} {
  const bytes = readFileSync(url);
  expect(bytes.subarray(0, 4).toString("ascii")).toBe("glTF");
  expect(bytes.readUInt32LE(4)).toBe(2);
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);

  const jsonBytes = bytes.readUInt32LE(12);
  expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a);
  const jsonStart = 20;
  const binaryHeader = jsonStart + jsonBytes;
  expect(bytes.readUInt32LE(binaryHeader + 4)).toBe(0x004e4942);
  const binaryBytes = bytes.readUInt32LE(binaryHeader);
  expect(binaryHeader + 8 + binaryBytes).toBe(bytes.length);
  const document = JSON.parse(
    bytes.subarray(jsonStart, binaryHeader).toString("utf8").trim(),
  ) as GltfDocument;
  return { document, binaryBytes };
}

function referencedUris(document: GltfDocument): string[] {
  return [
    ...(document.buffers ?? []).flatMap((buffer) =>
      buffer.uri === undefined ? [] : [buffer.uri],
    ),
    ...(document.images ?? []).flatMap((image) =>
      image.uri === undefined ? [] : [image.uri],
    ),
  ].sort();
}

const selfContainedCandidates = [
  {
    directory: "polyhaven-gothic-statue",
    root: "gothic_statue_1k.glb",
    api: "https://api.polyhaven.com/files/gothic_statue",
    bytes: 4_354_656,
    sha256: "28bfc938102059d78f05ef3ff6776aa72743fefa9ef60c05919a65b9710672c0",
    sidecarSha256:
      "463f2a39d95b047d2b23c2bbb400601d0a4dd60d99d570d2c7a39f6f96a97e67",
    sceneGuid: "019fdde8-bbe8-778b-816a-5d058ef3f977",
    expected: {
      nodes: 1,
      meshes: 1,
      primitives: 1,
      triangles: 27_739,
      metallicFactor: 0 as number | undefined,
      subAssets: [
        "material",
        "mesh",
        "sampler",
        "scene",
        "texture",
        "texture",
        "texture",
      ],
    },
  },
  {
    directory: "polyhaven-large-castle-door",
    root: "large_castle_door_1k.glb",
    api: "https://api.polyhaven.com/files/large_castle_door",
    bytes: 3_444_548,
    sha256: "bea00630c2f824e65da285e466547cad02bbb2e1f0a08a15157061e590b8b461",
    sidecarSha256:
      "e687acefb74b5daebb1ba9f240031cbe686b9c4200bdc4422ad055cb09ab0ced",
    sceneGuid: "019fddf1-5e4b-7578-91fd-66a8e526a9a1",
    expected: {
      nodes: 3,
      meshes: 3,
      primitives: 3,
      triangles: 12_640,
      metallicFactor: undefined as number | undefined,
      subAssets: [
        "material",
        "mesh",
        "mesh",
        "mesh",
        "sampler",
        "scene",
        "texture",
        "texture",
        "texture",
      ],
    },
  },
  {
    directory: "polyhaven-rock-face-01",
    root: "rock_face_01_1k.glb",
    api: "https://api.polyhaven.com/files/rock_face_01",
    bytes: 3_227_128,
    sha256: "c06b4ee2818b06b71783f4168194085e540f91df09fa0f501e25d6c8a191d053",
    sidecarSha256:
      "7cdb8d5cba521a67d4f97488f1df6ff27b4c25de1c621b3e75ca428ea985af02",
    sceneGuid: "019fde01-daea-7c2d-aeab-0b80822a2445",
    expected: {
      nodes: 1,
      meshes: 1,
      primitives: 1,
      triangles: 20_174,
      metallicFactor: 0 as number | undefined,
      subAssets: [
        "material",
        "mesh",
        "sampler",
        "scene",
        "texture",
        "texture",
        "texture",
      ],
    },
  },
] as const;

describe("production environment asset packages", () => {
  it.each(selfContainedCandidates)(
    "pins an importer-compatible, self-contained GLB candidate for $directory",
    (candidate) => {
      const directory = new URL(`${candidate.directory}/`, modelsRoot);
      const glb = new URL(candidate.root, directory);
      expect(statSync(glb).size).toBe(candidate.bytes);
      expect(sha256(glb)).toBe(candidate.sha256);
      const { document, binaryBytes } = readGlb(glb);

      expect(referencedUris(document)).toEqual([]);
      expect(document.buffers).toHaveLength(1);
      expect(document.buffers![0]).toEqual({ byteLength: binaryBytes });
      expect(document.images).toHaveLength(3);
      expect(
        document.images!.every(
          (image) =>
            image.uri === undefined &&
            image.bufferView !== undefined &&
            image.mimeType === "image/jpeg",
        ),
      ).toBe(true);

      const primitives = document.meshes.flatMap((mesh) => mesh.primitives);
      expect(document.nodes).toHaveLength(candidate.expected.nodes);
      expect(document.meshes).toHaveLength(candidate.expected.meshes);
      expect(primitives).toHaveLength(candidate.expected.primitives);
      expect(
        primitives.reduce(
          (sum, primitive) =>
            sum +
            document.accessors[
              primitive.indices ?? primitive.attributes.POSITION
            ]!.count /
              3,
          0,
        ),
      ).toBe(candidate.expected.triangles);
      for (const primitive of primitives) {
        expect(primitive.mode ?? 4).toBe(4);
        expect(new Set(Object.keys(primitive.attributes))).toEqual(
          new Set(["POSITION", "NORMAL", "TANGENT", "TEXCOORD_0"]),
        );

        const attributeAccessors = [
          document.accessors[primitive.attributes.POSITION]!,
          document.accessors[primitive.attributes.NORMAL]!,
          document.accessors[primitive.attributes.TANGENT]!,
          document.accessors[primitive.attributes.TEXCOORD_0]!,
        ];
        const attributeViews = attributeAccessors.map(
          (accessor) => accessor.bufferView!,
        );
        expect(new Set(attributeViews).size).toBe(4);
        expect(attributeAccessors.map((accessor) => accessor.count)).toEqual([
          attributeAccessors[0]!.count,
          attributeAccessors[0]!.count,
          attributeAccessors[0]!.count,
          attributeAccessors[0]!.count,
        ]);
        expect(
          attributeAccessors.map((accessor) => [
            accessor.type,
            accessor.componentType,
          ]),
        ).toEqual([
          ["VEC3", 5126],
          ["VEC3", 5126],
          ["VEC4", 5126],
          ["VEC2", 5126],
        ]);
        expect(
          attributeViews.map((view) => document.bufferViews![view]!.byteStride),
        ).toEqual([12, 12, 16, 8]);
      }

      const material = document.materials![0]!;
      const textureIndices = [
        material.pbrMetallicRoughness?.baseColorTexture?.index,
        material.normalTexture?.index,
        material.pbrMetallicRoughness?.metallicRoughnessTexture?.index,
      ];
      expect(textureIndices.every((index) => index !== undefined)).toBe(true);
      expect(new Set(textureIndices).size).toBe(3);
      expect(material.occlusionTexture?.index).toBe(
        material.pbrMetallicRoughness?.metallicRoughnessTexture?.index,
      );
      expect(material.pbrMetallicRoughness?.metallicFactor).toBe(
        candidate.expected.metallicFactor,
      );

      const sidecarUrl = new URL(`${candidate.root}.meta.json`, directory);
      expect(sha256(sidecarUrl)).toBe(candidate.sidecarSha256);
      const sidecar = readJson<Sidecar>(sidecarUrl);
      expect(sidecar).toMatchObject({
        importer: "gltf",
        kind: "external-asset-package",
        schemaVersion: 1,
        source: candidate.root,
      });
      const subAssetKinds = sidecar.subAssets.map((asset) => asset.kind).sort();
      expect(subAssetKinds).toEqual(candidate.expected.subAssets);
      expect(new Set(sidecar.subAssets.map((asset) => asset.guid)).size).toBe(
        sidecar.subAssets.length,
      );
      for (const asset of sidecar.subAssets)
        expect(asset.guid).toMatch(guidPattern);
      expect(sidecar.subAssets).toContainEqual(
        expect.objectContaining({
          guid: candidate.sceneGuid,
          kind: "scene",
        }),
      );
      expect(sidecar.importSettings.diagnostics.matrixTrsCoexistNodes).toEqual(
        [],
      );
      expect(sidecar.importSettings.diagnostics.unsupportedExtensions).toEqual(
        [],
      );
      expect(document.extensionsRequired ?? []).toEqual([]);
      expect(document.extensionsUsed ?? []).toEqual([]);
      expect(readFileSync(new URL("LICENSE", directory), "utf8")).toContain(
        "CC0 1.0 Universal",
      );
      expect(
        readFileSync(new URL("ATTRIBUTION.md", directory), "utf8"),
      ).toContain(candidate.api);
    },
  );

  it("retains globally distinct imported sub-asset identities", () => {
    const allGuids = new Set<string>();
    for (const candidate of selfContainedCandidates) {
      const directory = new URL(`${candidate.directory}/`, modelsRoot);
      const sidecar = readJson<Sidecar>(
        new URL(`${candidate.root}.meta.json`, directory),
      );
      for (const asset of sidecar.subAssets) {
        expect(asset.guid).toMatch(guidPattern);
        expect(allGuids.has(asset.guid)).toBe(false);
        allGuids.add(asset.guid);
      }
    }
    expect(allGuids.size).toBe(23);
  });
});

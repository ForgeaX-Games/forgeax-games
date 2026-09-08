import { PostProcessParams, type Renderer } from '@forgeax/engine-render';
import { URP_PIPELINE_ID } from '@forgeax/engine-render/internal';

export { PostProcessParams };

type MaterialArtifactLookup = ReturnType<Renderer['shader']['findMaterialArtifact']>;
type MaterialArtifact = Parameters<Renderer['shader']['installMaterialArtifact']>[1];
type PostProcessRegister = Renderer['postProcess']['register'];
type PostProcessEntry = Parameters<PostProcessRegister>[1];
type PostProcessRegistration = ReturnType<PostProcessRegister>;
type PipelineAsset = Parameters<Renderer['installPipeline']>[0];
type PipelineInstallResult = ReturnType<Renderer['installPipeline']>;
type MeshIndices = Uint16Array | Uint32Array;

type UnknownRecord = Record<PropertyKey, unknown>;
type MaterialShaderBridge = {
  findMaterialArtifact?: (id: string) => MaterialArtifactLookup;
  installMaterialArtifact?: (id: string, artifact: MaterialArtifact) => void;
};
type PostProcessBridge = {
  register?: PostProcessRegister;
};
type PipelineBridge = {
  installPipeline?: (asset: PipelineAsset) => PipelineInstallResult;
};
type MeshCallResult = void | boolean | { readonly ok: boolean };
type MeshStoreBridge = {
  updateMesh?: (handle: number, vertices: Float32Array, indices: MeshIndices) => MeshCallResult;
  updateMeshVertexRange?: (
    handle: number,
    vertices: Float32Array,
    firstVertex: number,
    vertexCount: number,
  ) => MeshCallResult;
};

function meshCallSucceeded(value: MeshCallResult): boolean {
  if (value === undefined) return true;
  if (typeof value === 'boolean') return value;
  return value.ok;
}

export class EngineBridgeContractError extends Error {
  constructor(capability: string, expected: string) {
    super(`[planet-snake] ForgeaX engine contract missing ${capability}; expected ${expected}`);
    this.name = 'EngineBridgeContractError';
  }
}

export function isEngineBridgeContractError(error: unknown): error is EngineBridgeContractError {
  return error instanceof EngineBridgeContractError;
}

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null ? value as UnknownRecord : undefined;
}

function shaderBridge(renderer: Renderer): MaterialShaderBridge {
  return record(renderer.shader) as MaterialShaderBridge | undefined ?? {};
}

function postProcessBridge(renderer: Renderer): PostProcessBridge {
  return record(renderer.postProcess) as PostProcessBridge | undefined ?? {};
}

function pipelineBridge(renderer: Renderer): PipelineBridge {
  return record(renderer) as PipelineBridge | undefined ?? {};
}

function meshStoreBridge(renderer: Renderer): MeshStoreBridge {
  return record(renderer.store) as MeshStoreBridge | undefined ?? {};
}

export function findMaterialArtifact(
  renderer: Renderer | undefined,
  id: string,
): MaterialArtifactLookup | undefined {
  if (renderer === undefined) return undefined;
  const shader = shaderBridge(renderer);
  if (typeof shader.findMaterialArtifact !== 'function') {
    throw new EngineBridgeContractError(
      'renderer.shader.findMaterialArtifact',
      '(id: string) => Result<MaterialShaderArtifact, ShaderError>',
    );
  }
  return shader.findMaterialArtifact.call(renderer.shader, id);
}

export function installMaterialArtifact(
  renderer: Renderer | undefined,
  id: string,
  artifact: MaterialArtifact,
): void {
  if (renderer === undefined) return;
  const shader = shaderBridge(renderer);
  if (typeof shader.installMaterialArtifact !== 'function') {
    throw new EngineBridgeContractError(
      'renderer.shader.installMaterialArtifact',
      '(id: string, artifact: MaterialShaderArtifact) => void',
    );
  }
  shader.installMaterialArtifact.call(renderer.shader, id, artifact);
}

export function registerPostProcess(
  renderer: Renderer | undefined,
  id: string,
  entry: PostProcessEntry,
): PostProcessRegistration | undefined {
  if (renderer === undefined) return undefined;
  const postProcess = postProcessBridge(renderer);
  if (typeof postProcess.register !== 'function') {
    throw new EngineBridgeContractError(
      'renderer.postProcess.register',
      '(id: string, entry: PostProcessShaderEntry) => cleanup',
    );
  }
  return postProcess.register.call(renderer.postProcess, id, entry);
}

export function installUrpPostProcessPipeline(
  renderer: Renderer | undefined,
  postEffects: readonly string[],
): PipelineInstallResult | undefined {
  if (renderer === undefined) return undefined;
  const target = pipelineBridge(renderer);
  if (typeof target.installPipeline !== 'function') {
    throw new EngineBridgeContractError(
      'renderer.installPipeline',
      '(asset: RenderPipelineAsset) => Result<cleanup, PipelineError>',
    );
  }
  return target.installPipeline.call(renderer, {
    kind: 'render-pipeline',
    pipelineId: URP_PIPELINE_ID,
    config: { postEffects: [...postEffects] },
  });
}

export function updateMesh(
  renderer: Renderer | undefined,
  handle: number,
  vertices: Float32Array,
  indices: MeshIndices,
): boolean {
  if (renderer === undefined) return false;
  const store = meshStoreBridge(renderer);
  if (typeof store.updateMesh !== 'function') return false;
  return meshCallSucceeded(store.updateMesh.call(renderer.store, handle, vertices, indices));
}

let warnedMissingVertexRange = false;

/**
 * Optional partial upload. Absence is normal: warn once and let the caller
 * upload the whole mesh through updateMesh instead.
 */
export function updateMeshVertexRange(
  renderer: Renderer | undefined,
  handle: number,
  vertices: Float32Array,
  firstVertex: number,
  vertexCount: number,
): boolean {
  if (renderer === undefined) return false;
  const store = meshStoreBridge(renderer);
  if (typeof store.updateMeshVertexRange !== 'function') {
    if (!warnedMissingVertexRange) {
      warnedMissingVertexRange = true;
      console.warn(
        '[planet-snake] renderer.store.updateMeshVertexRange unavailable; falling back to a whole-mesh upload',
      );
    }
    return false;
  }
  return meshCallSucceeded(store.updateMeshVertexRange.call(
    renderer.store,
    handle,
    vertices,
    firstVertex,
    vertexCount,
  ));
}

export interface EngineBridgeVerification {
  renderer: 'present' | 'absent';
  required: {
    findMaterialArtifact: boolean;
    installMaterialArtifact: boolean;
    registerPostProcess: boolean;
    installPipeline: boolean;
  };
  optional: {
    updateMesh: boolean;
    updateMeshVertexRange: boolean;
  };
  requiredReady: boolean;
  note: string;
}

export function verifyEngineBridge(renderer?: Renderer): EngineBridgeVerification {
  const shader = renderer === undefined ? {} : shaderBridge(renderer);
  const postProcess = renderer === undefined ? {} : postProcessBridge(renderer);
  const pipeline = renderer === undefined ? {} : pipelineBridge(renderer);
  const store = renderer === undefined ? {} : meshStoreBridge(renderer);
  const required = {
    findMaterialArtifact: typeof shader.findMaterialArtifact === 'function',
    installMaterialArtifact: typeof shader.installMaterialArtifact === 'function',
    registerPostProcess: typeof postProcess.register === 'function',
    installPipeline: typeof pipeline.installPipeline === 'function',
  };
  return {
    renderer: renderer === undefined ? 'absent' : 'present',
    required,
    optional: {
      updateMesh: typeof store.updateMesh === 'function',
      updateMeshVertexRange: typeof store.updateMeshVertexRange === 'function',
    },
    requiredReady: Object.values(required).every(Boolean),
    note: renderer === undefined
      ? 'Headless/editor probe: renderer-backed capabilities were not evaluated.'
      : 'updateMeshVertexRange is optional; callers fall back to whole-mesh uploads.',
  };
}

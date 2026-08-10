/**
 * Dual material-shader registration for Engine c0 → current main.
 *
 * Engine tip replaced `registerMaterialShader` with `installMaterialArtifact`
 * (bindingLayout is now derived from paramSchema). Hellforge still needs to
 * run on both shapes:
 *   1. prefer `installMaterialArtifact` (current Engine)
 *   2. fallback `registerMaterialShader` (Engine c0eee524 / older pins)
 *
 * SSOT: docs/handoff/2026-08-01-hellforge-visual-fail-and-c0-lock-kimi-handoff.md
 */

export type MaterialParamType = 'color' | 'f32' | 'texture2d';

export type MaterialParamSchemaEntry = {
  readonly name: string;
  readonly type: MaterialParamType;
};

export type MaterialShaderRegisterEntry = {
  readonly source: string;
  readonly paramSchema: ReadonlyArray<MaterialParamSchemaEntry>;
};

export type MaterialShaderRegistrar = {
  installMaterialArtifact?: (id: string, entry: MaterialShaderRegisterEntry) => void;
  registerMaterialShader?: (
    id: string,
    entry: MaterialShaderRegisterEntry & { bindingLayout: [] },
  ) => void;
};

export type ShaderRegistrarApp = {
  renderer?: {
    shader?: MaterialShaderRegistrar | null;
  };
} | undefined;

function isAlreadyRegistered(message: string): boolean {
  return message.includes('already registered');
}

/**
 * Idempotent register. Returns true when the shader is (now or already)
 * registered; false when no compatible API exists or registration throws
 * an unexpected error.
 */
export function registerMaterialShaderDual(
  app: unknown,
  id: string,
  entry: MaterialShaderRegisterEntry,
  logTag: string,
): boolean {
  const shader = (app as ShaderRegistrarApp)?.renderer?.shader;
  if (!shader) return false;

  const payload: MaterialShaderRegisterEntry = {
    source: entry.source,
    paramSchema: entry.paramSchema,
  };

  if (typeof shader.installMaterialArtifact === 'function') {
    try {
      shader.installMaterialArtifact(id, payload);
      return true;
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (isAlreadyRegistered(msg)) return true;
      console.warn(`[${logTag}] installMaterialArtifact(${id}) threw:`, msg);
      return false;
    }
  }

  if (typeof shader.registerMaterialShader === 'function') {
    try {
      shader.registerMaterialShader(id, {
        ...payload,
        bindingLayout: [],
      });
      return true;
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (isAlreadyRegistered(msg)) return true;
      console.warn(`[${logTag}] registerMaterialShader(${id}) threw:`, msg);
      return false;
    }
  }

  return false;
}

import { describe, expect, spyOn, test } from 'bun:test';
import { registerMaterialShaderDual } from './register-material-shader.ts';

const ENTRY = {
  source: '// stub',
  paramSchema: [{ name: 'baseColor', type: 'color' as const }],
};

describe('registerMaterialShaderDual', () => {
  test('prefers installMaterialArtifact on current Engine', () => {
    const calls: Array<{ api: string; id: string; entry: unknown }> = [];
    const app = {
      renderer: {
        shader: {
          installMaterialArtifact: (id: string, entry: unknown) => {
            calls.push({ api: 'install', id, entry });
          },
          registerMaterialShader: (id: string, entry: unknown) => {
            calls.push({ api: 'legacy', id, entry });
          },
        },
      },
    };
    expect(registerMaterialShaderDual(app, 'hellforge::fire_bolt', ENTRY, 'hellforge/fx')).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.api).toBe('install');
    expect(calls[0]?.id).toBe('hellforge::fire_bolt');
    expect(calls[0]?.entry).toEqual(ENTRY);
  });

  test('falls back to registerMaterialShader on Engine c0', () => {
    const calls: Array<{ id: string; entry: unknown }> = [];
    const app = {
      renderer: {
        shader: {
          registerMaterialShader: (id: string, entry: unknown) => {
            calls.push({ id, entry });
          },
        },
      },
    };
    expect(registerMaterialShaderDual(app, 'hellforge::sprite', ENTRY, 'hellforge/fx')).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe('hellforge::sprite');
    expect(calls[0]?.entry).toEqual({ ...ENTRY, bindingLayout: [] });
  });

  test('swallows already-registered on either API', () => {
    const installApp = {
      renderer: {
        shader: {
          installMaterialArtifact: () => {
            throw new Error("ShaderRegistry: material shader identifier 'x' already registered;");
          },
        },
      },
    };
    expect(registerMaterialShaderDual(installApp, 'x', ENTRY, 't')).toBe(true);

    const legacyApp = {
      renderer: {
        shader: {
          registerMaterialShader: () => {
            throw new Error("already registered");
          },
        },
      },
    };
    expect(registerMaterialShaderDual(legacyApp, 'x', ENTRY, 't')).toBe(true);
  });

  test('unexpected throw warns and returns false', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const app = {
        renderer: {
          shader: {
            installMaterialArtifact: () => {
              throw new Error('boom');
            },
          },
        },
      };
      expect(registerMaterialShaderDual(app, 'hellforge::x', ENTRY, 'hellforge/fx')).toBe(false);
      expect(warn.mock.calls.length).toBe(1);
      expect(String(warn.mock.calls[0]?.[0] ?? '')).toContain('installMaterialArtifact');
    } finally {
      warn.mockRestore();
    }
  });

  test('returns false when registry is unavailable', () => {
    expect(registerMaterialShaderDual({}, 'x', ENTRY, 't')).toBe(false);
    expect(registerMaterialShaderDual({ renderer: {} }, 'x', ENTRY, 't')).toBe(false);
    expect(registerMaterialShaderDual({ renderer: { shader: {} } }, 'x', ENTRY, 't')).toBe(false);
  });
});

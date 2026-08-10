#import forgeax_vfx::prelude::{VfxParticle, VfxSpawnContext, VfxUpdateContext, vfx_integrate, vfx_random_spawn}

fn vfx_spawn(ctx: VfxSpawnContext, particle: ptr<function, VfxParticle>) {
  let angle = vfx_random_spawn(ctx, 0u) * 6.2831853;
  let radius = sqrt(vfx_random_spawn(ctx, 1u)) * 1.4;
  let height = (vfx_random_spawn(ctx, 2u) - 0.5) * 3.0;
  (*particle).position = vec4<f32>(cos(angle) * radius, height, sin(angle) * radius, 1.0);
  (*particle).velocity = vec4<f32>(0.0, 0.25 + vfx_random_spawn(ctx, 3u) * 0.9, 0.0, 0.0);
  (*particle).color = vec4<f32>(0.18, 0.78, 1.0, 0.78);
  (*particle).size_rotation = vec4<f32>(0.12, 0.12, 0.0, 0.0);
  (*particle).lifetime = 2.8;
}

fn vfx_update(ctx: VfxUpdateContext, particle: ptr<function, VfxParticle>) {
  let drag = max(0.0, 1.0 - 0.1 * ctx.delta);
  (*particle).velocity = vec4<f32>(
    (*particle).velocity.x * drag,
    ((*particle).velocity.y + 0.06 * ctx.delta) * drag,
    (*particle).velocity.z * drag,
    0.0,
  );
  vfx_integrate(ctx, particle);
  let life = clamp((*particle).age / (*particle).lifetime, 0.0, 1.0);
  let size = mix(0.03, 0.16, min(life * 5.0, 1.0)) * (1.0 - life);
  let rotation = (*particle).size_rotation.z + ctx.delta * 1.4;
  (*particle).size_rotation = vec4<f32>(size, size, rotation, 0.0);
  (*particle).color = vec4<f32>(0.18, 0.72, 1.0, (1.0 - life) * 0.78);
}

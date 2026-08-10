#import forgeax_vfx::prelude::{VfxParticle, VfxSpawnContext, VfxUpdateContext, vfx_integrate, vfx_random_spawn}

fn vfx_spawn(ctx: VfxSpawnContext, particle: ptr<function, VfxParticle>) {
  let angle = vfx_random_spawn(ctx, 0u) * 6.2831853;
  let radius = sqrt(vfx_random_spawn(ctx, 1u)) * 0.55;
  (*particle).position = vec4<f32>(cos(angle) * radius, 0.0, sin(angle) * radius, 1.0);
  (*particle).velocity = vec4<f32>(0.0, 1.4 + vfx_random_spawn(ctx, 2u) * 0.6, 0.0, 0.0);
  (*particle).color = vec4<f32>(1.0, 0.72, 0.2, 1.0);
  (*particle).size_rotation = vec4<f32>(0.28, 0.28, 0.0, 0.0);
  (*particle).lifetime = 0.8;
}

fn vfx_update(ctx: VfxUpdateContext, particle: ptr<function, VfxParticle>) {
  let drag = max(0.0, 1.0 - 0.22 * ctx.delta);
  (*particle).velocity = vec4<f32>(
    (*particle).velocity.x * drag,
    ((*particle).velocity.y - 2.8 * ctx.delta) * drag,
    (*particle).velocity.z * drag,
    0.0,
  );
  vfx_integrate(ctx, particle);
  let life = clamp((*particle).age / (*particle).lifetime, 0.0, 1.0);
  let size = mix(0.28, 0.02, life);
  let rotation = (*particle).size_rotation.z + ctx.delta * 3.0;
  (*particle).size_rotation = vec4<f32>(size, size, rotation, 0.0);
  (*particle).color = vec4<f32>(mix(vec3<f32>(1.0, 0.72, 0.2), vec3<f32>(0.1, 0.05, 1.0), life), 1.0 - life);
}

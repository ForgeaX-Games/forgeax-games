// LiteLLM 网关薄客户端 —— WorldClaw 三级流水线的外部依赖都走这里。
//
// 移植自 WorldClaw 参考实现的 gateway 薄客户端。
// 那份 docstring 说得对：这一层存在的意义是把各条路由踩过的坑封在一处，上面的
// stage 代码不必再关心。三条路由形态各不相同，坑也各不相同，逐条记在下面。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// 网关地址由环境变量提供，不写死在源码里。**在真正发起请求时才校验**——
// 放在模块顶层会把不需要网络的路径（例如 plan-biome 的 --current 纯校准）一并挡住。
const BASE_URL = process.env.FORGEAX_LLM_BASE_URL ?? '';
function gatewayBase(): string {
  if (!BASE_URL) {
    throw new Error('FORGEAX_LLM_BASE_URL 未设置 —— 这些离线工具需要一个 LLM 网关地址；游戏本体运行不需要。');
  }
  return BASE_URL;
}

export const TEXT_MODEL = 'claude-opus-4-8';
export const IMAGE_MODEL = 'gemini-3-pro-image';
export const VISION_MODEL = 'gemini-3.1-pro';
export const GEN3D_MODEL = 'hunyuan-3d-text';

let cachedKey: string | null = null;

export async function apiKey(): Promise<string> {
  if (cachedKey !== null) return cachedKey;
  if (process.env.FORGEAX_LLM_KEY) {
    cachedKey = process.env.FORGEAX_LLM_KEY;
    return cachedKey;
  }
  const wrapper = join(homedir(), '.local/bin/claude');
  const source = await readFile(wrapper, 'utf8');
  const match = source.match(/ANTHROPIC_API_KEY="([^"]*)"/);
  if (!match) throw new Error(`没能从 ${wrapper} 取到 key，且 FORGEAX_LLM_KEY 未设`);
  cachedKey = match[1]!;
  return cachedKey;
}

async function post(path: string, payload: unknown, timeoutMs = 600_000): Promise<any> {
  const response = await fetch(gatewayBase() + path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(`${path} 调用失败 (${response.status}): ${JSON.stringify(data?.error ?? data).slice(0, 400)}`);
  }
  return data;
}

async function get(path: string, timeoutMs = 120_000): Promise<any> {
  const response = await fetch(gatewayBase() + path, {
    headers: { Authorization: `Bearer ${await apiKey()}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(`${path} 失败 (${response.status}): ${JSON.stringify(data?.error ?? data).slice(0, 400)}`);
  }
  return data;
}

// ── 1. 文本 ────────────────────────────────────────────────────────────────

export interface ChatOptions {
  system?: string;
  model?: string;
  images?: Uint8Array[];
  maxTokens?: number;
}

export async function chat(prompt: string, options: ChatOptions = {}): Promise<string> {
  const { system, model = TEXT_MODEL, images, maxTokens = 8192 } = options;
  const content = images && images.length > 0
    ? [
      { type: 'text', text: prompt },
      ...images.map((image) => ({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${Buffer.from(image).toString('base64')}` },
      })),
    ]
    : prompt;
  const messages: unknown[] = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content });
  const data = await post('/v1/chat/completions', { model, messages, max_tokens: maxTokens });
  return data.choices?.[0]?.message?.content ?? '';
}

/** 要求模型只回 JSON。剥 ```json 围栏后解析 —— 模型经常照加不误。 */
export async function chatJson(prompt: string, options: ChatOptions = {}): Promise<any> {
  const raw = await chat(prompt, options);
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```\s*$/, '');
  }
  try {
    return JSON.parse(text);
  } catch {
    const fallback = text.match(/[\[{][\s\S]*[\]}]/)?.[0];
    if (!fallback) throw new Error(`模型没回 JSON，前 400 字:\n${text.slice(0, 400)}`);
    return JSON.parse(fallback);
  }
}

// ── 2. 图像 ────────────────────────────────────────────────────────────────

export async function image(prompt: string, model = IMAGE_MODEL): Promise<Uint8Array> {
  const data = await post('/v1/images/generations', { model, prompt });
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('文生图没返回 b64_json');
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * 图生图 —— 走 chat 多模态路径，不走 /v1/images/edits。
 *
 * gateway.py 记的原因：/v1/images/edits 要 multipart，而 chat 路径接受 data-URI
 * 且同样返回图，对我们更省事。Stage 3 的地形条件化构图正是这条。
 */
export async function imageEdit(
  prompt: string, source: Uint8Array, model = IMAGE_MODEL,
): Promise<Uint8Array> {
  const data = await post('/v1/chat/completions', {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${Buffer.from(source).toString('base64')}` },
        },
      ],
    }],
  });
  const images = data.choices?.[0]?.message?.images ?? [];
  if (images.length === 0) {
    throw new Error('图生图没返回图片（可能被模型当成纯文本问题回答了）');
  }
  const first = images[0];
  const url = typeof first.image_url === 'object' ? first.image_url.url : first.image_url;
  return new Uint8Array(Buffer.from(String(url).split(',', 2)[1]!, 'base64'));
}

// ── 3. 3D ──────────────────────────────────────────────────────────────────
//
// gateway.py 记在案的三条坑（2026-08-07 实测），本机 2026-08-10 复验仍然成立：
//   1. 走不了 /v1/chat/completions —— 报 Unmapped LLM provider
//   2. 取结果是 /v1/3d/tasks/{id}，不是 /v1/3d/generations/{id}（404）
//   3. 终态是 "succeeded" 不是 "completed" —— 只判 completed 会死循环
// 且 image_url 必须公网可达，data-URI 会在**执行阶段**才失败（建任务时照收）。

const TERMINAL = new Set(['succeeded', 'completed', 'failed']);

export async function gen3d(
  params: Record<string, unknown>,
  { model = GEN3D_MODEL, pollMs = 10_000, timeoutMs = 1_800_000 } = {},
): Promise<any> {
  const task = await post('/v1/3d/generations', { model, ...params });
  const id = task.id;
  if (!id) throw new Error(`3D 建任务没返回 id: ${JSON.stringify(task).slice(0, 300)}`);
  const started = Date.now();
  for (;;) {
    const data = await get(`/v1/3d/tasks/${id}`);
    const status = data.status;
    if (TERMINAL.has(status)) {
      if (status === 'failed') throw new Error(`3D 生成失败: ${JSON.stringify(data.error)}`);
      return data;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`3D 任务 ${id} 超过 ${Math.round(timeoutMs / 1000)}s 仍是 ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export function pickFormat(result: any, format: string): string | null {
  for (const item of result?.data ?? []) {
    if (item?.format === format) return item.url;
  }
  return null;
}

export async function download(url: string, dest: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  if (!response.ok) throw new Error(`下载失败 ${response.status}: ${url}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await response.arrayBuffer()));
  return dest;
}

export async function savePng(bytes: Uint8Array, dest: string): Promise<string> {
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
  return dest;
}

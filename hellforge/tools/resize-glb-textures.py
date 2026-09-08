#!/usr/bin/env python3
"""Resize embedded GLB textures. Does not upscale. PNG stays PNG (normals)."""
from __future__ import annotations

import io
import json
import os
import struct
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ORIG = ROOT / ".forgeax-asset-cache" / "original-keep-glb"
# Native 2K snapshot: git tag hellforge-textures-2k-20260813 (games #100 / 3224653).
TWO_K_REF = "hellforge-textures-2k-20260813"
SKIP_SUBSTR = ("characterw-merged",)

# Cook-budget cap. Never upscale (witch / Kenney monsters stay 512).
def max_edge_for(rel: str) -> int:
    return 1024


def parse_glb(data: bytes) -> tuple[dict, bytes]:
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise ValueError("not glb")
    off = 12
    json_bytes = b"{}"
    bin_bytes = b""
    while off + 8 <= length:
        chunk_len, chunk_type = struct.unpack_from("<I4s", data, off)
        off += 8
        chunk = data[off : off + chunk_len]
        off += chunk_len
        if chunk_type == b"JSON":
            json_bytes = chunk.rstrip(b"\x00")
        elif chunk_type == b"BIN\x00":
            bin_bytes = chunk
    return json.loads(json_bytes), bin_bytes


def write_glb(doc: dict, bin_bytes: bytes) -> bytes:
    json_bytes = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    while len(json_bytes) % 4:
        json_bytes += b" "
    while len(bin_bytes) % 4:
        bin_bytes += b"\x00"
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    out = bytearray()
    out += struct.pack("<4sII", b"glTF", 2, total)
    out += struct.pack("<I4s", len(json_bytes), b"JSON")
    out += json_bytes
    out += struct.pack("<I4s", len(bin_bytes), b"BIN\x00")
    out += bin_bytes
    return bytes(out)


def buffer_view_slice(doc: dict, bin_bytes: bytes, view_idx: int) -> bytes:
    view = doc["bufferViews"][view_idx]
    start = view.get("byteOffset", 0)
    return bin_bytes[start : start + view["byteLength"]]


def resize_image_bytes(raw: bytes, mime: str, max_edge: int) -> tuple[bytes, str, tuple[int, int], tuple[int, int]]:
    im = Image.open(io.BytesIO(raw))
    w, h = im.size
    edge = max(w, h)
    if edge <= max_edge:
        return raw, mime, (w, h), (w, h)
    scale = max_edge / edge
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    if mime == "image/jpeg":
        if im.mode != "RGB":
            im = im.convert("RGB")
        im.save(buf, format="JPEG", quality=92, optimize=True)
        out_mime = "image/jpeg"
    else:
        if im.mode not in ("RGBA", "RGB", "L", "LA"):
            im = im.convert("RGBA")
        im.save(buf, format="PNG", optimize=True)
        out_mime = "image/png"
    return buf.getvalue(), out_mime, (w, h), (nw, nh)


def resize_glb(src: bytes, max_edge: int) -> tuple[bytes, list[str]]:
    doc, bin_bytes = parse_glb(src)
    images = doc.get("images") or []
    if not images:
        return src, []
    views = doc.get("bufferViews") or []
    notes = []
    new_chunks: list[bytes] = []
    new_views = []
    # Rebuild BIN: keep non-image views, replace image views.
    image_view_idxs = set()
    for img in images:
        if "bufferView" in img:
            image_view_idxs.add(img["bufferView"])
    cursor = 0
    view_remap: dict[int, int] = {}
    for i, view in enumerate(views):
        if i in image_view_idxs:
            continue
        sl = buffer_view_slice(doc, bin_bytes, i)
        pad = (4 - (len(sl) % 4)) % 4
        new_views.append({
            **{k: v for k, v in view.items() if k != "byteOffset"},
            "buffer": 0,
            "byteOffset": cursor,
            "byteLength": len(sl),
        })
        view_remap[i] = len(new_views) - 1
        new_chunks.append(sl + b"\x00" * pad)
        cursor += len(sl) + pad
    for img in images:
        if "uri" in img and not img["uri"].startswith("data:"):
            notes.append(f"skip external uri {img['uri']}")
            continue
        mime = img.get("mimeType") or "image/png"
        raw = buffer_view_slice(doc, bin_bytes, img["bufferView"]) if "bufferView" in img else b""
        if not raw:
            notes.append("empty image")
            continue
        new_raw, out_mime, before, after = resize_image_bytes(raw, mime, max_edge)
        notes.append(f"{before[0]}x{before[1]} -> {after[0]}x{after[1]} {out_mime}")
        pad = (4 - (len(new_raw) % 4)) % 4
        new_views.append({
            "buffer": 0,
            "byteOffset": cursor,
            "byteLength": len(new_raw),
        })
        img["bufferView"] = len(new_views) - 1
        img["mimeType"] = out_mime
        img.pop("uri", None)
        new_chunks.append(new_raw + b"\x00" * pad)
        cursor += len(new_raw) + pad
    # Remap accessors that pointed at kept views
    for acc in doc.get("accessors") or []:
        if "bufferView" in acc and acc["bufferView"] in view_remap:
            acc["bufferView"] = view_remap[acc["bufferView"]]
    for img in images:
        # already rewritten
        pass
    doc["bufferViews"] = new_views
    doc["buffers"] = [{"byteLength": cursor}]
    return write_glb(doc, b"".join(new_chunks)), notes


def load_source(rel: str) -> bytes | None:
    orig = ORIG / rel
    if orig.is_file():
        return orig.read_bytes()
    for ref in (TWO_K_REF, "HEAD"):
        try:
            return subprocess.check_output(
                ["git", "show", f"{ref}:hellforge/{rel}"],
                cwd=ROOT.parent,
                stderr=subprocess.DEVNULL,
            )
        except subprocess.CalledProcessError:
            continue
    live = ROOT / rel
    return live.read_bytes() if live.is_file() else None


def main() -> int:
    targets: list[Path] = []
    for p in ASSETS.rglob("*.glb"):
        rel = str(p.relative_to(ROOT))
        if any(s in rel for s in SKIP_SUBSTR):
            print(f"SKIP {rel}")
            continue
        targets.append(p)
    print(f"targets {len(targets)}")
    changed = 0
    for p in sorted(targets):
        rel = str(p.relative_to(ROOT))
        src = load_source(rel)
        if src is None:
            print(f"NO_SRC {rel}")
            continue
        max_edge = max_edge_for(rel)
        try:
            out, notes = resize_glb(src, max_edge)
        except Exception as e:
            print(f"FAIL {rel}: {e}")
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        if out != p.read_bytes() if p.exists() else True:
            p.write_bytes(out)
            changed += 1
        kb = len(out) / 1024
        print(f"OK {rel} max={max_edge} {kb:.0f}KB | {'; '.join(notes[:6])}")
    print(f"wrote {changed}/{len(targets)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

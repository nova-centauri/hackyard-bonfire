#!/usr/bin/env python3
"""Bake Grok Imagine sources into the authored texture set in docs/textures.md.

Normals are OpenGL tangent-space, wrap-aware Sobel from height. AI cannot emit
valid normals; this bake is the mapping pass.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(__file__).resolve().parent / "sources"
OUT = ROOT / "public" / "textures"
PREV = Path(__file__).resolve().parent / "previews"


def load_rgb(path: Path) -> np.ndarray:
    im = Image.open(path).convert("RGB")
    return np.asarray(im, dtype=np.float32) / 255.0


def lum(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def to_img(arr: np.ndarray, mode: str = "RGB") -> Image.Image:
    arr = np.clip(arr, 0, 1)
    if arr.ndim == 2:
        arr = np.stack([arr, arr, arr], axis=-1)
    if mode == "L":
        return Image.fromarray((arr[..., 0] * 255).astype(np.uint8), "L")
    if mode == "RGBA":
        return Image.fromarray((arr * 255).astype(np.uint8), "RGBA")
    return Image.fromarray((arr[..., :3] * 255).astype(np.uint8), "RGB")


def resize(arr: np.ndarray, size: int, resample=Image.Resampling.LANCZOS) -> np.ndarray:
    im = to_img(arr, "RGBA" if arr.shape[-1] == 4 else "RGB")
    im = im.resize((size, size), resample)
    out = np.asarray(im, dtype=np.float32) / 255.0
    if arr.ndim == 2 or (arr.ndim == 3 and arr.shape[-1] == 1):
        return out[..., 0]
    if arr.shape[-1] == 4:
        return out
    return out[..., :3]


def wrap_pad(arr: np.ndarray, pad: int, wrap_x: bool, wrap_y: bool) -> np.ndarray:
    y_mode = "wrap" if wrap_y else "edge"
    x_mode = "wrap" if wrap_x else "edge"
    if arr.ndim == 2:
        padded = np.pad(arr, ((0, 0), (pad, pad)), mode=x_mode)
        return np.pad(padded, ((pad, pad), (0, 0)), mode=y_mode)
    padded = np.pad(arr, ((0, 0), (pad, pad), (0, 0)), mode=x_mode)
    return np.pad(padded, ((pad, pad), (0, 0), (0, 0)), mode=y_mode)


def gaussian(arr: np.ndarray, radius: float, wrap_x: bool = False, wrap_y: bool = False) -> np.ndarray:
    pad = int(radius * 3) + 2
    padded = wrap_pad(arr, pad, wrap_x, wrap_y)
    im = to_img(padded, "RGB")
    blurred = np.asarray(im.filter(ImageFilter.GaussianBlur(radius=radius)), dtype=np.float32) / 255.0
    cropped = blurred[pad:-pad, pad:-pad]
    if arr.ndim == 2:
        return cropped[..., 0]
    return cropped[..., : arr.shape[-1]]


def flatten_light(rgb: np.ndarray, radius: float, wrap_x: bool, wrap_y: bool, amount: float = 0.7) -> np.ndarray:
    blur = gaussian(rgb, radius, wrap_x, wrap_y)
    mean = np.mean(blur, axis=(0, 1), keepdims=True)
    gain = np.clip(mean / (blur + 1e-3), 0.45, 2.2)
    flat = np.clip(rgb * gain, 0, 1)
    return rgb * (1 - amount) + flat * amount


def grade_mean(rgb: np.ndarray, target, amount: float) -> np.ndarray:
    target = np.asarray(target, dtype=np.float32)
    mean = rgb.mean(axis=(0, 1))
    shifted = rgb - mean + target
    return np.clip(rgb * (1 - amount) + shifted * amount, 0, 1)


def edge_blend(arr: np.ndarray, wrap_x: bool, wrap_y: bool, frac: float = 0.04) -> np.ndarray:
    """Gently average opposite edges so a wrap does not flash a hard line."""
    out = arr.astype(np.float32).copy()
    h, w = out.shape[:2]
    if wrap_x:
        bw = max(4, int(w * frac))
        t = (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, bw))).reshape((1, bw) + (1,) * (out.ndim - 2))
        left, right = out[:, :bw].copy(), out[:, -bw:].copy()
        mix = 0.35
        out[:, :bw] = left * (1 - t * mix) + right * (t * mix)
        out[:, -bw:] = right * (1 - t[:, ::-1] * mix) + left * (t[:, ::-1] * mix)
    if wrap_y:
        bh = max(4, int(h * frac))
        t = (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, bh))).reshape((bh, 1) + (1,) * (out.ndim - 2))
        top, bottom = out[:bh].copy(), out[-bh:].copy()
        mix = 0.35
        out[:bh] = top * (1 - t * mix) + bottom * (t * mix)
        out[-bh:] = bottom * (1 - t[::-1] * mix) + top * (t[::-1] * mix)
    return np.clip(out, 0, 1)


def height_to_normal(height: np.ndarray, strength: float, wrap_x: bool, wrap_y: bool) -> np.ndarray:
    h = height.astype(np.float32)
    if wrap_x:
        dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    else:
        dx = np.zeros_like(h)
        dx[:, 1:-1] = (h[:, 2:] - h[:, :-2]) * 0.5
        dx[:, 0] = h[:, 1] - h[:, 0]
        dx[:, -1] = h[:, -1] - h[:, -2]
    if wrap_y:
        dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    else:
        dy = np.zeros_like(h)
        dy[1:-1] = (h[2:] - h[:-2]) * 0.5
        dy[0] = h[1] - h[0]
        dy[-1] = h[-1] - h[-2]
    # Image y is down. OpenGL green is +Y (up in UV). With three.js flipY, invert dy.
    nx = -dx * strength
    ny = dy * strength
    nz = np.ones_like(h)
    n = np.stack([nx, ny, nz], axis=-1)
    n /= np.sqrt(np.sum(n * n, axis=-1, keepdims=True)) + 1e-8
    return np.clip(n * 0.5 + 0.5, 0, 1)


def radial_coords(size: int):
    y, x = np.mgrid[0:size, 0:size]
    cx = cy = (size - 1) / 2
    r = np.hypot(x - cx, y - cy) / (size / 2)
    return r


def save_webp(arr: np.ndarray, path: Path, quality: int = 90) -> None:
    to_img(arr).save(path, "WEBP", quality=quality, method=6)


def save_png(arr: np.ndarray, path: Path, mode: str = "RGB") -> None:
    im = to_img(arr, mode)
    im.save(path, "PNG", optimize=True, compress_level=9)


def tile_preview(arr: np.ndarray, path: Path, nx: int = 2, ny: int = 2) -> None:
    im = to_img(arr)
    w, h = im.size
    sheet = Image.new("RGB", (w * nx, h * ny))
    for y in range(ny):
        for x in range(nx):
            sheet.paste(im, (x * w, y * h))
    sheet.resize((min(1024, sheet.width), min(1024, sheet.height)), Image.Resampling.LANCZOS).save(path)


def bark():
    albedo = load_rgb(SRC / "bark-albedo.png")
    height_src = lum(load_rgb(SRC / "bark-height.png"))
    emissive_src = lum(load_rgb(SRC / "bark-emissive.png"))

    albedo = flatten_light(albedo, 90, True, False, 0.45)
    albedo = grade_mean(albedo, (0.133, 0.102, 0.071), 0.55)
    albedo = np.clip(albedo * 0.92, 0, 1)

    height = 0.72 * (height_src - height_src.min()) / (height_src.max() - height_src.min() + 1e-6)
    micro = lum(albedo)
    micro = (micro - micro.min()) / (micro.max() - micro.min() + 1e-6)
    height = np.clip(height + 0.28 * micro, 0, 1)

    albedo = edge_blend(albedo, True, False, 0.035)
    height = edge_blend(np.stack([height] * 3, -1), True, False, 0.035)[..., 0]

    albedo2048 = resize(albedo, 2048)
    height2048 = resize(np.stack([height] * 3, -1), 2048)[..., 0]
    height2048 = gaussian(height2048, 0.85, True, False)
    normal = height_to_normal(height2048, strength=9.5, wrap_x=True, wrap_y=False)

    em = np.clip((emissive_src - 0.08) / 0.8, 0, 1)
    em = em ** 1.15
    v = np.linspace(0, 1, em.shape[0])[:, None]
    em *= np.sin(np.pi * v) ** 1.35
    em = edge_blend(np.stack([em] * 3, -1), True, False, 0.035)[..., 0]
    em = resize(np.stack([em] * 3, -1), 1024)[..., 0]

    save_webp(albedo2048, OUT / "bark-albedo.webp", 88)
    save_png(normal, OUT / "bark-normal.png")
    save_png(np.stack([em, em * 0.12, em * 0.02], -1), OUT / "bark-emissive.png")
    tile_preview(albedo2048, PREV / "bark-albedo-tiled.png", 2, 1)
    tile_preview(normal, PREV / "bark-normal.png", 2, 1)
    return "bark"


def end_grain():
    albedo = load_rgb(SRC / "end-albedo.png")
    height_src = lum(load_rgb(SRC / "end-height.png"))
    albedo = flatten_light(albedo, 70, False, False, 0.4)
    albedo = grade_mean(albedo, (0.525, 0.416, 0.278), 0.35)

    r = radial_coords(albedo.shape[0])
    rim = np.clip((r - 0.97) / 0.03, 0, 1)[..., None]
    mean = albedo.mean(axis=(0, 1), keepdims=True)
    albedo = albedo * (1 - rim) + mean * rim

    height = (height_src - height_src.min()) / (height_src.max() - height_src.min() + 1e-6)
    height = height * (1 - rim[..., 0]) + 0.5 * rim[..., 0]

    albedo1024 = resize(albedo, 1024)
    height1024 = resize(np.stack([height] * 3, -1), 1024)[..., 0]
    r1024 = radial_coords(1024)
    rim1024 = np.clip((r1024 - 0.97) / 0.03, 0, 1)
    normal = height_to_normal(height1024, strength=4.2, wrap_x=False, wrap_y=False)
    flat = np.array([0.5, 0.5, 1.0])
    normal = normal * (1 - rim1024[..., None]) + flat * rim1024[..., None]

    inv = 1 - height1024
    checks = np.clip((inv - 0.62) / 0.22, 0, 1) ** 1.6
    checks *= (1 - rim1024)
    checks = resize(np.stack([checks] * 3, -1), 512)[..., 0]

    save_webp(albedo1024, OUT / "end-albedo.webp", 90)
    save_png(normal, OUT / "end-normal.png")
    save_png(np.stack([checks, checks * 0.18, checks * 0.02], -1), OUT / "end-emissive.png")
    tile_preview(albedo1024, PREV / "end-albedo.png", 1, 1)
    return "endGrain"


def exposed():
    albedo = load_rgb(SRC / "exposed-albedo.png")
    albedo = flatten_light(albedo, 80, False, True, 0.35)
    albedo = grade_mean(albedo, (0.584, 0.463, 0.306), 0.4)
    albedo = edge_blend(albedo, False, True, 0.045)
    height = lum(albedo)
    height = (height - height.min()) / (height.max() - height.min() + 1e-6)
    height = edge_blend(np.stack([height] * 3, -1), False, True, 0.045)[..., 0]
    albedo1024 = resize(albedo, 1024)
    height1024 = resize(np.stack([height] * 3, -1), 1024)[..., 0]
    normal = height_to_normal(height1024, strength=3.4, wrap_x=False, wrap_y=True)
    save_webp(albedo1024, OUT / "exposed-albedo.webp", 90)
    save_png(normal, OUT / "exposed-normal.png")
    tile_preview(albedo1024, PREV / "exposed-albedo-tiled.png", 1, 2)
    return "exposedWood"


def soil():
    albedo = load_rgb(SRC / "soil-albedo.png")
    albedo = flatten_light(albedo, 70, True, True, 0.35)
    sat = lum(albedo)[..., None]
    albedo = albedo * 0.55 + sat * 0.45
    albedo = grade_mean(albedo, (0.38, 0.36, 0.33), 0.45)
    albedo = edge_blend(albedo, True, True, 0.03)
    height = lum(albedo)
    height = (height - np.percentile(height, 2)) / (np.percentile(height, 98) - np.percentile(height, 2) + 1e-6)
    height = np.clip(height, 0, 1)
    height = edge_blend(np.stack([height] * 3, -1), True, True, 0.03)[..., 0]
    albedo2048 = resize(albedo, 2048)
    albedo2048 = gaussian(albedo2048, 0.7, True, True) * 0.55 + albedo2048 * 0.45
    height2048 = gaussian(resize(np.stack([height] * 3, -1), 2048)[..., 0], 2.2, True, True)
    normal = height_to_normal(height2048, strength=4.6, wrap_x=True, wrap_y=True)
    save_webp(albedo2048, OUT / "soil-albedo.webp", 86)
    save_png(normal, OUT / "soil-normal.png")
    tile_preview(albedo2048, PREV / "soil-albedo-tiled.png", 2, 2)
    return "soil"


def smoke():
    rgb = load_rgb(SRC / "smoke-puff.png")
    alpha = np.clip((lum(rgb) - 0.012) / 0.55, 0, 1)
    alpha = np.clip(alpha ** 0.9, 0, 1)
    size = rgb.shape[0]
    r = radial_coords(size)
    alpha *= np.clip(1 - np.clip((r - 0.62) / 0.34, 0, 1) ** 1.6, 0, 1)
    white = np.ones_like(alpha)
    rgba = np.dstack([white, white, white, alpha])
    rgba = resize(rgba, 512)
    rgba[..., :3] = 1.0
    save_png(rgba, OUT / "smoke-puff.png", "RGBA")
    checker = (np.indices((512, 512)) // 16).sum(axis=0) % 2
    checker = np.where(checker[..., None], 0.22, 0.78)
    a = rgba[..., 3:4]
    prev = rgba[..., :3] * a + checker * (1 - a)
    to_img(prev).save(PREV / "smoke-puff.png")
    return "smokePuff"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    PREV.mkdir(parents=True, exist_ok=True)
    for name, fn in [
        ("bark", bark),
        ("endGrain", end_grain),
        ("exposedWood", exposed),
        ("soil", soil),
        ("smokePuff", smoke),
    ]:
        fn()
        print("baked", name)
    print("\noutputs:")
    total = 0
    for p in sorted(OUT.iterdir()):
        total += p.stat().st_size
        print(f"  {p.name:24s} {p.stat().st_size / 1024:8.1f} KB")
    print(f"  total {total / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()

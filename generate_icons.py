"""Generate simple Box-blue PNG icons without third-party libraries."""
from __future__ import annotations

import pathlib
import struct
import zlib

ROOT = pathlib.Path(__file__).resolve().parent
ICON_DIR = ROOT / "icons"
BLUE = (0, 97, 213)
WHITE = (255, 255, 255)
NAVY = (26, 39, 51)


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: pathlib.Path, size: int) -> None:
    rows = []
    radius = size * 0.22
    pad = size * 0.18
    for y in range(size):
        row = bytearray()
        for x in range(size):
            color = BLUE if inside_round_rect(x, y, size, radius) else NAVY
            if inside_document(x, y, size, pad):
                color = WHITE
            if inside_spark(x, y, size):
                color = WHITE
            row += bytes(color)
        rows.append(b"\x00" + row)
    raw = b"".join(rows)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def inside_round_rect(x: float, y: float, size: int, radius: float) -> bool:
    inset = size * 0.06
    left, top, right, bottom = inset, inset, size - inset, size - inset
    if x < left or x > right or y < top or y > bottom:
        return False
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    if abs(x - cx) <= radius and abs(y - cy) <= radius:
        return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
    return True


def inside_document(x: float, y: float, size: int, pad: float) -> bool:
    left, top = pad + size * 0.08, pad
    right, bottom = size - pad, size - pad * 0.85
    fold = size * 0.12
    if x < left or x > right or y < top or y > bottom:
        return False
    if x > right - fold and y < top + fold:
        return (x - (right - fold)) + (y - top) >= fold
    # text lines
    if left + size * 0.08 < x < right - size * 0.18:
        for i, line_y in enumerate((0.42, 0.54, 0.66)):
            ly = size * line_y
            if abs(y - ly) < size * 0.025 and (i < 2 or x < right - size * 0.28):
                return False
    return True


def inside_spark(x: float, y: float, size: int) -> bool:
    cx, cy = size * 0.78, size * 0.24
    dx, dy = abs(x - cx), abs(y - cy)
    arm = size * 0.09
    thick = size * 0.018
    return (dx < thick and dy < arm) or (dy < thick and dx < arm)


def main() -> None:
    ICON_DIR.mkdir(exist_ok=True)
    for size in (16, 32, 48, 128):
        write_png(ICON_DIR / f"icon{size}.png", size)
        print(f"wrote icon{size}.png")


if __name__ == "__main__":
    main()

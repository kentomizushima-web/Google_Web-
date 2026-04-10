#!/usr/bin/env python3
"""Generate simple PNG icons for the extension using only stdlib."""
import struct
import zlib
import os

def create_png(size, color=(26, 115, 232)):
    """Create a solid-color square PNG with a search icon overlay."""
    r, g, b = color

    # Simple icon: solid background with white magnifying glass shape
    pixels = []
    cx, cy = size // 2, size // 2
    radius = int(size * 0.28)
    line_width = max(1, size // 12)
    handle_len = int(size * 0.18)

    for y in range(size):
        row = []
        for x in range(size):
            dx = x - cx + size // 10
            dy = y - cy + size // 10

            # Circle ring
            dist = (dx * dx + dy * dy) ** 0.5
            in_circle = abs(dist - radius) < line_width

            # Handle (diagonal line from bottom-right of circle)
            hx = cx + int(radius * 0.7) - size // 10
            hy = cy + int(radius * 0.7) - size // 10
            # line from (hx, hy) at 45 degrees
            px, py = x - hx, y - hy
            in_handle = (0 <= px <= handle_len and
                         0 <= py <= handle_len and
                         abs(px - py) < line_width)

            if in_circle or in_handle:
                row.extend([255, 255, 255, 255])  # white with full alpha
            else:
                row.extend([r, g, b, 255])  # background color

        pixels.append(bytes(row))

    # Build PNG
    def png_chunk(name, data):
        c = zlib.crc32(name + data) & 0xFFFFFFFF
        return struct.pack('>I', len(data)) + name + data + struct.pack('>I', c)

    raw = b''
    for row in pixels:
        raw += b'\x00' + row  # filter type 0 (None)

    compressed = zlib.compress(raw, 9)

    ihdr_data = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    # RGBA = color type 6, bit depth 8
    ihdr_data = struct.pack('>II', size, size) + bytes([8, 6, 0, 0, 0])

    png = b'\x89PNG\r\n\x1a\n'
    png += png_chunk(b'IHDR', ihdr_data)
    png += png_chunk(b'IDAT', compressed)
    png += png_chunk(b'IEND', b'')
    return png


script_dir = os.path.dirname(os.path.abspath(__file__))
for size in [16, 48, 128]:
    data = create_png(size)
    path = os.path.join(script_dir, f'icon{size}.png')
    with open(path, 'wb') as f:
        f.write(data)
    print(f'Created {path} ({size}x{size})')

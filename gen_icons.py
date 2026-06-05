import struct
import zlib
import os

base = "/Users/anyan/Documents/编程/浏览器插件/prototype-annotator/icons"

def create_png(width, height, pixels):
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc

    header = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    raw = b''
    for y in range(height):
        raw += b'\x00'
        for x in range(width):
            idx = (y * width + x) * 4
            raw += bytes(pixels[idx:idx+4])
    compressed = zlib.compress(raw)
    idat = chunk(b'IDAT', compressed)
    iend = chunk(b'IEND', b'')
    return header + ihdr + idat + iend

def make_icon(size, bg_r, bg_g, bg_b):
    pixels = [0] * (size * size * 4)
    cx, cy = size / 2, size / 2
    radius = size * 0.42
    for y in range(size):
        for x in range(size):
            dx, dy = x - cx, y - cy
            dist = (dx * dx + dy * dy) ** 0.5
            idx = (y * size + x) * 4
            if dist <= radius:
                pixels[idx] = bg_r
                pixels[idx+1] = bg_g
                pixels[idx+2] = bg_b
                pixels[idx+3] = 255
            else:
                pixels[idx+3] = 0
    return create_png(size, size, pixels)

configs = [
    ("icon_default.png", 128, 120, 120, 120),
    ("icon_default_48.png", 48, 120, 120, 120),
    ("icon_default_32.png", 32, 120, 120, 120),
    ("icon_default_16.png", 16, 120, 120, 120),
    ("icon_active.png", 128, 220, 50, 50),
    ("icon_active_48.png", 48, 220, 50, 50),
    ("icon_active_32.png", 32, 220, 50, 50),
    ("icon_active_16.png", 16, 220, 50, 50),
    ("icon_inactive.png", 128, 50, 160, 80),
    ("icon_inactive_48.png", 48, 50, 160, 80),
    ("icon_inactive_32.png", 32, 50, 160, 80),
    ("icon_inactive_16.png", 16, 50, 160, 80),
]

for name, size, r, g, b in configs:
    data = make_icon(size, r, g, b)
    with open(os.path.join(base, name), 'wb') as f:
        f.write(data)

print("Icons created successfully")
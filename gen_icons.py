"""Generate PWA icons (icon-192.png, icon-512.png, apple-touch-icon.png) using stdlib only."""
import struct, zlib, math, os

BG   = (11,  14,  24)   # #0b0e18
BLUE = (79, 124, 255)   # #4f7cff

def clamp(v, lo=0, hi=255):
    return max(lo, min(hi, v))

def blend(fg, bg, alpha):
    a = max(0.0, min(1.0, alpha))
    return (clamp(int(fg[0]*a + bg[0]*(1-a))),
            clamp(int(fg[1]*a + bg[1]*(1-a))),
            clamp(int(fg[2]*a + bg[2]*(1-a))))

def draw_ring(buf, W, cx, cy, r, lw, color):
    margin = int(r + lw + 2)
    for y in range(max(0, int(cy)-margin), min(W, int(cy)+margin+1)):
        for x in range(max(0, int(cx)-margin), min(W, int(cx)+margin+1)):
            d = abs(math.sqrt((x-cx)**2 + (y-cy)**2) - r)
            alpha = min(1.0, max(0.0, lw/2 + 1 - d))
            if alpha > 0:
                buf[y*W+x] = blend(color, buf[y*W+x], alpha)

def draw_disk(buf, W, cx, cy, r, color):
    for y in range(max(0, int(cy-r)-1), min(W, int(cy+r)+2)):
        for x in range(max(0, int(cx-r)-1), min(W, int(cx+r)+2)):
            d = math.sqrt((x-cx)**2 + (y-cy)**2)
            alpha = min(1.0, max(0.0, r+1-d))
            if alpha > 0:
                buf[y*W+x] = blend(color, buf[y*W+x], alpha)

def draw_line(buf, W, x1, y1, x2, y2, lw, color):
    dx, dy = x2-x1, y2-y1
    length = math.sqrt(dx*dx + dy*dy)
    if length < 0.01:
        draw_disk(buf, W, x1, y1, lw/2, color)
        return
    margin = int(lw/2 + 2)
    for y in range(max(0, int(min(y1,y2))-margin), min(W, int(max(y1,y2))+margin+1)):
        for x in range(max(0, int(min(x1,x2))-margin), min(W, int(max(x1,x2))+margin+1)):
            t = max(0.0, min(1.0, ((x-x1)*dx + (y-y1)*dy) / (length*length)))
            px, py = x1+t*dx, y1+t*dy
            d = math.sqrt((x-px)**2 + (y-py)**2)
            alpha = min(1.0, max(0.0, lw/2 + 1 - d))
            if alpha > 0:
                buf[y*W+x] = blend(color, buf[y*W+x], alpha)

def make_png(W, buf):
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', W, W, 8, 2, 0, 0, 0)
    raw = bytearray()
    for y in range(W):
        raw += b'\x00'
        for x in range(W):
            r, g, b = buf[y*W+x]
            raw += bytes([r, g, b])
    return (b'\x89PNG\r\n\x1a\n' +
            chunk(b'IHDR', ihdr) +
            chunk(b'IDAT', zlib.compress(bytes(raw), 9)) +
            chunk(b'IEND', b''))

def generate(W):
    s = W / 192.0
    buf = [BG] * (W * W)

    lw  = max(1.5, 3.0*s)   # frame tube width
    rw  = max(1.5, 2.5*s)   # rim width
    sw  = max(1.0, 1.5*s)   # spoke width

    # Key coordinates
    lwx, lwy, lwr = 50*s, 122*s, 42*s   # rear wheel
    rwx, rwy, rwr = 142*s, 122*s, 42*s  # front wheel
    bbx, bby = 88*s, 122*s              # bottom bracket
    scx, scy = 80*s,  66*s              # seat cluster
    htx, hty = 130*s, 70*s             # head tube

    # Wheels
    draw_ring(buf, W, lwx, lwy, lwr, rw, BLUE)
    draw_ring(buf, W, rwx, rwy, rwr, rw, BLUE)

    # Spokes — rear wheel (every 60°, starting vertical)
    for i in range(6):
        a = math.radians(i*60 - 90)
        sx = lwx + (lwr - rw - 1) * math.cos(a)
        sy = lwy + (lwr - rw - 1) * math.sin(a)
        draw_line(buf, W, lwx, lwy, sx, sy, sw, BLUE)
    # Spokes — front wheel (offset 30°)
    for i in range(6):
        a = math.radians(i*60 - 60)
        sx = rwx + (rwr - rw - 1) * math.cos(a)
        sy = rwy + (rwr - rw - 1) * math.sin(a)
        draw_line(buf, W, rwx, rwy, sx, sy, sw, BLUE)

    # Hubs
    draw_disk(buf, W, lwx, lwy, lw*1.2, BLUE)
    draw_disk(buf, W, rwx, rwy, lw*1.2, BLUE)
    draw_disk(buf, W, bbx, bby, lw*1.2, BLUE)

    # Frame tubes
    draw_line(buf, W, bbx, bby, lwx, lwy,  lw*1.8, BLUE)  # chain stays
    draw_line(buf, W, scx, scy, lwx, lwy,  lw*1.4, BLUE)  # seat stays
    draw_line(buf, W, bbx, bby, scx, scy,  lw*1.8, BLUE)  # seat tube
    draw_line(buf, W, scx, scy, htx, hty,  lw*1.8, BLUE)  # top tube
    draw_line(buf, W, htx, hty, bbx, bby,  lw*1.8, BLUE)  # down tube
    draw_line(buf, W, htx, hty, rwx, rwy,  lw*1.4, BLUE)  # fork

    # Saddle
    draw_line(buf, W, (scx-12*s), (scy-7*s), (scx+12*s), (scy-7*s), lw*1.6, BLUE)
    # Handlebars
    draw_line(buf, W, (htx-10*s), (hty-8*s), (htx+4*s), (hty-8*s), lw*1.6, BLUE)

    return buf

os.makedirs('icons', exist_ok=True)
for size, name in [(192, 'icons/icon-192.png'), (512, 'icons/icon-512.png'), (180, 'icons/apple-touch-icon.png')]:
    print(f'Generating {name} ({size}×{size})...', flush=True)
    buf = generate(size)
    data = make_png(size, buf)
    with open(name, 'wb') as f:
        f.write(data)
    print(f'  → {len(data):,} bytes', flush=True)
print('Done.')

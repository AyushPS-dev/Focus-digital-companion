import math
import struct
import zlib
import os

def make_png(width, height, rgba_data):
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw.extend(rgba_data[y * width * 4 : (y + 1) * width * 4])
    idat = zlib.compress(bytes(raw), 9)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

def sd_rounded_box(px, py, bx, by, r):
    qx = abs(px) - bx + r
    qy = abs(py) - by + r
    return min(max(qx, qy), 0.0) + math.sqrt(max(qx, 0.0)**2 + max(qy, 0.0)**2) - r

def render_icon(size):
    # Palette
    # Container background: Deep Navy-Indigo
    bg_top = (22, 28, 52)
    bg_bot = (12, 16, 32)
    
    # Crisp outer border
    border_color = (124, 92, 255)      # #7c5cff
    border_subtle = (90, 75, 180)     # #5a4bb4
    
    # F symbol primary (Stem + Top bar): Pure Crisp White
    f_white = (255, 255, 255)
    
    # F symbol accent (Middle bar): Vibrant Lavender/Violet
    f_accent = (167, 139, 250)         # #a78bfa
    
    half = size / 2.0
    
    # Container dimensions
    pad = max(1.0, size * 0.05)
    box_w = half - pad
    box_h = half - pad
    box_r = size * 0.22
    border_thick = max(1.0, size * 0.035)

    # Let's set up the F proportions centered nicely in the container
    # Total width of F is from x_left to x_top_right
    x_left = -half * 0.40
    stem_w = half * 0.26
    x_stem_right = x_left + stem_w
    
    y_top = half * 0.52
    y_bot = -half * 0.52
    
    top_bar_h = stem_w * 0.90
    y_top_inner = y_top - top_bar_h
    x_top_right = half * 0.46
    
    # Middle bar
    mid_bar_h = stem_w * 0.82
    y_mid_center = half * 0.04
    y_mid_top = y_mid_center + mid_bar_h / 2.0
    y_mid_bot = y_mid_center - mid_bar_h / 2.0
    x_mid_right = half * 0.28
    
    # Fillet radius for the F glyph
    r_f = max(0.6, size * 0.035)

    # Stem box (unrounded core)
    # top box (unrounded core)
    # middle box (unrounded core)
    
    sub_n = 6
    sub_step = 1.0 / sub_n
    sub_weight = 1.0 / (sub_n * sub_n)

    pixels = bytearray(size * size * 4)

    for py in range(size):
        for px in range(size):
            r_acc = 0.0
            g_acc = 0.0
            b_acc = 0.0
            a_acc = 0.0

            for sy in range(sub_n):
                for sx in range(sub_n):
                    sub_x = (px + (sx + 0.5) * sub_step) - half
                    sub_y = half - (py + (sy + 0.5) * sub_step)

                    # Container distance
                    d_box = sd_rounded_box(sub_x, sub_y, box_w, box_h, box_r)

                    if d_box <= 0.0:
                        norm_y = (sub_y + half) / size
                        # Subtle elegant background gradient
                        bg_r = bg_bot[0] + (bg_top[0] - bg_bot[0]) * norm_y
                        bg_g = bg_bot[1] + (bg_top[1] - bg_bot[1]) * norm_y
                        bg_b = bg_bot[2] + (bg_top[2] - bg_bot[2]) * norm_y

                        # Border region inside the container
                        if d_box >= -border_thick:
                            t = (d_box + border_thick) / border_thick
                            bc = (
                                border_subtle[0] + (border_color[0] - border_subtle[0]) * norm_y,
                                border_subtle[1] + (border_color[1] - border_subtle[1]) * norm_y,
                                border_subtle[2] + (border_color[2] - border_subtle[2]) * norm_y
                            )
                            bg_r = bg_r * (1.0 - t) + bc[0] * t
                            bg_g = bg_g * (1.0 - t) + bc[1] * t
                            bg_b = bg_b * (1.0 - t) + bc[2] * t

                        # Distance to Stem:
                        # Box from x_left to x_stem_right, y_bot to y_top
                        stem_cx = (x_left + x_stem_right) / 2.0
                        stem_cy = (y_bot + y_top) / 2.0
                        stem_hw = (x_stem_right - x_left) / 2.0
                        stem_hh = (y_top - y_bot) / 2.0
                        d_stem = sd_rounded_box(sub_x - stem_cx, sub_y - stem_cy, stem_hw, stem_hh, r_f)

                        # Distance to Top bar:
                        # Box from x_left to x_top_right, y_top_inner to y_top
                        top_cx = (x_left + x_top_right) / 2.0
                        top_cy = (y_top_inner + y_top) / 2.0
                        top_hw = (x_top_right - x_left) / 2.0
                        top_hh = (y_top - y_top_inner) / 2.0
                        d_top = sd_rounded_box(sub_x - top_cx, sub_y - top_cy, top_hw, top_hh, r_f)

                        # Main white F is union of stem and top bar
                        d_main = min(d_stem, d_top)

                        # Distance to Middle bar (Lavender accent):
                        # Connects smoothly from x_stem_right - 0.5 to x_mid_right, y_mid_bot to y_mid_top
                        mid_cx = (x_stem_right + x_mid_right) / 2.0
                        mid_cy = (y_mid_bot + y_mid_top) / 2.0
                        mid_hw = (x_mid_right - x_stem_right) / 2.0
                        mid_hh = (y_mid_top - y_mid_bot) / 2.0
                        d_mid = sd_rounded_box(sub_x - mid_cx, sub_y - mid_cy, mid_hw, mid_hh, r_f)

                        in_main = d_main <= 0.0
                        in_mid = d_mid <= 0.0

                        if in_main:
                            r_acc += f_white[0] * sub_weight
                            g_acc += f_white[1] * sub_weight
                            b_acc += f_white[2] * sub_weight
                            a_acc += 255.0 * sub_weight
                        elif in_mid:
                            r_acc += f_accent[0] * sub_weight
                            g_acc += f_accent[1] * sub_weight
                            b_acc += f_accent[2] * sub_weight
                            a_acc += 255.0 * sub_weight
                        else:
                            r_acc += bg_r * sub_weight
                            g_acc += bg_g * sub_weight
                            b_acc += bg_b * sub_weight
                            a_acc += 255.0 * sub_weight

                    elif d_box < 0.8:
                        # Antialiased outer container edge
                        alpha_edge = max(0.0, min(1.0, (0.8 - d_box) / 0.8))
                        norm_y = (sub_y + half) / size
                        bc = (
                            border_subtle[0] + (border_color[0] - border_subtle[0]) * norm_y,
                            border_subtle[1] + (border_color[1] - border_subtle[1]) * norm_y,
                            border_subtle[2] + (border_color[2] - border_subtle[2]) * norm_y
                        )
                        r_acc += bc[0] * alpha_edge * sub_weight
                        g_acc += bc[1] * alpha_edge * sub_weight
                        b_acc += bc[2] * alpha_edge * sub_weight
                        a_acc += 255.0 * alpha_edge * sub_weight

            idx = (py * size + px) * 4
            pixels[idx + 0] = int(round(min(255.0, r_acc)))
            pixels[idx + 1] = int(round(min(255.0, g_acc)))
            pixels[idx + 2] = int(round(min(255.0, b_acc)))
            pixels[idx + 3] = int(round(min(255.0, a_acc)))

    return make_png(size, size, bytes(pixels))

def main():
    out_dir = os.path.join(os.path.dirname(__file__), "icons")
    os.makedirs(out_dir, exist_ok=True)
    sizes = [16, 32, 48, 128]
    for s in sizes:
        png_data = render_icon(s)
        out_path = os.path.join(out_dir, f"icon{s}.png")
        with open(out_path, "wb") as f:
            f.write(png_data)
        print(f"Generated {out_path} ({len(png_data)} bytes)")

if __name__ == "__main__":
    main()

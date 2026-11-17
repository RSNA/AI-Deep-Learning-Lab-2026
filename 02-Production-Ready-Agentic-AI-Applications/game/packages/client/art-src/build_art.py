"""Builds the game's pixel art from the CC0 RPG Urban Pack by Kenney (engineering spec, 11.4).

    python3 packages/client/art-src/build_art.py                  # the client art
    python3 packages/client/art-src/build_art.py --room reading OUT  # the reading room, for a pack

Outputs, all at 1x (the client scales by whole numbers with nearest neighbour):
  public/art/sprites.png        12 characters x (4 directions x 3 frames), 16 x 16 each
  public/art/avatars/avNN.png   each character facing front, 16 x 16
  public/art/town_day.png       the street strip for join, lobby and the big screen, and _night
  public/art/room/              the library branch of the demo pack: room_day.png, room_night.png, scene.json

A pack may bring its own room in art/room/ with the same three files.
A change of palette is one run of this script.
"""
import colorsys
import json
import os
import random
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
TM = Image.open(os.path.join(HERE, "kenney-rpg-urban", "tilemap_packed.png")).convert("RGBA")
W, H = 320, 180


def T(c, r):
    return TM.crop((c * 16, r * 16, c * 16 + 16, r * 16 + 16))


def hx(h, a=255):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


INK = hx("5c6278")
BRN = hx("874d27")
DBR = hx("6f3f2a")


def put(im, t, x, y):
    im.alpha_composite(t, (x, y))


def box(d, x, y, w, h, fill, line=INK, hi=None, lo=None):
    d.rectangle((x, y, x + w - 1, y + h - 1), fill=hx(fill) if isinstance(fill, str) else fill, outline=line)
    if hi:
        d.line((x + 1, y + 1, x + w - 2, y + 1), fill=hx(hi))
    if lo:
        d.line((x + 1, y + h - 2, x + w - 2, y + h - 2), fill=hx(lo))


# ------------------------------------------------------------------------------------------
# Characters: six people of the pack, each in 4 directions with an idle and two walk frames.
# Columns 23 to 26 of the sheet face left, front, back, right. Rows r, r+1, r+2 are the frames.
# ------------------------------------------------------------------------------------------
FACINGS = ["front", "back", "left", "right"]
COLS = {"left": 23, "front": 24, "back": 25, "right": 26}


def recolor(t, shift):
    if not shift:
        return t
    o = t.copy()
    px = o.load()
    for y in range(16):
        for x in range(16):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if s > 0.25 and 0.36 < h < 0.75:
                r2, g2, b2 = colorsys.hsv_to_rgb((h + shift) % 1, min(1, s * 1.05), v)
                px[x, y] = (int(r2 * 255), int(g2 * 255), int(b2 * 255), a)
    return o


# The twelve characters a practice can pick, av01 to av12, and that the cast borrows.
CAST = [(0, 0), (3, 0), (6, 0), (12, 0), (15, 0), (0, 0.42), (3, 0.3), (12, 0.5), (15, 0.38), (6, 0.55), (0, 0.2), (9, 0)]


def sprites(out):
    sheet = Image.new("RGBA", (12 * 16, len(CAST) * 16), (0, 0, 0, 0))
    os.makedirs(os.path.join(out, "avatars"), exist_ok=True)
    for i, (row, shift) in enumerate(CAST):
        for fi, facing in enumerate(FACINGS):
            for frame in range(3):
                t = recolor(T(COLS[facing], row + frame), shift)
                put(sheet, t, (fi * 3 + frame) * 16, i * 16)
        recolor(T(COLS["front"], row), shift).save(os.path.join(out, "avatars", "av%02d.png" % (i + 1)))
    sheet.save(os.path.join(out, "sprites.png"))


# ------------------------------------------------------------------------------------------
# Shared furniture
# ------------------------------------------------------------------------------------------
BOOKS = ["dc615d", "38cbab", "59b6d8", "f5a94c", "a09cca", "e6eef8", "ff7143", "42a379", "c2504d", "64c0e1"]


def bookshelf(d, x, y, w, rows, rnd):
    h = rows * 9 + 3
    box(d, x, y, w, h, "c77b47", DBR)
    for r in range(rows):
        yy = y + 2 + r * 9
        d.rectangle((x + 2, yy, x + w - 3, yy + 7), fill=hx("7d4552"))
        xx = x + 2
        while xx < x + w - 3:
            bw = rnd.choice([2, 2, 3])
            bh = rnd.choice([5, 6, 6, 7])
            if xx + bw > x + w - 2:
                break
            if rnd.random() < 0.12:
                xx += 2
                continue
            d.rectangle((xx, yy + 8 - bh, xx + bw - 1, yy + 7), fill=hx(rnd.choice(BOOKS)))
            xx += bw
        d.line((x + 1, yy + 8, x + w - 2, yy + 8), fill=hx("e29157"))


def monitor(d, x, y, lit="64c0e1", frame=INK, w=11, h=8):
    box(d, x, y, w, h, lit, frame)
    d.line((x + 2, y + 2, x + 4, y + 2), fill=hx("e6eef8"))
    d.rectangle((x + w // 2 - 1, y + h, x + w // 2 + 1, y + h + 1), fill=frame)
    d.line((x + 2, y + h + 2, x + w - 3, y + h + 2), fill=frame)


def plant(d, x, y):
    for (dx, dy, c) in [(3, 0, "42dfab"), (1, 2, "38cbab"), (5, 2, "38cbab"), (0, 5, "21837c"), (3, 4, "42dfab"), (6, 5, "21837c"), (2, 7, "38cbab"), (4, 7, "21837c")]:
        d.ellipse((x + dx, y + dy, x + dx + 4, y + dy + 4), fill=hx(c), outline=hx("21837c"))
    box(d, x + 1, y + 11, 9, 6, "dc615d", hx("742c34"), hi="f1b089")


def chair(d, x, y, color="dc615d", dark="742c34"):
    box(d, x, y, 10, 8, color, hx(dark), hi="f1b089")


def nightify(im, glass, lit, lamps, tint=(92, 98, 190, 255)):
    day = im
    dark = ImageChops.multiply(im, Image.new("RGBA", im.size, tint))
    dd = ImageDraw.Draw(dark)
    for (a, b, c, e) in glass:
        dd.rectangle((a, b, c, e), fill=hx("23234a"))
        for (sx, sy) in [(3, 3), (7, 9), (15, 4), (18, 11), (5, 13)]:
            if a + sx < c and b + sy < e:
                dd.point((a + sx, b + sy), fill=hx("fff4c2"))
    glow = Image.new("RGBA", im.size, (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    for (a, b, c, e) in lit:
        g.ellipse((a - 14, b - 10, c + 14, e + 16), fill=(120, 220, 255, 70))
    for (cx, cy) in lamps:
        g.ellipse((cx - 30, cy - 20, cx + 30, cy + 22), fill=(255, 214, 130, 60))
    glow = glow.filter(ImageFilter.GaussianBlur(6))
    lite = ImageChops.screen(dark, Image.alpha_composite(Image.new("RGBA", im.size, (0, 0, 0, 255)), glow))
    lite.putalpha(255)
    # Screens keep their daytime pixels, so they glow with what they show.
    for (a, b, c, e) in lit:
        lite.paste(day.crop((a, b, c + 1, e + 1)), (a, b))
    return lite


# ------------------------------------------------------------------------------------------
# The library branch (demo pack)
# ------------------------------------------------------------------------------------------
def library(night=False):
    rnd = random.Random(7)
    im = Image.new("RGBA", (W, H), hx("f1b089"))
    d = ImageDraw.Draw(im)
    for r in range(5, 23):
        y = r * 8
        d.rectangle((0, y, W, y + 7), fill=hx("f1b089" if r % 2 else "eda77c"))
        d.line((0, y + 7, W, y + 7), fill=hx("dc8652"))
        for x in range((r % 3) * 14, W, 42):
            d.line((x, y, x, y + 6), fill=hx("dc8652"))
        for _ in range(3):
            d.point((rnd.randrange(W), y + rnd.randrange(1, 6)), fill=hx("e29157"))
    d.rectangle((0, 0, W, 39), fill=hx("cfe7f1"))
    d.rectangle((0, 0, W, 4), fill=hx("7a77a4"))
    d.line((0, 5, W, 5), fill=INK)
    d.rectangle((0, 32, W, 38), fill=hx("a09cca"))
    d.line((0, 32, W, 32), fill=hx("cdc9e7"))
    d.line((0, 39, W, 39), fill=INK)
    for x in range(0, W, 16):
        d.line((x, 34, x, 37), fill=hx("7a77a4"))
    glass = []
    for x in (110, 147, 184):
        box(d, x, 9, 26, 20, "ffffff", INK)
        d.rectangle((x + 2, 11, x + 23, 26), fill=hx("64c0e1"))
        glass.append((x + 2, 11, x + 23, 26))
        d.line((x + 12, 11, x + 12, 26), fill=hx("ffffff"))
        d.line((x + 13, 11, x + 13, 26), fill=hx("ffffff"))
        d.line((x + 4, 18, x + 9, 13), fill=hx("c1dbeb"))
        d.ellipse((x + 14, 20, x + 22, 28), fill=hx("38cbab"))
        d.rectangle((x + 14, 25, x + 23, 26), fill=hx("38cbab"))
        d.rectangle((x - 1, 28, x + 26, 30), fill=hx("e6eef8"), outline=INK)
    bookshelf(d, 6, 8, 34, 4, rnd)
    bookshelf(d, 42, 8, 34, 4, rnd)
    bookshelf(d, 244, 8, 34, 4, rnd)
    bookshelf(d, 280, 8, 34, 4, rnd)
    plant(d, 94, 24)
    plant(d, 214, 24)
    # rug and the reading table, which is the meeting table
    box(d, 112, 92, 96, 52, "38cbab", hx("21837c"))
    d.rectangle((115, 95, 204, 140), outline=hx("d6d4af"))
    d.rectangle((118, 98, 201, 137), fill=hx("42dfab"))
    for x in range(120, 200, 8):
        d.point((x, 117), fill=hx("d6d4af"))
    for (cx, cy) in [(134, 96), (176, 96)]:
        chair(d, cx, cy)
    box(d, 126, 104, 68, 22, "e29157", BRN, hi="f5c29a")
    d.rectangle((127, 122, 192, 124), fill=hx("c77b47"))
    box(d, 136, 108, 9, 6, "ffffff", INK)
    d.line((140, 109, 140, 112), fill=hx("a09cca"))
    box(d, 170, 107, 10, 7, "5c6278", INK)
    d.rectangle((171, 108, 178, 111), fill=hx("64c0e1"))
    box(d, 156, 112, 5, 5, "f5a94c", BRN)
    lit = [(171, 108, 178, 111)]
    # circulation desk, left
    box(d, 12, 70, 80, 16, "f5c29a", BRN, hi="ffe2c4")
    d.rectangle((13, 80, 90, 84), fill=hx("c77b47"))
    d.line((13, 79, 90, 79), fill=BRN)
    box(d, 12, 85, 16, 44, "f5c29a", BRN)
    d.rectangle((23, 86, 26, 127), fill=hx("c77b47"))
    monitor(d, 64, 63)
    lit.append((65, 64, 73, 69))
    for i, c in enumerate(["dc615d", "59b6d8", "f5a94c"]):
        d.rectangle((16, 74 - i * 2, 25, 75 - i * 2), fill=hx(c))
    d.ellipse((80, 70, 86, 75), fill=hx("f5a94c"), outline=BRN)
    box(d, 15, 96, 8, 6, "ffffff", INK)
    box(d, 15, 108, 8, 6, "38cbab", hx("21837c"))
    # public computers, right
    box(d, 230, 70, 78, 14, "f5c29a", BRN, hi="ffe2c4")
    d.rectangle((231, 79, 306, 82), fill=hx("c77b47"))
    d.line((231, 78, 306, 78), fill=BRN)
    monitor(d, 240, 63)
    monitor(d, 280, 63)
    lit += [(241, 64, 249, 69), (281, 64, 289, 69)]
    for x in (240, 280):
        chair(d, x, 90, "59b6d8", "2b2d4f")
    # holds cart, bottom right
    box(d, 252, 136, 46, 22, "c77b47", DBR)
    for r in range(2):
        yy = 138 + r * 10
        d.rectangle((254, yy, 295, yy + 7), fill=hx("7d4552"))
        xx = 254
        while xx < 294:
            bw = rnd.choice([2, 3])
            bh = rnd.choice([5, 6, 7])
            d.rectangle((xx, yy + 8 - bh, xx + bw - 1, yy + 7), fill=hx(rnd.choice(BOOKS)))
            xx += bw + (1 if rnd.random() < 0.2 else 0)
    for x in (255, 292):
        d.ellipse((x, 157, x + 4, 161), fill=INK)
    put(im, T(7, 9), 34, 160)
    put(im, T(7, 9), 50, 160)
    box(d, 146, 171, 28, 9, "7a77a4", INK)
    plant(d, 4, 150)
    plant(d, 304, 100)
    if night:
        im = nightify(im, glass, lit, [(160, 112), (48, 64), (270, 140)])
    scene = {
        "size": [W, H],
        # Top-left corners of 16 x 16 characters. Posts hold the cast in cast order.
        "posts": [[40, 56, "front"], [264, 52, "front"], [214, 128, "left"], [70, 120, "right"],
                  [96, 52, "front"], [222, 98, "front"], [40, 136, "right"], [286, 112, "left"]],
        "table": {"seats": [[110, 104, "right"], [194, 104, "left"], [140, 84, "front"], [170, 84, "front"]],
                  "you": [152, 124, "back"]},
        "you": [152, 150, "front"],
        "door": [152, 176],
        "ambient": [[241, 84, "back"], [58, 40, "back"]],
        "board": None,
    }
    return im, scene


# ------------------------------------------------------------------------------------------
# A radiology reading room. Drawn for this project; a pack copies it into its art/room/ folder.
# ------------------------------------------------------------------------------------------
def station(d, x, y, lit):
    """A reading station: a desk with two diagnostic monitors, a dictation mic and a chair."""
    box(d, x, y + 12, 44, 12, "8d93ad", INK, hi="b9bed4")
    d.rectangle((x + 1, y + 20, x + 42, y + 22), fill=hx("6d7290"))
    for i, mx in enumerate((x + 4, x + 23)):
        box(d, mx, y, 17, 12, "2b2d4f", INK)
        d.rectangle((mx + 2, y + 2, mx + 14, y + 9), fill=hx("1d1e3a"))
        # a grey image on a black screen
        d.ellipse((mx + 4, y + 3, mx + 8, y + 9), fill=hx("c9cdea"))
        d.ellipse((mx + 8, y + 3, mx + 12, y + 9), fill=hx("c9cdea"))
        d.line((mx + 8, y + 3, mx + 8, y + 9), fill=hx("e6e9fb"))
        d.rectangle((mx + 7, y + 12, mx + 9, y + 13), fill=INK)
        lit.append((mx + 2, y + 2, mx + 14, y + 9))
    box(d, x + 40, y + 6, 3, 7, "5c6278", INK)
    d.rectangle((x + 16, y + 14, x + 27, y + 17), fill=hx("e6eef8"), outline=INK)
    chair(d, x + 17, y + 26, "5c6278", "2b2d4f")


def reading(night=False):
    rnd = random.Random(11)
    im = Image.new("RGBA", (W, H), hx("c9cdea"))
    d = ImageDraw.Draw(im)
    # carpet tiles
    for r in range(5, 23):
        for c in range(0, W // 8 + 1):
            d.rectangle((c * 8, r * 8, c * 8 + 7, r * 8 + 7), fill=hx("b3b8d6" if (r + c) % 2 else "aab0d0"))
    for _ in range(140):
        d.point((rnd.randrange(W), rnd.randrange(40, H)), fill=hx("9ba1c4"))
    # back wall with acoustic panels
    d.rectangle((0, 0, W, 39), fill=hx("dfe3f3"))
    d.rectangle((0, 0, W, 4), fill=hx("7a77a4"))
    d.line((0, 5, W, 5), fill=INK)
    for x in range(4, W, 22):
        box(d, x, 8, 18, 20, "cdd3ea", hx("b3b8d6"))
    d.rectangle((0, 32, W, 38), fill=hx("a09cca"))
    d.line((0, 32, W, 32), fill=hx("cdc9e7"))
    d.line((0, 39, W, 39), fill=INK)
    # the worklist board, centre of the wall
    box(d, 118, 7, 84, 24, "2b2d4f", INK)
    d.rectangle((120, 9, 199, 28), fill=hx("1d1e3a"))
    rows = [("ff8a80", 30), ("ffc145", 52), ("38cbab", 44), ("64c0e1", 60), ("38cbab", 36)]
    for i, (c, w) in enumerate(rows):
        d.rectangle((123, 11 + i * 3 + i, 123 + w, 12 + i * 3 + i), fill=hx(c))
        d.rectangle((188, 11 + i * 4, 196, 12 + i * 4), fill=hx("e6eef8"))
    lit = [(120, 9, 199, 28)]
    # an old film light box on the wall, and a door
    box(d, 30, 10, 30, 18, "ffffff", INK)
    d.rectangle((32, 12, 57, 25), fill=hx("fff4c2"))
    d.ellipse((36, 13, 44, 24), fill=hx("c9cdea"))
    d.ellipse((45, 13, 53, 24), fill=hx("c9cdea"))
    lit.append((32, 12, 57, 25))
    box(d, 282, 6, 24, 33, "c77b47", DBR, hi="e29157")
    d.ellipse((300, 22, 303, 25), fill=hx("ffc145"))
    # four stations along the back, two along the left
    for (x, y) in [(6, 44), (60, 44), (216, 44), (270, 44)]:
        station(d, x, y, lit)
    for (x, y) in [(6, 110), (60, 110)]:
        station(d, x, y, lit)
    # meeting table in the middle
    box(d, 122, 96, 76, 30, "d7a26e", BRN, hi="f0c79a")
    d.rectangle((123, 121, 196, 124), fill=hx("b88152"))
    for (cx, cy) in [(136, 86), (174, 86)]:
        chair(d, cx, cy, "59b6d8", "2b2d4f")
    box(d, 134, 102, 10, 7, "ffffff", INK)
    d.line((136, 104, 141, 104), fill=hx("a09cca"))
    d.line((136, 106, 140, 106), fill=hx("a09cca"))
    box(d, 172, 101, 12, 8, "5c6278", INK)
    d.rectangle((173, 102, 182, 106), fill=hx("64c0e1"))
    lit.append((173, 102, 182, 106))
    box(d, 156, 106, 6, 6, "ffffff", INK)
    d.rectangle((157, 107, 160, 108), fill=hx("874d27"))
    # coffee corner, bottom right
    box(d, 262, 128, 50, 16, "f5c29a", BRN, hi="ffe2c4")
    d.rectangle((263, 138, 310, 141), fill=hx("c77b47"))
    box(d, 268, 118, 12, 12, "5c6278", INK)
    d.rectangle((271, 121, 276, 124), fill=hx("ff8a80"))
    box(d, 288, 123, 6, 6, "ffffff", INK)
    box(d, 296, 123, 6, 6, "ffffff", INK)
    # a phone and a printer by the door
    box(d, 238, 128, 18, 12, "e6eef8", INK)
    d.rectangle((240, 130, 253, 132), fill=hx("5c6278"))
    plant(d, 104, 22)
    plant(d, 206, 22)
    plant(d, 304, 156)
    box(d, 146, 171, 28, 9, "7a77a4", INK)
    if night:
        im = nightify(im, [], lit, [(160, 112), (288, 136)], tint=(80, 86, 176, 255))
    scene = {
        "size": [W, H],
        "posts": [[124, 60, "front"], [244, 104, "left"], [282, 112, "front"], [100, 132, "right"],
                  [204, 72, "front"], [40, 92, "front"], [270, 150, "left"], [216, 150, "front"]],
        "table": {"seats": [[106, 102, "right"], [200, 102, "left"], [140, 76, "front"], [172, 76, "front"]],
                  "you": [152, 128, "back"]},
        "you": [152, 152, "front"],
        "door": [294, 44],
        # radiologists at their stations, seen from behind
        "ambient": [[22, 64, "back"], [76, 64, "back"], [232, 64, "back"], [22, 130, "back"]],
        "board": [118, 7, 84, 24],
    }
    return im, scene


# ------------------------------------------------------------------------------------------
# The street strip (join page, lobby, big screen)
# ------------------------------------------------------------------------------------------
def town(night=False):
    rnd = random.Random(3)
    C, R = 60, 7
    im = Image.new("RGBA", (C * 16, R * 16), hx("38cbab"))

    def nine(c0, r0, x0, y0, w, h):
        for j in range(h):
            for i in range(w):
                cc = c0 + (0 if i == 0 else 2 if i == w - 1 else 1)
                rr = r0 + (0 if j == 0 else 2 if j == h - 1 else 1)
                put(im, T(cc, rr), (x0 + i) * 16, (y0 + j) * 16)

    nine(0, 0, 0, 0, C, 4)
    for i in range(C):
        put(im, T(9, 0), i * 16, 64)
        put(im, T(9, 2), i * 16, 80)
        put(im, T(9, 17), i * 16, 96)
        if i % 2 == 0:
            put(im, T(1, 16), i * 16, 96)
    wins = []

    def building(x0, w, brick_r, bc, roof_c, win, door, wincols):
        nine(roof_c, 3, x0, 0, w, 2)
        for i in range(w):
            cc = bc + (0 if i == 0 else 2 if i == w - 1 else 1)
            put(im, T(cc, brick_r), (x0 + i) * 16, 32)
            put(im, T(cc, brick_r + 3), (x0 + i) * 16, 48)
        for i in wincols:
            put(im, T(*win), (x0 + i) * 16, 34)
            wins.append(((x0 + i) * 16 + 4, 38, (x0 + i) * 16 + 11, 45))
        put(im, T(*door), (x0 + w // 2) * 16, 48)

    building(2, 9, 0, 17, 0, (13, 13), (14, 10), [1, 2, 3, 5, 6, 7])
    building(17, 7, 4, 17, 8, (13, 16), (15, 10), [1, 2, 4, 5])
    building(26, 9, 0, 17, 0, (13, 13), (14, 10), [1, 2, 3, 5, 6, 7])
    building(42, 7, 4, 20, 8, (13, 16), (13, 10), [1, 2, 4, 5])
    building(52, 7, 0, 20, 0, (12, 14), (15, 10), [1, 2, 4, 5])
    for (x, r, tall) in [(11, 8, 1), (12, 8, 0), (15, 8, 1), (24, 11, 1), (35, 8, 0), (40, 8, 1), (49, 11, 1), (50, 8, 0), (0, 8, 1), (59, 11, 0)]:
        c = 16 if tall else 17
        put(im, T(c, r), x * 16, 12)
        put(im, T(c, r + 1), x * 16, 28)
    nine(8, 6, 36, 1, 4, 2)
    for x in (13, 14, 37, 38):
        put(im, T(5, 12), x * 16, 50)
    put(im, T(7, 9), 13 * 16 + 8, 34)
    put(im, T(7, 9), 39 * 16, 50)
    for x in (10, 25, 41, 51):
        put(im, T(7, 6), x * 16 + 4, 40)
        put(im, T(7, 7), x * 16 + 4, 56)
    put(im, T(8, 11), 16 * 16, 54)
    put(im, T(9, 10), 34 * 16 + 6, 54)
    put(im, T(6, 6), 48 * 16, 40)
    put(im, T(6, 7), 48 * 16, 56)
    people = [(0, "right", 6), (3, "front", 9), (15, "left", 12), (6, "front", 19), (12, "right", 23), (9, "front", 28), (3, "left", 30), (0, "front", 31), (15, "front", 33), (12, "left", 38), (6, "right", 44), (9, "left", 47), (3, "right", 54), (0, "left", 57)]
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    for k, (row, face, x) in enumerate(people):
        y = 62 + (k * 5) % 12
        s = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(s).ellipse((x * 16 + 3, y + 13, x * 16 + 13, y + 16), fill=(40, 30, 60, 70))
        layer.alpha_composite(s)
        put(layer, T(COLS[face], row), x * 16, y)
    im.alpha_composite(layer)
    if night:
        dark = ImageChops.multiply(im, Image.new("RGBA", im.size, (88, 96, 196, 255)))
        dd = ImageDraw.Draw(dark)
        glow = Image.new("RGBA", im.size, (0, 0, 0, 0))
        g = ImageDraw.Draw(glow)
        for (a, b, c, e) in wins:
            dd.rectangle((a, b, c, e), fill=hx("ffd86b"))
            g.ellipse((a - 8, b - 6, c + 8, e + 10), fill=(255, 216, 107, 90))
        for x in (10, 25, 41, 51):
            g.ellipse((x * 16 - 16, 34, x * 16 + 40, 92), fill=(255, 230, 150, 110))
        glow = glow.filter(ImageFilter.GaussianBlur(7))
        im = ImageChops.screen(dark, Image.alpha_composite(Image.new("RGBA", im.size, (0, 0, 0, 255)), glow))
        im.putalpha(255)
    return im


def write_room(build, out):
    os.makedirs(out, exist_ok=True)
    day, scene = build(False)
    night, _ = build(True)
    day.save(os.path.join(out, "room_day.png"))
    night.save(os.path.join(out, "room_night.png"))
    with open(os.path.join(out, "scene.json"), "w") as f:
        json.dump(scene, f, indent=1)


def main():
    args = sys.argv[1:]
    if args[:1] == ["--room"]:
        kind, out = args[1], args[2]
        write_room({"reading": reading, "library": library}[kind], out)
        print("wrote the %s room to %s" % (kind, out))
        return
    out = os.path.join(HERE, "..", "public", "art")
    os.makedirs(out, exist_ok=True)
    sprites(out)
    town(False).save(os.path.join(out, "town_day.png"))
    town(True).save(os.path.join(out, "town_night.png"))
    write_room(library, os.path.join(out, "room"))
    print("wrote the client art to %s" % os.path.normpath(out))


if __name__ == "__main__":
    main()

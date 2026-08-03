"""Match original EuroStreet.createWoodenItemBox canvas textures more closely."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

SIZE = 256  # sharper than original 128 for track-distance readability


def make_wood() -> Image.Image:
    im = Image.new("RGBA", (SIZE, SIZE), (122, 74, 44, 255))  # #7a4a2c
    d = ImageDraw.Draw(im)
    s = SIZE / 128
    for y in (32, 64, 96):
        yy = int(y * s)
        d.line([(0, yy), (SIZE, yy)], fill=(102, 57, 31, 255), width=max(2, int(4 * s)))
    for y in (14, 47, 80, 113):
        yy = int(y * s)
        d.line(
            [(int(4 * s), yy), (SIZE - int(4 * s), yy)],
            fill=(255, 220, 170, 42),
            width=max(1, int(2 * s)),
        )
    r = max(4, int(5 * s))
    for x, y in ((12, 12), (116, 12), (12, 116), (116, 116)):
        cx, cy = int(x * s), int(y * s)
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(202, 160, 106, 255))
        # tiny highlight on rivet
        d.ellipse((cx - r // 2, cy - r // 2, cx, cy), fill=(235, 210, 160, 180))
    return im


def question_layer(with_black_bg: bool) -> Image.Image:
    im = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 255 if with_black_bg else 0))
    try:
        font = ImageFont.truetype(
            "/System/Library/Fonts/Supplemental/Comic Sans MS.ttf", int(78 * SIZE / 128)
        )
    except OSError:
        try:
            font = ImageFont.truetype(
                "/System/Library/Fonts/Supplemental/Arial Bold.ttf", int(78 * SIZE / 128)
            )
        except OSError:
            font = ImageFont.load_default()

    # Soft yellow bloom (original shadowBlur 18 on #ffd23e)
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    text = "?"
    bbox = gd.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    xy = (SIZE / 2 - tw / 2 - bbox[0], SIZE * 68 / 128 - th / 2 - bbox[1])
    gd.text(xy, text, font=font, fill=(255, 210, 62, 255))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=max(4, int(9 * SIZE / 128))))
    # boost glow
    glow = ImageChops.multiply(glow, Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 220)))

    out = im.copy()
    out.alpha_composite(glow)
    d = ImageDraw.Draw(out)
    d.text(xy, text, font=font, fill=(255, 226, 90, 255))
    return out


def main() -> None:
    wood = make_wood()
    q = question_layer(with_black_bg=False)
    wood.alpha_composite(q)
    wood.save("wood_q.png")

    emis = question_layer(with_black_bg=True)
    emis.save("emis_q.png")
    print("wrote wood_q.png emis_q.png", SIZE)


if __name__ == "__main__":
    main()

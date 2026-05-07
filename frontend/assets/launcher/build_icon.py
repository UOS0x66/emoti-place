"""
EmotiPlace 런처 아이콘 생성기.
1024x1024 PNG를 만들어 frontend/assets/launcher/icon.png 로 저장.

디자인:
- 둥근 사각형 배경: 좌상→우하 그라디언트 (#FFB088 → #FF6B35)
- 중앙 흰색 위치 핀
- 핀 내부 동그라미 자리에 작은 빨간 하트 (감정 + 장소 컨셉)

실행: python build_icon.py
"""

import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), 'icon.png')
SIZE = 1024
RADIUS_PCT = 0.22  # 모서리 둥글기 (Android adaptive icon foreground 권장 영역과 무관)

# --- 색상 ---
TL = (255, 176, 136, 255)   # #FFB088
BR = (255, 107, 53, 255)    # #FF6B35
WHITE = (255, 255, 255, 255)
HEART = (255, 107, 53, 255)  # #FF6B35 — 배경 그라디언트 진한 쪽과 동일

# --- 1) 그라디언트 배경 (원본 정사각형) ---
bg = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
bg_pixels = bg.load()
for y in range(SIZE):
    for x in range(SIZE):
        # 좌상단=0, 우하단=1 인 대각선 거리 비율
        t = (x + y) / (2 * (SIZE - 1))
        r = int(TL[0] + (BR[0] - TL[0]) * t)
        g = int(TL[1] + (BR[1] - TL[1]) * t)
        b = int(TL[2] + (BR[2] - TL[2]) * t)
        bg_pixels[x, y] = (r, g, b, 255)

# 둥근 모서리 마스크
mask = Image.new('L', (SIZE, SIZE), 0)
mdraw = ImageDraw.Draw(mask)
radius = int(SIZE * RADIUS_PCT)
mdraw.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=radius, fill=255)
img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
img.paste(bg, (0, 0), mask)

draw = ImageDraw.Draw(img)


def draw_pin(canvas, cx, cy, head_r, tip_y, color):
    """위치 핀(원 + 아래쪽 삼각형 합성) 그리기.
    cx, cy: 원 중심
    head_r: 원 반지름
    tip_y: 핀 끝점의 y 좌표 (cy < tip_y)
    """
    # 원
    canvas.ellipse(
        (cx - head_r, cy - head_r, cx + head_r, cy + head_r),
        fill=color,
    )
    # 아래쪽 삼각형 (원과 매끄럽게 연결되도록 원 옆면 접점에서 시작)
    # 접점 각도: tip이 정확히 아래쪽이므로 좌우 대칭 70도 각도쯤이 자연스러움
    import math
    angle = math.radians(150)  # 아래로 60도 양옆
    lx = cx + head_r * math.cos(angle)
    ly = cy + head_r * math.sin(-angle) * -1  # y는 아래가 +
    # 단순화: 원의 아래 60도 호와 만나는 두 점 + tip
    lx1 = cx - head_r * math.sin(math.radians(35))
    ly1 = cy + head_r * math.cos(math.radians(35))
    rx1 = cx + head_r * math.sin(math.radians(35))
    ry1 = ly1
    canvas.polygon([(lx1, ly1), (rx1, ry1), (cx, tip_y)], fill=color)


def draw_heart(canvas, cx, cy, size, color):
    """원 두 개 + 폴리곤으로 하트 모양 합성."""
    half = size / 2
    lobe_r = half * 0.55
    # 두 잎
    canvas.ellipse(
        (cx - half, cy - lobe_r, cx, cy + lobe_r),
        fill=color,
    )
    canvas.ellipse(
        (cx, cy - lobe_r, cx + half, cy + lobe_r),
        fill=color,
    )
    # 아래 V (잎 두 원 아래 접선에서 정점까지)
    top_y = cy
    bottom_y = cy + size * 0.85
    canvas.polygon(
        [
            (cx - half * 0.98, top_y + lobe_r * 0.05),
            (cx + half * 0.98, top_y + lobe_r * 0.05),
            (cx, bottom_y),
        ],
        fill=color,
    )


# --- 2) 핀 (흰색) ---
PIN_CX = SIZE // 2
PIN_HEAD_R = int(SIZE * 0.22)
PIN_CY = int(SIZE * 0.40)
PIN_TIP_Y = int(SIZE * 0.82)
draw_pin(draw, PIN_CX, PIN_CY, PIN_HEAD_R, PIN_TIP_Y, WHITE)

# --- 3) 핀 내부 하트 (따뜻한 빨강) ---
draw_heart(draw, PIN_CX, int(PIN_CY - PIN_HEAD_R * 0.05),
           size=int(PIN_HEAD_R * 1.05), color=HEART)

img.save(OUT, format='PNG')
print(f'생성 완료: {OUT} ({img.size[0]}x{img.size[1]})')

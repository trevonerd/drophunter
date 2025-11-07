#!/usr/bin/env python3
"""
Script per creare icone placeholder PNG per l'estensione Chrome
"""

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("PIL not found. Installing Pillow...")
    import subprocess
    subprocess.check_call(['pip3', 'install', 'pillow'])
    from PIL import Image, ImageDraw, ImageFont

import os

# Colori Twitch
PURPLE = (145, 70, 255)
DARK = (24, 24, 27)

def create_icon(size):
    """Crea un'icona PNG con dimensione specificata"""
    # Crea immagine con sfondo gradiente viola
    img = Image.new('RGBA', (size, size), PURPLE)
    draw = ImageDraw.Draw(img)

    # Disegna un cerchio di sfondo
    padding = size // 10
    draw.ellipse([padding, padding, size - padding, size - padding],
                 fill=PURPLE, outline=DARK, width=max(1, size // 32))

    # Disegna icona Twitch stilizzata (semplificata)
    # Corpo principale
    body_left = size // 4
    body_top = size // 4
    body_right = size * 3 // 4
    body_bottom = size * 3 // 4
    draw.rectangle([body_left, body_top, body_right, body_bottom],
                   fill='white', outline=None)

    # "Chat" boxes
    box_width = size // 12
    box_height = size // 6
    box1_x = size // 2 - size // 8
    box2_x = size // 2 + size // 24
    box_y = size // 2 - size // 12

    draw.rectangle([box1_x, box_y, box1_x + box_width, box_y + box_height],
                   fill=PURPLE)
    draw.rectangle([box2_x, box_y, box2_x + box_width, box_y + box_height],
                   fill=PURPLE)

    # Salva l'icona
    output_path = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons', f'icon{size}.png')
    img.save(output_path, 'PNG')
    print(f'Created {output_path}')

def main():
    sizes = [16, 32, 48, 128]

    for size in sizes:
        create_icon(size)

    print('All icons created successfully!')

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
from PIL import Image, ImageDraw, ImageFont
import os

# Colori
PURPLE = (145, 70, 255)
WHITE = (255, 255, 255)

def create_simple_icon(size):
    """Crea un'icona semplice ma riconoscibile"""
    # Sfondo viola
    img = Image.new('RGBA', (size, size), PURPLE)
    draw = ImageDraw.Draw(img)

    # Cerchio bianco al centro
    center = size // 2
    radius = size // 3
    draw.ellipse([center - radius, center - radius,
                  center + radius, center + radius],
                 fill=WHITE)

    # "T" grande per Twitch
    letter_size = size // 2
    letter_x = center - letter_size // 4
    letter_y = center - letter_size // 3

    # Barra orizzontale della T
    draw.rectangle([letter_x - letter_size // 4, letter_y,
                   letter_x + letter_size // 4, letter_y + letter_size // 8],
                  fill=PURPLE)

    # Barra verticale della T
    draw.rectangle([letter_x - letter_size // 12, letter_y,
                   letter_x + letter_size // 12, letter_y + letter_size // 2],
                  fill=PURPLE)

    return img

# Crea le icone
sizes = [16, 32, 48, 128]
base_dir = os.path.dirname(os.path.abspath(__file__))
icons_dir = os.path.join(base_dir, '..', 'public', 'icons')

os.makedirs(icons_dir, exist_ok=True)

for size in sizes:
    icon = create_simple_icon(size)
    output_path = os.path.join(icons_dir, f'icon{size}.png')
    icon.save(output_path, 'PNG')
    print(f'✓ Created {output_path}')

print('\n✨ All icons created successfully!')

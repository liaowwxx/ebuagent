from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "mini_qrcode_export"
TARGET = ROOT / "public" / "mini_qrcode_export"

if TARGET.exists():
    shutil.rmtree(TARGET)
shutil.copytree(SOURCE, TARGET)
print(f"Copied QR codes to {TARGET}")

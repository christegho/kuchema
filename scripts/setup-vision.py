"""Download the official YOLO11n and SAM 2.1 tiny checkpoints once."""
import os
from pathlib import Path

root = Path(__file__).resolve().parents[1]
models = root / 'models'
models.mkdir(exist_ok=True)
(models / '.config').mkdir(exist_ok=True)
os.environ['YOLO_CONFIG_DIR'] = str(models / '.config')
os.environ['YOLO_AUTOINSTALL'] = 'false'
from ultralytics import YOLO, SAM, settings
settings.update({'sync': False})
YOLO(str(models / 'yolo11n.pt'))
SAM(str(models / 'sam2.1_t.pt'))
print('YOLO11n and SAM 2.1 tiny are installed in', models)

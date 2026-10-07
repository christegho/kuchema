"""JSON-lines YOLO detection and SAM segmentation. No external inference calls."""
import os, sys, json, contextlib
from pathlib import Path
root = Path(__file__).resolve().parents[1]
(root / 'models' / '.config').mkdir(parents=True, exist_ok=True)
os.environ.setdefault('YOLO_CONFIG_DIR', str(root / 'models' / '.config'))
os.environ['YOLO_AUTOINSTALL'] = 'false'
os.environ.setdefault('MPLCONFIGDIR', str(root / 'models' / '.config' / 'matplotlib'))
with contextlib.redirect_stdout(sys.stderr):
    import numpy as np
    import torch
    from PIL import Image, ImageFilter
    from ultralytics import YOLO, SAM, settings
    settings.update({'sync': False})
    torch.set_num_threads(min(4, os.cpu_count() or 2))
    device = os.environ.get('VISION_DEVICE', 'cpu')
    detector = YOLO(str(root / 'models' / 'yolo11n.pt'))
    segmenter = SAM(str(root / 'models' / 'sam2.1_t.pt'))

def process(req):
    if req.get('action') == 'health':
        return {'ready': True, 'detector': 'YOLO11n', 'segmenter': 'SAM 2.1 tiny', 'device': device}
    source = Image.open(req['path']).convert('RGB')
    w, h = source.size
    detections = detector.predict(source, conf=.20, imgsz=640, device=device, verbose=False)[0]
    boxes = []
    for b in detections.boxes:
        cls = int(b.cls[0])
        x1,y1,x2,y2 = b.xyxy[0].cpu().tolist()
        boxes.append({'label': detections.names[cls], 'box': [x1/w,y1/h,x2/w,y2/h], 'confidence': float(b.conf[0]), 'detector': 'YOLO11n'})
    if req.get('action') == 'detect':
        return {'detections':boxes,'width':w,'height':h}
    def iou(a,b):
        overlap=max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))
        total=(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-overlap
        return overlap/max(total,.0001)
    # In directed mode, YOLO may refine a requested subject, never add its own subjects.
    targets=[]
    human_words=['person','people','woman','man','child','figure','body','group','gathering','crowd','family','youth']
    for region in req.get('regions', [])[:int(req.get('maxCuts',3))]:
        b=region.get('box',[]);point=region.get('point')
        if len(b)!=4 or b[2]<=b[0] or b[3]<=b[1]: continue
        item={**region, 'box':b, 'confidence':None, 'detector':'VLM-directed box and point'}
        label=region.get('label','').lower()
        human_target=any(word in label for word in human_words)
        group_target=any(word in label for word in ['group','people','gathering','crowd','family','youth'])
        person_candidates=[d for d in boxes if d['label']=='person' and (
            iou(b,d['box'])>.08
            or (b[0]<=(d['box'][0]+d['box'][2])/2<=b[2] and b[1]<=(d['box'][1]+d['box'][3])/2<=b[3])
            or (point and d['box'][0]<=point[0]<=d['box'][2] and d['box'][1]<=point[1]<=d['box'][3])
        )]
        # Refuse an uncertain human fragment rather than risk returning a detached
        # head or torso. A full YOLO person box becomes the segmentation prompt.
        if human_target and not person_candidates: continue
        compatible=person_candidates if human_target else [d for d in boxes if d['label'].lower() in label and iou(b,d['box'])>.55]
        if compatible and not group_target:
            match=max(compatible,key=lambda d:iou(b,d['box']))
            selected_point=[(match['box'][0]+match['box'][2])/2,(match['box'][1]+match['box'][3])/2] if human_target else point
            if human_target or not point or (match['box'][0]<=point[0]<=match['box'][2] and match['box'][1]<=point[1]<=match['box'][3]):
                item.update({'box':match['box'],'point':selected_point,'confidence':match['confidence'],'detector':'VLM-selected / YOLO11n full-person refinement' if human_target else 'VLM-selected / YOLO11n-refined'})
        targets.append(item)
    if not req.get('directed') and not targets: targets=boxes[:int(req.get('maxCuts',3))]
    out=[]
    for index,item in enumerate(targets):
        b=item['box']
        members=[]
        if any(word in item.get('label','').lower() for word in ['group','people','gathering','crowd','family','youth']):
            members=[d for d in boxes if d['label']=='person' and (iou(b,d['box'])>.08 or (b[0]<=(d['box'][0]+d['box'][2])/2<=b[2] and b[1]<=(d['box'][1]+d['box'][3])/2<=b[3]))]
        if len(members)>1:
            prompts_list=[{'box':d['box'],'point':[(d['box'][0]+d['box'][2])/2,(d['box'][1]+d['box'][3])/2]} for d in members[:8]]
            item.update({'detector':'VLM-selected group / YOLO11n instances','instanceBoxes':[m['box'] for m in members[:8]]})
        else: prompts_list=[item]
        combined=np.zeros((h,w),dtype=np.uint8)
        for subject in prompts_list:
            pixel_box=[int(v*(w if i%2==0 else h)) for i,v in enumerate(subject['box'])]
            prompts={'bboxes':[pixel_box]}
            point=subject.get('point')
            if point: prompts.update({'points':[[[int(point[0]*w),int(point[1]*h)]]],'labels':[[1]]})
            result=segmenter.predict(source,device=device,verbose=False,imgsz=int(req.get('samImageSize',1024)),**prompts)[0]
            if result.masks is None or not len(result.masks.data): continue
            mask_np=result.masks.data[0].cpu().numpy()
            mask=Image.fromarray((mask_np>0.5).astype(np.uint8)*255).resize((w,h),Image.Resampling.NEAREST)
            combined=np.maximum(combined,np.asarray(mask))
        alpha=Image.fromarray(combined)
        coverage=np.asarray(alpha).mean()/255
        if coverage<.004 or coverage>.9: continue
        boundary=item.get('boundary','silhouette')
        if boundary=='residue':
            radius=max(3,int(min(w,h)*.035)//2*2+1)
            alpha=alpha.filter(ImageFilter.MaxFilter(radius))
        if boundary=='field':
            # Expand the selected environmental material while preserving an
            # irregular alpha edge and transparent corners. Downsampled
            # morphology keeps this fast on 2K generation outputs.
            scale=max(1,min(w,h)//240)
            sw,sh=max(1,w//scale),max(1,h//scale)
            small=alpha.resize((sw,sh),Image.Resampling.NEAREST)
            size=min(17,max(3,int(min(sw,sh)*.045)//2*2+1))
            alpha=small.filter(ImageFilter.MaxFilter(size)).resize((w,h),Image.Resampling.BILINEAR)
            # Keep expansion near the composition-directed subject box. A field
            # must not grow back into an almost complete rectangular photograph.
            pad=.025
            left=max(0,int((b[0]-pad)*w));top=max(0,int((b[1]-pad)*h))
            right=min(w,int((b[2]+pad)*w));bottom=min(h,int((b[3]+pad)*h))
            clipped=Image.new('L',(w,h),0)
            clipped.paste(alpha.crop((left,top,right,bottom)),(left,top))
            alpha=clipped
        coverage=np.asarray(alpha).mean()/255
        if coverage>.92: continue
        bbox=alpha.getbbox()
        if not bbox: continue

        rgba=source.copy().convert('RGBA');rgba.putalpha(alpha)
        output=str(Path(req['outputDir']) / f'cut-{index}.png')
        rgba.crop(bbox).save(output)
        out.append({**item,'file':output,'cropBox':list(bbox),'coverage':round(float(coverage),4),'segmenter':'SAM 2.1 tiny'})
    return {'cuts':out, 'detections':boxes, 'width':w, 'height':h}

for line in sys.stdin:
    try:
        req=json.loads(line)
        with contextlib.redirect_stdout(sys.stderr): result=process(req)
        print(json.dumps({'id':req['id'],'result':result}),flush=True)
    except Exception as exc:
        print(json.dumps({'id':locals().get('req',{}).get('id'),'error':str(exc)[:500]}),flush=True)

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class VisionWorker {
  constructor(){this.child=null;this.pending=new Map();this.queue=Promise.resolve();}
  async available(){
    try {await Promise.all(['models/yolo11n.pt','models/sam2.1_t.pt',process.env.VISION_PYTHON||'.venv/bin/python'].map(p=>fs.access(path.resolve(p))));return true;}catch{return false;}
  }
  async request(body){
    const run=()=>this.call(body);
    const next=this.queue.catch(()=>{}).then(run);this.queue=next;return next;
  }
  async call(body){
    if(!await this.available())throw new Error('Local segmentation models are not installed. Run npm run setup:vision before creating an image.');
    if(!this.child){
      this.child=spawn(path.resolve(process.env.VISION_PYTHON||'.venv/bin/python'),[path.resolve('scripts/vision-worker.py')],{stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUNBUFFERED:'1',PYTORCH_ENABLE_MPS_FALLBACK:'1'}});
      let errors='';this.child.stderr.on('data',d=>{errors=(errors+d.toString()).slice(-1500);});
      createInterface({input:this.child.stdout}).on('line',line=>{try{const value=JSON.parse(line),p=this.pending.get(value.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(value.id);value.error?p.reject(new Error(value.error)):p.resolve(value.result);}catch{}});
      const failed=()=>{this.child=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(`Segmentation worker stopped. ${errors.slice(-400)}`));}this.pending.clear();};
      this.child.on('error',failed);this.child.on('exit',failed);
    }
    return new Promise((resolve,reject)=>{const id=randomUUID(),timeout=Math.max(30000,Math.min(Number(body.timeoutMs)||300000,300000)),timer=setTimeout(()=>{this.pending.delete(id);this.child?.kill();reject(new Error('Local segmentation timed out.'));},timeout);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({...body,id})+'\n');});
  }
  close(){this.child?.kill();}
}

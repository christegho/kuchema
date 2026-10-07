import { useCallback, useRef, useState } from 'react';
import type { Asset, Layer, Project } from './types';
import {DEFAULT_GROUND} from '../shared/ground.js';

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...options, headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...options.headers } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
export function download(name: string, data: Blob|string) {
  const url = typeof data === 'string' ? data : URL.createObjectURL(data);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  if (typeof data !== 'string') setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const uid = () => crypto.randomUUID();
export const clamp = (value:number,min:number,max:number) => Math.min(max,Math.max(min,value));
export function makeLayer(asset: Asset|null, index = 0): Layer {
  const width = asset ? Math.min(460, 800 * asset.width / asset.height) : 460;
  return { id: uid(), assetId: asset?.id || null, name: asset?.title || 'An unresolved space', kind: asset?.kind || 'gap',
    x: 160 + index * 45, y: 140 + index * 25, width: Math.max(10,width), height: asset ? Math.max(10,width * asset.height / asset.width) : 280,
    rotation: 0, opacity: 1, shape: 'rectangle', points: [], crop: {x:0,y:0,zoom:1}, visible: true, locked: false,
    note: asset ? '' : 'What cannot be supported by this archive?' };
}
export function arrange(assets: Asset[], strategy: Project['strategy']): Layer[] {
  const picked = assets.slice(0,8);
  if (!picked.length) return [makeLayer(null)];
  if (strategy === 'echoes') return Array.from({length:Math.min(7,Math.max(picked.length,5))}, (_,i) => {
    const a = picked[i % picked.length];
    return {...makeLayer(a), x:80+i*185,y:90+(i%3)*140,width:370,height:a.allowCrop?610:370*a.height/a.width,rotation:(i%2?4:-4),shape:a.allowCrop?'torn':'rectangle',note:'Repetition retains distinct viewpoints rather than combining them into one landscape.'};
  });
  const positions = [[95,85,490,690,-4],[600,65,355,495,3],[930,210,570,560,-3],[465,565,535,310,2],[1110,60,345,250,6],[135,700,350,210,-2],[760,90,300,310,4],[1000,690,450,240,-2]];
  const layers: Layer[] = picked.map((a,i) => {
    const [x,y,w,h,r]=positions[i];
    return {...makeLayer(a),x,y,width:w,height:a.allowCrop?h:w*a.height/a.width,rotation:r,shape:a.allowCrop && i<3?'torn' as const:'rectangle' as const};
  });
  if (strategy === 'gaps') {
    layers.splice(Math.min(2,layers.length),1);
    layers.push({...makeLayer(null),x:970,y:250,width:490,height:530,note:'Locality and the relationships between these images are not yet documented.'});
  }
  return layers;
}
export function initialProject(assets: Asset[]): Project {
  return { title:'A fragmentary atlas',brief:'Follow the water, the ground, and the spaces where people gather. Let different perspectives coexist. Leave room for what these images cannot tell us.',strategy:'atlas',background:DEFAULT_GROUND,layers:arrange(assets,'atlas'),evidence:null };
}
export function useHistory(initial: Project) {
  const [project, setProject] = useState(initial);
  const current = useRef(initial), past = useRef<Project[]>([]), future = useRef<Project[]>([]);
  const update = useCallback((fn: Project|((p:Project)=>Project)) => {
    const next = typeof fn === 'function' ? fn(current.current) : fn;
    if (next === current.current) return;
    past.current = [...past.current.slice(-59),current.current]; future.current=[];
    current.current=next;setProject(next);
  },[]);
  const undo = useCallback(() => { const prev=past.current.pop(); if(prev){future.current.push(current.current);current.current=prev;setProject(prev);} },[]);
  const redo = useCallback(() => { const next=future.current.pop();if(next){past.current.push(current.current);current.current=next;setProject(next);} },[]);
  return {project,update,undo,redo,canUndo:past.current.length>0,canRedo:future.current.length>0};
}

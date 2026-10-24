import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Stage, Layer as KLayer, Group, Image as KImage, Rect, Text, Transformer, Line } from 'react-konva';
import Konva from 'konva';
import type { Asset, Layer, Project } from './types';
import { clamp } from './lib';
import {canvasGround, DEFAULT_GROUND} from '../shared/ground.js';
import {canvasOf, outputScale} from '../shared/canvas.js';

export type CanvasHandle = { exportPNG: () => string };
type Props = { project:Project;assets:Asset[];selected:string|null;onSelect:(id:string|null)=>void;onChange:(id:string,change:Partial<Layer>)=>void;cutting:boolean;cutPoints:number[];onCutPoint:(x:number,y:number)=>void;showSources:boolean;editable?:boolean };
const torn = [0,.03,.16,0,.31,.025,.48,.003,.6,.02,.79,0,1,.035,.98,.24,1,.39,.977,.62,1,.78,.98,1,.77,.978,.6,1,.42,.975,.23,1,0,.978,.015,.79,0,.59,.017,.36];

function Fragment({item,asset,selected,onSelect,onChange,cutting,onCutPoint,showSources,editable=true,bounds}:{item:Layer;asset?:Asset;selected:boolean;onSelect:()=>void;onChange:(c:Partial<Layer>)=>void;cutting:boolean;onCutPoint:(x:number,y:number)=>void;showSources:boolean;editable?:boolean;bounds:{width:number;height:number}}) {
  const [image,setImage]=useState<HTMLImageElement>();
  const group=useRef<Konva.Group>(null), transformer=useRef<Konva.Transformer>(null);
  useEffect(()=>{if(!asset)return;const img=new window.Image();img.onload=()=>setImage(img);img.src=asset.url;return()=>{img.onload=null;};},[asset?.url]);
  useEffect(()=>{if(selected&&transformer.current&&group.current){transformer.current.nodes([group.current]);transformer.current.getLayer()?.batchDraw();}},[selected,item.width,item.height,item.rotation,cutting]);
  if(!item.visible)return null;
  const w=item.width,h=item.height;
  let crop;
  if(image){
    const cover=Math.max(w/image.width,h/image.height)*item.crop.zoom;
    const sw=Math.min(image.width,w/cover),sh=Math.min(image.height,h/cover);
    crop={x:(image.width-sw)*item.crop.x/.95,y:(image.height-sh)*item.crop.y/.95,width:sw,height:sh};
  }
  const noCrop=asset&&!asset.allowCrop;
  const fit=image?Math.min(w/image.width,h/image.height):1;
  const imageW=noCrop&&image?image.width*fit:w, imageH=noCrop&&image?image.height*fit:h;
  function clip(ctx:Konva.Context){
    ctx.beginPath();
    if(item.shape==='ellipse')ctx.ellipse(w/2,h/2,w/2,h/2,0,0,Math.PI*2);
    else if(item.shape==='torn'||(item.shape==='polygon'&&item.points.length>=6)){
      const p=item.shape==='torn'?torn:item.points;ctx.moveTo(p[0]*w,p[1]*h);for(let i=2;i<p.length;i+=2)ctx.lineTo(p[i]*w,p[i+1]*h);ctx.closePath();
    }else ctx.rect(0,0,w,h);
  }
  return <>
    <Group ref={group} id={item.id} x={item.x} y={item.y} width={w} height={h} rotation={item.rotation} opacity={item.opacity}
      draggable={editable&&!item.locked&&!cutting} onClick={onSelect} onTap={onSelect}
      onMouseDown={()=>onSelect()} onDragEnd={e=>onChange({x:clamp(e.target.x(),-2*bounds.width,3*bounds.width),y:clamp(e.target.y(),-2*bounds.height,3*bounds.height)})}
      onTransformEnd={()=>{const n=group.current!;const nw=clamp(n.width()*n.scaleX(),20,3*bounds.width),nh=clamp(n.height()*n.scaleY(),20,3*bounds.height);n.scale({x:1,y:1});onChange({x:clamp(n.x(),-2*bounds.width,3*bounds.width),y:clamp(n.y(),-2*bounds.height,3*bounds.height),width:nw,height:nh,rotation:n.rotation()});}}>
      {item.kind==='gap'?<><Rect width={w} height={h} fill={DEFAULT_GROUND}/><Line points={[0,1,w,1]} stroke="#bbb" strokeWidth={.7}/><Text x={8} y={12} width={w-16} height={h-16} text={item.note||'An account remains unfilled.'} fontFamily="Arial" fontSize={11.33} lineHeight={1.3} fill="#d6c8a5"/></>:
      <Group clipFunc={clip}><KImage image={image} x={(w-imageW)/2} y={(h-imageH)/2} width={imageW} height={imageH} crop={noCrop?undefined:crop}/>{!image&&<Rect width={w} height={h} fill="#c4c4b7"/>}</Group>}
      {showSources&&<Group name="editor-only" listening={false}><Rect y={h-42} width={w} height={42} fill={item.kind==='generated'?'#c7b6ff':'#dded85'} opacity={.92}/><Text x={12} y={h-29} width={w-24} fontSize={16} fontFamily="monospace" text={`${item.kind==='generated'?'AI':item.kind==='gap'?'?':'SOURCE'} · ${asset?.contributor||'unattributed'}`} fill="#161616"/></Group>}
      {selected&&cutting&&<Rect width={w} height={h} fill="rgba(0,0,0,0.06)" onTap={e=>{e.cancelBubble=true;const p=group.current!.getRelativePointerPosition();if(p)onCutPoint(clamp(p.x/w,0,1),clamp(p.y/h,0,1));}} onClick={e=>{e.cancelBubble=true;const p=group.current!.getRelativePointerPosition();if(p)onCutPoint(clamp(p.x/w,0,1),clamp(p.y/h,0,1));}}/>}
    </Group>
    {selected&&editable&&!item.locked&&!cutting&&<Transformer name="editor-only" ref={transformer} flipEnabled={false} keepRatio={true} rotateEnabled anchorSize={8} borderStroke="#777" anchorStroke="#777" anchorFill="#f5f5f5" borderDash={[6,4]} boundBoxFunc={(old,b)=>b.width<20||b.height<20?old:b}/>}
  </>;
}

export const CollageCanvas=forwardRef<CanvasHandle,Props>(function CollageCanvas({project,assets,selected,onSelect,onChange,cutting,cutPoints,onCutPoint,showSources,editable=true},ref){
  const container=useRef<HTMLDivElement>(null), stage=useRef<Konva.Stage>(null);
  const [width,setWidth]=useState(800),paper=canvasOf(project),exportWidth=paper.width*outputScale(project);
  useEffect(()=>{const o=new ResizeObserver(es=>setWidth(es[0].contentRect.width));if(container.current)o.observe(container.current);return()=>o.disconnect();},[]);
  useImperativeHandle(ref,()=>({exportPNG:()=>{
    const s=stage.current!;if(s.find('Image').some(n=>!(n as Konva.Image).image()))throw new Error('Images are still loading. Try exporting in a moment.');
    const overlays=s.find('.editor-only');overlays.forEach(n=>n.hide());s.draw();
    try{return s.toDataURL({pixelRatio:exportWidth/width,mimeType:'image/png'});}finally{overlays.forEach(n=>n.show());s.draw();}
  }}),[width,exportWidth]);
  const selectedLayer=project.layers.find(l=>l.id===selected);
  return <div className={`canvas-wrap ${cutting?'cutting':''}`} ref={container} aria-label="Editable collage canvas">
    <Stage ref={stage} width={width} height={width*paper.height/paper.width} scaleX={width/paper.width} scaleY={width/paper.width} onMouseDown={e=>{if(e.target===e.target.getStage()||e.target.name()==='paper')onSelect(null);}}>
      <KLayer><Rect name="paper" width={paper.width} height={paper.height} fill={canvasGround(project.background)}/>
        {project.layers.map(l=><Fragment key={l.id} item={l} asset={assets.find(a=>a.id===l.assetId)} selected={l.id===selected} onSelect={()=>onSelect(l.id)} onChange={c=>onChange(l.id,c)} cutting={cutting&&l.id===selected} onCutPoint={onCutPoint} showSources={showSources} editable={editable} bounds={paper}/>)}
        {cutting&&selectedLayer&&<Group name="editor-only" x={selectedLayer.x} y={selectedLayer.y} rotation={selectedLayer.rotation} listening={false}><Line points={cutPoints.map((v,i)=>v*(i%2?selectedLayer.height:selectedLayer.width))} stroke="#555" strokeWidth={4} closed={cutPoints.length>=6} fill="rgba(80,80,80,.1)"/>{Array.from({length:cutPoints.length/2},(_,i)=><Rect key={i} x={cutPoints[i*2]*selectedLayer.width-5} y={cutPoints[i*2+1]*selectedLayer.height-5} width={10} height={10} fill="#555"/>)}</Group>}
      </KLayer>
    </Stage>
  </div>;
});

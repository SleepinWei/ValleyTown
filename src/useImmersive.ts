import { useEffect, useRef, useState } from 'react';
export function useImmersive(){
  const root=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null);
  const [immersive,setImmersive]=useState(false);
  const native=useRef(false);
  const exit=async()=>{if(document.fullscreenElement===root.current)await document.exitFullscreen().catch(()=>{});native.current=false;setImmersive(false);button.current?.focus();};
  const toggle=async()=>{if(immersive){await exit();return;}setImmersive(true);try{if(root.current?.requestFullscreen){await root.current.requestFullscreen();native.current=true;}}catch{/* Embedded browsers still get a viewport-filling immersive view. */}};
  useEffect(()=>{const change=()=>{if(!document.fullscreenElement&&native.current){native.current=false;setImmersive(false);button.current?.focus();}};document.addEventListener('fullscreenchange',change);return()=>document.removeEventListener('fullscreenchange',change);},[]);
  useEffect(()=>{if(!immersive)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.querySelector('[role="dialog"]'))void exit();};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',key);};},[immersive]);
  return {root,button,immersive,toggle};
}

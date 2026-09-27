import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { MAP_W, MAP_H, locations, peaks, terrainAt, walkable, regions } from '../../shared/map';
import { daylight, weatherInfo } from '../../shared/weather';
import { freshLife, type Point, type PublicActor, type Snapshot } from '../../shared/types';
import { PresentationClock } from './PresentationClock';
import { BoundaryClouds } from './boundaryClouds';
import { createWater, lensShader, pixelCloudTexture } from './environment';
import { actorTexture, canvasTexture, glowTexture, groundTexture, noise, pixelSurface } from './textures';

export type ViewState={yaw:number;pitch:number;overview:boolean;labels:{id:string;text:string;x:number;y:number;actor?:boolean}[];x:number;y:number;w:number;h:number};
export type RendererCallbacks={getWorld:()=>Snapshot;getSelected:()=>string;select:(id:string)=>void;move:(x:number,y:number)=>void;interact:()=>void;view:(v:ViewState)=>void;error:(text:string)=>void};
const elevation=(x:number,z:number)=>z<48?Math.max(0,(48-z)/20)*(1+.12*Math.sin(x*.13)):0;
type Person={mesh:THREE.Mesh;frames:THREE.CanvasTexture[];ring:THREE.Mesh;umbrella:THREE.Group;prop:THREE.Group;id:string};
export class TownRenderer {
  readonly renderer:THREE.WebGLRenderer;private scene=new THREE.Scene();private camera=new THREE.OrthographicCamera(-30,30,25,-25,.1,600);
  private composer:EffectComposer;private bloom:UnrealBloomPass;private lens:ShaderPass;
  private presentationClock=new PresentationClock();private shadowClock=NaN;
  private moon=new THREE.DirectionalLight(0x93b8d9,0);
  private sun=new THREE.DirectionalLight(0xffe0a0,2.7);private ambient=new THREE.AmbientLight(0xbcc6b4,.8);private sky=new THREE.HemisphereLight(0xb9d7e8,0x59613a,2);
  private target=new THREE.Vector3(108,0,80);private span=58;private yaw=.15;private pitch=.70;private overview=false;private follow=false;
  private width=1;private height=1;private disposed=false;private lost=false;private raf=0;private lastTime=0;private motion=0;private lastVisualClock?:number;private lastLabels=0;private lastShadow=-Infinity;private lastMove=0;private lastTask?:string;
  private effects=true;private reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;private media=window.matchMedia('(prefers-reduced-motion: reduce)');
  private observer:ResizeObserver;private people=new Map<string,Person>();private keys=new Set<string>();private pointer:{x:number;y:number;start:THREE.Vector3;dragged:boolean}|null=null;private raycaster=new THREE.Raycaster();private ground!:THREE.Mesh;
  private clouds:{mesh:THREE.Mesh<THREE.PlaneGeometry,THREE.MeshLambertMaterial>;x:number;z:number;speed:number}[]=[];
  private cloudDrift=0;
  private boundaryClouds=new BoundaryClouds();
  private weatherVisual: {cloud:number;rain:number;fog:number;wind:number}|null=null;
  private water!:THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>;private rain!:THREE.LineSegments;private rainPositions=new Float32Array(500*6);
  private lamps:{position:THREE.Vector3;glow:THREE.Sprite}[]=[];private pointLights=Array.from({length:4},()=>new THREE.PointLight(0xffb859,0,16,2));
  private windows=new THREE.MeshStandardMaterial({color:0xf8d896,emissive:0xffb747,emissiveIntensity:.1,roughness:.6});private resources=new Set<THREE.Texture>();
  constructor(private host:HTMLDivElement,private callbacks:RendererCallbacks){
    this.renderer=new THREE.WebGLRenderer({antialias:false,alpha:false,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;this.renderer.shadowMap.autoUpdate=false;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.18;this.renderer.domElement.dataset.renderer='threejs';this.renderer.domElement.setAttribute('aria-label','Three.js HD-2D 溪谷镇');host.append(this.renderer.domElement);
    this.scene.background=new THREE.Color('#879a89');this.scene.fog=new THREE.Fog('#879a89',220,440);this.scene.add(this.ambient,this.sky,this.sun,this.sun.target,this.moon,this.moon.target,...this.pointLights);
    this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.camera.near=1;this.sun.shadow.camera.far=300;this.sun.shadow.bias=-.0004;this.sun.shadow.normalBias=.04;this.sun.shadow.radius=2;
    this.buildWorld();
    this.composer=new EffectComposer(this.renderer);
    for(const target of [this.composer.renderTarget1,this.composer.renderTarget2]){target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);}
    this.composer.addPass(new RenderPass(this.scene,this.camera));this.bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.3,.7,.85);this.composer.addPass(this.bloom);this.lens=new ShaderPass(lensShader);this.composer.addPass(this.lens);this.composer.addPass(new OutputPass());
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resize();this.bind();this.raf=requestAnimationFrame(this.frame);
  }
  private texture<T extends THREE.Texture>(t:T):T{this.resources.add(t);return t;}
  private material(color:string,map?:THREE.Texture){return new THREE.MeshStandardMaterial({color,map:map??null,roughness:.95,metalness:0});}
  private box(x:number,y:number,z:number,w:number,h:number,d:number,material:THREE.Material,shadow=true){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);mesh.castShadow=shadow;mesh.receiveShadow=true;this.scene.add(mesh);return mesh;}
  private buildWorld(){
    const geo=new THREE.PlaneGeometry(MAP_W,MAP_H,MAP_W,MAP_H);geo.rotateX(-Math.PI/2);geo.translate(MAP_W/2,0,MAP_H/2);const pos=geo.attributes.position;for(let i=0;i<pos.count;i++)pos.setY(i,elevation(pos.getX(i),pos.getZ(i))-( ['sea','lake','river'].includes(terrainAt(pos.getX(i),pos.getZ(i)))?.5:0));geo.computeVertexNormals();
    this.ground=new THREE.Mesh(geo,this.material('#ffffff',this.texture(groundTexture())));this.ground.receiveShadow=true;this.scene.add(this.ground);
    this.water=createWater();this.scene.add(this.water);
    this.buildClouds();
    this.scene.add(this.boundaryClouds);
    const wood=this.material('#b39461',this.texture(pixelSurface('wood','#dbc19b'))),stone=this.material('#aaa58d',this.texture(pixelSurface('stone','#b6b3a0')));
    for(const l of locations){if(l.kind==='prison')this.prison(l);if(l.kind==='shop'||l.kind==='home')this.building(l);if(l.kind==='pier'){this.box(l.x+l.w/2,.12,l.y+l.h/2,l.w,.35,l.h,wood);for(let z=l.y;z<=l.y+l.h;z+=2){this.box(l.x,.55,z,.25,1.2,.25,wood);this.box(l.x+l.w,.55,z,.25,1.2,.25,wood);}}if(l.kind==='camp')this.camp(l);if(l.kind==='summit'){this.box(l.x+l.w/2,elevation(l.x,l.y)+.2,l.y+l.h/2,l.w,.4,l.h,stone);}}
    for(const z of [42,76,87,99,130,148]){const h=elevation(135,z);this.box(135.5,h+.1,z+1.5,7,.3,4,wood);for(const zz of [z-.3,z+3.3]){this.box(135.5,h+.85,zz,7,.14,.15,wood);for(const x of [132,134,137,139])this.box(x,h+.5,zz,.16,1.2,.18,wood);}}
    this.trees();
    for(const p of peaks){const g=new THREE.ConeGeometry(1,1,7,2),mat=this.material('#91958a',this.texture(pixelSurface('stone','#c7c7b3')));const mesh=new THREE.Mesh(g,mat);mesh.position.set(p.x,elevation(p.x,p.y)+p.ry*.65,p.y);mesh.scale.set(p.rx,p.ry*1.5,p.ry);mesh.rotation.y=p.x;mesh.castShadow=true;mesh.receiveShadow=true;this.scene.add(mesh);const snow=new THREE.Mesh(new THREE.ConeGeometry(1,1,7),this.material('#d8dbcb'));snow.position.set(p.x,elevation(p.x,p.y)+p.ry*1.13,p.y);snow.scale.set(p.rx*.3,p.ry*.5,p.ry*.3);snow.rotation.y=p.x;this.scene.add(snow);}
    // Fountain, raised garden beds, benches, hoops and lanterns anchor the town.
    const fountain=new THREE.Mesh(new THREE.CylinderGeometry(2.4,2.6,.5,16),stone);fountain.position.set(108,.3,76);fountain.receiveShadow=true;this.scene.add(fountain);const basin=new THREE.Mesh(new THREE.CylinderGeometry(2,2,.12,16),this.material('#6ba3a1'));basin.position.set(108,.59,76);this.scene.add(basin);this.box(108,1.3,76,.4,1.5,.4,stone);
    for(let row=0;row<3;row++)for(let col=0;col<7;col++){this.box(80+col,.14,74+row*2,.8,.3,1.4,this.material('#68593c'));const flower=new THREE.Mesh(new THREE.SphereGeometry(.23,5,3),this.material(['#de9a99','#e5c66f','#9b83b1'][col%3]));flower.position.set(80+col,.65,74+row*2);this.scene.add(flower);}
    for(const [x,z]of [[99,86],[118,85],[142,79],[63,102]]){this.box(x,.6,z,2.4,.25,.6,wood);this.box(x,.95,z-.3,2.4,.9,.18,wood);for(const dx of [-.85,.85])this.box(x+dx,.3,z,.16,.6,.5,wood);}
    for(const z of [117,129]){this.box(125,1.5,z,.15,3,.15,stone);this.box(125,3,z,1.3,.8,.13,this.material('#e0d9b8'));const hoop=new THREE.Mesh(new THREE.TorusGeometry(.35,.035,6,12),this.material('#bb643e'));hoop.rotation.x=Math.PI/2;hoop.position.set(125,2.7,z+(z===117?.5:-.5));this.scene.add(hoop);}
    for(const [x,z]of [[97,72],[118,72],[97,85],[118,85],[89,92],[125,97],[104,106],[78,148],[111,149],[66,104],[107,45],[196,88]]){const h=elevation(x,z);this.box(x,h+1.7,z,.14,3.4,.14,this.material('#485645'));this.box(x,h+3.4,z,.5,.65,.5,this.windows);this.box(x,h+3.8,z,.7,.15,.7,wood);this.light(x,h+3.5,z,5);}
    const rainGeo=new THREE.BufferGeometry();rainGeo.setAttribute('position',new THREE.BufferAttribute(this.rainPositions,3));this.rain=new THREE.LineSegments(rainGeo,new THREE.LineBasicMaterial({color:0xb7d9df,transparent:true,opacity:.32,depthWrite:false}));this.rain.frustumCulled=false;this.scene.add(this.rain);
  }
  private buildClouds(){
    const maps=[0,1,2].map(i=>this.texture(pixelCloudTexture(80+i*17)));
    const geometry=new THREE.PlaneGeometry(1,1);
    for(let i=0;i<36;i++){
      const material=new THREE.MeshLambertMaterial({map:maps[i%3],transparent:true,opacity:.7,depthWrite:false,side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(geometry,material),x=(i%6)*48+noise(i+90)*16,z=Math.floor(i/6)*42+noise(i+50)*20;
      mesh.rotation.x=-Math.PI/2;mesh.rotation.z=.12;mesh.scale.set(19+noise(i+1)*15,13+noise(i+2)*8,1);
      mesh.position.set(x,19+noise(i+3)*7,z);this.scene.add(mesh);
      this.clouds.push({mesh,x,z,speed:.35+noise(i+4)*.35});
    }
    // Project a slow cloud field into the ground's existing material, without another shadow pass.
    const material=this.ground.material as THREE.MeshStandardMaterial;
    material.onBeforeCompile=shader=>{
      shader.uniforms.cloudTime={value:0};shader.uniforms.cloudAmount={value:0};
      material.userData.cloudUniforms=shader.uniforms;
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 cloudWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\ncloudWorld=position.xz;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        varying vec2 cloudWorld;uniform float cloudTime,cloudAmount;`).replace('#include <color_fragment>',`#include <color_fragment>
        vec2 cp=cloudWorld*.09+vec2(cloudTime*.012,cloudTime*.004);
        float shade=smoothstep(.15,.72,sin(cp.x+sin(cp.y*.7))*cos(cp.y*.8));
        diffuseColor.rgb*=1.-shade*cloudAmount*.24;`);
    };
  }
  private building(l:typeof locations[number]){
    const base=elevation(l.x+l.w/2,l.y+l.h/2),x=l.x+l.w/2,z=l.y+l.h/2,height=l.id==='lighthouse'?9:4.3;
    if(l.id==='lighthouse'){const tower=new THREE.Mesh(new THREE.CylinderGeometry(1.6,2.2,height,12),this.material('#e7dfc2'));tower.position.set(x,base+height/2,z);tower.castShadow=true;this.scene.add(tower);this.box(x,base+height+.6,z,2.8,1.2,2.8,this.windows);this.light(x,base+height+1,z,10);}
    else{
      const wall=this.material('#f1e6c7',this.texture(pixelSurface('wall','#c6b48b')));this.box(x,base+height/2,z,l.w,height,l.h,wall);const timber=this.material('#6a5944',this.texture(pixelSurface('wood','#b5a177')));
      for(const xx of [l.x+.15,l.x+l.w-.15])this.box(xx,base+height/2,l.y+l.h+.02,.22,height+.1,.22,timber);this.box(x,base+.3,l.y+l.h+.06,l.w,.6,.18,timber);this.box(x,base+height-.1,l.y+l.h+.06,l.w,.25,.2,timber);
      const shape=new THREE.Shape();shape.moveTo(-l.w/2-.5,0);shape.lineTo(l.w/2+.5,0);shape.lineTo(0,2.9);shape.closePath();const roofGeo=new THREE.ExtrudeGeometry(shape,{depth:l.h+1,bevelEnabled:false});const roofMap=this.texture(pixelSurface('roof',l.color));roofMap.wrapS=roofMap.wrapT=THREE.RepeatWrapping;roofMap.repeat.set(.2,.2);const roof=new THREE.Mesh(roofGeo,this.material('#ffffff',roofMap));roof.position.set(x,base+height,l.y-.5);roof.castShadow=true;roof.receiveShadow=true;this.scene.add(roof);
      this.box(l.x+l.w-1.2,base+height+2.6,l.y+2,.65,2,.7,this.material('#8f7660'));
      this.box(l.door.x,base+1.3,l.y+l.h+.13,1.25,2.6,.18,timber);this.box(l.door.x+.38,base+1.25,l.y+l.h+.25,.1,.1,.08,this.material('#d4b566'));
      for(const xx of [l.x+1.6,l.x+l.w-1.7]){this.box(xx,base+2.35,l.y+l.h+.14,1.5,1.55,.16,timber);this.box(xx,base+2.35,l.y+l.h+.24,1.18,1.2,.1,this.windows);this.box(xx,base+2.35,l.y+l.h+.32,.1,1.2,.06,timber);this.box(xx,base+2.35,l.y+l.h+.32,1.18,.1,.06,timber);this.light(xx,base+2.35,l.y+l.h+.4,4);}
      if(l.id==='bakery'||l.id==='market')for(let i=0;i<8;i++){const awning=this.box(l.x+.5+(i+.5)*(l.w-1)/8,base+3.25,l.y+l.h+.65,(l.w-1)/8,.16,1.4,this.material(i%2?'#e8d9b1':l.color));awning.rotation.x=.2;}
    }
  }
  private prison(l:typeof locations[number]){
    const stone=this.material('#8e9790',this.texture(pixelSurface('stone','#a8ada3'))),iron=this.material('#465653'),floor=this.material('#b9b6a0'),wood=this.material('#907754');
    this.box(l.x+l.w/2,.02,l.y+l.h/2,l.w,.16,l.h,floor);
    this.box(157.5,1.8,94,16,3.6,.7,stone);
    for(const x of [150,165])this.box(x,1.8,100,.7,3.6,12,stone);
    for(const [x,w]of [[153.5,7],[162,6]])this.box(x,.6,106,w,1.2,.45,stone);
    for(let x=150;x<=165;x+=.65)if(Math.abs(x-158)>.65)this.box(x,1.75,106,.07,2,.07,iron);
    for(const x of [152.8,157.2,161.6]){
      this.box(x,.48,96,2.5,.8,1.3,wood);this.box(x,.94,96,2.4,.12,1.25,this.material('#a2aa9c'));
      for(let bx=x-1.8;bx<x+1.8;bx+=.4)this.box(bx,1.6,98,.055,3.1,.055,iron);
      this.box(x,3.1,98,3.8,.12,.1,iron);
    }
    for(const x of [150,165])for(const z of [94,106]){
      this.box(x,2.8,z,1.5,5.6,1.5,stone);this.box(x,5.7,z,2,.25,2,iron);
      this.box(x,4.8,z+.8,.6,.5,.1,this.windows);this.light(x,4.9,z+1,4);
    }
    this.box(158,3.6,106,4,.8,.3,iron);this.box(158,3.6,106.18,2.6,.4,.05,this.windows);
    this.box(161, .65,103,3,.25,.9,wood);this.box(157,.2,103,2,.3,1.7,this.material('#7b906f'));
  }
  private light(x:number,y:number,z:number,size:number){const texture=this.resources.size&&[...this.resources].find(t=>t.name==='lamp-glow')||this.texture(glowTexture());texture.name='lamp-glow';const material=new THREE.SpriteMaterial({map:texture,color:0xffd28c,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,opacity:0});const glow=new THREE.Sprite(material);glow.position.set(x,y,z);glow.scale.set(size,size,1);this.scene.add(glow);this.lamps.push({position:glow.position,glow});}
  private camp(l:typeof locations[number]){const h=elevation(l.x,l.y);for(const x of [l.x+1.5,l.x+6]){const shape=new THREE.Shape();shape.moveTo(-1.8,0);shape.lineTo(1.8,0);shape.lineTo(0,2.5);shape.closePath();const tent=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:3,bevelEnabled:false}),this.material(l.color));tent.position.set(x,h,l.y);tent.castShadow=true;this.scene.add(tent);const door=new THREE.Mesh(new THREE.PlaneGeometry(1.1,1.6),this.material('#343e33'));door.position.set(x,h+.8,l.y+3.01);this.scene.add(door);}const fire=new THREE.Mesh(new THREE.ConeGeometry(.4,1,6),this.windows);fire.position.set(l.x+4,h+.5,l.y+5);this.scene.add(fire);this.light(l.x+4,h+.7,l.y+5,6);}
  private trees(){
    const points:{x:number;z:number;s:number;pine:boolean}[]=[];const clear=(x:number,z:number)=>locations.some(l=>x>l.x-3&&x<l.x+l.w+3&&z>l.y-4&&z<l.y+l.h+4)||(x>78&&x<150&&z>57&&z<105)||Math.abs(x-108)<4||Math.abs(z-78)<4||Math.abs(z-130)<3||Math.abs(z-148)<3||Math.abs(x-68)<4;
    for(let z=7;z<149;z+=4)for(let x=5;x<237;x+=4){const t=terrainAt(x,z);if(['forest','grass','mountain','wetland'].includes(t)&&!clear(x,z)&&noise(x+z*240)>(t==='forest'?.16:.52))points.push({x:x+noise(x+z)*.8,z,s:.75+noise(x*z)*.5,pine:z<48});}
    const trunk=new THREE.InstancedMesh(new THREE.CylinderGeometry(.25,.38,2.6,5),this.material('#715638'),points.length),leaves=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1,0),this.material('#ffffff',this.texture(canvasTexture(32,32,ctx=>{ctx.fillStyle='#b9cc91';ctx.fillRect(0,0,32,32);for(let i=0;i<150;i++){ctx.fillStyle=i%3?'#8da76b':'#e0dcb0';ctx.fillRect(Math.floor(noise(i)*16)*2,Math.floor(noise(i+400)*16)*2,2,2);}}))),points.length),pines=new THREE.InstancedMesh(new THREE.ConeGeometry(2.2,5.5,7),this.material('#3c6348'),points.length);
    const dummy=new THREE.Object3D();for(const [i,p]of points.entries()){const y=elevation(p.x,p.z);dummy.position.set(p.x,y+1.3*p.s,p.z);dummy.rotation.set(0,0,0);dummy.scale.set(p.s,p.s,p.s);dummy.updateMatrix();trunk.setMatrixAt(i,dummy.matrix);dummy.position.y=y+3.8*p.s;dummy.rotation.y=p.x;dummy.scale.set(p.pine?0:2*p.s,p.pine?0:2.2*p.s,p.pine?0:1.8*p.s);dummy.updateMatrix();leaves.setMatrixAt(i,dummy.matrix);leaves.setColorAt(i,new THREE.Color().setHSL(.23+noise(i)*.06,.25,.70+noise(i+40)*.12));dummy.position.y=y+3.6*p.s;dummy.scale.set(p.pine?p.s:0,p.pine?p.s:0,p.pine?p.s:0);dummy.updateMatrix();pines.setMatrixAt(i,dummy.matrix);}
    for(const mesh of [trunk,leaves,pines]){mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();this.scene.add(mesh);}
  }
  private person(a:PublicActor):Person{
    const frames=[0,1,2].map(f=>this.texture(actorTexture(a,f)));const material=new THREE.MeshBasicMaterial({map:frames[0],transparent:true,alphaTest:.4,side:THREE.DoubleSide});const mesh=new THREE.Mesh(new THREE.PlaneGeometry(2.2,3.3),material);mesh.position.set(a.x,elevation(a.x,a.y)+1.65,a.y);mesh.castShadow=true;this.scene.add(mesh);
    const ring=new THREE.Mesh(new THREE.RingGeometry(.68,.79,24),new THREE.MeshBasicMaterial({color:a.id==='player'?0xf3d691:0xece8cc,transparent:true,opacity:.8,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;this.scene.add(ring);
    const umbrella=new THREE.Group(),canopy=new THREE.Mesh(new THREE.ConeGeometry(1.2,.55,8),this.material(a.color)),pole=new THREE.Mesh(new THREE.CylinderGeometry(.03,.03,1.8,4),this.material('#65583d'));canopy.position.y=3.8;pole.position.set(.3,2.8,0);umbrella.add(canopy,pole);this.scene.add(umbrella);
    const prop=new THREE.Group();const rod=new THREE.Mesh(new THREE.CylinderGeometry(.025,.04,2.4,4),this.material('#8c6a42'));rod.rotation.z=-.55;rod.position.set(.85,1.6,0);prop.add(rod);this.scene.add(prop);
    const result={mesh,frames,ring,umbrella,prop,id:a.id};this.people.set(a.id,result);return result;
  }
  control(action:string,point?:Point){
    if(action==='overview'){this.overview=true;this.follow=false;this.target.set(120,0,87);this.pitch=1.05;this.span=Math.max(196,260/(this.width/this.height));}
    else if(action==='in'||action==='out'){this.overview=false;this.span=THREE.MathUtils.clamp(this.span*(action==='in'?.76:1.3),18,290);}
    else if(action==='rotate-left'||action==='rotate-right'){this.yaw+=action==='rotate-left'?-.2:.2;}
    else{const w=this.callbacks.getWorld(),p=point??(action==='selected'?w.actors.find(a=>a.id===this.callbacks.getSelected())??w.player:w.player);this.target.set(p.x,0,p.y);this.overview=false;this.follow=action==='player';this.pitch=.70;this.span=action==='region'?58:35;}
    this.updateCamera();this.lastLabels=0;
  }
  orbit(deltaYaw:number,deltaPitch:number){
    this.yaw=Math.atan2(Math.sin(this.yaw+deltaYaw),Math.cos(this.yaw+deltaYaw));
    this.pitch=THREE.MathUtils.clamp(this.pitch+deltaPitch,.42,1.38);
    this.updateCamera();this.lastLabels=0;this.shadowClock=NaN;
  }
  resetOrbit(){this.yaw=.15;this.pitch=this.overview?1.05:.70;this.updateCamera();this.lastLabels=0;this.shadowClock=NaN;}
  setEffects(value:boolean){this.effects=value;this.bloom.enabled=value;this.lens.uniforms.strength.value=value?1:0;}
  private updateCamera(){const aspect=this.width/this.height;this.camera.left=-this.span*aspect/2;this.camera.right=this.span*aspect/2;this.camera.top=this.span/2;this.camera.bottom=-this.span/2;const d=Math.max(175,this.span*.7/Math.tan(this.pitch)+60);this.camera.far=d+this.span/Math.tan(this.pitch)+160;this.lens.uniforms.far.value=this.camera.far;this.lens.uniforms.focus.value=d;this.camera.position.set(this.target.x+Math.sin(this.yaw)*Math.cos(this.pitch)*d,Math.sin(this.pitch)*d,this.target.z+Math.cos(this.yaw)*Math.cos(this.pitch)*d);this.camera.lookAt(this.target);this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();this.boundaryClouds.updateCoverage(this.camera);}
  private resize(){const {width,height}=this.host.getBoundingClientRect();if(width<1||height<1)return;this.width=width;this.height=height;this.renderer.setSize(width,height,false);this.composer.setSize(width,height);this.lens.uniforms.resolution.value.set(width,height);if(this.overview)this.span=Math.max(196,260/(width/height));this.updateCamera();}
  private hit(clientX:number,clientY:number){const rect=this.host.getBoundingClientRect();this.raycaster.setFromCamera(new THREE.Vector2((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1),this.camera);return this.raycaster.intersectObject(this.ground)[0]?.point;}
  private down=(e:PointerEvent)=>{if(e.button!==0)return;this.host.setPointerCapture(e.pointerId);this.pointer={x:e.clientX,y:e.clientY,start:this.target.clone(),dragged:false};};
  private movePointer=(e:PointerEvent)=>{if(!this.pointer)return;const dx=e.clientX-this.pointer.x,dy=e.clientY-this.pointer.y;if(Math.hypot(dx,dy)<5&&!this.pointer.dragged)return;this.pointer.dragged=true;this.follow=false;const units=this.span/this.height;this.target.x=THREE.MathUtils.clamp(this.pointer.start.x-dx*units*Math.cos(this.yaw)-dy*units*Math.sin(this.yaw)/Math.sin(this.pitch),0,MAP_W);this.target.z=THREE.MathUtils.clamp(this.pointer.start.z+dx*units*Math.sin(this.yaw)-dy*units*Math.cos(this.yaw)/Math.sin(this.pitch),0,MAP_H);this.updateCamera();};
  private up=(e:PointerEvent)=>{const dragged=this.pointer?.dragged;this.pointer=null;if(this.host.hasPointerCapture(e.pointerId))this.host.releasePointerCapture(e.pointerId);if(dragged)return;const hit=this.hit(e.clientX,e.clientY);if(!hit)return;if(this.overview){this.control('region',{x:hit.x,y:hit.z});return;}const rect=this.host.getBoundingClientRect();const actor=this.callbacks.getWorld().actors.find(a=>{if(a.life.status==='dead')return false;const v=new THREE.Vector3(a.x,elevation(a.x,a.y)+1.6,a.y).project(this.camera);return Math.hypot((v.x+1)*rect.width/2-(e.clientX-rect.left),(-v.y+1)*rect.height/2-(e.clientY-rect.top))<20;});if(actor)this.callbacks.select(actor.id);else if(walkable(Math.round(hit.x),Math.round(hit.z)))this.callbacks.move(Math.round(hit.x),Math.round(hit.z));};
  private wheel=(e:WheelEvent)=>{e.preventDefault();this.control(e.deltaY<0?'in':'out');};
  private keydown=(e:KeyboardEvent)=>{if(this.typing())return;const key=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','e'].includes(key)){e.preventDefault();this.keys.add(key);if(key==='e'&&!e.repeat)this.callbacks.interact();}};
  private keyup=(e:KeyboardEvent)=>this.keys.delete(e.key.toLowerCase());private blur=()=>{this.keys.clear();this.pointer=null;};private reducedChange=()=>{this.reduced=this.media.matches;};
  private contextLost=(e:Event)=>{e.preventDefault();this.lost=true;this.callbacks.error('3D 画面暂时中断，正在恢复图形上下文。');};private contextRestored=()=>{this.lost=false;this.callbacks.error('');};
  private typing(){const active=document.activeElement;return active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement||active instanceof HTMLSelectElement||!!active?.closest('.orbit-gizmo')||!!document.querySelector('[role="dialog"]');}
  private bind(){this.host.addEventListener('pointerdown',this.down);this.host.addEventListener('pointermove',this.movePointer);this.host.addEventListener('pointerup',this.up);this.host.addEventListener('pointercancel',this.blur);this.host.addEventListener('wheel',this.wheel,{passive:false});window.addEventListener('keydown',this.keydown);window.addEventListener('keyup',this.keyup);window.addEventListener('blur',this.blur);this.media.addEventListener('change',this.reducedChange);this.renderer.domElement.addEventListener('webglcontextlost',this.contextLost);this.renderer.domElement.addEventListener('webglcontextrestored',this.contextRestored);}
  private frame=(now:number)=>{if(this.disposed)return;this.raf=requestAnimationFrame(this.frame);if(this.lost)return;const dt=Math.min((now-this.lastTime)/1000,.08);this.lastTime=now;const world=this.callbacks.getWorld(),running=!world.status.startsWith('paused');
    const visualClock=this.presentationClock.sample(world,now),light=daylight(visualClock),desiredWeather=weatherInfo(world.weather);
    const gameDelta=this.lastVisualClock===undefined?0:visualClock-this.lastVisualClock;this.lastVisualClock=visualClock;
    const motionDelta=running&&gameDelta>=0&&gameDelta<120?gameDelta/.8:0;if(!this.reduced)this.motion+=motionDelta;
    if(!this.weatherVisual)this.weatherVisual={...desiredWeather};
    const blend=this.reduced?1:1-Math.exp(-dt*1.4);
    for(const key of ['cloud','rain','fog','wind'] as const){const next=THREE.MathUtils.lerp(this.weatherVisual[key],desiredWeather[key],blend);this.weatherVisual[key]=Math.abs(next-desiredWeather[key])<.001?desiredWeather[key]:next;}
    const weather=this.weatherVisual;if(running&&!this.reduced)this.cloudDrift+=motionDelta*(.4+weather.wind);const task=world.player.outdoor.task?.id;if(task&&task!==this.lastTask)this.control('player');this.lastTask=task;
    this.boundaryClouds.updateLight(light.sun,light.warm,weather.rain);
    if(this.follow){this.target.x=THREE.MathUtils.lerp(this.target.x,world.player.x,.08);this.target.z=THREE.MathUtils.lerp(this.target.z,world.player.y,.08);this.updateCamera();}
    const sunColor=new THREE.Color('#ffe8bb').lerp(new THREE.Color('#f9ba73'),light.warm).lerp(new THREE.Color('#93b8d9'),light.night*.75);this.sun.color.copy(sunColor);this.sun.intensity=light.directSun*light.sun*2.9*(1-weather.cloud*.78);
    this.sun.position.set(this.target.x+light.direction.x*120,this.target.y+light.direction.y*120,this.target.z+light.direction.z*120);this.sun.target.position.copy(this.target);
    this.moon.position.set(this.target.x-light.direction.x*120,this.target.y-light.direction.y*120,this.target.z-light.direction.z*120);this.moon.target.position.copy(this.target);this.moon.intensity=light.moon*.22*(1-weather.cloud*.4);this.sky.intensity=(.55+light.sun*1.25)*(1-weather.cloud*.28);this.ambient.intensity=(.4+light.sun*.8)*(1-weather.cloud*.22);this.sky.color.set('#c0d4df').lerp(new THREE.Color('#7d94b5'),light.night);this.renderer.toneMappingExposure=.95+light.sun*.15;
    const fog=this.scene.fog as THREE.Fog;fog.color.set('#8fa99e').lerp(new THREE.Color('#c4b096'),light.warm*.4).lerp(new THREE.Color('#708892'),weather.rain*.5).lerp(new THREE.Color('#a1aea0'),Math.min(1,weather.fog*1.5)).lerp(new THREE.Color('#172d40'),light.night);fog.near=210-weather.fog*180;fog.far=470-weather.fog*260;this.scene.background=fog.color;
    const shadowRange=Math.min(135,Math.max(35,this.span));Object.assign(this.sun.shadow.camera,{left:-shadowRange,right:shadowRange,top:shadowRange,bottom:-shadowRange});this.sun.shadow.camera.updateProjectionMatrix();if(running||visualClock!==this.shadowClock||now-this.lastShadow>120){this.renderer.shadowMap.needsUpdate=true;this.lastShadow=now;this.shadowClock=visualClock;}
    this.windows.emissiveIntensity=.15+light.night*3;const lit=Math.max(light.night,weather.rain*.3);for(const lamp of this.lamps)(lamp.glow.material as THREE.SpriteMaterial).opacity=lit*.65;const nearest=[...this.lamps].sort((a,b)=>a.position.distanceToSquared(this.target)-b.position.distanceToSquared(this.target));this.pointLights.forEach((lamp,i)=>{lamp.position.copy(nearest[i].position);lamp.intensity=lit*35;});
    this.water.material.uniforms.time.value=this.motion;this.water.material.uniforms.day.value=light.sun;this.water.material.uniforms.rain.value=weather.rain;
    this.water.material.uniforms.cloud.value=weather.cloud;this.water.material.uniforms.warm.value=light.warm;
    const cloudUniforms=(this.ground.material as THREE.MeshStandardMaterial).userData.cloudUniforms;
    if(cloudUniforms){cloudUniforms.cloudTime.value=this.motion;cloudUniforms.cloudAmount.value=this.effects?weather.cloud*light.sun:0;}
    for(const [i,cloud] of this.clouds.entries()){
      cloud.mesh.visible=this.effects;
      cloud.mesh.position.x=((cloud.x+this.cloudDrift*cloud.speed)%(MAP_W+65))-25;
      cloud.mesh.material.opacity=(.24+weather.cloud*.47)*(i%3===0?1:weather.cloud)*(.65+light.sun*.35);
      cloud.mesh.material.color.setRGB(1-weather.rain*.32,1-weather.rain*.28,1-weather.rain*.18);
    }
    this.lens.uniforms.tDepth.value=this.composer.readBuffer.depthTexture;
    this.lens.uniforms.focusWidth.value=this.span*(this.overview?.7:.15);
    this.lens.uniforms.warm.value=light.warm;this.lens.uniforms.night.value=light.night;this.lens.uniforms.storm.value=weather.rain;
    this.bloom.strength=.24+light.warm*.13+light.night*.12;
    const player:PublicActor={life:freshLife(),age:25,id:'player',name:'你',role:'新住户',x:world.player.x,y:world.player.y,color:'#d5b263',hair:'#554331',skin:'#e3b590',activity:'',mood:'',energy:world.player.energy,home:'playerhome',busy:false,outdoor:world.player.outdoor};
    const visible=[...world.actors.filter(a=>a.life.status==='alive'),player];
    for(const [id,p]of this.people)if(!visible.some(a=>a.id===id)){p.mesh.visible=false;p.ring.visible=false;p.umbrella.visible=false;p.prop.visible=false;}
    for(const a of visible){const p=this.people.get(a.id)??this.person(a);p.mesh.visible=true;const scale=a.life.stage==='child'?.6:1;p.mesh.scale.setScalar(scale);const moving=Math.hypot(p.mesh.position.x-a.x,p.mesh.position.z-(a.y+.4))>.02;p.mesh.position.x=THREE.MathUtils.lerp(p.mesh.position.x,a.x,.2);p.mesh.position.z=THREE.MathUtils.lerp(p.mesh.position.z,a.y+.4,.2);p.mesh.position.y=elevation(a.x,a.y)+1.65*scale+(moving&&running&&!this.reduced?Math.sin(this.motion*18)*.06:0);p.mesh.rotation.y=this.yaw;(p.mesh.material as THREE.MeshBasicMaterial).map=p.frames[moving&&running?1+Math.floor(this.motion*7)%2:0];(p.mesh.material as THREE.MeshBasicMaterial).color.setRGB(.65+light.sun*.35,.67+light.sun*.33,.72+light.sun*.28);p.ring.position.set(a.x,elevation(a.x,a.y)+.05,a.y+.4);if(a.life.custody)(p.mesh.material as THREE.MeshBasicMaterial).color.set('#b2c2bd');p.ring.visible=a.id==='player'||a.id===this.callbacks.getSelected();p.umbrella.position.set(a.x,elevation(a.x,a.y),a.y+.4);p.umbrella.visible=weather.rain>.08&&!a.activity.includes('屋檐');p.prop.position.set(a.x,elevation(a.x,a.y),a.y+.4);p.prop.rotation.y=this.yaw;p.prop.visible=a.outdoor.task?.phase==='active'&&(a.outdoor.task.kind==='fishing'||a.outdoor.task.kind==='hunting');}
    const count=Math.floor(500*weather.rain);this.rain.visible=this.effects&&count>0;this.rain.geometry.setDrawRange(0,count*2);if(this.rain.visible){const spread=Math.max(35,this.span);for(let i=0;i<count;i++){const x=this.target.x+(noise(i+700)-.5)*spread*1.9,z=this.target.z+(noise(i+1000)-.5)*spread*1.7,y=elevation(x,z)+((noise(i+2)*18-this.motion*(12+weather.wind*6))%18+18)%18;this.rainPositions.set([x,y,z,x-.22*weather.wind,y+1,z+.05],i*6);}this.rain.geometry.attributes.position.needsUpdate=true;}
    if(running&&!this.typing()&&now-this.lastMove>160){let dx=0,dz=0;if(this.keys.has('w')||this.keys.has('arrowup'))dz=-1;if(this.keys.has('s')||this.keys.has('arrowdown'))dz=1;if(this.keys.has('a')||this.keys.has('arrowleft'))dx=-1;if(this.keys.has('d')||this.keys.has('arrowright'))dx=1;if(dx||dz){if(this.overview)this.control('player');this.follow=true;this.callbacks.move(Math.round(world.player.x)+dx,Math.round(world.player.y)+dz);this.lastMove=now;}}
    this.composer.render(dt);if(now-this.lastLabels>180){this.lastLabels=now;const labels:ViewState['labels']=[];const add=(id:string,text:string,x:number,y:number,z:number,actor=false)=>{const p=new THREE.Vector3(x,y,z).project(this.camera);if(Math.abs(p.x)<.98&&Math.abs(p.y)<.94)labels.push({id,text,x:(p.x+1)*50,y:(1-p.y)*50,actor});};if(this.overview)for(const r of regions)add(r.id,r.name,r.center.x,elevation(r.center.x,r.center.y)+4,r.center.y);else{for(const a of visible)add(a.id,a.name,a.x,elevation(a.x,a.y)+3.8,a.y,true);if(this.span<90)for(const l of locations)add(l.id,l.name,l.door.x,elevation(l.door.x,l.door.y)+.1,l.door.y+1.5);}this.callbacks.view({yaw:this.yaw,pitch:this.pitch,overview:this.overview,labels,x:this.target.x-this.span*this.width/this.height/2,y:this.target.z-this.span/2,w:this.span*this.width/this.height,h:this.span});}
  };
  dispose(){this.boundaryClouds.releaseInstances();this.disposed=true;cancelAnimationFrame(this.raf);this.observer.disconnect();this.host.removeEventListener('pointerdown',this.down);this.host.removeEventListener('pointermove',this.movePointer);this.host.removeEventListener('pointerup',this.up);this.host.removeEventListener('pointercancel',this.blur);this.host.removeEventListener('wheel',this.wheel);window.removeEventListener('keydown',this.keydown);window.removeEventListener('keyup',this.keyup);window.removeEventListener('blur',this.blur);this.media.removeEventListener('change',this.reducedChange);this.renderer.domElement.removeEventListener('webglcontextlost',this.contextLost);this.renderer.domElement.removeEventListener('webglcontextrestored',this.contextRestored);const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();this.scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.LineSegments){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}if(o instanceof THREE.Sprite)materials.add(o.material);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());this.resources.forEach(t=>t.dispose());this.composer.passes.forEach(p=>p.dispose());this.composer.dispose();this.sun.shadow.dispose();this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();}
}

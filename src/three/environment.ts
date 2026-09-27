import * as THREE from 'three';
import { MAP_W, MAP_H, terrainAt } from '../../shared/map';
import { canvasTexture, noise } from './textures';

// Depth is sampled from the scene pass, before bloom and colour grading.
export const lensShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) }, strength: { value: 1 },
    near: { value: .1 }, far: { value: 600 }, focus: { value: 175 },
    focusWidth: { value: 10 }, warm: { value: 0 }, night: { value: 0 }, storm: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `
    uniform sampler2D tDiffuse, tDepth;
    uniform vec2 resolution;
    uniform float strength, near, far, focus, focusWidth, warm, night, storm;
    varying vec2 vUv;
    void main(){
      vec3 original=texture2D(tDiffuse,vUv).rgb;
      if(strength<.001){gl_FragColor=vec4(original,1.);return;}
      float depth=mix(near,far,texture2D(tDepth,vUv).x);
      float coc=smoothstep(focusWidth,focusWidth*3.4,abs(depth-focus));
      vec2 radius=vec2(3.4)/resolution*coc*strength;
      vec3 c=original; float total=1.;
      for(int i=0;i<12;i++){
        float angle=float(i)*2.399963;
        vec2 offset=vec2(cos(angle),sin(angle))*sqrt((float(i)+.5)/12.);
        vec2 uv=clamp(vUv+offset*radius,vec2(0.),vec2(1.));
        float sampleDepth=mix(near,far,texture2D(tDepth,uv).x);
        // Reject foreground samples so silhouettes do not bleed over the background.
        float weight=mix(.08,1.,smoothstep(-focusWidth,0.,sampleDepth-depth));
        c+=texture2D(tDiffuse,uv).rgb*weight;total+=weight;
      }
      c/=total;
      float luminance=dot(c,vec3(.2126,.7152,.0722));
      float shadows=1.-smoothstep(.05,.65,luminance);
      c*=mix(vec3(1.),vec3(.87,1.015,1.08),shadows*(.2+night*.25+storm*.2));
      c*=mix(vec3(1.),vec3(1.10,1.015,.88),(.18+warm*.5)*(1.-shadows*.5));
      c=mix(vec3(luminance),c,1.04-storm*.13);
      vec2 q=(vUv-.5)*vec2(1.,.88);
      c*=1.-.23*smoothstep(.22,.66,length(q));
      gl_FragColor=vec4(mix(original,c,strength),1.);
    }`,
};

const isWater = (x: number, z: number) => x >= 0 && z >= 0 && x < MAP_W && z < MAP_H && ['sea', 'lake', 'river'].includes(terrainAt(x, z));

export function createWater() {
  // A shared corner depth field keeps colour and foam continuous across tile seams.
  const waterTiles = new Uint8Array(MAP_W * MAP_H);
  for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) waterTiles[z * MAP_W + x] = Number(isWater(x, z));
  const depths = new Float32Array((MAP_W + 1) * (MAP_H + 1));
  for (let z = 0; z <= MAP_H; z++) for (let x = 0; x <= MAP_W; x++) {
    let distance = 7;
    for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
      const xx = x + dx, zz = z + dz;
      if (xx >= 0 && zz >= 0 && xx < MAP_W && zz < MAP_H && !waterTiles[zz * MAP_W + xx]) {
        distance = Math.min(distance, Math.hypot(dx + .5, dz + .5));
      }
    }
    depths[z * (MAP_W + 1) + x] = distance;
  }
  const vertices: number[] = [], shore: number[] = [], sea: number[] = [];
  for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) if (isWater(x, z)) {
    for (const [dx, dz] of [[0, 0], [0, 1], [1, 0], [1, 0], [0, 1], [1, 1]]) {
      vertices.push(x + dx, -.12, z + dz);
      shore.push(depths[(z + dz) * (MAP_W + 1) + x + dx]);
      sea.push(terrainAt(x, z) === 'sea' ? 1 : 0);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('shore', new THREE.Float32BufferAttribute(shore, 1));
  geometry.setAttribute('sea', new THREE.Float32BufferAttribute(sea, 1));
  geometry.computeVertexNormals();
  const material = new THREE.ShaderMaterial({
    fog: true,
    uniforms: { ...THREE.UniformsLib.fog, time: { value: 0 }, day: { value: 1 }, rain: { value: 0 }, cloud: { value: 0 }, warm: { value: 0 } },
    vertexShader: `
      uniform float time; attribute float shore,sea;
      varying vec3 p; varying float bank,ocean;
      #include <fog_pars_vertex>
      void main(){
        p=position;bank=shore;ocean=sea;
        vec3 v=position;v.y+=sin(v.x*.65+time)*cos(v.z*.8+time*.7)*.024;
        vec4 mvPosition=modelViewMatrix*vec4(v,1.);gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float time,day,rain,cloud,warm;
      varying vec3 p;varying float bank,ocean;
      #include <fog_pars_fragment>
      float hash(vec2 n){return fract(sin(dot(n,vec2(127.1,311.7)))*43758.5453);}
      void main(){
        vec2 pixel=floor(p.xz*8.)/8.;
        float wave=sin(pixel.x*1.25+pixel.y*.8+time*.7)*sin(pixel.y*1.8-time*.65);
        float depth=smoothstep(.45,6.,bank);
        vec3 shallow=vec3(.16,.39,.34),deep=mix(vec3(.035,.17,.21),vec3(.025,.115,.19),ocean);
        vec3 c=mix(shallow,deep,depth)+wave*.015;
        float caustic=pow(1.-abs(sin(pixel.x*2.+time*.4)*cos(pixel.y*2.6-time*.3)),18.);
        c+=vec3(.08,.13,.08)*caustic*(1.-depth)*day;
        float crest=sin(pixel.y*2.7+sin(pixel.x*.42+time*.19)*2.+sin(pixel.x*.19-pixel.y*.2)*1.5-time*(.8+ocean*.3));
        float glitter=step(.975,crest)*step(.3,sin(pixel.x*3.4+sin(pixel.y*1.3)+time*.7))*mix(.15,1.,hash(floor(pixel*vec2(.55,.8))));
        vec3 reflection=mix(vec3(.6,.85,.88),vec3(1.,.62,.26),warm*.8);
        c+=reflection*glitter*(.13+day*.52)*(1.-cloud*.72);
        float foam=pow(max(0.,sin(bank*5.-time*1.25+wave*.65)),12.)*(1.-smoothstep(.7,2.1,bank));
        c+=vec3(.32,.46,.39)*foam*(.3+ocean*.5);
        vec2 cell=floor(p.xz*1.4);float phase=fract(time*1.1+hash(cell));
        float ring=1.-smoothstep(.025,.065,abs(length(fract(p.xz*1.4)-.5)-phase*.48));
        c+=vec3(.16,.24,.24)*ring*(1.-phase)*rain*step(.45,hash(cell+3.));
        c*=.22+day*.78;c=mix(c,c*vec3(.72,.88,1.),rain*.35);
        gl_FragColor=vec4(c,1.);
        #include <fog_fragment>
      }`,
  });
  return new THREE.Mesh(geometry, material);
}

export function pixelCloudTexture(seed: number) {
  return canvasTexture(96, 48, ctx => {
    // Paint quantised lobes into a silhouette, then light its upper edge.
    const lobes = Array.from({ length: 8 }, (_, i) => ({
      x: 15 + i * 9, y: 25 - Math.sin(i / 7 * Math.PI) * 9,
      rx: 12 + noise(seed + i) * 7, ry: 8 + noise(seed + i + 30) * 8,
    }));
    for (let y = 2; y < 46; y += 2) for (let x = 2; x < 94; x += 2) {
      if (!lobes.some(l => ((x-l.x)/l.rx)**2 + ((y-l.y)/l.ry)**2 < 1)) continue;
      ctx.fillStyle = y > 29 ? '#8a9eaf' : y > 23 ? '#b5c5ce' : y > 15 ? '#e0e6df' : '#fff4dd';
      ctx.fillRect(x, y, 2, 2);
    }
  });
}

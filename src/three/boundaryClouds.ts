import * as THREE from 'three';
import { MAP_W, MAP_H } from '../../shared/map';

const VOXEL = 3;
const BOTTOM = -24;
const CHUNK = 48;
const CLOUD_SPACING = 36;
const hash = (x:number,z:number) => {
  const n=Math.sin(x*127.1+z*311.7)*43758.5453;
  return n-Math.floor(n);
};
function softNoise(x:number,z:number){
  const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz;
  const u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix,iz),hash(ix+1,iz),u),THREE.MathUtils.lerp(hash(ix,iz+1),hash(ix+1,iz+1),u),v);
}

// Solid, stepped geometry, with exposed top and side faces. The continuous lower
// body prevents holes; coherent tiers above it form clustered voxel cloud banks.
export class BoundaryClouds extends THREE.Group {
  private geometry=new THREE.BoxGeometry(1,1,1);
  private material=new THREE.MeshLambertMaterial({color:0xeaf0f5,vertexColors:true,fog:false});
  private mesh=new THREE.InstancedMesh(this.geometry,this.material,1);
  private bounds='';
  private tint=new THREE.Color();
  private dayTint=new THREE.Color('#f4f3e7');
  private nightTint=new THREE.Color('#879dbb');
  private duskTint=new THREE.Color('#efbd94');
  constructor(){
    super();this.name='voxel-boundary-clouds';
    // Face tones make the steps legible even under overcast, diffuse light.
    const normals=this.geometry.attributes.normal,colors=new Float32Array(normals.count*3);
    for(let i=0;i<normals.count;i++){
      const shade=normals.getY(i)>.5?1:normals.getY(i)<-.5?.57:normals.getX(i)>.5?.86:.73;
      colors.set(normals.getY(i)>.5?[1,1,1]:[shade*.94,shade,Math.min(1,shade*1.08)],i*3);
    }
    this.geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    this.mesh.count=0;this.add(this.mesh);
  }
  updateCoverage(camera:THREE.OrthographicCamera){
    const span=camera.top-camera.bottom,voxel=span>450?12:span>150?6:VOXEL;
    const direction=camera.getWorldDirection(new THREE.Vector3());
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    // Cover the entire camera footprint, including the thickness of the bank.
    for(const x of [-1,1])for(const y of [-1,1])for(const height of [BOTTOM,36]){
      const p=new THREE.Vector3(x,y,0).unproject(camera);
      p.addScaledVector(direction,(height-p.y)/direction.y);
      minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);
    }
    const left=Math.floor((minX-CHUNK)/CHUNK)*CHUNK,right=Math.ceil((maxX+CHUNK)/CHUNK)*CHUNK;
    const top=Math.floor((minZ-CHUNK)/CHUNK)*CHUNK,bottom=Math.ceil((maxZ+CHUNK)/CHUNK)*CHUNK;
    const key=[left,right,top,bottom,voxel].join(':');if(key===this.bounds)return;this.bounds=key;
    const count=2*(right-left)*(bottom-top)/(voxel*voxel);
    if(count>this.mesh.instanceMatrix.count){
      this.remove(this.mesh);this.mesh.dispose();
      this.mesh=new THREE.InstancedMesh(this.geometry,this.material,Math.ceil(count*1.2));
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.castShadow=true;this.mesh.receiveShadow=true;this.add(this.mesh);
    }
    const matrix=new THREE.Matrix4(),color=new THREE.Color();let index=0;
    const put=(x:number,z:number,lo:number,hi:number,tone:number)=>{
      matrix.makeScale(voxel,hi-lo,voxel);matrix.setPosition(x+voxel/2,(hi+lo)/2,z+voxel/2);
      this.mesh.setMatrixAt(index,matrix);color.setScalar(tone);this.mesh.setColorAt(index,color);index++;
    };
    const lobes=new Map<string,{x:number;z:number;y:number;rx:number;rz:number;ry:number}[]>();
    for(let iz=Math.floor(top/CLOUD_SPACING)-1;iz<=Math.ceil(bottom/CLOUD_SPACING)+1;iz++)for(let ix=Math.floor(left/CLOUD_SPACING)-1;ix<=Math.ceil(right/CLOUD_SPACING)+1;ix++){
      const x=(ix+.5)*CLOUD_SPACING+(hash(ix+43,iz)-.5)*12,z=(iz+.5)*CLOUD_SPACING+(hash(ix,iz+57)-.5)*12;
      if(x>0&&x<MAP_W&&z>0&&z<MAP_H)continue;
      const seed=hash(ix,iz),y=11+hash(ix+91,iz)*5;
      lobes.set(`${ix}:${iz}`, [
        {x,z,y,rx:13+seed*5,rz:13+hash(ix,iz+71)*5,ry:7+seed*5},
        {x:x+8,z:z-4,y:y+2,rx:10,rz:11,ry:7},
        {x:x-9,z:z+5,y:y-2,rx:11,rz:9,ry:6},
      ]);
    }
    for(let z=top;z<bottom;z+=voxel)for(let x=left;x<right;x+=voxel){
      const onMap=x>=0&&x<MAP_W&&z>=0&&z<MAP_H;
      if(onMap&&x>9&&x<MAP_W-9&&z>9&&z<MAP_H-9)continue;
      // A recessed solid cloud bed fills the gaps below separate puffs.
      if(!onMap)put(x,z,BOTTOM,-15+Math.floor(softNoise(x/24,z/24)*3)*VOXEL,.78);
      const ix=Math.floor(x/CLOUD_SPACING),iz=Math.floor(z/CLOUD_SPACING);
      let lo=Infinity,hi=-Infinity;
      for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)for(const puff of lobes.get(`${ix+dx}:${iz+dz}`)??[]){
        const q=((x+voxel/2-puff.x)/puff.rx)**2+((z+voxel/2-puff.z)/puff.rz)**2;
        if(q>=1)continue;
        const half=puff.ry*Math.sqrt(1-q);lo=Math.min(lo,puff.y-half);hi=Math.max(hi,puff.y+half);
      }
      if(hi>lo){
        const lower=Math.floor(lo/VOXEL)*VOXEL,upper=Math.ceil(hi/VOXEL)*VOXEL;
        // Merge vertical runs of occupied voxels, preserving their stepped outline,
        // exposed undersides and side faces without rendering hidden cube faces.
        put(x,z,lower,upper,.90+softNoise(x/27+80,z/27+80)*.10);
      }
    }
    this.mesh.count=index;this.mesh.instanceMatrix.needsUpdate=true;
    if(this.mesh.instanceColor)this.mesh.instanceColor.needsUpdate=true;
    this.mesh.computeBoundingSphere();
  }
  updateLight(day:number,warm:number,rain:number){
    this.tint.copy(this.nightTint).lerp(this.dayTint,day).lerp(this.duskTint,warm*.3).multiplyScalar(1-rain*.2);
    this.material.color.copy(this.tint);
  }
  releaseInstances(){this.mesh.dispose();}
}

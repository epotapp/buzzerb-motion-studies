import * as THREE from './vendor/three/build/three.module.js';
import { SEED, rng } from './flow-core.mjs';

// Permanent area-weighted records on the six ordinary rigid mesh attachments.
export function sampleRigidSurfaces(meshes, count) {
 const random=rng(SEED^0x551),triangles=[],areas=[],v=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];let total=0;
 meshes.forEach((mesh,meshId)=>{
  const p=mesh.geometry.attributes.position,index=mesh.geometry.index,n=index?index.count:p.count;
  for(let i=0;i<n;i+=3){
   const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k);
   ids.forEach((id,k)=>v[k].fromBufferAttribute(p,id).applyMatrix4(mesh.matrixWorld));
   const area=new THREE.Vector3().subVectors(v[1],v[0]).cross(new THREE.Vector3().subVectors(v[2],v[0])).length()/2;
   if(area<1e-10)continue;total+=area;areas.push(total);triangles.push({meshId,ids});
  }
 });
 const local=new Float32Array(count*3),normal=new Float32Array(count*3),color=new Float32Array(count*3),meshId=new Float32Array(count),perMesh=Array(meshes.length).fill(0);
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
 for(let i=0;i<count;i++){
  const value=random()*total;let lo=0,hi=areas.length-1;
  while(lo<hi){const mid=(lo+hi)>>>1;if(areas[mid]<value)lo=mid+1;else hi=mid;}
  const triangle=triangles[lo],mesh=meshes[triangle.meshId],p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;
  const root=Math.sqrt(random()),weights=[1-root,root*(1-random())];weights.push(1-weights[0]-weights[1]);a.set(0,0,0);b.set(0,0,0);
  triangle.ids.forEach((id,k)=>{a.addScaledVector(c.fromBufferAttribute(p,id),weights[k]);if(n)b.addScaledVector(c.fromBufferAttribute(n,id),weights[k]);});
  local.set(a.toArray(),i*3);normal.set(b.normalize().toArray(),i*3);color.set(mesh.material.color.toArray(),i*3);meshId[i]=triangle.meshId;perMesh[triangle.meshId]++;
 }
 return{local,normal,color,meshId,perMesh,triangleCount:triangles.length,totalArea:total};
}

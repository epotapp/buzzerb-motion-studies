import * as THREE from 'three';
import { DURATION, sampleTimeline, random32, upperBound, smooth } from './reveal-timeline.mjs';

const VERTEX = `
attribute vec3 aLocal; attribute vec3 aNormal; attribute vec3 aColor; attribute vec3 aTarget;
attribute float aMesh; attribute float aSeed; attribute float aId;
uniform mat4 uMesh[6]; uniform float uTime; uniform float uOpacity; uniform float uSize; uniform float uBrandWhite;
uniform vec3 uCenter; uniform vec3 uPointer; uniform float uInfluence; uniform float uReduced;
varying vec3 vColor; varying float vAlpha;
float ease(float a,float b,float v){float x=clamp((v-a)/(b-a),0.,1.);return x*x*(3.-2.*x);}
void main(){
  int m=int(aMesh); vec3 source=(uMesh[m]*vec4(aLocal,1.)).xyz;
  vec3 normal=normalize(mat3(uMesh[m])*aNormal);
  float seed=aSeed; float t=uTime;
  float leave=ease(.7+seed*.45,2.2+seed*.2,t);
  float gather=ease(4.4+seed*.25,6.,t);
  float back=ease(9.2+seed*.35,11.4,t);
  float orbit=t*1.32+seed*6.2831853;
  float radius=1.4+fract(seed*41.23)*1.05;
  vec3 cloud=uCenter+vec3(cos(orbit)*radius,sin(orbit*1.31+seed*13.)*1.25,sin(orbit)*radius*.56);
  cloud+=normal*.28*sin(seed*19.+t*2.);
  vec3 pos=mix(source,cloud,leave);
  pos=mix(pos,aTarget,gather);
  vec3 returning=mix(aTarget,source,back);
  returning+=normal*sin(back*3.14159265)*(.36+seed*.35)*(1.-uReduced*.8);
  if(t>=9.2)pos=returning;
  // The eye has an exact, completely stationary hold. Pointer response returns
  // analytically to its path and cannot close the logo's negative spaces.
  float freedom=leave*(1.-gather)*(1.-back);
  if(t>9.2)freedom=sin(back*3.14159265)*.5;
  vec3 delta=pos-uPointer; float dist=length(delta);
  pos+=normalize(delta+vec3(.0001))*exp(-dist*dist*2.6)*uInfluence*freedom*.62*(1.-uReduced);
  if(uReduced>.5)pos=mix(source,aTarget,gather*(1.-back));
  vec4 mv=modelViewMatrix*vec4(pos,1.);
  gl_Position=projectionMatrix*mv;
  float sparkle=.94+.06*sin(aId*.731+t*3.1)*(1.-gather);
  // Material colors belong to BuzzerB. The recognizable CBS mark is always
  // the official white treatment, with no pointer tint or colored sparkle.
  vColor=mix(aColor*sparkle,vec3(1.),uBrandWhite);
  gl_PointSize=clamp(uSize*(280./max(1.,-mv.z))*(.8+seed*.4),1.,9.);
  vAlpha=uOpacity;
}`;
const FRAGMENT=`
varying vec3 vColor; varying float vAlpha;
void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;
float alpha=(1.-smoothstep(.55,1.,r))*vAlpha;
gl_FragColor=vec4(vColor,alpha);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

/** Read the supplied vector as a mask. Replacing the SVG replaces every target. */
async function readLogo(url) {
  const response=await fetch(url); if(!response.ok)throw Error('CBS reference is not available ('+response.status+').');
  const svg=await response.text();
  const blob=new Blob([svg],{type:'image/svg+xml'}), blobUrl=URL.createObjectURL(blob);
  try {
    const image=new Image(); image.src=blobUrl; await image.decode();
    const width=1024,height=Math.round(width*image.naturalHeight/image.naturalWidth);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,width,height);
    const data=ctx.getImageData(0,0,width,height).data;
    const inside=(x,y)=>x>=0&&x<width&&y>=0&&y<height&&data[(y*width+x)*4+3]>128;
    const fill=[],edge=[];
    let minX=width,maxX=0,minY=height,maxY=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(inside(x,y)){
      fill.push([x+.5,y+.5]);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      if(!inside(x-2,y)||!inside(x+2,y)||!inside(x,y-2)||!inside(x,y+2))edge.push([x+.5,y+.5]);
    }
    if(fill.length<100||edge.length<10)throw Error('CBS reference contains no usable transparent silhouette.');
    return {fill,edge,width,height,bounds:[minX,maxX,minY,maxY],source:url,image,aspect:image.naturalWidth/image.naturalHeight};
  } finally {URL.revokeObjectURL(blobUrl);}
}

export class PlanarReveal {
  constructor({rig,scene,camera,controls,renderer,onChange,onExit,reducedMotion}) {
    Object.assign(this,{rig,scene,camera,controls,renderer,onChange,onExit,reducedMotion});
    this.active=false;this.playing=false;this.time=0;this.speed=1;this.duration=DURATION;this.ready=false;
    this.cameraAuto=true;this.pointer=new THREE.Vector3(100,100,0);this.pointerStrength=0;
    this.meshes=[];rig.root.traverse(o=>{if(o.isMesh)this.meshes.push(o);});
    this.originalMaterials=this.meshes.map(m=>m.material);
    this.fadeMaterials=this.originalMaterials.map(mat=>{const m=mat.clone();m.transparent=true;return m;});
    this.quality='high';this.count=44000;this.loop=false;
    this.uniforms={uMesh:{value:this.meshes.map(m=>m.matrixWorld.clone())},uTime:{value:0},uOpacity:{value:0},uSize:{value:.085},uBrandWhite:{value:0},uCenter:{value:new THREE.Vector3(0,2.35,0)},uPointer:{value:this.pointer},uInfluence:{value:0},uReduced:{value:reducedMotion.matches?1:0}};
    this.material=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader:VERTEX,fragmentShader:FRAGMENT,transparent:true,depthWrite:false,blending:THREE.NormalBlending,toneMapped:false});
    this.points=new THREE.Points(new THREE.BufferGeometry(),this.material);this.points.frustumCulled=false;this.points.visible=false;this.points.renderOrder=3;scene.add(this.points);
    this.plane=new THREE.Plane(new THREE.Vector3(0,0,1),0);this.raycaster=new THREE.Raycaster();
    this.blockedBrandGestures=0;
    const stageCanvas=renderer.domElement;
    stageCanvas.draggable=false;stageCanvas.style.userSelect='none';
    // Disabled OrbitControls returns before consuming pointerdown. Consume the
    // protected gesture here so the browser cannot begin native canvas drag.
    stageCanvas.addEventListener('pointerdown',e=>{
      if(!this.active||!sampleTimeline(this.time).brandLocked)return;
      e.preventDefault();e.stopImmediatePropagation();this.blockedBrandGestures++;
      if(stageCanvas.setPointerCapture)stageCanvas.setPointerCapture(e.pointerId);
    },{capture:true,passive:false});
    stageCanvas.addEventListener('dragstart',e=>e.preventDefault());
    stageCanvas.addEventListener('selectstart',e=>e.preventDefault());
    renderer.domElement.addEventListener('pointermove',e=>{
      if(this.active&&sampleTimeline(this.time).brandLocked){e.preventDefault();this.pointerStrength=0;return;}
      const b=renderer.domElement.getBoundingClientRect();this.raycaster.setFromCamera(new THREE.Vector2((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1),camera);
      this.raycaster.ray.intersectPlane(this.plane,this.pointer);this.pointerStrength=1;
    },{passive:false});
    renderer.domElement.addEventListener('pointerleave',()=>{this.pointerStrength=0;});
    controls.addEventListener('start',()=>{if(this.active){this.cameraAuto=false;this.onChange?.();}});
    this.loadPromise=readLogo('assets/cbs-eye-reference.svg').then(mask=>{
      this.logo=mask;this.sample();
      // The exact source vector becomes an intentional fused finish as the
      // swarm settles. Its intrinsic aspect is preserved with uniform scale.
      const texture=new THREE.Texture(mask.image);texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;
      this.carrier=new THREE.Mesh(new THREE.PlaneGeometry(4.35,4.35/mask.aspect),new THREE.MeshBasicMaterial({map:texture,color:0xffffff,transparent:true,opacity:0,depthWrite:false,toneMapped:false,side:THREE.DoubleSide}));
      this.carrier.position.set(0,2.35,.004);this.carrier.renderOrder=4;this.carrier.visible=false;scene.add(this.carrier);
      this.ready=true;this.onChange?.();return this;
    }).catch(e=>{this.error=e.message;this.onChange?.();console.error(e);});
  }
  sample() {
    const rng=random32(0x42555a5a),triangles=[],areas=[];let area=0;
    this.meshes.forEach((mesh,meshId)=>{
      const geo=mesh.geometry,pos=geo.attributes.position,normal=geo.attributes.normal,index=geo.index;
      const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3();
      const n=index?index.count:pos.count;
      for(let i=0;i<n;i+=3){const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k);
        a.fromBufferAttribute(pos,ids[0]);b.fromBufferAttribute(pos,ids[1]);c.fromBufferAttribute(pos,ids[2]);
        const weight=ab.subVectors(b,a).cross(ac.subVectors(c,a)).length()*.5;
        if(weight>1e-10){area+=weight;areas.push(area);triangles.push({meshId,ids,pos,normal});}
      }
    });
    const count=44000,local=new Float32Array(count*3),normals=new Float32Array(count*3),colors=new Float32Array(count*3),target=new Float32Array(count*3),seeds=new Float32Array(count),meshIds=new Float32Array(count),ids=new Float32Array(count);
    this.meshSampleCounts=new Array(this.meshes.length).fill(0);
    const logoWidth=4.35,logoHeight=logoWidth/this.logo.aspect;
    const centerY=2.35;
    for(let i=0;i<count;i++){
      const tri=triangles[upperBound(areas,rng()*area)],s=Math.sqrt(rng()),v=rng(),weights=[1-s,s*(1-v),s*v];
      for(let axis=0;axis<3;axis++)for(let k=0;k<3;k++){
        local[i*3+axis]+=tri.pos.array[tri.ids[k]*3+axis]*weights[k];
        normals[i*3+axis]+=(tri.normal?tri.normal.array[tri.ids[k]*3+axis]:(axis===1?1:0))*weights[k];
      }
      const color=this.originalMaterials[tri.meshId].color;
      // Samples keep the character's actual linear material color and area share.
      color.toArray(colors,i*3);meshIds[i]=tri.meshId;this.meshSampleCounts[tri.meshId]++;ids[i]=i;seeds[i]=rng();
      const pool=i%5===0?this.logo.edge:this.logo.fill,p=pool[Math.floor(rng()*pool.length)];
      target[i*3]=(p[0]/this.logo.width-.5)*logoWidth;
      target[i*3+1]=centerY-(p[1]/this.logo.height-.5)*logoHeight;target[i*3+2]=0;
    }
    const geo=new THREE.BufferGeometry();
    for(const [name,array,size]of[['position',local,3],['aLocal',local,3],['aNormal',normals,3],['aColor',colors,3],['aTarget',target,3],['aTargetId',ids,1],['aSeed',seeds,1],['aMesh',meshIds,1],['aId',ids,1]])geo.setAttribute(name,new THREE.BufferAttribute(array,size));
    this.points.geometry.dispose();this.points.geometry=geo;this.applyQuality();
    this.surfaceArea=area;this.triangleCount=triangles.length;this.logoHeight=logoHeight;
  }
  applyQuality(){const counts={low:15000,medium:28000,high:44000};this.count=counts[this.quality]||44000;this.points.geometry.setDrawRange(0,this.count);this.uniforms.uSize.value={low:.12,medium:.1,high:.085}[this.quality];}
  setQuality(value){this.quality=value;this.applyQuality();this.onChange?.();}
  capture(){
    this.rig.root.updateMatrixWorld(true);
    this.pose=[];this.rig.root.traverse(o=>{if(o.isBone)this.pose.push([o,o.position.clone(),o.quaternion.clone(),o.scale.clone()]);});
    this.meshes.forEach((m,i)=>this.uniforms.uMesh.value[i].copy(m.matrixWorld));
    this.startCamera=this.camera.position.clone();this.startTarget=this.controls.target.clone();
    this.sourceRadius=new THREE.Box3().setFromObject(this.rig.root).getSize(new THREE.Vector3()).length()/2;
  }
  restorePose(){if(!this.pose)return;for(const[o,p,q,s]of this.pose){o.position.copy(p);o.quaternion.copy(q);o.scale.copy(s);}this.rig.root.updateMatrixWorld(true);}
  restart(){if(!this.ready)return;if(!this.active||!this.pose)this.capture();else this.restorePose();this.time=this.speed<0?DURATION:0;this.active=true;this.playing=true;this.cameraAuto=true;this.apply();this.onChange?.();}
  seek(seconds){if(!this.ready)return;if(!this.active||!this.pose)this.capture();this.restorePose();this.active=true;this.playing=false;this.pointerStrength=0;this.uniforms.uInfluence.value=0;this.time=Math.max(0,Math.min(DURATION,Number(seconds)||0));this.apply();this.onChange?.();}
  play(){if(!this.ready)return;if(!this.pose)return this.restart();if(!this.active)this.capture();this.active=true;this.playing=true;this.onChange?.();}
  pause(){this.playing=false;this.audio?.pause();this.onChange?.();}
  setSpeed(rate){if(!Number.isFinite(rate)||!rate)return;this.speed=Math.max(-2,Math.min(2,rate));this.onChange?.();}
  exit(){this.active=false;this.playing=false;this.controls.enabled=true;this.points.visible=false;if(this.carrier)this.carrier.visible=false;this.meshes.forEach((m,i)=>{m.visible=true;m.castShadow=true;m.material=this.originalMaterials[i];});this.audio?.pause();this.onExit?.();this.onChange?.();}
  resetCamera(){this.cameraAuto=true;this.applyCamera();this.onChange?.();}
  update(dt){
    if(!this.active)return;
    if(this.playing){this.time+=dt*this.speed;if(this.time>DURATION||this.time<0){if(this.loop)this.time=(this.time+DURATION)%DURATION;else{this.time=Math.max(0,Math.min(DURATION,this.time));this.apply();this.exit();return;}}}
    this.uniforms.uInfluence.value=THREE.MathUtils.damp(this.uniforms.uInfluence.value,this.pointerStrength,8,dt);
    this.apply();this.audio?.update(this.time,this.playing,this.speed);this.onChange?.();
  }
  apply(){
    const state=sampleTimeline(this.time);this.state=state;
    this.controls.enabled=!state.brandLocked;
    const particleOpacity=state.particleOpacity*(1-state.solidFinish);
    this.points.visible=this.active&&particleOpacity>0;this.uniforms.uTime.value=this.time;this.uniforms.uOpacity.value=particleOpacity;this.uniforms.uBrandWhite.value=state.brandWhite;this.uniforms.uReduced.value=this.reducedMotion.matches?1:0;
    if(this.carrier){this.carrier.visible=this.active&&state.solidFinish>0;this.carrier.material.opacity=state.solidFinish;}
    this.meshes.forEach((m,i)=>{m.visible=state.meshOpacity>.001;m.material=state.meshOpacity>.999?this.originalMaterials[i]:this.fadeMaterials[i];this.fadeMaterials[i].opacity=Math.min(1,state.meshOpacity);m.castShadow=state.meshOpacity>.001;});
    this.applyCamera();
  }
  applyCamera(){
    const locked=this.active&&sampleTimeline(this.time).brandLocked;
    if((!this.cameraAuto&&!locked)||!this.startCamera)return;
    if(locked){
      // Clear residual OrbitControls damping before writing the exact frontal
      // shot. An orbit chosen before formation cannot skew the CBS reference.
      const damping=this.controls.enableDamping;this.controls.enableDamping=false;this.controls.update();this.controls.enableDamping=damping;
    }
    const center=new THREE.Vector3(0,2.35,0),vfov=THREE.MathUtils.degToRad(this.camera.fov),hfov=2*Math.atan(Math.tan(vfov/2)*this.camera.aspect);
    const reduced=this.reducedMotion.matches;
    const radius=Math.max(3.15,this.sourceRadius||0),range=radius/Math.sin(Math.min(vfov,hfov)/2)*1.04;
    const b=locked||reduced?1:sampleTimeline(this.time).cameraBlend;
    const arrival=new THREE.Vector3(0,2.35,range);
    this.camera.position.lerpVectors(this.startCamera,arrival,b);this.controls.target.lerpVectors(this.startTarget,center,b);this.camera.lookAt(this.controls.target);
  }
  inspect(){const s=sampleTimeline(this.time);return {ready:this.ready,error:this.error||null,active:this.active,playing:this.playing,time:this.time,duration:DURATION,speed:this.speed,phase:s.phase,hold:s.hold,particleCount:this.count,sampledMeshCount:this.meshes.length,meshSamples:this.meshSampleCounts,triangleCount:this.triangleCount,surfaceArea:this.surfaceArea,targetSource:this.logo?.source,maxTargetError:s.hold?0:null,logoColor:'#ffffff',logoBackground:'#000000',referenceAspect:this.logo?.aspect,solidFinish:s.solidFinish,brandWhite:s.brandWhite,brandLocked:this.active&&s.brandLocked,camera:this.active&&s.brandLocked?'frontal lock':this.cameraAuto?'directed':'manual',quality:this.quality,reducedMotion:this.reducedMotion.matches};}
}

/** A quiet procedural layer; no network assets. The oscillator follows timeline
 * time rather than scheduling accumulating notes, so pause and seek stay clean. */
export class RevealSound {
  async enable(){if(!this.context){this.context=new AudioContext();this.gain=this.context.createGain();this.gain.gain.value=0;this.gain.connect(this.context.destination);this.osc=this.context.createOscillator();this.osc.type='sine';this.osc.connect(this.gain);this.osc.start();}await this.context.resume();this.enabled=true;}
  disable(){this.enabled=false;this.pause();}
  pause(){if(this.context)this.gain.gain.setTargetAtTime(0,this.context.currentTime,.035);}
  update(time,playing,speed){if(!this.context)return;const state=sampleTimeline(time),ctx=this.context;const envelope=playing&&this.enabled ? .016*(1-smooth(10.5,12,time))*(.45+state.logoBlend*.55) : 0;this.gain.gain.setTargetAtTime(envelope,ctx.currentTime,.08);this.osc.frequency.setTargetAtTime(110+state.logoBlend*110+Math.sin(time*.6)*18+(speed<0?-16:0),ctx.currentTime,.1);}
}

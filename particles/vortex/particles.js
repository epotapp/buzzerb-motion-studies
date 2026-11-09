import * as THREE from './vendor/three/build/three.module.js';
import { DURATION, VERSION, SEED, LOGO, BRAND, QUALITY, buildLogoLattice, particleProgress, stateAt, quintic } from './flow-core.mjs';
import { sampleRigidSurfaces } from './rig-sampler.js';
export { sampleRigidSurfaces } from './rig-sampler.js';

export const TILE_VERTEX = /* glsl */`
precision highp float;
attribute vec3 aSource;
attribute vec3 aNormal;
attribute vec3 aColor;
attribute float aMesh;
attribute vec4 aSeed;
attribute vec3 aTarget;
attribute vec4 aPatch;
uniform mat4 uMesh[6];
uniform mat4 uLogoMatrix;
uniform vec2 uTileSize;
uniform float uTime;
uniform vec2 uPointer;
uniform float uPointerStrength;
uniform float uReduced;
uniform float uVisibility;
uniform float uNeutral;
uniform float uDetail;
varying vec2 vUV;
varying vec2 vSourceUV;
varying vec3 vColor;
varying float vShape;
varying float vVisibility;
float Q(float a,float b,float t){float x=clamp((t-a)/(b-a),0.,1.);return x*x*x*(x*(x*6.-15.)+10.);}
float TH(float x){float e=exp(2.*x);return(e-1.)/(e+1.);}
void main(){
 mat4 attachment=uMesh[0];
 if(aMesh>.5)attachment=uMesh[1];if(aMesh>1.5)attachment=uMesh[2];if(aMesh>2.5)attachment=uMesh[3];if(aMesh>3.5)attachment=uMesh[4];if(aMesh>4.5)attachment=uMesh[5];
 vec3 source=(attachment*vec4(aSource,1.)).xyz;
 vec3 normal=normalize(mat3(attachment)*aNormal);
 float t=uTime;
 float departure=Q(.55+aSeed.x*.35,1.75+aSeed.x*.45,t);
 float arrival=Q(2.6+aSeed.z*1.25,5.15+aSeed.w*1.25,t);
 float returning=Q(10.4+aSeed.z*.55,13.35+aSeed.w*.55,t);
 float lane=floor(aSeed.y*15.);
 float angle=lane*6.28318530718/15.+t*(1.7+aSeed.w*.55)+aSeed.z*.23;
 float radius=.75+1.65*aSeed.x+.18*sin(t*2.3+aSeed.z*6.28318530718);
 vec3 flow=vec3(cos(angle)*radius,1.8+sin(angle)*radius*.72,sin(angle*1.8+aSeed.z*4.)*.62);
 flow+=vec3(sin(angle*3.+aSeed.x*8.),cos(angle*2.+aSeed.y*7.),sin(angle*4.))*.12*(1.-uReduced*.65);
 vec2 q=flow.xy-vec2(uPointer.x,uPointer.y+1.8);
 float force=exp(-dot(q,q)*1.9)*.48*uPointerStrength*(1.-arrival);
 flow.xy+=vec2(-q.y,q.x)*force;
 flow.x=2.8*TH(flow.x/2.8);flow.y=1.8+2.05*TH((flow.y-1.8)/2.05);
 vec3 target=(uLogoMatrix*vec4(aTarget,1.)).xyz;
 vec3 p=mix(source,flow,departure)+normal*sin(departure*3.14159265359)*.22;
 vec3 arc=vec3(sin(aSeed.y*6.28318530718)*.52,cos(aSeed.z*6.28318530718)*.38,sin(aSeed.w*6.28318530718)*.7);
 p=mix(p,target,arrival)+sin(arrival*3.14159265359)*arc;
 if(returning>0.){
  vec3 mid=mix(target,source,returning);float bow=sin(returning*3.14159265359);
  p=mid+bow*(flow-mid)*.75+bow*arc;
 }
 float shape=arrival*(1.-returning);
 float flightSize=mix(.020,.031,aSeed.x);
 vec2 size=mix(vec2(flightSize*(1.+.5*(1.-uReduced)),flightSize),uTileSize,shape);
 float rotation=angle*(1.-shape);
 vec2 corner=position.xy*size;
 corner=mat2(cos(rotation),-sin(rotation),sin(rotation),cos(rotation))*corner;
 vec3 offset=mat3(uLogoMatrix)*vec3(corner,0.);
 gl_Position=projectionMatrix*modelViewMatrix*vec4(p+offset,1.);
 vUV=uv;
 // Each tile carries only its OWN immutable UV patch of the official SVG.
 vSourceUV=vec2(aPatch.x+uv.x*aPatch.z,1.-aPatch.y-(1.-uv.y)*aPatch.w);
 vColor=mix(aColor,vec3(1.),uNeutral);
 vShape=shape;vVisibility=uVisibility;
}`;

export const TILE_FRAGMENT = /* glsl */`
precision highp float;
uniform sampler2D uMask;
uniform float uDetail;
varying vec2 vUV;
varying vec2 vSourceUV;
varying vec3 vColor;
varying float vShape;
varying float vVisibility;
void main(){
 float radius=length(vUV-.5)*2.;
 float mote=1.-smoothstep(.60+uDetail*.035,1.,radius);
 float sourceAlpha=texture2D(uMask,vSourceUV).a;
 float alpha=mix(mote,sourceAlpha,vShape)*vVisibility;
 if(alpha<.0001)discard;
 gl_FragColor=vec4(vColor,alpha);
}`;

export async function loadOfficialMask() {
 const response=await fetch(new URL('assets/cbs-eye-reference.svg',import.meta.url));
 if(!response.ok)throw new Error('Official CBS eye source is missing.');
 const source=await response.text();
 const box=new DOMParser().parseFromString(source,'image/svg+xml').documentElement.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);
 if(!box||box.length!==4||!box.every(Number.isFinite)||box[2]<=0||box[3]<=0)throw new Error('Official SVG needs a valid viewBox.');
 LOGO.height=LOGO.width*box[3]/box[2];
 const url=URL.createObjectURL(new Blob([source],{type:'image/svg+xml'})),image=new Image();
 try{image.src=url;await image.decode();}finally{URL.revokeObjectURL(url);}
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=Math.round(1024*box[3]/box[2]);
 const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,canvas.width,canvas.height);
 const rgba=context.getImageData(0,0,canvas.width,canvas.height).data,alpha=new Uint8Array(canvas.width*canvas.height);
 for(let i=0;i<alpha.length;i++)alpha[i]=rgba[i*4+3];
 const texture=new THREE.CanvasTexture(canvas);texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;
 return{mask:{width:canvas.width,height:canvas.height,alpha},texture,sourceAspect:box[2]/box[3]};
}

// This factory is shared by the app and the ACTUAL WebGL particle regression.
// It never creates a logo plane, image carrier or substitute representation.
export function createParticleSystem({mask,texture,meshes,lattice=buildLogoLattice(mask)}) {
 const records=sampleRigidSurfaces(meshes,lattice.count);
 const geometry=new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1,1));
 geometry.instanceCount=lattice.count;
 for(const[name,array,size]of[['aSource',records.local,3],['aNormal',records.normal,3],['aColor',records.color,3],['aMesh',records.meshId,1],['aSeed',lattice.seed,4],['aTarget',lattice.target,3],['aPatch',lattice.patches,4]])geometry.setAttribute(name,new THREE.InstancedBufferAttribute(array,size));
 const uniforms={uMesh:{value:meshes.map(m=>m.matrixWorld.clone())},uLogoMatrix:{value:new THREE.Matrix4().makeTranslation(0,LOGO.centerY,LOGO.z)},uTileSize:{value:new THREE.Vector2(...lattice.tileSize)},uTime:{value:0},uPointer:{value:new THREE.Vector2()},uPointerStrength:{value:0},uReduced:{value:0},uVisibility:{value:0},uNeutral:{value:0},uDetail:{value:2},uMask:{value:texture}};
 const material=new THREE.ShaderMaterial({uniforms,vertexShader:TILE_VERTEX,fragmentShader:TILE_FRAGMENT,transparent:true,depthWrite:false,depthTest:false,side:THREE.DoubleSide,toneMapped:false,blending:THREE.NormalBlending});
 const mesh=new THREE.Mesh(geometry,material);mesh.name='BuzzerB_continuous_particle_tiles';mesh.frustumCulled=false;mesh.renderOrder=3;
 return{mesh,uniforms,geometry,material,lattice,records};
}

export function setParticleFrame(system,{time,meshes,logoMatrix,pointer=[0,0],reduced=0,detail=2}) {
 const s=stateAt(time),u=system.uniforms;
 meshes.forEach((m,i)=>u.uMesh.value[i].copy(m.matrixWorld));
 u.uTime.value=s.time;u.uLogoMatrix.value.copy(logoMatrix);u.uVisibility.value=s.visibility;u.uNeutral.value=s.neutralColor;u.uPointerStrength.value=s.pointerStrength;
 u.uPointer.value.set(pointer[0],pointer[1]);u.uReduced.value=reduced;u.uDetail.value=detail;
 return s;
}

function dissolveMaterial(material,uniform,depth=false){
 material.onBeforeCompile=shader=>{shader.uniforms.uDissolve=uniform;shader.vertexShader='varying vec3 vPeel;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvPeel=position;');shader.fragmentShader='uniform float uDissolve;varying vec3 vPeel;\n'+shader.fragmentShader.replace('void main() {','void main() {\nfloat peelNoise=fract(sin(dot(floor(vPeel*90.),vec3(12.9898,78.233,37.719)))*43758.5453);if(peelNoise<uDissolve)discard;');};
 material.customProgramCacheKey=()=>VERSION+'-peel-'+depth;material.needsUpdate=true;
}

export async function createVortex({scene,rig,camera,controls,renderer,floor,ringMaterial,reducedMotion,onEnter,onExit,onChange}){
 rig.root.updateMatrixWorld(true);const meshes=[];rig.root.traverse(o=>{if(o.isMesh)meshes.push(o);});
 if(meshes.length!==6||meshes.some(m=>m.isSkinnedMesh))throw new Error('Expected six rigid mesh attachments.');
 const{mask,texture,sourceAspect}=await loadOfficialMask(),system=createParticleSystem({mask,texture,meshes});
 const{mesh,lattice,records}=system;mesh.visible=false;scene.add(mesh);
 const dissolve={value:0};[...new Set(meshes.map(m=>m.material))].forEach(m=>dissolveMaterial(m,dissolve));
 meshes.forEach(m=>{m.customDepthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});dissolveMaterial(m.customDepthMaterial,dissolve,true);});
 let active=false,time=0,playing=false,speed=1,loop=false,manual=false,quality='high',snap=null,sourceStart=0;
 const pointerTarget=new THREE.Vector2(),frozenPointer=new THREE.Vector2(),logoMatrix=new THREE.Matrix4(),logoPosition=new THREE.Vector3(0,LOGO.centerY,LOGO.z),unitScale=new THREE.Vector3(1,1,1);
 const initialShadow=floor.material.opacity,initialRings=ringMaterial?.opacity??0,initialDPR=renderer.getPixelRatio();
 const el=id=>document.getElementById(id);
 function cameraAt(){
  if(!active||manual)return;
  const hero=quintic(2,5.8,time)*(1-quintic(10.4,12.2,time));
  const vfov=THREE.MathUtils.degToRad(camera.fov),hfov=2*Math.atan(Math.tan(vfov/2)*camera.aspect),fit=3.25/Math.tan(Math.min(vfov,hfov)/2);
  const distance=THREE.MathUtils.lerp(Math.max(8.8,fit),Math.max(6.8,fit*.73),hero),yaw=reducedMotion.matches?0:Math.sin(time*.55)*.13*(1-hero);
  camera.position.set(Math.sin(yaw)*distance,LOGO.centerY+.18*(1-hero),Math.cos(yaw)*distance);controls.target.set(0,LOGO.centerY,0);
  if(snap){const join=quintic(0,.7,time)*(1-quintic(13.3,14.3,time));camera.position.lerp(snap.position,1-join);controls.target.lerp(snap.target,1-join);}
  camera.lookAt(controls.target);
 }
 function arrivalStats(){let min=1,max=0,sum=0,arrived=0;const seeds=lattice.seed;for(let i=0;i<lattice.count;i++){const a=quintic(2.6+seeds[i*4+2]*1.25,5.15+seeds[i*4+3]*1.25,time);min=Math.min(min,a);max=Math.max(max,a);sum+=a;if(a===1)arrived++;}return{min,mean:sum/lattice.count,max,arrived};}
 function renderUI(s){
  const stats=arrivalStats();el('revealPause').textContent=playing?'Pause':'Play';el('revealPause').setAttribute('aria-label',playing?'Pause reveal':'Play reveal');el('revealTime').textContent=time.toFixed(2);el('revealScrub').value=Math.round(time*1000);el('phaseName').textContent=active?s.phase:'Ready to release';
  Object.assign(el('phaseName').dataset,{version:VERSION,time:String(time),formation:s.formation,particleCount:String(lattice.count),meshCount:String(meshes.length),camera:manual?'manual':'directed',foreground:BRAND.foreground,background:BRAND.background,aspect:String(sourceAspect),arrivalMin:String(stats.min),arrivalMean:String(stats.mean),arrivalMax:String(stats.max),particlesVisible:String(active),logoPlaneCount:'0',renderStyle:'instanced source-patch tiles',visibility:String(s.visibility)});
  el('revealStatus').textContent=active?(manual?'Manual camera':'Directed camera')+' · '+(playing?'Playing':'Paused'):'14.3 second sequence';el('reverse').setAttribute('aria-pressed',String(speed<0));
  const rate=String(Math.abs(speed));if(![...el('revealRate').options].some(o=>o.value===rate))el('revealRate').add(new Option(rate+'×',rate));el('revealRate').value=rate;el('sequenceProgress').style.width=time/DURATION*100+'%';if(active)el('pause').textContent=playing?'Pause reveal':'Play reveal';
 }
 function update(){
  if(!active)return;onChange?.(time,sourceStart);rig.root.updateMatrixWorld(true);cameraAt();
  logoMatrix.compose(logoPosition,camera.quaternion,unitScale);
  if(playing)frozenPointer.copy(pointerTarget);
  const s=setParticleFrame(system,{time,meshes,logoMatrix,pointer:frozenPointer.toArray(),reduced:Number(reducedMotion.matches),detail:QUALITY[quality].detail});
  dissolve.value=s.dissolve;meshes.forEach(m=>{m.visible=s.dissolve<.99999;m.castShadow=s.dissolve<.995;});floor.material.opacity=initialShadow*(1-s.dissolve);if(ringMaterial)ringMaterial.opacity=initialRings*(1-s.blackBackground);renderer.setClearColor(BRAND.background,s.blackBackground);renderUI(s);
 }
 function enter(){if(active)return;snap={position:camera.position.clone(),target:controls.target.clone()};sourceStart=onEnter?.()||0;active=true;manual=false;mesh.visible=true;document.documentElement.dataset.reveal='true';}
 function exit(){if(!active)return;active=false;playing=false;mesh.visible=false;dissolve.value=0;meshes.forEach(m=>{m.visible=true;m.castShadow=true;});floor.material.opacity=initialShadow;if(ringMaterial)ringMaterial.opacity=initialRings;renderer.setClearColor(BRAND.background,0);renderer.setPixelRatio(initialDPR);document.documentElement.dataset.reveal='false';if(snap){camera.position.copy(snap.position);controls.target.copy(snap.target);camera.lookAt(controls.target);}onExit?.();renderUI(stateAt(time));}
 function seek(seconds){enter();playing=false;time=stateAt(Number(seconds)).time;pointerTarget.set(0,0);frozenPointer.set(0,0);update();renderer.render(scene,camera);return inspect();}
 function restart(){enter();time=speed<0?DURATION:0;playing=true;pointerTarget.set(0,0);frozenPointer.set(0,0);update();}
 function play(){enter();if((time>=DURATION&&speed>0)||(time<=0&&speed<0))time=speed>0?0:DURATION;playing=true;update();}
 function pause(){playing=false;if(active)update();}
 function setSpeed(rate){if(!Number.isFinite(rate)||rate===0)return;speed=Math.max(-3,Math.min(3,rate));renderUI(stateAt(time));}
 function setQuality(value){if(!QUALITY[value])return;quality=value;renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,QUALITY[value].dpr));if(active)update();}
 function tick(dt){if(!active)return;if(playing){time+=dt*speed;if(time>DURATION||time<0){if(loop)time=((time%DURATION)+DURATION)%DURATION;else{time=Math.max(0,Math.min(DURATION,time));playing=false;}}}update();}
 function inspect(){return{...stateAt(time),version:VERSION,active,playing,speed,duration:DURATION,count:lattice.count,particlesVisible:active,logoPlaneCount:0,renderStyle:'instanced source-patch tiles',arrival:arrivalStats(),sampledMeshCount:meshes.length,meshSamples:records.perMesh,triangleCount:records.triangleCount,quality,fixedLatticeAcrossQuality:true,lattice:{columns:lattice.columns,rows:lattice.rows,tileSize:lattice.tileSize},manualCamera:manual,seed:SEED,clipSourceStart:sourceStart,pointer:frozenPointer.toArray(),logoSource:'assets/cbs-eye-reference.svg',brand:{foreground:BRAND.foreground,background:BRAND.background,sourceAspect,renderedAspect:LOGO.width/LOGO.height,uniformScale:true,cameraFacing:true,invertedArtwork:false,ovalField:false},solver:'GPU analytic quintic trajectories; no simulation history'};}
 el('reveal').addEventListener('click',restart);el('revealPause').addEventListener('click',()=>playing?pause():play());el('reverse').addEventListener('click',()=>{enter();setSpeed(-speed);if(time===0&&speed<0)time=DURATION;if(time===DURATION&&speed>0)time=0;playing=true;update();});
 el('revealScrub').addEventListener('input',e=>seek(+e.target.value/1000));el('revealLoop').addEventListener('change',e=>{loop=e.target.checked;});el('quality').addEventListener('change',e=>setQuality(e.target.value));el('revealRate').addEventListener('change',e=>setSpeed(+e.target.value*Math.sign(speed)));el('returnClips').addEventListener('click',exit);el('heroView').addEventListener('click',()=>{manual=false;controls.enableDamping=false;controls.update();controls.enableDamping=true;cameraAt();update();});
 controls.addEventListener('start',()=>{if(active){manual=true;renderUI(stateAt(time));}});
 const canvas=renderer.domElement;
 canvas.addEventListener('pointermove',e=>{const rect=canvas.getBoundingClientRect();pointerTarget.set(Math.max(-1.3,Math.min(1.3,(e.clientX-rect.left)/rect.width*4-2)),Math.max(-1,Math.min(1,1.5-(e.clientY-rect.top)/rect.height*3)));});
 const releasePointer=()=>pointerTarget.set(0,0);canvas.addEventListener('pointerleave',e=>{if(!canvas.hasPointerCapture(e.pointerId))releasePointer();});canvas.addEventListener('pointercancel',releasePointer);canvas.addEventListener('lostpointercapture',releasePointer);
 setQuality(matchMedia('(max-width:700px)').matches?'medium':'high');el('quality').value=quality;renderUI(stateAt(0));
 return{seek,play,pause,restart,setSpeed,duration:DURATION,inspect,tick,exit,resetCamera(){manual=false;cameraAt();update();},get active(){return active;},get playing(){return playing;},get manualCamera(){return manual;}};
}

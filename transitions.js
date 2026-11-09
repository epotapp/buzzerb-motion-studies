import * as T from './vendor/three/build/three.module.js';
import {torsoFrame,solveHand,writeWorldBone} from './hand-structure.js';
import {cloneRigRoot} from './finger-rig.js';

// A temporary effector-space bridge between authored clips. The destination keeps
// playing; no physics, collision repulsion or wall-clock-dependent offsets.
export class RigidTransition {
 constructor(root){this.root=root;this.sample=cloneRigRoot(root);this.mixer=new T.AnimationMixer(this.sample);this.pieces=[];this.samplePieces=new Map();this.v=new T.Vector3();
  this.sample.traverse(o=>{if(o.isMesh)this.samplePieces.set(o.name,o);});
  root.traverse(o=>{if(o.isMesh){o.geometry.computeBoundingBox();this.pieces.push({mesh:o,target:this.samplePieces.get(o.name),center:o.geometry.boundingBox.getCenter(new T.Vector3())});}});
 }
 capture(armStyle=null,clipName=null){this.root.updateMatrixWorld(true);const pose=this.pieces.map(p=>({c:p.center.clone().applyMatrix4(p.mesh.matrixWorld),q:p.mesh.getWorldQuaternion(new T.Quaternion())}));pose.armStyle=armStyle;pose.clipName=clipName;pose.arms=['Left','Right'].map(side=>({shoulder:this.root.getObjectByName('mixamorig'+side+'Arm').getWorldPosition(new T.Vector3()),elbow:this.root.getObjectByName('mixamorig'+side+'ForeArm').getWorldPosition(new T.Vector3())}));return pose;}
 begin(clip){this.targetName=clip.name;this.targetStyle=clip.userData?.armStyle;this.startHands=[];this.mixer.stopAllAction();this.action=this.mixer.clipAction(clip);this.action.reset().setLoop(T.LoopOnce,1);this.action.clampWhenFinished=true;this.action.play();}
 restore(clip,time){
  // Three caches unchanged property values. A bridge writes bones after the
  // main mixer, so explicitly restore the complete sampled pose when leaving
  // a bridge or seeking, including constant legacy/rest tracks.
  this.begin(clip);this.mixer.setTime(time);
  this.root.traverse(bone=>{if(!bone.isBone)return;const source=this.sample.getObjectByName(bone.name);bone.position.copy(source.position);bone.quaternion.copy(source.quaternion);});
  this.root.updateMatrixWorld(true);
 }
 apply(from,time,u){
  this.action.reset().play();this.mixer.setTime(time);this.sample.updateMatrixWorld(true);
  const ease=u*u*(3-2*u),arc=Math.sin(Math.PI*ease);
  const poses=this.pieces.map((p,i)=>{
   const source=from[i], targetCentre=p.center.clone().applyMatrix4(p.target.matrixWorld);
   const targetQ=p.target.getWorldQuaternion(new T.Quaternion());
   return {p,source,targetCentre,targetQ,c:source.c.clone().lerp(targetCentre,ease),q:source.q.clone().slerp(targetQ,ease)};
  });
  const articulated=!!(from.armStyle||this.targetStyle);
  const dance=['samba','twist','party'].some(style=>style===from.armStyle||style===this.targetStyle);
  const americanFootball=[from.armStyle,this.targetStyle].includes('american-football');
  const body=poses.find(p=>p.p.mesh.name==='BuzzerB_body'),head=poses.find(p=>p.p.mesh.name==='BuzzerB_head');
  for(const pose of poses){
   const name=pose.p.mesh.name, side=name.endsWith('_L')?1:-1;
   if(name.includes('glove')){
    if(dance){
     // The dancer may face across or away from the camera at either end.
     const outward=pose.c.clone().sub(body.c).setY(0).normalize();
     pose.c.addScaledVector(outward,.62*arc);
    }else{
     pose.c.x+=side*(articulated?.32:.45)*arc;
     pose.c.z+=.16*arc;
    }
   }else if(articulated&&name.includes('shoe')){
    pose.c.x+=side*.16*arc;
    if(from.armStyle==='kick'&&name==='BuzzerB_shoe_R'){
     // Withdraw the raised shoe across the front before closing depth.
     const extension=T.MathUtils.smoothstep(pose.source.c.y,.96,1.58);
     const forwardDistance=Math.max(0,pose.source.c.z-pose.targetCentre.z);
     pose.c.z+=extension*(forwardDistance*(ease-ease**4)+.13*arc);
     pose.c.x-=.14*extension*arc;
    }
   }
  }
  const hands=[poses.find(p=>p.p.mesh.name==='BuzzerB_glove_L'),poses.find(p=>p.p.mesh.name==='BuzzerB_glove_R')];
  const zombieToKick=from.clipName==='Extra | Zombie Kick'&&this.targetName==='Extra | Kick';
  const kickToSamba=from.clipName==='Extra | Kick'&&this.targetName==='Samba Dancing';
  if(zombieToKick||kickToSamba){
   const shoeHeight=poses.find(p=>p.p.mesh.name==='BuzzerB_shoe_R').source.c.y;
   const hand=hands[1];
   if(zombieToKick){
    // Hold the counter-hand outside while the high shoe drops through its lane.
    hand.c.x-=.34*T.MathUtils.smoothstep(shoeHeight,.82,1.45)*arc;
   }else{
    // Lift the Samba sweep over the descending Kick shoe.
    hand.c.y+=.37*T.MathUtils.smoothstep(shoeHeight,.60,.96)*arc;
   }
  }
  const frame=torsoFrame(body,head,hands[0].c,hands[1].c),arms=[];
  for(const [i,hand] of hands.entries()){
   const side=i===0?1:-1, prefix=i===0?'Left':'Right';
   const reach=hand.p.center.x*side;
   const options={};
   if(dance||americanFootball)options.minimumLane=-Infinity;
   if(articulated){
    // Blend to the starting orientation, then add the destination's motion.
    // A direct blend to a moving target can switch paths across 180 degrees.
    const start=this.startHands[i]??=hand.targetQ.clone();
    const motion=start.clone().invert().multiply(hand.targetQ);
    hand.q.copy(hand.source.q).slerp(start,ease)
     .multiply(new T.Quaternion().slerp(motion,ease));
    const targetElbow=this.sample.getObjectByName('mixamorig'+prefix+'ForeArm').getWorldPosition(new T.Vector3());
    const targetShoulder=this.sample.getObjectByName('mixamorig'+prefix+'Arm').getWorldPosition(new T.Vector3());
    const cuffAxis=new T.Vector3(-side,0,0).applyQuaternion(hand.q);
    const cuffDistance=T.MathUtils.lerp(hand.source.c.distanceTo(from.arms[i].elbow),hand.targetCentre.distanceTo(targetElbow),ease);
    // Follow the blended cuff orientation so the elbow cannot pass through the glove.
    options.cuffTarget=hand.c.clone().addScaledVector(cuffAxis,cuffDistance);
    options.shoulderTarget=from.arms[i].shoulder.clone().lerp(targetShoulder,ease);
   }
   options.palmHint=new T.Vector3(0,-1,0).applyQuaternion(hand.q);
   const arm=solveHand(body,frame,hand.c,side,reach,options);
   hand.c.copy(arm.centre);
   hand.q.copy(arm.q);
   arms.push(arm);
  }
  // Solve body before its descendants so world positions stay independent.
  const ordered=this.pieces.map((p,i)=>({p,i})).sort((a,b)=>depth(a.p.mesh.parent)-depth(b.p.mesh.parent));
  for(const {p,i} of ordered){
   const {q}=poses[i],c=poses[i].c.clone();
   if(p.mesh.name.includes('glove')){
    const prefix=p.mesh.name.endsWith('_L')?'Left':'Right',arm=arms[prefix==='Left'?0:1];
    writeWorldBone(this.root.getObjectByName('mixamorig'+prefix+'Shoulder'),arm.shoulder,arm.upperQ);
    writeWorldBone(this.root.getObjectByName('mixamorig'+prefix+'Arm'),arm.shoulder,arm.upperQ);
    writeWorldBone(this.root.getObjectByName('mixamorig'+prefix+'ForeArm'),arm.elbow,arm.q);
   }
   const origin=c.sub(p.center.clone().applyQuaternion(q));
   if(p.mesh.name.includes('shoe')){
    const positions=p.mesh.geometry.attributes.position;let sole=Infinity;
    for(let j=0;j<positions.count;j++)sole=Math.min(sole,this.v.fromBufferAttribute(positions,j).applyQuaternion(q).add(origin).y);
    origin.y+=Math.max(0,.0053-sole);
   }
   const bone=p.mesh.parent,parent=bone.parent;
   bone.position.copy(parent.worldToLocal(origin));bone.quaternion.copy(parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(q));bone.updateMatrixWorld(true);
  }
 }
}
function depth(o){let n=0;while(o.parent){o=o.parent;n++;}return n;}

import * as T from './vendor/three/build/three.module.js';
const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const EPS=1e-8;
export function locomotionStyle(clip){
 const title=clip.title||clip.name||'';
 if(['Run','Soldier Run','Jog'].includes(title))return 'run';
 if(['Walk','Soldier Walk'].includes(title))return 'walk';
 return null;
}
// Upper arm pitch, elbow spread, forearm pitch and yaw, shoulder depth,
// and inward palm roll. Reach and recovery pass through different lanes.
const armPoses = [
 [ 48, 46,  13, -57,  .14, 12], // Lead hand cuts inward under the chin.
 [ 18, 39,   6, -18,  .12, 26], // Release the lead hand out of the centre.
 [-25, 32, -28,  30, -.04, 45], // Pull back outside the hip.
 [-64, 31, -51,  34, -.12, 35], // Rear elbow rises as the hand folds down.
 [-82, 25, -53,  32, -.19, 20], // Shoulder and elbow reach their rear accent.
 [-58, 29, -43,  26, -.11, 32], // Recover forward with the hand low.
 [-25, 31, -18,  12, -.01, 38], // Pass beside the body.
 [ 29, 38,   3, -36,  .11, 20], // Raise and flatten the hand into the next reach.
];

function sampleArmPose(phase) {
 const count = armPoses.length;
 const position = T.MathUtils.euclideanModulo(phase, 1) * count;
 const i = Math.floor(position), u = position - i;
 const a = armPoses[(i + count - 1) % count], b = armPoses[i];
 const c = armPoses[(i + 1) % count], d = armPoses[(i + 2) % count];
 return b.map((value, j) => value + 0.5 * u * (
  c[j] - a[j] + u * (2 * a[j] - 5 * value + 4 * c[j] - d[j] + u * (-a[j] + 3 * value - 3 * c[j] + d[j]))
 ));
}

export function athleticArm(body, frame, side, phase, style, reach) {
 const walking = style === 'walk';
 const [drive, spread, lift, sweep, twist, roll] = sampleArmPose(phase);
 const rad = T.MathUtils.degToRad;
 const upperPitch = rad(walking ? T.MathUtils.lerp(-8, drive, .52) : drive);
 const abduct = rad(walking ? spread * .8 : spread);
 const forePitch = rad(walking ? T.MathUtils.lerp(-30, lift, .50) : lift);
 const foreYaw = rad(walking ? T.MathUtils.lerp(8, sweep, .46) : sweep);
 const palmRoll = rad(walking ? T.MathUtils.lerp(35, roll, .65) : roll);
 const shoulder = body.c.clone()
  .addScaledVector(frame.across, side * .31)
  .addScaledVector(frame.up, .26)
  .addScaledVector(frame.forward, walking ? twist * .55 : twist);
 const upper = frame.up.clone().multiplyScalar(-Math.cos(upperPitch) * Math.cos(abduct))
  .addScaledVector(frame.forward, Math.sin(upperPitch) * Math.cos(abduct))
  .addScaledVector(frame.across, side * Math.sin(abduct));
 const lower = frame.up.clone().multiplyScalar(Math.sin(forePitch))
  .addScaledVector(frame.forward, Math.cos(forePitch) * Math.cos(foreYaw))
  .addScaledVector(frame.across, side * Math.cos(forePitch) * Math.sin(foreYaw));
 const elbow = shoulder.clone().addScaledVector(upper, walking ? .43 : .52);
 const centre = elbow.clone().addScaledVector(lower, .30 + reach);
 const palm = frame.up.clone().multiplyScalar(-Math.cos(palmRoll))
  .addScaledVector(frame.across, -side * Math.sin(palmRoll));
 return { shoulder, elbow, centre, palm };
}
export function restPalmWeight(clip,time=0){
 const name=(clip.title||clip.name||'').replaceAll('_',' ').toLowerCase();
 if(/dance|kick|look|push/.test(name))return 0;
 if(/jump/.test(name)){
  const duration=(clip.n-1)/clip.fps,phase=T.MathUtils.clamp(time/duration,0,1);
  const keys=[[0,1],[.08,1],[.205,.5],[.295,0],[.547,0],[.69,.7],[.879,1],[1,1]];
  let i=1;while(i<keys.length-1&&phase>keys[i][0])i++;
  const a=keys[i-1],b=keys[i],u=T.MathUtils.smoothstep(phase,a[0],b[0]);
  return T.MathUtils.lerp(a[1],b[1],u);
 }
 // Neutral and quiet hands use a relaxed pronated forearm. Athletic gaits
 // provide their own inward palm hint at the call site.
 return 1;
}

// This frame belongs to the character, never the camera. The black ball's old
// Mixamo quaternion is not a chest orientation: it can spin while the implied
// torso remains upright. Use the rig's front and a restrained head/body lean.
export function torsoFrame(body,head,left,right){
 const up=head.c.clone().sub(body.c).normalize().multiplyScalar(.2).add(V(0,.8,0)).normalize();
 const forward=V(0,0,1).addScaledVector(up,-up.z).normalize();
 const across=new T.Vector3().crossVectors(up,forward).normalize();
 return{up,forward,across};
}

export function danceFrame(body, head, chestForward) {
 const { up } = torsoFrame(body, head);
 const forward = chestForward.clone().addScaledVector(up, -chestForward.dot(up)).normalize();
 const across = new T.Vector3().crossVectors(up, forward).normalize();
 return { up, forward, across };
}
function orient(fingers,palm,side){
 const x=fingers.clone().multiplyScalar(side),y=palm.clone().negate();
 const z=new T.Vector3().crossVectors(x,y).normalize();y.crossVectors(z,x).normalize();
 return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x,y,z)).normalize();
}

// The glove model's fingers extend along anatomical +/-X and its palm faces -Y.
// Rest and gestures target the black sphere with the cuff opening (-finger
// axis). Athletic gaits supply a bent elbow instead. In either case the cuff
// follows the implied forearm without a separate wrist twist.
export function solveHand(body,frame,requested,side,reach,{
 restWeight=0,palmHint=null,cuffTarget=null,shoulderTarget=null,
 minimumLane=cuffTarget ? .10 : .50,
}={}){
 const shoulder=shoulderTarget?.clone()||body.c.clone().addScaledVector(frame.across,side*.24).addScaledVector(frame.up,.18);
 const centre=requested.clone();
 const lateral=centre.clone().sub(body.c).dot(frame.across)*side;
 if(lateral<minimumLane)centre.addScaledVector(frame.across,side*(minimumLane-lateral));
 const radial=centre.clone().sub(cuffTarget||body.c);
 const distance=radial.length();
 const fingers=distance>EPS?radial.multiplyScalar(1/distance):frame.across.clone().multiplyScalar(side);
 const wrist=centre.clone().addScaledVector(fingers,-reach);
 const forearmLength=Math.min(.42,Math.max(.10,(distance-reach)*.55));
 const elbow=cuffTarget?.clone()||wrist.clone().addScaledVector(fingers,-forearmLength);
 // The gesture reference faces away from the torso; the relaxed profile below
 // replaces it with a downward, slightly inward palm. Both lie normal to
 // the forearm. This stays defined when fingers point straight forward, where
 // a projected world-forward normal would flip through a singularity.
 const palm=centre.clone().sub(body.c);
 palm.addScaledVector(fingers,-palm.dot(fingers));
 if(palm.lengthSq()<1e-6)palm.copy(frame.forward).addScaledVector(fingers,-frame.forward.dot(fingers));
 palm.normalize();
 const relaxed=frame.up.clone().negate().addScaledVector(fingers,frame.up.dot(fingers)).normalize();
 if(palmHint){
  const hint=palmHint.clone().addScaledVector(fingers,-palmHint.dot(fingers));
  if(hint.lengthSq()>1e-5)palm.copy(hint.normalize());
 }else if(restWeight>=1){
  palm.copy(relaxed);
 }else if(restWeight>0){
  const angle=Math.atan2(fingers.dot(new T.Vector3().crossVectors(palm,relaxed)),palm.dot(relaxed));
  palm.applyAxisAngle(fingers,angle*restWeight).normalize();
 }
 const q=orient(fingers,palm,side);
 const upperDir=elbow.clone().sub(shoulder);
 if(upperDir.lengthSq()<1e-6)upperDir.copy(frame.up).negate();
 upperDir.normalize();
 const upperPalm=frame.forward.clone().addScaledVector(upperDir,-frame.forward.dot(upperDir));
 if(upperPalm.lengthSq()<1e-6)upperPalm.copy(frame.across).addScaledVector(upperDir,-frame.across.dot(upperDir));
 upperPalm.normalize();
 return{centre,shoulder,elbow,wrist,fingers,palm,q,upperQ:orient(upperDir,upperPalm,side),frame};
}
export function writeWorldBone(bone,position,q){
 bone.position.copy(bone.parent.worldToLocal(position.clone()));
 bone.quaternion.copy(bone.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(q));
 bone.updateMatrixWorld(true);
}

import * as T from './vendor/three/build/three.module.js';
import { RigidTransition } from './transitions.js';

// Explicit weights make interrupted blends deterministic. Finished actions are
// handled after mixer.update, never while Three is iterating active actions.
export class AnimationPlayer {
 constructor(mixer,onChange=()=>{}){this.mixer=mixer;this.onChange=onChange;this.current=null;this.idle=null;this.actions=new Set();this.transition=null;this.loop=true;this.finished=null;this.paused=false;this.fade=.3;this.bridge=new RigidTransition(mixer.getRoot());
  mixer.addEventListener('finished',e=>{if(e.action===this.current?.action)this.finished=e.action;});
 }
 select(entry,{fade=this.fade}={}){
  this.finished=null;const a=entry.action,previous=this.current;
  const previousClip=previous?.action.getClip();
  const armStyle=previousClip?.userData?.armStyle||this.transition?.pose?.armStyle;
  const pose=this.bridge.capture(armStyle,previousClip?.name);
  const from=new Map([...this.actions].map(a=>[a,a.getEffectiveWeight()]));
  a.reset().stopFading().stopWarping().setEffectiveTimeScale(1).setEffectiveWeight(from.get(a)||0);
  a.setLoop(!entry.still&&(this.loop||entry.isIdle)?T.LoopRepeat:T.LoopOnce,Infinity);a.clampWhenFinished=true;a.play();
  if(entry.still){a.time=entry.dur;a.paused=true;}
  this.actions.add(a);this.current=entry;
  if(!previous||previous===entry||fade<=0){this.solo();}else{from.set(a,from.get(a)||0);this.transition={from,pose,elapsed:0,duration:fade};this.bridge.begin(a.getClip());}
  this.mixer.update(0);this.onChange(entry);
  if(this.transition)this.bridge.apply(pose,a.time,0);else this.bridge.restore(a.getClip(),a.time);
 }
 solo(){for(const a of this.actions)if(a!==this.current.action)a.stop();this.actions=new Set([this.current.action]);this.current.action.stopFading().setEffectiveWeight(1);this.transition=null;}
 setLoop(loop){this.loop=loop;const e=this.current;if(!e)return;e.action.setLoop(!e.still&&(loop||e.isIdle)?T.LoopRepeat:T.LoopOnce,Infinity);
  if(!e.still&&e.action.paused&&e.action.time>=e.dur&&loop){e.action.reset().play();e.action.setEffectiveWeight(1);}
 }
 seek(seconds){if(!this.current)return;this.solo();this.finished=null;const a=this.current.action;
  a.enabled=true;a.paused=this.current.still;a.time=T.MathUtils.clamp(seconds,0,this.current.dur);this.mixer.update(0);this.bridge.restore(a.getClip(),a.time);
 }
 update(dt){if(this.paused)return;
  let completed=false;
  if(this.transition){const tr=this.transition;tr.elapsed+=Math.max(0,dt);const u=Math.min(1,tr.elapsed/tr.duration);
   for(const a of this.actions)a.setEffectiveWeight((tr.from.get(a)||0)*(1-u)+(a===this.current.action?u:0));if(u===1){this.solo();completed=true;}
  }
  this.mixer.update(dt);
  if(completed)this.bridge.restore(this.current.action.getClip(),this.current.action.time);
  if(this.transition)this.bridge.apply(this.transition.pose,this.current.action.time,Math.min(1,this.transition.elapsed/this.transition.duration));
  if(this.finished){this.finished=null;if(this.current&&!this.current.still&&!this.current.isIdle&&this.current.end!=='hold'&&this.idle)this.select(this.idle);}
 }
}

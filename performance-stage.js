import { Box3, Vector3 } from 'three';
import { makeFootballBall } from './football-ball.js';
import { createBasketballProps } from './basketball-props.js';
import { createGolfStage } from './golf-stage.js';
import { createTennisProps, tennisBounds } from './tennis-props.js';
import { createAmericanFootballProp } from './american-football-prop.js';

export function authoredPerformanceFrame(clip) {
  const framing = clip.basketball?.framing;
  return framing && { center: new Vector3(...framing.center), radius: framing.radius };
}

export function performanceBounds(clip) {
  return clip.tennis ? tennisBounds(clip, new Box3()) : undefined;
}

// Props use the sampled pose clock so a seek or replay reproduces contact.
export function createPerformanceStage(scene, rig, clips) {
  const football = clips.find(clip => clip.ball)?.ball;
  const updateFootball = football && makeFootballBall(scene, football.radius);
  const basketball = clips.some(clip => clip.basketball) && createBasketballProps(scene);
  const golf = clips.some(clip => clip.golf) && createGolfStage(scene, rig);
  const updateTennis = clips.some(clip => clip.tennis) && createTennisProps(scene, rig);
  const updateAmericanFootball = clips.some(clip => clip.prop?.kind === 'football') && createAmericanFootballProp(scene, rig);
  return (clip, time, transition) => {
    if (updateFootball) updateFootball(clip?.ball, time, clip?.fps);
    if (basketball) {
      const weight = transition ? transition.elapsed / transition.duration : 1;
      basketball.update(clip?.basketball, time, weight);
    }
    if (golf) golf.update(clip?.golf, clip?.fps, time);
    if (updateTennis) updateTennis(clip, time, !!transition);
    if (updateAmericanFootball) updateAmericanFootball(clip, time, transition);
  };
}

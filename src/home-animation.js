import {strikerRunupPose,penaltyStyles} from './anatomy.js';
const smooth=t=>{const q=Math.max(0,Math.min(1,t));return q*q*q*(q*(q*6-15)+10);};

// The camera leaves the striker before the next ball and runup are reset.
export function homeAnimation(time){
  const t=((time%20)+20)%20,focus=smooth((t-5)/3)*(1-smooth((t-14)/4));
  const kickTime=10.015,after=(t-kickTime)/1.3,phase=Math.max(0,Math.min(1,(t-8)/2.015));
  const flight=.55,travel=Math.max(0,Math.min(flight,after));
  const ball=after<0?{x:0,y:.11,z:11}:after<flight?{
    x:2.7*travel/flight,y:.11+4*travel-4.905*travel*travel,z:11-11*travel/flight,
  }:{x:2.7,y:Math.max(.11,.825-Math.max(0,after-flight)*1.4),z:Math.max(-1.65,-(after-flight)*12)};
  return {
    camera:{x:4.5+focus*1.8+Math.sin(t*Math.PI/10)*.4,y:5.4-focus*2.1,z:17.4+focus*.8},
    target:{x:-focus*1.2,y:.6,z:3+focus*8.5},
    striker:strikerRunupPose(0,phase,after>=0?after:-1,.7,2.7,penaltyStyles[0]),
    strikerVisible:t>=5&&t<18,ballVisible:t<18,
    ball,
    // Freeze the warmup during the shot, and retrace it as the camera returns.
    warmupTime:t<8?8*smooth(t/8):t<14?8:8*(1-smooth((t-14)/6)),
  };
}

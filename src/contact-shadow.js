// Reuses the one existing ball-shadow draw. No extra lights or postprocessing.
export function ballContactShadow(height,radius=.11,out={}){
  const gap=Math.max(0,height-radius);
  out.scale=1+Math.min(gap,8)*.52;out.opacity=.27*Math.exp(-gap*1.35);return out;
}
export function drawContactShadow(context,size){
  const half=size/2,gradient=context.createRadialGradient(half,half,0,half,half,half);
  gradient.addColorStop(0,'rgba(0,0,0,.9)');gradient.addColorStop(.38,'rgba(0,0,0,.64)');gradient.addColorStop(1,'rgba(0,0,0,0)');
  context.fillStyle=gradient;context.fillRect(0,0,size,size);
}

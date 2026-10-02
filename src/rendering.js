// Bound the framebuffer cost on Retina / 4K screens while retaining the mesh
// detail and antialiasing. High-DPR phones intentionally render below native density.
export function renderPixelRatio(width,height,pixelRatio=1){
  return Math.min(pixelRatio,1.7,Math.sqrt(3_000_000/(Math.max(1,width)*Math.max(1,height))));
}

// Restrict the extra grazing-angle sampling to the large pitch texture. This
// costs texture samples, not another pass or a larger texture allocation.
export function configurePitchFiltering(texture,renderer){
  const supported=renderer?.capabilities?.getMaxAnisotropy?.()??1;
  texture.anisotropy=Number.isFinite(supported)?Math.min(2,Math.max(1,Math.floor(supported))):1;
  return texture.anisotropy;
}

const drawingBuffers=new WeakMap();
// setPixelRatio() calls setSize() internally in Three r180. Update both logical
// size and ratio once, and avoid reallocating an unchanged drawing buffer.
export function resizeDrawingBuffer(renderer,width,height,pixelRatio){
  if(!renderer||!Number.isFinite(width)||!Number.isFinite(height)||!Number.isFinite(pixelRatio)||width<=0||height<=0||pixelRatio<=0)return false;
  const previous=drawingBuffers.get(renderer);
  if(previous&&previous.width===width&&previous.height===height&&previous.pixelRatio===pixelRatio)return false;
  renderer.setDrawingBufferSize(width,height,pixelRatio);
  drawingBuffers.set(renderer,{width,height,pixelRatio});return true;
}

// Static framing for the complete compact run-up ready pose on narrow phones.
// Offline production-skin probes retain a 12px horizontal margin for the actor,
// ball and goal at320x700,390x844 and320x900. FOV/aim stay fixed; landscape keeps17m.
export function advancedAttackRadius(width,height){
  return Math.min(25,Math.max(17,7+5.75*height/Math.max(1,width-24)));
}

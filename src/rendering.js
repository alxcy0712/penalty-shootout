// Bound the framebuffer cost on Retina / 4K screens while retaining the mesh
// detail and antialiasing. Small screens still render at native pixel density.
export function renderPixelRatio(width,height,pixelRatio=1){
  return Math.min(pixelRatio,1.7,Math.sqrt(3_000_000/(Math.max(1,width)*Math.max(1,height))));
}

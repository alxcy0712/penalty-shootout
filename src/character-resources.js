// Source resources are disposed by their cache, never by a character clone.
export function disposeCharacterAsset(asset){
  const geometries=new Set(),materials=new Set(),textures=new Set(),skeletons=new Set(),images=new Set();
  asset?.scene?.traverse(object=>{
    if(object.geometry)geometries.add(object.geometry);
    if(object.skeleton)skeletons.add(object.skeleton);
    for(const material of [object.material].flat().filter(Boolean)){
      materials.add(material);
      for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
    }
  });
  for(const texture of textures)for(const image of [texture.source?.data??texture.image].flat(Infinity)){
    if(typeof image?.close==='function')images.add(image);
  }
  for(const resources of [skeletons,geometries,materials,textures])for(const resource of resources)resource.dispose();
  // ImageBitmap CPU storage is not released by Texture.dispose(). A source may
  // be reused by several textures, so close it once, only at cache retirement.
  for(const image of images)image.close();
}

export function disposeCharacterRuntime(runtime){
  if(!runtime||runtime.disposed)return;
  runtime.disposed=true;
  runtime.root?.removeFromParent();
  runtime.mixer?.stopAllAction();
  if(runtime.mixer&&runtime.root)runtime.mixer.uncacheRoot(runtime.root);
  for(const skeleton of runtime.skeletons??[])skeleton.dispose();
  for(const geometry of runtime.geometries??[])geometry.dispose();
  for(const material of runtime.materials??[])material.dispose();
  for(const lease of runtime.leases??[])lease.release();
}

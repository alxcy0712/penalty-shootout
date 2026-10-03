import {gunzipSync} from 'node:zlib';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {requireThat, sha256} from './files.mjs';

const widths = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16};
const components = {5121: [1, 'readUInt8'], 5123: [2, 'readUInt16LE'], 5125: [4, 'readUInt32LE'], 5126: [4, 'readFloatLE']};
export async function checkGlb(bytes, metadata, identity) {
  const check = requireThat;
  check(bytes.length <= 450000, 'GLB byte budget exceeded before decode');
  check(bytes.length >= 28 && bytes.toString('ascii', 0, 4) === 'glTF' && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length, 'Invalid GLB header');
  const jsonLength = bytes.readUInt32LE(12), binOffset = 28 + jsonLength;
  check(jsonLength % 4 === 0 && binOffset <= bytes.length && bytes.toString('ascii', 16, 20) === 'JSON' && bytes.toString('ascii', binOffset - 4, binOffset) === 'BIN\0', 'Invalid GLB chunks');
  check(bytes.readUInt32LE(binOffset - 8) === bytes.length - binOffset, 'Invalid binary chunk length');
  const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength)), bin = bytes.subarray(binOffset);
  check(doc.asset?.version === '2.0' && Array.isArray(doc.meshes) && doc.meshes.length > 0, 'Invalid glTF document');
  check(doc.buffers.every(b => !b.uri) && doc.images.every(i => !i.uri), 'External asset references are unsupported');
  check(doc.skins.length === 1 && doc.skins[0].joints.length === 22 && new Set(doc.skins[0].joints).size === 22 && doc.skins[0].joints.every(i => doc.nodes[i]), 'Expected 22 distinct asset bones');
  check(doc.materials.length === 6 && doc.textures.length === 2, 'Material/texture budget changed');
  // Bound untrusted declarations before any Meshopt allocation or accessor array.
  check(Array.isArray(doc.bufferViews) && doc.bufferViews.length <= 1024 && doc.bufferViews.every(v => Number.isSafeInteger(v.byteLength) && v.byteLength >= 0 && v.byteLength <= 4 * 1024 * 1024) && doc.bufferViews.reduce((n, v) => n + v.byteLength, 0) <= 8 * 1024 * 1024, 'Decoded buffer budget exceeded before allocation');
  check(Array.isArray(doc.accessors) && doc.accessors.length <= 4096 && doc.accessors.every(a => Number.isSafeInteger(a.count) && a.count > 0 && a.count <= 65536) && doc.accessors.reduce((n, a) => n + a.count, 0) <= 250000, 'Accessor count budget exceeded before allocation');
  await MeshoptDecoder.ready;
  const views = doc.bufferViews.map(v => {
    check(Number.isSafeInteger(v.byteLength) && v.byteLength >= 0 && v.byteLength <= 32 * 1024 * 1024, 'Invalid buffer view size');
    const e = v.extensions?.EXT_meshopt_compression;
    const offset = e?.byteOffset ?? v.byteOffset ?? 0, length = e?.byteLength ?? v.byteLength;
    check(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length >= 0 && offset + length <= bin.length, 'Buffer view outside binary chunk');
    if (!e) return bin.subarray(offset, offset + length);
    check(e.buffer === 0 && Number.isSafeInteger(e.count) && e.count > 0 && Number.isSafeInteger(e.byteStride) && e.byteStride > 0 && e.count * e.byteStride <= v.byteLength, 'Invalid meshopt extent');
    const decoded = new Uint8Array(v.byteLength);
    MeshoptDecoder.decodeGltfBuffer(decoded, e.count, e.byteStride, bin.subarray(offset, offset + length), e.mode, e.filter);
    return Buffer.from(decoded);
  });
  const read = id => {
    const a = doc.accessors[id];
    check(a && !a.sparse && widths[a.type] && components[a.componentType] && Number.isSafeInteger(a.count) && a.count > 0, 'Unsupported accessor');
    const [size, method] = components[a.componentType], width = widths[a.type], view = doc.bufferViews[a.bufferView], data = views[a.bufferView], offset = a.byteOffset ?? 0, stride = view?.byteStride ?? size * width;
    check(data && Number.isSafeInteger(offset) && offset >= 0 && stride >= width * size && offset + (a.count - 1) * stride + width * size <= data.length, 'Accessor outside buffer view');
    return Array.from({length: a.count}, (_, i) => Array.from({length: width}, (_, j) => {
      const n = data[method](offset + i * stride + j * size); check(Number.isFinite(n), 'Nonfinite accessor');
      return a.normalized ? n / (a.componentType === 5121 ? 255 : 65535) : n;
    }));
  };
  let triangles = 0;
  for (const primitive of doc.meshes.flatMap(m => m.primitives)) {
    check((primitive.mode ?? 4) === 4 && primitive.material >= 0 && primitive.material < 6, 'Unsupported primitive');
    const a = primitive.attributes;
    check(a.COLOR_0 !== undefined && a.JOINTS_1 === undefined && a.WEIGHTS_1 === undefined && doc.accessors[a.POSITION]?.type === 'VEC3' && doc.accessors[a.JOINTS_0]?.type === 'VEC4' && doc.accessors[a.WEIGHTS_0]?.type === 'VEC4', 'Missing attributes or excess skin influences');
    const positions = read(a.POSITION), weights = read(a.WEIGHTS_0), joints = read(a.JOINTS_0), indices = read(primitive.indices).flat();
    check(weights.length === positions.length && joints.length === positions.length && indices.length % 3 === 0 && indices.every(i => Number.isInteger(i) && i >= 0 && i < positions.length), 'Invalid mesh counts or indices');
    check(weights.every(w => w.every(n => n >= 0 && n <= 1) && Math.abs(w.reduce((s, n) => s + n, 0) - 1) <= 0.0001), 'Invalid normalized skin weights');
    check(joints.every(j => j.every(n => Number.isInteger(n) && n >= 0 && n < 22)), 'Invalid skin joint');
    triangles += indices.length / 3;
  }
  check(triangles <= 18000 && bytes.length <= 450000, 'Model budget exceeded');
  check(metadata.triangles === triangles && metadata.glbBytes === bytes.length && metadata.bones === 22 && metadata.materials === 6 && metadata.textures === 2, 'Metadata does not match GLB');
  check(identity.sha256 === sha256(bytes) && identity.bytes === bytes.length && identity.triangles === triangles, 'Model identity manifest mismatch');
  return {triangles, bytes: bytes.length, bones: 22, materials: 6, textures: 2, maxInfluences: 4};
}
export function checkBlend(bytes) {
  const unpacked = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, {maxOutputLength: 64 * 1024 * 1024}) : bytes;
  requireThat(unpacked.length >= 12 && unpacked.toString('ascii', 0, 7) === 'BLENDER', 'Invalid editable Blender header');
  return {bytes: bytes.length, unpackedSha256: sha256(unpacked), scope: 'Header/serialization only; Blender structural equivalence is not rerun'};
}
export function parseCache(bytes) {
  const text = bytes.toString('utf8');
  const match = /^\/\/ Generated by tools\/generate-keeper-contact\.mjs from keeper-prototype\.glb\.\r?\nexport const keeperContactData=(\{[\s\S]*\});\s*$/.exec(text);
  requireThat(match, 'Cache must be the generated JSON-only module; executable code is rejected');
  const cache = JSON.parse(match[1]);
  requireThat(cache.source && cache.hulls && cache.binds && cache.patch && cache.torsoPatch, 'Incomplete contact cache');
  return cache;
}

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

export const mainSource=await readFile(new URL('../../src/main.js',import.meta.url),'utf8');
// Run the actual top-level application function, supporting both the original
// one-line wrappers and readable multiline bodies without duplicating logic.
export const mainFunction=name=>{
  const start=mainSource.indexOf(`function ${name}(`),lineEnd=mainSource.indexOf('\n',start);
  assert.ok(start>=0,`Missing application function ${name}`);
  const firstLine=mainSource.slice(start,lineEnd);
  return firstLine.endsWith('{')?mainSource.slice(start,mainSource.indexOf('\n}',lineEnd)+2):firstLine;
};

import {TextDecoder, assert} from '@loaders.gl/core';

// Decode the JSON binary array into clear text
export function getStringFromArrayBuffer(arrayBuffer, byteOffset, byteLength) {
  // Set up an array buffer view with the right offset and length
  arrayBuffer = arrayBuffer.buffer || arrayBuffer;
  const typedArray = new Uint8Array(arrayBuffer, byteOffset, byteLength);
  // Decode it
  const textDecoder = new TextDecoder('utf8');
  const string = textDecoder.decode(typedArray);
  return string;
}

// Decode the JSON binary array into clear text
export function getStringFromTypedArray(typedArray) {
  assert(ArrayBuffer.isView(typedArray));
  const textDecoder = new TextDecoder('utf8');
  const string = textDecoder.decode(typedArray);
  return string;
}

export function getMagicString(dataView, byteOffset = 0) {
  return `\
${String.fromCharCode(dataView.getUint8(byteOffset + 0))}\
${String.fromCharCode(dataView.getUint8(byteOffset + 1))}\
${String.fromCharCode(dataView.getUint8(byteOffset + 2))}\
${String.fromCharCode(dataView.getUint8(byteOffset + 3))}`;
}

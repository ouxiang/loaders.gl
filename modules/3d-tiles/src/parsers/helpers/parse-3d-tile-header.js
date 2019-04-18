const SIZEOF_UINT32 = 4;

/* PARSE FIXED HEADER:
Populates
  magic, // identifies type of tile
  type, // String version of magic
  version,
  byteLength
 */
export function parse3DTileHeaderSync(tile, dataView, byteOffset = 0) {
  tile.magic = dataView.getUint32(byteOffset, true);
  byteOffset += SIZEOF_UINT32;

  tile.version = dataView.getUint32(byteOffset, true);
  byteOffset += SIZEOF_UINT32;

  tile.byteLength = dataView.getUint32(byteOffset, true);
  byteOffset += SIZEOF_UINT32;

  // TODO - move version check into each tile parser?
  if (tile.version !== 1) {
    throw new Error(`3D Tile Version ${tile.version} not supported`);
  }

  return byteOffset; // Indicates where the parsing ended
}

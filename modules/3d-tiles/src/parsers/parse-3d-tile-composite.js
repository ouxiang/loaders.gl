import {parse3DTileHeaderSync} from './helpers/parse-3d-tile-header';

// Reference code:
// https://github.com/AnalyticalGraphicsInc/cesium/blob/master/Source/Scene/Composite3DTileContent.js#L182
export default function parseComposite3DTileSync(
  tile,
  dataView,
  byteOffset,
  options,
  parse3DTileSync
) {
  byteOffset = parse3DTileHeaderSync(tile, dataView, byteOffset, options);

  // Extract number of tiles
  tile.tilesLength = dataView.getUint32(byteOffset, true);
  byteOffset += 4;

  // extract each tile from the byte stream
  tile.tiles = [];
  while (tile.tiles.length < tile.tilesLength && tile.byteLength - byteOffset > 12) {
    const subtile = {};
    tile.tiles.push(subtile);
    byteOffset = parse3DTileSync(dataView, byteOffset, options, subtile);
    // TODO - do we need to add any padding in between tiles?
  }

  return byteOffset;
}

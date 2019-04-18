import {TILE3D_TYPE} from '../constants';
import {getMagicString} from './helpers/parse-utils';

import parsePointCloud3DTileSync from './parse-3d-tile-point-cloud';
import parseBatchedModel3DTileSync from './parse-3d-tile-batched-model';
import parseInstancedModel3DTileSync from './parse-3d-tile-instanced-model';
import parseComposite3DTileSync from './parse-3d-tile-composite';

// Extracts
export default function parse3DTileSync(dataView, byteOffset = 0, options = {}, tile = {}) {
  // Peek into data and extract type
  tile.type = getMagicString(dataView, byteOffset);

  // Save byteOffset (start of tile in original binary "stream")
  tile.byteOffset = byteOffset;

  switch (tile.type) {
    case TILE3D_TYPE.COMPOSITE:
      // Note: We pass this function as argument so that embedded tiles can be parsed recursively
      parseComposite3DTileSync(tile, dataView, byteOffset, options, parse3DTileSync);
      break;

    case TILE3D_TYPE.BATCHED_3D_MODEL:
      parseBatchedModel3DTileSync(tile, dataView, byteOffset, options);
      break;

    case TILE3D_TYPE.INSTANCED_3D_MODEL:
      parseInstancedModel3DTileSync(tile, dataView, byteOffset, options);
      break;

    case TILE3D_TYPE.POINT_CLOUD:
      parsePointCloud3DTileSync(tile, dataView, byteOffset, options);
      break;

    default:
      throw new Error(`3DTileLoader: unknown type ${tile.type}`); // eslint-disable-line
  }

  return tile;
}

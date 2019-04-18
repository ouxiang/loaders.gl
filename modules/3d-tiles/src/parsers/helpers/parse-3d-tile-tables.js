import {getStringFromArrayBuffer} from './parse-utils';

const SIZEOF_UINT32 = 4;

// eslint-disable-next-line max-statements
export function parse3DTileTablesHeaderSync(tile, dataView, byteOffset) {
  tile.featureTableJsonByteLength = dataView.getUint32(byteOffset, true);
  byteOffset += SIZEOF_UINT32;

  tile.featureTableBinaryByteLength = dataView.getUint32(byteOffset, true);
  byteOffset += SIZEOF_UINT32;

  tile.batchTableJsonByteLength = dataView.getUint32(byteOffset, true);
  byteOffset += SIZEOF_UINT32;

  tile.batchTableBinaryByteLength = dataView.getUint32(byteOffset, true);
  byteOffset += SIZEOF_UINT32;

  return byteOffset;
}

export function parse3DTileTablesSync(tile, dataView, byteOffset, options) {
  byteOffset = parse3DTileFeatureTable(tile, dataView, byteOffset, options);
  byteOffset = parse3DTileBatchTable(tile, dataView, byteOffset, options);
  return byteOffset;
}

function parse3DTileFeatureTable(tile, dataView, byteOffset, options) {
  const {featureTableJsonByteLength, featureTableBinaryByteLength} = tile;

  tile.featureTableJson = {
    BATCH_LENGTH: 0
  };

  if (featureTableJsonByteLength > 0) {
    const featureTableString = getStringFromArrayBuffer(
      dataView,
      byteOffset,
      featureTableJsonByteLength
    );
    tile.featureTableJson = JSON.parse(featureTableString);
  }
  byteOffset += featureTableJsonByteLength;

  tile.featureTableBinary = new Uint8Array(dataView.buffer, byteOffset, featureTableBinaryByteLength);
  byteOffset += featureTableBinaryByteLength;

  /*
  const featureTable = parseFeatureTable(featureTableJson, featureTableBinary);

  const batchLength = featureTable.getGlobalProperty('BATCH_LENGTH');
  featureTable.featuresLength = batchLength;
  */

  return byteOffset;
}

function parse3DTileBatchTable(tile, dataView, byteOffset, options) {
  const {batchTableJsonByteLength, batchTableBinaryByteLength} = tile;

  if (batchTableJsonByteLength > 0) {
    const batchTableString = getStringFromArrayBuffer(
      dataView,
      byteOffset,
      batchTableJsonByteLength
    );
    tile.batchTableJson = JSON.parse(batchTableString);
    byteOffset += batchTableJsonByteLength;

    if (batchTableBinaryByteLength > 0) {
      // Has a batch table binary
      tile.batchTableBinary = new Uint8Array(dataView.buffer, byteOffset, batchTableBinaryByteLength);
      // Copy the batchTableBinary section and let the underlying ArrayBuffer be freed
      tile.batchTableBinary = new Uint8Array(tile.batchTableBinary);

      byteOffset += batchTableBinaryByteLength;
    }
  }

  return byteOffset;
}

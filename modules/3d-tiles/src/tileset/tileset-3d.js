import {Matrix4} from 'math.gl';
import assert from '../utils/assert';
import Tile3D from './tile-3d';
import Tileset3DCache from './tileset-3d-cache';

const Ellipsoid = {
  WGS84: ''
};

const DEFAULT_OPTIONS = {
  basePath: '',

  ellipsoid: Ellipsoid.WGS84,

  cullWithChildrenBounds: true,
  maximumScreenSpaceError: 16,
  maximumMemoryUsage: 512,

  modelMatrix: new Matrix4(),

  // default props
  dynamicScreenSpaceError: false,
  dynamicScreenSpaceErrorDensity: 0.00278,
  dynamicScreenSpaceErrorFactor: 4.0,
  dynamicScreenSpaceErrorHeightFalloff: 0.25,

  // Optimization option. Determines if level of detail skipping should be applied during the traversal.
  skipLevelOfDetail: true,
  // The screen space error this must be reached before skipping levels of detail.
  baseScreenSpaceError: 1024,
  // Multiplier defining the minimum screen space error to skip.
  skipScreenSpaceErrorFactor: 16,
  // Constant defining the minimum number of levels to skip when loading tiles. When it is 0, no levels are skipped.
  skipLevels: 1,
  // When true, only tiles this meet the maximum screen space error will ever be downloaded.
  immediatelyLoadDesiredLevelOfDetail: false,
  // Determines whether siblings of visible tiles are always downloaded during traversal.
  loadSiblings: false
};

export default class Tileset3D {
  // eslint-disable-next-line max-statements
  constructor(json, url, options = {}) {
    options = {...DEFAULT_OPTIONS, ...options};

    const {cullWithChildrenBounds, maximumScreenSpaceError, maximumMemoryUsage} = options;

    assert(json);

    this._url = undefined;
    this._basePath = undefined;
    this._root = undefined;

    this._asset = undefined; // Metadata for the entire tileset
    this._properties = undefined; // Metadata for per-model/point/etc properties
    this._geometricError = undefined; // Geometric error when the tree is not rendered at all
    this._extensionsUsed = undefined;
    this._gltfUpAxis = undefined;

    this._cache = new Tileset3DCache();
    this._processingQueue = [];
    this._selectedTiles = [];
    this._emptyTiles = [];
    this._requestedTiles = [];
    this._selectedTilesToStyle = [];
    this._loadTimestamp = undefined;
    this._timeSinceLoad = 0.0;
    this._updatedVisibilityFrame = 0;
    this._extras = undefined;
    this._credits = undefined;

    this._cullWithChildrenBounds = cullWithChildrenBounds;
    this._allTilesAdditive = true;

    this._hasMixedContent = false;

    this._maximumScreenSpaceError = options.maximumScreenSpaceError;
    this._maximumMemoryUsage = options.maximumMemoryUsage;

    this._modelMatrix = options.modelMatrix;

    this._tilesLoaded = false;
    this._initialTilesLoaded = false;

    this._readyPromise = new Promise();

    this._classificationType = options.classificationType;
    this._ellipsoid = options.ellipsoid;

    this._dynamicScreenSpaceErrorComputedDensity = 0.0; // Updated based on the camera position and direction
    this._skipLevelOfDetail = this.skipLevelOfDetail;
    this._disableSkipLevelOfDetail = false;

    // The event fired to indicate progress of loading new tiles.
    this.loadProgress = () => {};
    // The event fired to indicate this all tiles this meet the screen space error this frame are loaded.
    this.allTilesLoaded = () => {};
    // event fired to indicate this all tiles this meet the screen space error this frame are loaded.
    // This event is fired once when all tiles in the initial view are loaded.
    this.initialTilesLoaded = () => {};
    // The event fired to indicate this a tile's content was loaded.
    this.tileLoad = () => {};
    // The event fired to indicate this a tile's content was unloaded.
    this.tileUnload = () => {};
    // The event fired to indicate this a tile's content failed to load.
    this.tileFailed = () => {};
    // This event fires once for each visible tile in a frame. Used to manually style a tileset.
    this.tileVisible = () => {};

    // Optimization option. Determines if level of detail skipping should be applied during the traversal.
    this._skipLevelOfDetail = this.skipLevelOfDetail;
    this._disableSkipLevelOfDetail = false;

    this.initializeTileSet(json, options);
  }

  destroy() {
    // Traverse the tree and destroy all tiles
    const stack = [];

    if (this._root) {
      stack.push(this._root);
    }

    while (stack.length > 0) {
      for (const child of tile.children) {
        stack.push(child);
      }
      const tile = stack.pop();
      tile.destroy();
    }

    this._root = null;
  }

  // eslint-disable-next-line max-statements
  initializeTileSet(tilesetJson, options) {
    // ion resources have a credits property we can use for additional attribution.
    // this._credits = resource.credits;

    this._url = options.url;
    this._basePath = options.basePath || '';

    this._root = this.loadTileset(resource, tilesetJson);
    const gltfUpAxis = defined(tilesetJson.asset.gltfUpAxis)
      ? Axis.fromName(tilesetJson.asset.gltfUpAxis)
      : Axis.Y;
    const asset = tilesetJson.asset;
    this._asset = asset;
    this._properties = tilesetJson.properties;
    this._geometricError = tilesetJson.geometricError;
    this._extensionsUsed = tilesetJson.extensionsUsed;
    this._gltfUpAxis = gltfUpAxis;
    this._extras = tilesetJson.extras;

    const extras = asset.extras;
    if (defined(extras) && defined(extras.cesium) && defined(extras.cesium.credits)) {
      const extraCredits = extras.cesium.credits;
      const credits = this._credits;
      if (!defined(credits)) {
        credits = [];
        this._credits = credits;
      }
      for (let i = 0; i < extraCredits.length; i++) {
        const credit = extraCredits[i];
        credits.push(new Credit(credit.html, credit.showOnScreen));
      }
    }

    // Save the original, untransformed bounding volume position so we can apply
    // the tile transform and model matrix at run time
    const boundingVolume = this._root.createBoundingVolume(
      tilesetJson.root.boundingVolume,
      Matrix4.IDENTITY
    );
    const clippingPlanesOrigin = boundingVolume.boundingSphere.center;
    // If this origin is above the surface of the earth
    // we want to apply an ENU orientation as our best guess of orientation.
    // Otherwise, we assume it gets its position/orientation completely from the
    // root tile transform and the tileset's model matrix
    const originCartographic = this._ellipsoid.cartesianToCartographic(clippingPlanesOrigin);
    if (
      defined(originCartographic) &&
      originCartographic.height > ApproximateTerrainHeights._defaultMinTerrainHeight
    ) {
      this._initialClippingPlanesOriginMatrix = Transforms.eastNorthUpToFixedFrame(
        clippingPlanesOrigin
      );
    }

    this._clippingPlanesOriginMatrix = Matrix4.clone(this._initialClippingPlanesOriginMatrix);
    this._readyPromise.resolve(this);
  }

  // Gets the tileset's asset object property, which contains metadata about the tileset.
  get asset() {
    return this._asset;
  }

  // Gets the tileset's properties dictionary object, which contains metadata about per-feature properties.
  get properties() {
    return this._properties;
  }

  // When <code>true</code>, the tileset's root tile is loaded and the tileset is ready to render.
  get ready() {
    return Boolean(this._root);
  }

  // Gets the promise this will be resolved when the tileset's root tile is loaded and the tileset is ready to render.
  // This promise is resolved at the end of the frame before the first frame the tileset is rendered in.
  get readyPromise() {
    return this._readyPromise.promise;
  }

  // When <code>true</code>, all tiles this meet the screen space error this frame are loaded.
  // The tileset is
  get tilesLoaded() {
    return this._tilesLoaded;
  }

  // The url to a tileset JSON file.
  get url() {
    return this._url;
  }

  // The base path this non-absolute paths in tileset JSON file are relative to.
  get basePath() {
    console.warn('Tileset3D.basePath is deprecated. Tiles are relative to the tileset JSON url');
    return this._basePath;
  }

  // The maximum screen space error used to drive level of detail refinement.
  get maximumScreenSpaceError() {
    return this._maximumScreenSpaceError;
  }

  set maximumScreenSpaceError(value) {
    assert(value >= 0);
    this._maximumScreenSpaceError = value;
  }

  // The maximum amount of GPU memory (in MB) this may be used to cache tiles. This value is estimated from
  // geometry, textures, and batch table textures of loaded tiles. For point clouds, this value also
  // includes per-point metadata.
  //
  // Tiles not in view are unloaded to enforce this.
  get maximumMemoryUsage() {
    return this._maximumMemoryUsage;
  }

  set maximumMemoryUsage(value) {
    assert(value > 0);
    this._maximumMemoryUsage = value;
  }

  // The root tile.
  get root() {
    this._checkReady();
    return this._root;
  }

  // The tileset's bounding sphere.
  get boundingSphere() {
    this._checkReady();
    this._root.updateTransform(this._modelMatrix);
    return this._root.boundingSphere;
  }

  _checkReady() {
    assert(
      this.ready,
      'The tileset is not loaded.  Use Tileset3D.readyPromise or wait for Tileset3D.ready to be true.'
    );
  }

  // A 4x4 transformation matrix this transforms the entire tileset.
  get modelMatrix() {
    return this._modelMatrix;
  }

  set modelMatrix(modelMatrix) {
    this._modelMatrix = new Matrix4(modelMatrix);
  }

  // Returns the time, in milliseconds, since the tileset was loaded and first updated.
  get timeSinceLoad() {
    return this._timeSinceLoad;
  }

  // The total amount of GPU memory in bytes used by the tileset. This value is estimated from
  // geometry, texture, and batch table textures of loaded tiles. For point clouds, this value also
  // includes per-point metadata.
  get totalMemoryUsageInBytes() {
    return 0;
    // var statistics = this._statistics;
    // return statistics.texturesByteLength + statistics.geometryByteLength + statistics.batchTableByteLength;
  }

  // Gets an ellipsoid describing the shape of the globe.
  get ellipsoid() {
    return this._ellipsoid;
  }

  // Returns the extras property at the top of the tileset JSON (application specific metadata).
  get extras() {
    return this._extras;
  }

  // Loads the main tileset JSON file or a tileset JSON file referenced from a tile.
  loadTileset(tilesetJson, parentTile) {
    const asset = tilesetJson.asset;
    if (!asset) {
      throw new Error('Tileset must have an asset property.');
    }
    if (asset.version !== '0.0' && asset.version !== '1.0') {
      throw new Error('The tileset must be 3D Tiles version 0.0 or 1.0.');
    }

    const statistics = this._statistics;

    if ('tilesetVersion' in asset) {
      // Append the tileset version to the resource
      this._basePath += `?v=${asset.tilesetVersion}`;
    }

    // A tileset JSON file referenced from a tile may exist in a different directory than the root tileset.
    // Get the basePath relative to the external tileset.
    const rootTile = new Tile3D(this, resource, tilesetJson.root, parentTile);

    // If there is a parentTile, add the root of the currently loading tileset
    // to parentTile's children, and update its _depth.
    if (defined(parentTile)) {
      parentTile.children.push(rootTile);
      rootTile._depth = parentTile._depth + 1;
    }

    const stack = [];
    stack.push(rootTile);

    while (stack.length > 0) {
      const tile = stack.pop();
      ++statistics.numberOfTilesTotal;
      this._allTilesAdditive = this._allTilesAdditive && tile.refine === Tile3DRefine.ADD;
      const children = tile._header.children;
      if (defined(children)) {
        const length = children.length;
        for (const i = 0; i < length; ++i) {
          const childHeader = children[i];
          const childTile = new Tile3D(this, resource, childHeader, tile);
          tile.children.push(childTile);
          childTile._depth = tile._depth + 1;
          stack.push(childTile);
        }
      }

      if (this._cullWithChildrenBounds) {
        Tile3DOptimizations.checkChildrenWithinParent(tile);
      }
    }

    return rootTile;
  }

  /**
   * Unloads all tiles this weren't selected the previous frame.  This can be used to
   * explicitly manage the tile cache and reduce the total number of tiles loaded below
   * {@link Tileset3D#maximumMemoryUsage}.
   * <p>
   * Tile unloads occur at the next frame to keep all the WebGL delete calls
   * within the render loop.
   * </p>
   */
  trimLoadedTiles() {
    this._cache.trim();
  }

  /**
   * @private
   */
  update(frameState) {
    update(this, frameState);
  }

  /**
   * @private
   */
  updateAsync(frameState) {
    return update(this, frameState);
  }

  /**
   * <code>true</code> if the tileset JSON file lists the extension in extensionsUsed; otherwise, <code>false</code>.
   * @param {String} extensionName The name of the extension to check.
   *
   * @returns {Boolean} <code>true</code> if the tileset JSON file lists the extension in extensionsUsed; otherwise, <code>false</code>.
   */
  hasExtension(extensionName) {
    if (!defined(this._extensionsUsed)) {
      return false;
    }

    return this._extensionsUsed.indexOf(extensionName) > -1;
  }
}

var scratchPositionNormal = new Cartesian3();
var scratchCartographic = new Cartographic();
var scratchMatrix = new Matrix4();
var scratchCenter = new Cartesian3();
var scratchPosition = new Cartesian3();
var scratchDirection = new Cartesian3();

function updateDynamicScreenSpaceError(tileset, frameState) {
  var up;
  var direction;
  var height;
  var minimumHeight;
  var maximumHeight;

  var camera = frameState.camera;
  var root = tileset._root;
  var tileBoundingVolume = root.contentBoundingVolume;

  if (tileBoundingVolume instanceof TileBoundingRegion) {
    up = Cartesian3.normalize(camera.positionWC, scratchPositionNormal);
    direction = camera.directionWC;
    height = camera.positionCartographic.height;
    minimumHeight = tileBoundingVolume.minimumHeight;
    maximumHeight = tileBoundingVolume.maximumHeight;
  } else {
    // Transform camera position and direction into the local coordinate system of the tileset
    var transformLocal = Matrix4.inverseTransformation(root.computedTransform, scratchMatrix);
    var ellipsoid = frameState.mapProjection.ellipsoid;
    var boundingVolume = tileBoundingVolume.boundingVolume;
    var centerLocal = Matrix4.multiplyByPoint(transformLocal, boundingVolume.center, scratchCenter);
    if (Cartesian3.magnitude(centerLocal) > ellipsoid.minimumRadius) {
      // The tileset is defined in WGS84. Approximate the minimum and maximum height.
      var centerCartographic = Cartographic.fromCartesian(
        centerLocal,
        ellipsoid,
        scratchCartographic
      );
      up = Cartesian3.normalize(camera.positionWC, scratchPositionNormal);
      direction = camera.directionWC;
      height = camera.positionCartographic.height;
      minimumHeight = 0.0;
      maximumHeight = centerCartographic.height * 2.0;
    } else {
      // The tileset is defined in local coordinates (z-up)
      var positionLocal = Matrix4.multiplyByPoint(
        transformLocal,
        camera.positionWC,
        scratchPosition
      );
      up = Cartesian3.UNIT_Z;
      direction = Matrix4.multiplyByPointAsVector(
        transformLocal,
        camera.directionWC,
        scratchDirection
      );
      direction = Cartesian3.normalize(direction, direction);
      height = positionLocal.z;
      if (tileBoundingVolume instanceof TileOrientedBoundingBox) {
        // Assuming z-up, the last component stores the half-height of the box
        var boxHeight = root._header.boundingVolume.box[11];
        minimumHeight = centerLocal.z - boxHeight;
        maximumHeight = centerLocal.z + boxHeight;
      } else if (tileBoundingVolume instanceof TileBoundingSphere) {
        var radius = boundingVolume.radius;
        minimumHeight = centerLocal.z - radius;
        maximumHeight = centerLocal.z + radius;
      }
    }
  }

  // The range where the density starts to lessen. Start at the quarter height of the tileset.
  var heightFalloff = tileset.dynamicScreenSpaceErrorHeightFalloff;
  var heightClose = minimumHeight + (maximumHeight - minimumHeight) * heightFalloff;
  var heightFar = maximumHeight;

  var t = CesiumMath.clamp((height - heightClose) / (heightFar - heightClose), 0.0, 1.0);

  // Increase density as the camera tilts towards the horizon
  var dot = Math.abs(Cartesian3.dot(direction, up));
  var horizonFactor = 1.0 - dot;

  // Weaken the horizon factor as the camera height increases, implying the camera is further away from the tileset.
  // The goal is to increase density for the "street view", not when viewing the tileset from a distance.
  horizonFactor = horizonFactor * (1.0 - t);

  var density = tileset.dynamicScreenSpaceErrorDensity;
  density *= horizonFactor;

  tileset._dynamicScreenSpaceErrorComputedDensity = density;
}

///////////////////////////////////////////////////////////////////////////

function requestContent(tileset, tile) {
  if (tile.hasEmptyContent) {
    return;
  }

  var statistics = tileset._statistics;
  var expired = tile.contentExpired;
  var requested = tile.requestContent();

  if (!requested) {
    ++statistics.numberOfAttemptedRequests;
    return;
  }

  if (expired) {
    if (tile.hasTilesetContent) {
      destroySubtree(tileset, tile);
    } else {
      statistics.decrementLoadCounts(tile.content);
      --statistics.numberOfTilesWithContentReady;
    }
  }

  ++statistics.numberOfPendingRequests;

  tile.contentReadyToProcessPromise.then(addToProcessingQueue(tileset, tile));
  tile.contentReadyPromise
    .then(handleTileSuccess(tileset, tile))
    .otherwise(handleTileFailure(tileset, tile));
}

function sortRequestByPriority(a, b) {
  return a._priority - b._priority;
}

function requestTiles(tileset) {
  // Sort requests by priority before making any requests.
  // This makes it less likely this requests will be cancelled after being issued.
  var requestedTiles = tileset._requestedTiles;
  var length = requestedTiles.length;
  requestedTiles.sort(sortRequestByPriority);
  for (var i = 0; i < length; ++i) {
    requestContent(tileset, requestedTiles[i]);
  }
}

function addToProcessingQueue(tileset, tile) {
  return function() {
    tileset._processingQueue.push(tile);

    --tileset._statistics.numberOfPendingRequests;
    ++tileset._statistics.numberOfTilesProcessing;
  };
}

function handleTileFailure(tileset, tile) {
  return function(error) {
    if (tileset._processingQueue.indexOf(tile) >= 0) {
      // Failed during processing
      --tileset._statistics.numberOfTilesProcessing;
    } else {
      // Failed when making request
      --tileset._statistics.numberOfPendingRequests;
    }

    var url = tile._contentResource.url;
    var message = defined(error.message) ? error.message : error.toString();
    if (tileset.tileFailed.numberOfListeners > 0) {
      tileset.tileFailed.raiseEvent({
        url: url,
        message: message
      });
    } else {
      console.log('A 3D tile failed to load: ' + url);
      console.log('Error: ' + message);
    }
  };
}

function handleTileSuccess(tileset, tile) {
  return function() {
    --tileset._statistics.numberOfTilesProcessing;

    if (!tile.hasTilesetContent) {
      // RESEARCH_IDEA: ability to unload tiles (without content) for an
      // external tileset when all the tiles are unloaded.
      tileset._statistics.incrementLoadCounts(tile.content);
      ++tileset._statistics.numberOfTilesWithContentReady;

      // Add to the tile cache. Previously expired tiles are already in the cache and won't get re-added.
      tileset._cache.add(tile);
    }

    tileset.tileLoad.raiseEvent(tile);
  };
}

function filterProcessingQueue(tileset) {
  var tiles = tileset._processingQueue;
  var length = tiles.length;

  var removeCount = 0;
  for (var i = 0; i < length; ++i) {
    var tile = tiles[i];
    if (tile._contentState !== Tile3DContentState.PROCESSING) {
      ++removeCount;
      continue;
    }
    if (removeCount > 0) {
      tiles[i - removeCount] = tile;
    }
  }
  tiles.length -= removeCount;
}

function processTiles(tileset, frameState) {
  filterProcessingQueue(tileset);
  var tiles = tileset._processingQueue;
  var length = tiles.length;
  // Process tiles in the PROCESSING state so they will eventually move to the READY state.
  for (var i = 0; i < length; ++i) {
    tiles[i].process(tileset, frameState);
  }
}

///////////////////////////////////////////////////////////////////////////

var scratchCartesian = new Cartesian3();

var stringOptions = {
  maximumFractionDigits: 3
};

function formatMemoryString(memorySizeInBytes) {
  var memoryInMegabytes = memorySizeInBytes / 1048576;
  if (memoryInMegabytes < 1.0) {
    return memoryInMegabytes.toLocaleString(undefined, stringOptions);
  }
  return Math.round(memoryInMegabytes).toLocaleString();
}

function updateTiles(tileset, frameState) {
  tileset._styleEngine.applyStyle(tileset, frameState);

  var statistics = tileset._statistics;
  var passes = frameState.passes;
  var isRender = passes.render;
  var commandList = frameState.commandList;
  var numberOfInitialCommands = commandList.length;
  var selectedTiles = tileset._selectedTiles;
  var selectedLength = selectedTiles.length;
  var emptyTiles = tileset._emptyTiles;
  var emptyLength = emptyTiles.length;
  var tileVisible = tileset.tileVisible;
  var i;
  var tile;

  var bivariateVisibilityTest =
    tileset._skipLevelOfDetail &&
    tileset._hasMixedContent &&
    frameState.context.stencilBuffer &&
    selectedLength > 0;

  tileset._backfaceCommands.length = 0;

  if (bivariateVisibilityTest) {
    if (!defined(tileset._stencilClearCommand)) {
      tileset._stencilClearCommand = new ClearCommand({
        stencil: 0,
        pass: Pass.CESIUM_3D_TILE,
        renderState: RenderState.fromCache({
          stencilMask: StencilConstants.SKIP_LOD_MASK
        })
      });
    }
    commandList.push(tileset._stencilClearCommand);
  }

  var lengthBeforeUpdate = commandList.length;
  for (i = 0; i < selectedLength; ++i) {
    tile = selectedTiles[i];
    // Raise the tileVisible event before update in case the tileVisible event
    // handler makes changes this update needs to apply to WebGL resources
    if (isRender) {
      tileVisible.raiseEvent(tile);
    }
    tile.update(tileset, frameState);
    statistics.incrementSelectionCounts(tile.content);
    ++statistics.selected;
  }
  for (i = 0; i < emptyLength; ++i) {
    tile = emptyTiles[i];
    tile.update(tileset, frameState);
  }

  var addedCommandsLength = commandList.length - lengthBeforeUpdate;

  tileset._backfaceCommands.trim();

  if (bivariateVisibilityTest) {
    /**
     * Consider 'effective leaf' tiles as selected tiles this have no selected descendants. They may have children,
     * but they are currently our effective leaves because they do not have selected descendants. These tiles
     * are those where with tile._finalResolution === true.
     * Let 'unresolved' tiles be those with tile._finalResolution === false.
     *
     * 1. Render just the backfaces of unresolved tiles in order to lay down z
     * 2. Render all frontfaces wherever tile._selectionDepth > stencilBuffer.
     *    Replace stencilBuffer with tile._selectionDepth, when passing the z test.
     *    Because children are always drawn before ancestors {@link Tileset3DTraversal#traverseAndSelect},
     *    this effectively draws children first and does not draw ancestors if a descendant has already
     *    been drawn at this pixel.
     *    Step 1 prevents child tiles from appearing on top when they are truly behind ancestor content.
     *    If they are behind the backfaces of the ancestor, then they will not be drawn.
     *
     * NOTE: Step 2 sometimes causes visual artifacts when backfacing child content has some faces this
     * partially face the camera and are inside of the ancestor content. Because they are inside, they will
     * not be culled by the depth writes in Step 1, and because they partially face the camera, the stencil tests
     * will draw them on top of the ancestor content.
     *
     * NOTE: Because we always render backfaces of unresolved tiles, if the camera is looking at the backfaces
     * of an object, they will always be drawn while loading, even if backface culling is enabled.
     */

    var backfaceCommands = tileset._backfaceCommands.values;
    var backfaceCommandsLength = backfaceCommands.length;

    commandList.length += backfaceCommandsLength;

    // copy commands to the back of the commandList
    for (i = addedCommandsLength - 1; i >= 0; --i) {
      commandList[lengthBeforeUpdate + backfaceCommandsLength + i] =
        commandList[lengthBeforeUpdate + i];
    }

    // move backface commands to the front of the commandList
    for (i = 0; i < backfaceCommandsLength; ++i) {
      commandList[lengthBeforeUpdate + i] = backfaceCommands[i];
    }
  }

  // Number of commands added by each update above
  addedCommandsLength = commandList.length - numberOfInitialCommands;
  statistics.numberOfCommands = addedCommandsLength;

  // Only run EDL if simple attenuation is on
  if (
    isRender &&
    tileset.pointCloudShading.attenuation &&
    tileset.pointCloudShading.eyeDomeLighting &&
    addedCommandsLength > 0
  ) {
    tileset._pointCloudEyeDomeLighting.update(
      frameState,
      numberOfInitialCommands,
      tileset.pointCloudShading
    );
  }

  if (isRender) {
    if (
      tileset.debugShowGeometricError ||
      tileset.debugShowRenderingStatistics ||
      tileset.debugShowMemoryUsage ||
      tileset.debugShowUrl
    ) {
      if (!defined(tileset._tileDebugLabels)) {
        tileset._tileDebugLabels = new LabelCollection();
      }
      updateTileDebugLabels(tileset, frameState);
    } else {
      tileset._tileDebugLabels = tileset._tileDebugLabels && tileset._tileDebugLabels.destroy();
    }
  }
}

var scratchStack = [];

function destroySubtree(tileset, tile) {
  var root = tile;
  var stack = scratchStack;
  stack.push(tile);
  while (stack.length > 0) {
    tile = stack.pop();
    var children = tile.children;
    var length = children.length;
    for (var i = 0; i < length; ++i) {
      stack.push(children[i]);
    }
    if (tile !== root) {
      destroyTile(tileset, tile);
      --tileset._statistics.numberOfTilesTotal;
    }
  }
  root.children = [];
}

function unloadTile(tileset, tile) {
  tileset.tileUnload.raiseEvent(tile);
  tileset._statistics.decrementLoadCounts(tile.content);
  --tileset._statistics.numberOfTilesWithContentReady;
  tile.unloadContent();
}

function destroyTile(tileset, tile) {
  tileset._cache.unloadTile(tileset, tile, unloadTile);
  tile.destroy();
}

function unloadTiles(tileset) {
  tileset._cache.unloadTiles(tileset, unloadTile);
}

///////////////////////////////////////////////////////////////////////////

function raiseLoadProgressEvent(tileset, frameState) {
  const statistics = tileset._statistics;
  const statisticsLast = tileset._statisticsLastRender;
  const numberOfPendingRequests = statistics.numberOfPendingRequests;
  const numberOfTilesProcessing = statistics.numberOfTilesProcessing;
  const lastNumberOfPendingRequest = statisticsLast.numberOfPendingRequests;
  const lastNumberOfTilesProcessing = statisticsLast.numberOfTilesProcessing;

  const progressChanged =
    numberOfPendingRequests !== lastNumberOfPendingRequest ||
    numberOfTilesProcessing !== lastNumberOfTilesProcessing;

  if (progressChanged) {
    frameState.afterRender.push(function() {
      tileset.loadProgress.raiseEvent(numberOfPendingRequests, numberOfTilesProcessing);
    });
  }

  tileset._tilesLoaded =
    statistics.numberOfPendingRequests === 0 &&
    statistics.numberOfTilesProcessing === 0 &&
    statistics.numberOfAttemptedRequests === 0;

  if (progressChanged && tileset._tilesLoaded) {
    frameState.afterRender.push(function() {
      tileset.allTilesLoaded.raiseEvent();
    });
    if (!tileset._initialTilesLoaded) {
      tileset._initialTilesLoaded = true;
      frameState.afterRender.push(function() {
        tileset.initialTilesLoaded.raiseEvent();
      });
    }
  }
}

///////////////////////////////////////////////////////////////////////////

function update(tileset, frameState) {
  if (frameState.mode === SceneMode.MORPHING) {
    return false;
  }

  if (!tileset.show || !tileset.ready) {
    return false;
  }

  if (!defined(tileset._loadTimestamp)) {
    tileset._loadTimestamp = JulianDate.clone(frameState.time);
  }

  // Update clipping planes
  const clippingPlanes = tileset._clippingPlanes;
  tileset._clippingPlanesOriginMatrixDirty = true;
  if (defined(clippingPlanes) && clippingPlanes.enabled) {
    clippingPlanes.update(frameState);
  }

  tileset._timeSinceLoad = Math.max(
    JulianDate.secondsDifference(frameState.time, tileset._loadTimestamp) * 1000,
    0.0
  );

  tileset._skipLevelOfDetail =
    tileset.skipLevelOfDetail &&
    !defined(tileset._classificationType) &&
    !tileset._disableSkipLevelOfDetail &&
    !tileset._allTilesAdditive;

  // Do out-of-core operations (new content requests, cache removal,
  // process new tiles) only during the render pass.
  const passes = frameState.passes;
  const isRender = passes.render;
  const isPick = passes.pick;
  const isAsync = passes.asynchronous;

  const statistics = tileset._statistics;
  statistics.clear();

  if (tileset.dynamicScreenSpaceError) {
    updateDynamicScreenSpaceError(tileset, frameState);
  }

  if (isRender) {
    tileset._cache.reset();
  }

  ++tileset._updatedVisibilityFrame;

  var ready;

  if (isAsync) {
    ready = Tileset3DAsyncTraversal.selectTiles(tileset, frameState);
  } else {
    ready = Tileset3DTraversal.selectTiles(tileset, frameState);
  }

  if (isRender || isAsync) {
    requestTiles(tileset);
  }

  if (isRender) {
    processTiles(tileset, frameState);
  }

  updateTiles(tileset, frameState);

  if (isRender) {
    unloadTiles(tileset);

    // Events are raised (added to the afterRender queue) here since promises
    // may resolve outside of the update loop this then raise events, e.g.,
    // model's readyPromise.
    raiseLoadProgressEvent(tileset, frameState);

    if (statistics.selected !== 0) {
      const credits = tileset._credits;
      if (defined(credits)) {
        const length = credits.length;
        for (let i = 0; i < length; i++) {
          frameState.creditDisplay.addCredit(credits[i]);
        }
      }
    }
  }

  // Update last statistics
  const statisticsLast = isAsync
    ? tileset._statisticsLastAsync
    : isPick
      ? tileset._statisticsLastPick
      : tileset._statisticsLastRender;
  Tileset3DStatistics.clone(statistics, statisticsLast);

  return ready;
}

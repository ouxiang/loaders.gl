// import {TILE3D_REFINEMENT, TILE3D_OPTIMIZATION_HINT} from '../constants';
import {Vector3, Matrix4, config} from 'math.gl';

/* eslint-disable */
const scratchDate = new Date();
const scratchCommandList = [];
const scratchToTileCenter = new Vector3();

/**
 * A tile in a {@link Tileset3D}.  When a tile is first created, its content is not loaded;
 * the content is loaded on-demand when needed based on the view.
 * <p>
 * Do not construct this directly, instead access tiles through {@link Tileset3D#tileVisible}.
 * </p>
 *
 * @alias Tile3D
 * @constructor
 */
export default class Tile3D {
  constructor(tileset, baseResource, header, parent) {
    this._initialize(tileset, baseResource, header, parent);
  }

  destroy() {}

  // The tileset containing this tile.
  // @memberof Tile3D.prototype
  // @type {Tileset3D}
  // @readonly
  get tileset() {
    return this._tileset;
  }

  // The tile's content.  This represents the actual tile's payload,
  // not the content's metadata in the tileset JSON file.
  // @memberof Tile3D.prototype
  // @type {Tile3DContent}
  // @readonly
  get content() {
    return this._content;
  }

  // Get the tile's bounding volume.
  // @memberof Tile3D.prototype
  // @type {TileBoundingVolume}
  // @readonly
  get boundingVolume() {
    return this._boundingVolume;
  }

  // Get the bounding volume of the tile's contents.  This defaults to the
  // tile's bounding volume when the content's bounding volume is
  // <code>undefined</code>.
  // @memberof Tile3D.prototype
  // @type {TileBoundingVolume}
  // @readonly
  get contentBoundingVolume() {
    return this._contentBoundingVolume || this._boundingVolume;
  }

  // Get the bounding sphere derived from the tile's bounding volume.
  // @memberof Tile3D.prototype
  // @type {BoundingSphere}
  // @readonly
  get boundingSphere() {
    return this._boundingVolume.boundingSphere;
  }

  // Returns the <code>extras</code> property in the tileset JSON for this tile, which contains application specific metadata.
  // Returns <code>undefined</code> if <code>extras</code> does not exist.
  // @memberof Tile3D.prototype
  // @type {*}
  // @readonly
  // @see {@link https://github.com/AnalyticalGraphicsInc/3d-tiles/tree/master/specification#specifying-extensions-and-application-specific-extras|Extras in the 3D Tiles specification.}
  get extras() {
    return this._header.extras;
  }

  // Determines if the tile has available content to render.  <code>true</code> if the tile's
  // content is ready or if it has expired content that renders while new content loads; otherwise,
  // <code>false</code>.
  // @memberof Tile3D.prototype
  // @type {Boolean}
  get contentAvailable() {
    return (
      (this.contentReady && !this.hasEmptyContent && !this.hasTilesetContent) ||
      (defined(this._expiredContent) && !this.contentFailed)
    );
  }

  // Determines if the tile's content is ready. This is automatically <code>true</code> for
  // tile's with empty content.
  // @memberof Tile3D.prototype
  // @type {Boolean}
  get contentReady() {
    return this._contentState === TILE3D_CONTENT_STATE.READY;
  }

  // Determines if the tile's content has not be requested. <code>true</code> if tile's
  // content has not be requested; otherwise, <code>false</code>.
  // @memberof Tile3D.prototype
  // @type {Boolean}
  get contentUnloaded() {
    return this._contentState === TILE3D_CONTENT_STATE.UNLOADED;
  }

  // Determines if the tile's content is expired. <code>true</code> if tile's
  // content is expired; otherwise, <code>false</code>.
  // @memberof Tile3D.prototype
  // @type {Boolean}
  get contentExpired() {
    return this._contentState === TILE3D_CONTENT_STATE.EXPIRED;
  }

  // Determines if the tile's content failed to load.  <code>true</code> if the tile's
  // content failed to load; otherwise, <code>false</code>.
  // @memberof Tile3D.prototype
  // @type {Boolean}
  get contentFailed() {
    return this._contentState === TILE3D_CONTENT_STATE.FAILED;
  }

  // Gets the promise that will be resolved when the tile's content is ready to process.
  // This happens after the content is downloaded but before the content is ready
  // to render.
  // <p>
  // The promise remains <code>undefined</code> until the tile's content is requested.
  // </p>
  // @type {Promise.<Tile3DContent>}
  get contentReadyToProcessPromise() {
    if (defined(this._contentReadyToProcessPromise)) {
      return this._contentReadyToProcessPromise.promise;
    }
  }

  // Gets the promise that will be resolved when the tile's content is ready to render.
  // <p>
  // The promise remains <code>undefined</code> until the tile's content is requested.
  // </p>
  // @type {Promise.<Tile3DContent>}
  get contentReadyPromise() {
    if (defined(this._contentReadyPromise)) {
      return this._contentReadyPromise.promise;
    }
  }

  // Get the tile's screen space error.
  getScreenSpaceError({frustum, width, height}, useParentGeometricError) {
    const tileset = this._tileset;
    const parentGeometricError = this.parent ? this.parent.geometricError : tileset._geometricError;
    const geometricError = useParentGeometricError ? parentGeometricError : this.geometricError;

    // Leaf tiles do not have any error so save the computation
    if (geometricError === 0.0) {
      return 0.0;
    }

    // Avoid divide by zero when viewer is inside the tile
    const distance = Math.max(this._distanceToCamera, 1e-7);
    const sseDenominator = frustum.sseDenominator;
    let error = (geometricError * height) / (distance * sseDenominator);

    // TODO - test dynamic screen space error
    if (tileset.dynamicScreenSpaceError) {
      function fog(distanceToCamera, density) {
        const scalar = distanceToCamera * density;
        return 1.0 - Math.exp(-(scalar * scalar));
      }

      const density = tileset._dynamicScreenSpaceErrorComputedDensity;
      const factor = tileset.dynamicScreenSpaceErrorFactor;
      const dynamicError = fog(distance, density) * factor;
      error -= dynamicError;
    }

    // TODO: Orthographic Frustum needs special treatment?
    // this._getOrthgrahicScreenSpaceError();

    return error;
  }

  _getDynamicScreenSpaceError(distance) {
    function fog(distanceToCamera, density) {
      const scalar = distanceToCamera * density;
      return 1.0 - Math.exp(-(scalar * scalar));
    }

    if (tileset.dynamicScreenSpaceError) {
      const density = tileset._dynamicScreenSpaceErrorComputedDensity;
      const factor = tileset.dynamicScreenSpaceErrorFactor;
      const dynamicError = fog(distance, density) * factor;
      error -= dynamicError;
    }
  }

  _getOrthgrahicScreenSpaceError() {
    // if (frameState.mode === SceneMode.SCENE2D || frustum instanceof OrthographicFrustum) {
    //   if (defined(frustum._offCenterFrustum)) {
    //     frustum = frustum._offCenterFrustum;
    //   }
    //   const pixelSize = Math.max(frustum.top - frustum.bottom, frustum.right - frustum.left) / Math.max(width, height);
    //   error = geometricError / pixelSize;
    // }
  }

  // Update the tile's visibility.
  updateVisibility(frameState) {
    const parent = this.parent;
    const parentTransform = defined(parent) ? parent.computedTransform : this._tileset.modelMatrix;
    const parentVisibilityPlaneMask = defined(parent)
      ? parent._visibilityPlaneMask
      : CullingVolume.MASK_INDETERMINATE;
    this.updateTransform(parentTransform);
    this._distanceToCamera = this.distanceToTile(frameState);
    this._centerZDepth = this.distanceToTileCenter(frameState);
    this._screenSpaceError = this.getScreenSpaceError(frameState, false);
    this._visibilityPlaneMask = this.visibility(frameState, parentVisibilityPlaneMask); // Use parent's plane mask to speed up visibility test
    this._visible = this._visibilityPlaneMask !== CullingVolume.MASK_OUTSIDE;
    this._inRequestVolume = this.insideViewerRequestVolume(frameState);
  }

  // Update whether the tile has expired.
  updateExpiration() {
    if (defined(this.expireDate) && this.contentReady && !this.hasEmptyContent) {
      const now = Date.now(scratchDate);
      if (Date.lessThan(this.expireDate, now)) {
        this._contentState = TILE3D_CONTENT_STATE.EXPIRED;
        this._expiredContent = this._content;
      }
    }
  }

  // Requests the tile's content.
  // <p>
  // The request may not be made if the Cesium Request Scheduler can't prioritize it.
  // </p>
  async requestContent() {
    if (this.hasEmptyContent) {
      return false;
    }

    const that = this;
    const tileset = this._tileset;

    requestTile;
    resource.request = request;

    // Append a query parameter of the tile expiration date to prevent caching
    // const expired = this.contentExpired;
    // if (expired) {
    //   expired: this.expireDate.toString()
    const request = new Request({
      throttle: true,
      throttleByServer: true,
      type: RequestType.TILES3D,
      priorityFunction: createPriorityFunction(this),
      serverKey: this._serverKey
    });

    const promise = resource.fetchArrayBuffer();

    const contentState = this._contentState;
    this._contentState = TILE3D_CONTENT_STATE.LOADING;
    this._contentReadyToProcessPromise = when.defer();
    this._contentReadyPromise = when.defer();

    if (expired) {
      this.expireDate = undefined;
    }

    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();

    if (this.isDestroyed()) {
      // Tile is unloaded before the content finishes loading
      const contentFailedFunction = getContentFailedFunction(this);
      contentFailedFunction();
      return;
    }

    // The content can be a binary tile ot a  JSON/
    const content = parse(arrayBuffer, [Tile3DLoader, Tileset3DLoader]);

    // Vector and Geometry tile rendering do not support the skip LOD optimization.
    switch (content.type) {
      case 'vctr':
      case 'geom':
        tileset._disableSkipLevelOfDetail = true;
      default:
    }

    // The content may be json instead
    content = Tile3DContentFactory.json(tileset, that, that._contentResource, arrayBuffer, 0);
    that.hasTilesetContent = true;

    const contentFactory = Tile3DContentFactory[magic];
    const content =
      contentFactory && contentFactory(tileset, that, that._contentResource, arrayBuffer, 0);

    that._content = content;
    that._contentState = TILE3D_CONTENT_STATE.PROCESSING;
    that._contentReadyToProcessPromise.resolve(content);

    return content.readyPromise.then(function(content) {
      if (that.isDestroyed()) {
        // Tile is unloaded before the content finishes processing
        contentFailedFunction();
        return;
      }
      updateExpireDate(that);

      // Refresh style for expired content
      that._selectedFrame = 0;
      that.lastStyleTime = 0;

      that._contentState = TILE3D_CONTENT_STATE.READY;
      that._contentReadyPromise.resolve(content);
    });
    /*
      .otherwise(function(error) {
        if (request.state === RequestState.CANCELLED) {
          // Cancelled due to low priority - try again later.
          that._contentState = contentState;
          --tileset.statistics.numberOfPendingRequests;
          ++tileset.statistics.numberOfAttemptedRequests;
          return;
        }
        contentFailedFunction(error);
      });
    */

    return true;
  }

  // Unloads the tile's content.
  unloadContent() {
    if (this.hasEmptyContent || this.hasTilesetContent) {
      return;
    }

    this._content = this._content && this._content.destroy();
    this._contentState = TILE3D_CONTENT_STATE.UNLOADED;
    this._contentReadyToProcessPromise = undefined;
    this._contentReadyPromise = undefined;

    this.lastStyleTime = 0;
    this.clippingPlanesDirty = this._clippingPlanesState === 0;
    this._clippingPlanesState = 0;

    this._debugColorizeTiles = false;

    this._debugBoundingVolume = this._debugBoundingVolume && this._debugBoundingVolume.destroy();
    this._debugContentBoundingVolume =
      this._debugContentBoundingVolume && this._debugContentBoundingVolume.destroy();
    this._debugViewerRequestVolume =
      this._debugViewerRequestVolume && this._debugViewerRequestVolume.destroy();
  }

  // Determines whether the tile's bounding volume intersects the culling volume.
  // @param {FrameState} frameState The frame state.
  // @param {Number} parentVisibilityPlaneMask The parent's plane mask to speed up the visibility check.
  // @returns {Number} A plane mask as described above in {@link CullingVolume#computeVisibilityWithPlaneMask}.
  visibility(frameState, parentVisibilityPlaneMask) {
    const cullingVolume = frameState.cullingVolume;
    const boundingVolume = this._boundingVolume;

    const tileset = this._tileset;
    const clippingPlanes = tileset.clippingPlanes;
    if (defined(clippingPlanes) && clippingPlanes.enabled) {
      const intersection = clippingPlanes.computeIntersectionWithBoundingVolume(
        boundingVolume,
        tileset.clippingPlanesOriginMatrix
      );
      this._isClipped = intersection !== Intersect.INSIDE;
      if (intersection === Intersect.OUTSIDE) {
        return CullingVolume.MASK_OUTSIDE;
      }
    }

    return cullingVolume.computeVisibilityWithPlaneMask(boundingVolume, parentVisibilityPlaneMask);
  }

  // Assuming the tile's bounding volume intersects the culling volume, determines
  // whether the tile's content's bounding volume intersects the culling volume.
  // @param {FrameState} frameState The frame state.
  // @returns {Intersect} The result of the intersection: the tile's content is completely outside, completely inside, or intersecting the culling volume.
  contentVisibility(frameState) {
    // Assumes the tile's bounding volume intersects the culling volume already, so
    // just return Intersect.INSIDE if there is no content bounding volume.
    if (!defined(this._contentBoundingVolume)) {
      return Intersect.INSIDE;
    }

    if (this._visibilityPlaneMask === CullingVolume.MASK_INSIDE) {
      // The tile's bounding volume is completely inside the culling volume so
      // the content bounding volume must also be inside.
      return Intersect.INSIDE;
    }

    // PERFORMANCE_IDEA: is it possible to burn less CPU on this test since we know the
    // tile's (not the content's) bounding volume intersects the culling volume?
    const cullingVolume = frameState.cullingVolume;
    const boundingVolume = tile._contentBoundingVolume;

    const tileset = this._tileset;
    const clippingPlanes = tileset.clippingPlanes;
    if (defined(clippingPlanes) && clippingPlanes.enabled) {
      const intersection = clippingPlanes.computeIntersectionWithBoundingVolume(
        boundingVolume,
        tileset.clippingPlanesOriginMatrix
      );
      this._isClipped = intersection !== Intersect.INSIDE;
      if (intersection === Intersect.OUTSIDE) {
        return Intersect.OUTSIDE;
      }
    }

    return cullingVolume.computeVisibility(boundingVolume);
  }

  // Computes the (potentially approximate) distance from the closest point of the tile's bounding volume to the camera.
  // @param {FrameState} frameState The frame state.
  // @returns {Number} The distance, in meters, or zero if the camera is inside the bounding volume.
  distanceToTile({frameState}) {
    const boundingVolume = this._boundingVolume;
    return boundingVolume.distanceToCamera(frameState);
  }

  /**
   * Computes the distance from the center of the tile's bounding volume to the camera.
   *
   * @param {FrameState} frameState The frame state.
   * @returns {Number} The distance, in meters.
   *
   * @private
   */
  distanceToTileCenter({camera}) {
    const tileBoundingVolume = this._boundingVolume;
    const boundingVolume = tileBoundingVolume.boundingVolume; // Gets the underlying OrientedBoundingBox or BoundingSphere
    const toCenter = Vector3.subtract(
      boundingVolume.center,
      camera.positionWC,
      scratchToTileCenter
    );
    const distance = Vector3.magnitude(toCenter);
    Vector3.divideByScalar(toCenter, distance, toCenter);
    const dot = Vector3.dot(camera.directionWC, toCenter);
    return distance * dot;
  }

  /**
   * Checks if the camera is inside the viewer request volume.
   *
   * @param {FrameState} frameState The frame state.
   * @returns {Boolean} Whether the camera is inside the volume.
   *
   * @private
   */
  insideViewerRequestVolume(frameState) {
    const viewerRequestVolume = this._viewerRequestVolume;
    return (
      !defined(viewerRequestVolume) || viewerRequestVolume.distanceToCamera(frameState) === 0.0
    );
  }

  /**
   * Create a bounding volume from the tile's bounding volume header.
   *
   * @param {Object} boundingVolumeHeader The tile's bounding volume header.
   * @param {Matrix4} transform The transform to apply to the bounding volume.
   * @param {TileBoundingVolume} [result] The object onto which to store the result.
   *
   * @returns {TileBoundingVolume} The modified result parameter or a new TileBoundingVolume instance if none was provided.
   *
   * @private
   */
  createBoundingVolume(boundingVolumeHeader, transform, result) {
    if (!defined(boundingVolumeHeader)) {
      throw new RuntimeError('boundingVolume must be defined');
    }
    if (defined(boundingVolumeHeader.box)) {
      return createBox(boundingVolumeHeader.box, transform, result);
    }
    if (defined(boundingVolumeHeader.region)) {
      return createRegion(boundingVolumeHeader.region, transform, this._initialTransform, result);
    }
    if (defined(boundingVolumeHeader.sphere)) {
      return createSphere(boundingVolumeHeader.sphere, transform, result);
    }
    throw new RuntimeError('boundingVolume must contain a sphere, region, or box');
  }

  /**
   * Update the tile's transform. The transform is applied to the tile's bounding volumes.
   *
   * @private
   */
  updateTransform(parentTransform) {
    parentTransform = defaultValue(parentTransform, Matrix4.IDENTITY);
    const computedTransform = Matrix4.multiply(parentTransform, this.transform, scratchTransform);
    const transformChanged = !Matrix4.equals(computedTransform, this.computedTransform);

    if (!transformChanged) {
      return;
    }

    Matrix4.clone(computedTransform, this.computedTransform);

    // Update the bounding volumes
    const header = this._header;
    const content = this._header.content;
    this._boundingVolume = this.createBoundingVolume(
      header.boundingVolume,
      this.computedTransform,
      this._boundingVolume
    );
    if (defined(this._contentBoundingVolume)) {
      this._contentBoundingVolume = this.createBoundingVolume(
        content.boundingVolume,
        this.computedTransform,
        this._contentBoundingVolume
      );
    }
    if (defined(this._viewerRequestVolume)) {
      this._viewerRequestVolume = this.createBoundingVolume(
        header.viewerRequestVolume,
        this.computedTransform,
        this._viewerRequestVolume
      );
    }

    // Destroy the debug bounding volumes. They will be generated fresh.
    this._debugBoundingVolume = this._debugBoundingVolume && this._debugBoundingVolume.destroy();
    this._debugContentBoundingVolume =
      this._debugContentBoundingVolume && this._debugContentBoundingVolume.destroy();
    this._debugViewerRequestVolume =
      this._debugViewerRequestVolume && this._debugViewerRequestVolume.destroy();
  }

  /**
   * Get the draw commands needed to render this tile.
   *
   * @private
   */
  update(tileset, frameState) {
    const initCommandLength = frameState.commandList.length;
    updateClippingPlanes(this, tileset);
    applyDebugSettings(this, tileset, frameState);
    updateContent(this, tileset, frameState);
    this._commandsLength = frameState.commandList.length - initCommandLength;
    this.clippingPlanesDirty = false; // reset after content update
  }

  // Processes the tile's content, e.g., create WebGL resources, to move from the PROCESSING to READY state.
  // @param {Tileset3D} tileset The tileset containing this tile.
  // @param {FrameState} frameState The frame state.
  process(tileset, frameState) {
    // this._content.update(tileset, frameState);
  }

  _initialize(tileset, baseResource, header, parent) {
    this._tileset = tileset;
    this._header = header;

    const contentHeader = header.content;

    // The local transform of this tile.
    // @type {Matrix4}
    this.transform = header.transform ? new Matrix4(header.transform) : Matrix4.IDENTITY;

    const parentTransform = defined(parent) ? parent.computedTransform : tileset.modelMatrix;
    const computedTransform = Matrix4.multiply(parentTransform, this.transform, new Matrix4());

    const parentInitialTransform = defined(parent) ? parent._initialTransform : Matrix4.IDENTITY;
    this._initialTransform = Matrix4.multiply(
      parentInitialTransform,
      this.transform,
      new Matrix4()
    );

    // The final computed transform of this tile.
    // @type {Matrix4}
    // @readonly
    this.computedTransform = computedTransform;

    this._boundingVolume = this.createBoundingVolume(header.boundingVolume, computedTransform);

    let contentBoundingVolume;

    if (defined(contentHeader) && defined(contentHeader.boundingVolume)) {
      // Non-leaf tiles may have a content bounding-volume, which is a tight-fit bounding volume
      // around only the features in the tile.  This box is useful for culling for rendering,
      // but not for culling for traversing the tree since it does not guarantee spatial coherence, i.e.,
      // since it only bounds features in the tile, not the entire tile, children may be
      // outside of this box.
      contentBoundingVolume = this.createBoundingVolume(
        contentHeader.boundingVolume,
        computedTransform
      );
    }
    this._contentBoundingVolume = contentBoundingVolume;

    let viewerRequestVolume;
    if (defined(header.viewerRequestVolume)) {
      viewerRequestVolume = this.createBoundingVolume(
        header.viewerRequestVolume,
        computedTransform
      );
    }
    this._viewerRequestVolume = viewerRequestVolume;

    // The error, in meters, introduced if this tile is rendered and its children are not.
    // This is used to compute screen space error, i.e., the error measured in pixels.
    // @type {Number}
    // @readonly
    this.geometricError = header.geometricError;

    if (!defined(this.geometricError)) {
      this.geometricError = defined(parent) ? parent.geometricError : tileset._geometricError;
      Tile3D._deprecationWarning(
        'geometricErrorUndefined',
        "Required property geometricError is undefined for this tile. Using parent's geometric error instead."
      );
    }

    let refine;
    if (defined(header.refine)) {
      if (header.refine === 'replace' || header.refine === 'add') {
        Tile3D._deprecationWarning(
          'lowercase-refine',
          'This tile uses a lowercase refine "' +
            header.refine +
            '". Instead use "' +
            header.refine.toUpperCase() +
            '".'
        );
      }
      refine = header.refine.toUpperCase() === 'REPLACE' ? Tile3DRefine.REPLACE : Tile3DRefine.ADD;
    } else if (defined(parent)) {
      // Inherit from parent tile if omitted.
      refine = parent.refine;
    } else {
      refine = Tile3DRefine.REPLACE;
    }

    // Specifies the type of refinement that is used when traversing this tile for rendering.
    // @type {Tile3DRefine}
    // @readonly
    this.refine = refine;

    // Gets the tile's children.
    // @type {Tile3D[]}
    // @readonly
    this.children = [];

    // This tile's parent or <code>undefined</code> if this tile is the root.
    // <p>
    // When a tile's content points to an external tileset JSON file, the external tileset's
    // root tile's parent is not <code>undefined</code>; instead, the parent references
    // the tile (with its content pointing to an external tileset JSON file) as if the two tilesets were merged.
    // </p>
    // @type {Tile3D}
    // @readonly
    this.parent = parent;

    let content;
    let hasEmptyContent;
    let contentState;
    let contentResource;
    let serverKey;

    baseResource = Resource.createIfNeeded(baseResource);

    if (defined(contentHeader)) {
      const contentHeaderUri = contentHeader.uri;
      if (defined(contentHeader.url)) {
        Tile3D._deprecationWarning(
          'contentUrl',
          'This tileset JSON uses the "content.url" property which has been deprecated. Use "content.uri" instead.'
        );
        contentHeaderUri = contentHeader.url;
      }
      hasEmptyContent = false;
      contentState = TILE3D_CONTENT_STATE.UNLOADED;
      contentResource = baseResource.getDerivedResource({
        url: contentHeaderUri
      });
      serverKey = RequestScheduler.getServerKey(contentResource.getUrlComponent());
    } else {
      content = new Empty3DTileContent(tileset, this);
      hasEmptyContent = true;
      contentState = TILE3D_CONTENT_STATE.READY;
    }

    this._content = content;
    this._contentResource = contentResource;
    this._contentState = contentState;
    this._contentReadyToProcessPromise = undefined;
    this._contentReadyPromise = undefined;
    this._expiredContent = undefined;

    this._serverKey = serverKey;

    // When <code>true</code>, the tile has no content.
    // @type {Boolean}
    // @readonly
    this.hasEmptyContent = hasEmptyContent;

    // When <code>true</code>, the tile's content points to an external tileset.
    // <p>
    // This is <code>false</code> until the tile's content is loaded.
    // </p>
    // @type {Boolean}
    // @readonly
    this.hasTilesetContent = false;

    // The node in the tileset's LRU cache, used to determine when to unload a tile's content.
    // See {@link Tileset3DCache}
    // @type {DoublyLinkedListNode}
    // @readonly
    this.cacheNode = undefined;

    let expire = header.expire;
    let expireDuration;
    let expireDate;
    if (defined(expire)) {
      expireDuration = expire.duration;
      if (defined(expire.date)) {
        expireDate = Date.fromIso8601(expire.date);
      }
    }

    // The time in seconds after the tile's content is ready when the content expires and new content is requested.
    // @type {Number}
    this.expireDuration = expireDuration;

    // The date when the content expires and new content is requested.
    // @type {Date}
    this.expireDate = expireDate;

    // The time when a style was last applied to this tile.
    // @type {Number}
    this.lastStyleTime = 0;

    // Marks whether the tile's children bounds are fully contained within the tile's bounds
    // @type {Tile3DOptimizationHint}
    this._optimChildrenWithinParent = Tile3DOptimizationHint.NOT_COMPUTED;

    // Tracks if the tile's relationship with a ClippingPlaneCollection has changed with regards
    // to the ClippingPlaneCollection's state.
    // @type {Boolean}
    this.clippingPlanesDirty = false;

    // Members that are updated every frame for tree traversal and rendering optimizations:
    this._distanceToCamera = 0;
    this._centerZDepth = 0;
    this._screenSpaceError = 0;
    this._visibilityPlaneMask = 0;
    this._visible = false;
    this._inRequestVolume = false;

    this._finalResolution = true;
    this._depth = 0;
    this._stackLength = 0;
    this._selectionDepth = 0;

    this._updatedVisibilityFrame = 0;
    this._touchedFrame = 0;
    this._visitedFrame = 0;
    this._selectedFrame = 0;
    this._requestedFrame = 0;
    this._ancestorWithContent = undefined;
    this._ancestorWithContentAvailable = undefined;
    this._refines = false;
    this._shouldSelect = false;
    this._priority = 0.0;
    this._isClipped = true;
    this._clippingPlanesState = 0; // encapsulates (_isClipped, clippingPlanes.enabled) and number/function
    this._debugBoundingVolume = undefined;
    this._debugContentBoundingVolume = undefined;
    this._debugViewerRequestVolume = undefined;
    this._debugColor = Color.fromRandom({alpha: 1.0});
    this._debugColorizeTiles = false;

    this._commandsLength = 0;

    this._color = undefined;
    this._colorDirty = false;
  }
}

function updateContent(tile, tileset, frameState) {
  const content = tile._content;
  const expiredContent = tile._expiredContent;

  if (defined(expiredContent)) {
    if (!tile.contentReady) {
      // Render the expired content while the content loads
      expiredContent.update(tileset, frameState);
      return;
    }

    // New content is ready, destroy expired content
    tile._expiredContent.destroy();
    tile._expiredContent = undefined;
  }

  content.update(tileset, frameState);
}

function updateExpireDate(tile) {
  if (defined(tile.expireDuration)) {
    const expireDurationDate = Date.now(scratchDate);
    Date.addSeconds(expireDurationDate, tile.expireDuration, expireDurationDate);

    if (defined(tile.expireDate)) {
      if (Date.lessThan(tile.expireDate, expireDurationDate)) {
        Date.clone(expireDurationDate, tile.expireDate);
      }
    } else {
      tile.expireDate = Date.clone(expireDurationDate);
    }
  }
}

function getContentFailedFunction(tile) {
  return function(error) {
    tile._contentState = TILE3D_CONTENT_STATE.FAILED;
    tile._contentReadyPromise.reject(error);
    tile._contentReadyToProcessPromise.reject(error);
  };
}

function createPriorityFunction(tile) {
  return function() {
    return tile._priority;
  };
}

const scratchProjectedBoundingSphere = new BoundingSphere();

const scratchMatrix = new Matrix3();
const scratchScale = new Vector3();
const scratchHalfAxes = new Matrix3();
const scratchCenter = new Vector3();
const scratchRectangle = new Rectangle();
const scratchOrientedBoundingBox = new OrientedBoundingBox();
const scratchTransform = new Matrix4();

function createBox(box, transform, result) {
  const center = Vector3.fromElements(box[0], box[1], box[2], scratchCenter);
  const halfAxes = Matrix3.fromArray(box, 3, scratchHalfAxes);

  // Find the transformed center and halfAxes
  center = Matrix4.multiplyByPoint(transform, center, center);
  const rotationScale = Matrix4.getRotation(transform, scratchMatrix);
  halfAxes = Matrix3.multiply(rotationScale, halfAxes, halfAxes);

  if (defined(result)) {
    result.update(center, halfAxes);
    return result;
  }
  return new TileOrientedBoundingBox(center, halfAxes);
}

function createBoxFromTransformedRegion(region, transform, initialTransform, result) {
  const rectangle = Rectangle.unpack(region, 0, scratchRectangle);
  const minimumHeight = region[4];
  const maximumHeight = region[5];

  const orientedBoundingBox = OrientedBoundingBox.fromRectangle(
    rectangle,
    minimumHeight,
    maximumHeight,
    Ellipsoid.WGS84,
    scratchOrientedBoundingBox
  );
  const center = orientedBoundingBox.center;
  const halfAxes = orientedBoundingBox.halfAxes;

  // A region bounding volume is not transformed by the transform in the tileset JSON,
  // but may be transformed by additional transforms applied in Cesium.
  // This is why the transform is calculated as the difference between the initial transform and the current transform.
  transform = Matrix4.multiplyTransformation(
    transform,
    Matrix4.inverseTransformation(initialTransform, scratchTransform),
    scratchTransform
  );
  center = Matrix4.multiplyByPoint(transform, center, center);
  const rotationScale = Matrix4.getRotation(transform, scratchMatrix);
  halfAxes = Matrix3.multiply(rotationScale, halfAxes, halfAxes);

  if (defined(result) && result instanceof TileOrientedBoundingBox) {
    result.update(center, halfAxes);
    return result;
  }

  return new TileOrientedBoundingBox(center, halfAxes);
}

function createRegion(region, transform, initialTransform, result) {
  if (!Matrix4.equalsEpsilon(transform, initialTransform, CesiumMath.EPSILON8)) {
    return createBoxFromTransformedRegion(region, transform, initialTransform, result);
  }

  if (defined(result)) {
    return result;
  }

  const rectangleRegion = Rectangle.unpack(region, 0, scratchRectangle);

  return new TileBoundingRegion({
    rectangle: rectangleRegion,
    minimumHeight: region[4],
    maximumHeight: region[5]
  });
}

function createSphere(sphere, transform, result) {
  const center = Vector3.fromElements(sphere[0], sphere[1], sphere[2], scratchCenter);
  const radius = sphere[3];

  // Find the transformed center and radius
  center = Matrix4.multiplyByPoint(transform, center, center);
  const scale = Matrix4.getScale(transform, scratchScale);
  const uniformScale = Vector3.maximumComponent(scale);
  radius *= uniformScale;

  if (defined(result)) {
    result.update(center, radius);
    return result;
  }
  return new TileBoundingSphere(center, radius);
}

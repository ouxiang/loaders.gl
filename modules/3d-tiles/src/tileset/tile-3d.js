const scratchJulianDate = new JulianDate();
const scratchCommandList = [];
const scratchToTileCenter = new Cartesian3();

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

  destroy() {
    // For the interval between new content being requested and downloaded, expiredContent === content, so don't destroy twice
    this._content = this._content && this._content.destroy();
    this._expiredContent = this._expiredContent && !this._expiredContent.isDestroyed() && this._expiredContent.destroy();
    this._debugBoundingVolume = this._debugBoundingVolume && this._debugBoundingVolume.destroy();
    this._debugContentBoundingVolume = this._debugContentBoundingVolume && this._debugContentBoundingVolume.destroy();
    this._debugViewerRequestVolume = this._debugViewerRequestVolume && this._debugViewerRequestVolume.destroy();
    return destroyObject(this);
  };

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

  // Gets or sets the tile's highlight color.
  // @memberof Tile3D.prototype
  // @type {Color}
  // @default {@link Color.WHITE}
  get color() {
    if (!defined(this._color)) {
      this._color = new Color();
    }
    return Color.clone(this._color);
  }

  set color(value) {
    this._color = Color.clone(value, this._color);
    this._colorDirty = true;
  }

  // Determines if the tile has available content to render.  <code>true</code> if the tile's
  // content is ready or if it has expired content that renders while new content loads; otherwise,
  // <code>false</code>.
  // @memberof Tile3D.prototype
  // @type {Boolean}
  get contentAvailable() {
    return (this.contentReady && !this.hasEmptyContent && !this.hasTilesetContent) || (defined(this._expiredContent) && !this.contentFailed);
  }

  // Determines if the tile's content is ready. This is automatically <code>true</code> for
  // tile's with empty content.
  // @memberof Tile3D.prototype
  // @type {Boolean}
  get contentReady() {
    return this._contentState === Tile3DContentState.READY;
  }

  // Determines if the tile's content has not be requested. <code>true</code> if tile's
  // content has not be requested; otherwise, <code>false</code>.
  // @memberof Tile3D.prototype
  // @type {Boolean}
  get contentUnloaded() {
    return this._contentState === Tile3DContentState.UNLOADED;
  }

  // Determines if the tile's content is expired. <code>true</code> if tile's
  // content is expired; otherwise, <code>false</code>.
  // @memberof Tile3D.prototype
  // @type {Boolean}
  get contentExpired() {
    return this._contentState === Tile3DContentState.EXPIRED;
  }

  // Determines if the tile's content failed to load.  <code>true</code> if the tile's
  // content failed to load; otherwise, <code>false</code>.
  // @memberof Tile3D.prototype
  // @type {Boolean}
  get contentFailed() {
    return this._contentState === Tile3DContentState.FAILED;
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

  // Returns the number of draw commands used by this tile.
  get commandsLength() {
    return this._commandsLength;
  }

  // Get the tile's screen space error.
  getScreenSpaceError(frameState, useParentGeometricError) {
    const tileset = this._tileset;
    const parentGeometricError = defined(this.parent) ? this.parent.geometricError : tileset._geometricError;
    const geometricError = useParentGeometricError ? parentGeometricError : this.geometricError;
    if (geometricError === 0.0) {
      // Leaf tiles do not have any error so save the computation
      return 0.0;
    }
    const camera = frameState.camera;
    const frustum = camera.frustum;
    const context = frameState.context;
    const width = context.drawingBufferWidth;
    const height = context.drawingBufferHeight;
    let error;
    if (frameState.mode === SceneMode.SCENE2D || frustum instanceof OrthographicFrustum) {
      if (defined(frustum._offCenterFrustum)) {
        frustum = frustum._offCenterFrustum;
      }
      const pixelSize = Math.max(frustum.top - frustum.bottom, frustum.right - frustum.left) / Math.max(width, height);
      error = geometricError / pixelSize;
    } else {
      // Avoid divide by zero when viewer is inside the tile
      const distance = Math.max(this._distanceToCamera, CesiumMath.EPSILON7);
      const sseDenominator = camera.frustum.sseDenominator;
      error = (geometricError * height) / (distance * sseDenominator);
      if (tileset.dynamicScreenSpaceError) {
        const density = tileset._dynamicScreenSpaceErrorComputedDensity;
        const factor = tileset.dynamicScreenSpaceErrorFactor;
        const dynamicError = CesiumMath.fog(distance, density) * factor;
        error -= dynamicError;
      }
    }
    return error;
  }

  // Update the tile's visibility.
  updateVisibility(frameState) {
    const parent = this.parent;
    const parentTransform = defined(parent) ? parent.computedTransform : this._tileset.modelMatrix;
    const parentVisibilityPlaneMask = defined(parent) ? parent._visibilityPlaneMask : CullingVolume.MASK_INDETERMINATE;
    this.updateTransform(parentTransform);
    this._distanceToCamera = this.distanceToTile(frameState);
    this._centerZDepth = this.distanceToTileCenter(frameState);
    this._screenSpaceError = this.getScreenSpaceError(frameState, false);
    this._visibilityPlaneMask = this.visibility(frameState, parentVisibilityPlaneMask); // Use parent's plane mask to speed up visibility test
    this._visible = this._visibilityPlaneMask !== CullingVolume.MASK_OUTSIDE;
    this._inRequestVolume = this.insideViewerRequestVolume(frameState);
  };

  // Update whether the tile has expired.
  updateExpiration() {
    if (defined(this.expireDate) && this.contentReady && !this.hasEmptyContent) {
      const now = JulianDate.now(scratchJulianDate);
      if (JulianDate.lessThan(this.expireDate, now)) {
        this._contentState = Tile3DContentState.EXPIRED;
        this._expiredContent = this._content;
      }
    }
  }


  // Requests the tile's content.
  // <p>
  // The request may not be made if the Cesium Request Scheduler can't prioritize it.
  // </p>
  requestContent() {
    const that = this;
    const tileset = this._tileset;

    if (this.hasEmptyContent) {
      return false;
    }

    const resource = this._contentResource.clone();
    const expired = this.contentExpired;
    if (expired) {
      // Append a query parameter of the tile expiration date to prevent caching
      resource.setQueryParameters({
        expired: this.expireDate.toString()
      });
    }

    const request = new Request({
      throttle : true,
      throttleByServer : true,
      type : RequestType.TILES3D,
      priorityFunction : createPriorityFunction(this),
      serverKey : this._serverKey
    });

    resource.request = request;

    const promise = resource.fetchArrayBuffer();

    if (!defined(promise)) {
      return false;
    }

    const contentState = this._contentState;
    this._contentState = Tile3DContentState.LOADING;
    this._contentReadyToProcessPromise = when.defer();
    this._contentReadyPromise = when.defer();

    if (expired) {
      this.expireDate = undefined;
    }

    const contentFailedFunction = getContentFailedFunction(this);
    promise.then(function(arrayBuffer) {
      if (that.isDestroyed()) {
        // Tile is unloaded before the content finishes loading
        contentFailedFunction();
        return;
      }
      const uint8Array = new Uint8Array(arrayBuffer);
      const magic = getMagic(uint8Array);
      const contentFactory = Tile3DContentFactory[magic];
      let content;

      // Vector and Geometry tile rendering do not support the skip LOD optimization.
      tileset._disableSkipLevelOfDetail = tileset._disableSkipLevelOfDetail || magic === 'vctr' || magic === 'geom';

      if (defined(contentFactory)) {
        content = contentFactory(tileset, that, that._contentResource, arrayBuffer, 0);
      } else {
        // The content may be json instead
        content = Tile3DContentFactory.json(tileset, that, that._contentResource, arrayBuffer, 0);
        that.hasTilesetContent = true;
      }

      that._content = content;
      that._contentState = Tile3DContentState.PROCESSING;
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

        that._contentState = Tile3DContentState.READY;
        that._contentReadyPromise.resolve(content);
      });
    }).otherwise(function(error) {
      if (request.state === RequestState.CANCELLED) {
        // Cancelled due to low priority - try again later.
        that._contentState = contentState;
        --tileset.statistics.numberOfPendingRequests;
        ++tileset.statistics.numberOfAttemptedRequests;
        return;
      }
      contentFailedFunction(error);
    });

    return true;
  }

  // Unloads the tile's content.
  unloadContent() {
    if (this.hasEmptyContent || this.hasTilesetContent) {
      return;
    }

    this._content = this._content && this._content.destroy();
    this._contentState = Tile3DContentState.UNLOADED;
    this._contentReadyToProcessPromise = undefined;
    this._contentReadyPromise = undefined;

    this.lastStyleTime = 0;
    this.clippingPlanesDirty = (this._clippingPlanesState === 0);
    this._clippingPlanesState = 0;

    this._debugColorizeTiles = false;

    this._debugBoundingVolume = this._debugBoundingVolume && this._debugBoundingVolume.destroy();
    this._debugContentBoundingVolume = this._debugContentBoundingVolume && this._debugContentBoundingVolume.destroy();
    this._debugViewerRequestVolume = this._debugViewerRequestVolume && this._debugViewerRequestVolume.destroy();
  };

  // Determines whether the tile's bounding volume intersects the culling volume.
  // @param {FrameState} frameState The frame state.
  // @param {Number} parentVisibilityPlaneMask The parent's plane mask to speed up the visibility check.
  // @returns {Number} A plane mask as described above in {@link CullingVolume#computeVisibilityWithPlaneMask}.
  visibility(frameState, parentVisibilityPlaneMask) {
    const cullingVolume = frameState.cullingVolume;
    const boundingVolume = getBoundingVolume(this, frameState);

    const tileset = this._tileset;
    const clippingPlanes = tileset.clippingPlanes;
    if (defined(clippingPlanes) && clippingPlanes.enabled) {
      const intersection = clippingPlanes.computeIntersectionWithBoundingVolume(boundingVolume, tileset.clippingPlanesOriginMatrix);
      this._isClipped = intersection !== Intersect.INSIDE;
      if (intersection === Intersect.OUTSIDE) {
        return CullingVolume.MASK_OUTSIDE;
      }
    }

    return cullingVolume.computeVisibilityWithPlaneMask(boundingVolume, parentVisibilityPlaneMask);
  };

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
    const boundingVolume = getContentBoundingVolume(this, frameState);

    const tileset = this._tileset;
    const clippingPlanes = tileset.clippingPlanes;
    if (defined(clippingPlanes) && clippingPlanes.enabled) {
      const intersection = clippingPlanes.computeIntersectionWithBoundingVolume(boundingVolume, tileset.clippingPlanesOriginMatrix);
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
  distanceToTile(frameState) {
    const boundingVolume = getBoundingVolume(this, frameState);
    return boundingVolume.distanceToCamera(frameState);
  };


/**
 * Computes the distance from the center of the tile's bounding volume to the camera.
 *
 * @param {FrameState} frameState The frame state.
 * @returns {Number} The distance, in meters.
 *
 * @private
 */
  distanceToTileCenter(frameState) {
    const tileBoundingVolume = getBoundingVolume(this, frameState);
    const boundingVolume = tileBoundingVolume.boundingVolume; // Gets the underlying OrientedBoundingBox or BoundingSphere
    const toCenter = Cartesian3.subtract(boundingVolume.center, frameState.camera.positionWC, scratchToTileCenter);
    const distance = Cartesian3.magnitude(toCenter);
    Cartesian3.divideByScalar(toCenter, distance, toCenter);
    const dot = Cartesian3.dot(frameState.camera.directionWC, toCenter);
    return distance * dot;
  };

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
    return !defined(viewerRequestVolume) || (viewerRequestVolume.distanceToCamera(frameState) === 0.0);
  };


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
};

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
    this._boundingVolume = this.createBoundingVolume(header.boundingVolume, this.computedTransform, this._boundingVolume);
    if (defined(this._contentBoundingVolume)) {
      this._contentBoundingVolume = this.createBoundingVolume(content.boundingVolume, this.computedTransform, this._contentBoundingVolume);
    }
    if (defined(this._viewerRequestVolume)) {
      this._viewerRequestVolume = this.createBoundingVolume(header.viewerRequestVolume, this.computedTransform, this._viewerRequestVolume);
    }

    // Destroy the debug bounding volumes. They will be generated fresh.
    this._debugBoundingVolume = this._debugBoundingVolume && this._debugBoundingVolume.destroy();
    this._debugContentBoundingVolume = this._debugContentBoundingVolume && this._debugContentBoundingVolume.destroy();
    this._debugViewerRequestVolume = this._debugViewerRequestVolume && this._debugViewerRequestVolume.destroy();
  };

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
  };


  // Processes the tile's content, e.g., create WebGL resources, to move from the PROCESSING to READY state.
  // @param {Tileset3D} tileset The tileset containing this tile.
  // @param {FrameState} frameState The frame state.
  process(tileset, frameState) {
    const savedCommandList = frameState.commandList;
    frameState.commandList = scratchCommandList;

    this._content.update(tileset, frameState);

    scratchCommandList.length = 0;
    frameState.commandList = savedCommandList;
  }

  _initialize(tileset, baseResource, header, parent) {
    this._tileset = tileset;
    this._header = header;

    const contentHeader = header.content;

    // The local transform of this tile.
    // @type {Matrix4}
    this.transform = defined(header.transform) ? Matrix4.unpack(header.transform) : Matrix4.clone(Matrix4.IDENTITY);

    const parentTransform = defined(parent) ? parent.computedTransform : tileset.modelMatrix;
    const computedTransform = Matrix4.multiply(parentTransform, this.transform, new Matrix4());

    const parentInitialTransform = defined(parent) ? parent._initialTransform : Matrix4.IDENTITY;
    this._initialTransform = Matrix4.multiply(parentInitialTransform, this.transform, new Matrix4());

    // The final computed transform of this tile.
    // @type {Matrix4}
    // @readonly
    this.computedTransform = computedTransform;

    this._boundingVolume = this.createBoundingVolume(header.boundingVolume, computedTransform);
    this._boundingVolume2D = undefined;

    const contentBoundingVolume;

    if (defined(contentHeader) && defined(contentHeader.boundingVolume)) {
      // Non-leaf tiles may have a content bounding-volume, which is a tight-fit bounding volume
      // around only the features in the tile.  This box is useful for culling for rendering,
      // but not for culling for traversing the tree since it does not guarantee spatial coherence, i.e.,
      // since it only bounds features in the tile, not the entire tile, children may be
      // outside of this box.
      contentBoundingVolume = this.createBoundingVolume(contentHeader.boundingVolume, computedTransform);
    }
    this._contentBoundingVolume = contentBoundingVolume;
    this._contentBoundingVolume2D = undefined;

    const viewerRequestVolume;
    if (defined(header.viewerRequestVolume)) {
      viewerRequestVolume = this.createBoundingVolume(header.viewerRequestVolume, computedTransform);
    }
    this._viewerRequestVolume = viewerRequestVolume;

    // The error, in meters, introduced if this tile is rendered and its children are not.
    // This is used to compute screen space error, i.e., the error measured in pixels.
    // @type {Number}
    // @readonly
    this.geometricError = header.geometricError;

    if (!defined(this.geometricError)) {
      this.geometricError = defined(parent) ? parent.geometricError : tileset._geometricError;
      Tile3D._deprecationWarning('geometricErrorUndefined', 'Required property geometricError is undefined for this tile. Using parent\'s geometric error instead.');
    }

    const refine;
    if (defined(header.refine)) {
      if (header.refine === 'replace' || header.refine === 'add') {
        Tile3D._deprecationWarning('lowercase-refine', 'This tile uses a lowercase refine "' + header.refine + '". Instead use "' + header.refine.toUpperCase() + '".');
      }
      refine = (header.refine.toUpperCase() === 'REPLACE') ? Tile3DRefine.REPLACE : Tile3DRefine.ADD;
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
        Tile3D._deprecationWarning('contentUrl', 'This tileset JSON uses the "content.url" property which has been deprecated. Use "content.uri" instead.');
        contentHeaderUri = contentHeader.url;
      }
      hasEmptyContent = false;
      contentState = Tile3DContentState.UNLOADED;
      contentResource = baseResource.getDerivedResource({
        url : contentHeaderUri
      });
      serverKey = RequestScheduler.getServerKey(contentResource.getUrlComponent());
    } else {
      content = new Empty3DTileContent(tileset, this);
      hasEmptyContent = true;
      contentState = Tile3DContentState.READY;
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
        expireDate = JulianDate.fromIso8601(expire.date);
      }
    }

    // The time in seconds after the tile's content is ready when the content expires and new content is requested.
    // @type {Number}
    this.expireDuration = expireDuration;

    // The date when the content expires and new content is requested.
    // @type {JulianDate}
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
    this._debugColor = Color.fromRandom({ alpha : 1.0 });
    this._debugColorizeTiles = false;

    this._commandsLength = 0;

    this._color = undefined;
    this._colorDirty = false;
  }
}

function applyDebugSettings(tile, tileset, frameState) {
  if (!frameState.passes.render) {
    return;
  }

  const hasContentBoundingVolume = defined(tile._header.content) && defined(tile._header.content.boundingVolume);
  const empty = tile.hasEmptyContent || tile.hasTilesetContent;

  const showVolume = tileset.debugShowBoundingVolume || (tileset.debugShowContentBoundingVolume && !hasContentBoundingVolume);
  if (showVolume) {
    const color;
    if (!tile._finalResolution) {
      color = Color.YELLOW;
    } else if (empty) {
      color = Color.DARKGRAY;
    } else {
      color = Color.WHITE;
    }
    if (!defined(tile._debugBoundingVolume)) {
      tile._debugBoundingVolume = tile._boundingVolume.createDebugVolume(color);
    }
    tile._debugBoundingVolume.update(frameState);
    const attributes = tile._debugBoundingVolume.getGeometryInstanceAttributes('outline');
    attributes.color = ColorGeometryInstanceAttribute.toValue(color, attributes.color);
  } else if (!showVolume && defined(tile._debugBoundingVolume)) {
    tile._debugBoundingVolume = tile._debugBoundingVolume.destroy();
  }

  if (tileset.debugShowContentBoundingVolume && hasContentBoundingVolume) {
    if (!defined(tile._debugContentBoundingVolume)) {
      tile._debugContentBoundingVolume = tile._contentBoundingVolume.createDebugVolume(Color.BLUE);
    }
    tile._debugContentBoundingVolume.update(frameState);
  } else if (!tileset.debugShowContentBoundingVolume && defined(tile._debugContentBoundingVolume)) {
    tile._debugContentBoundingVolume = tile._debugContentBoundingVolume.destroy();
  }

  if (tileset.debugShowViewerRequestVolume && defined(tile._viewerRequestVolume)) {
    if (!defined(tile._debugViewerRequestVolume)) {
      tile._debugViewerRequestVolume = tile._viewerRequestVolume.createDebugVolume(Color.YELLOW);
    }
    tile._debugViewerRequestVolume.update(frameState);
  } else if (!tileset.debugShowViewerRequestVolume && defined(tile._debugViewerRequestVolume)) {
    tile._debugViewerRequestVolume = tile._debugViewerRequestVolume.destroy();
  }

  const debugColorizeTilesOn = tileset.debugColorizeTiles && !tile._debugColorizeTiles;
  const debugColorizeTilesOff = !tileset.debugColorizeTiles && tile._debugColorizeTiles;

  if (debugColorizeTilesOn) {
    tile._debugColorizeTiles = true;
    tile.color = tile._debugColor;
  } else if (debugColorizeTilesOff) {
    tile._debugColorizeTiles = false;
    tile.color = Color.WHITE;
  }

  if (tile._colorDirty) {
    tile._colorDirty = false;
    tile._content.applyDebugSettings(true, tile._color);
  }

  if (debugColorizeTilesOff) {
    tileset.makeStyleDirty(); // Re-apply style now that colorize is switched off
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

function updateClippingPlanes(tile, tileset) {
  // Compute and compare ClippingPlanes state:
  // - enabled-ness - are clipping planes enabled? is this tile clipped?
  // - clipping plane count
  // - clipping function (union v. intersection)
  const clippingPlanes = tileset.clippingPlanes;
  const currentClippingPlanesState = 0;
  if (defined(clippingPlanes) && tile._isClipped && clippingPlanes.enabled) {
    currentClippingPlanesState = clippingPlanes.clippingPlanesState;
  }
  // If clippingPlaneState for tile changed, mark clippingPlanesDirty so content can update
  if (currentClippingPlanesState !== tile._clippingPlanesState) {
    tile._clippingPlanesState = currentClippingPlanesState;
    tile.clippingPlanesDirty = true;
  }
}

function updateExpireDate(tile) {
  if (defined(tile.expireDuration)) {
    const expireDurationDate = JulianDate.now(scratchJulianDate);
    JulianDate.addSeconds(expireDurationDate, tile.expireDuration, expireDurationDate);

    if (defined(tile.expireDate)) {
      if (JulianDate.lessThan(tile.expireDate, expireDurationDate)) {
        JulianDate.clone(expireDurationDate, tile.expireDate);
      }
    } else {
      tile.expireDate = JulianDate.clone(expireDurationDate);
    }
  }
}

function getContentFailedFunction(tile) {
  return function(error) {
    tile._contentState = Tile3DContentState.FAILED;
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

function getBoundingVolume(tile, frameState) {
  if (frameState.mode !== SceneMode.SCENE3D && !defined(tile._boundingVolume2D)) {
    const boundingSphere = tile._boundingVolume.boundingSphere;
    const sphere = BoundingSphere.projectTo2D(boundingSphere, frameState.mapProjection, scratchProjectedBoundingSphere);
    tile._boundingVolume2D = new TileBoundingSphere(sphere.center, sphere.radius);
  }

  return frameState.mode !== SceneMode.SCENE3D ? tile._boundingVolume2D : tile._boundingVolume;
}

function getContentBoundingVolume(tile, frameState) {
  if (frameState.mode !== SceneMode.SCENE3D && !defined(tile._contentBoundingVolume2D)) {
    const boundingSphere = tile._contentBoundingVolume.boundingSphere;
    const sphere = BoundingSphere.projectTo2D(boundingSphere, frameState.mapProjection, scratchProjectedBoundingSphere);
    tile._contentBoundingVolume2D = new TileBoundingSphere(sphere.center, sphere.radius);
  }
  return frameState.mode !== SceneMode.SCENE3D ? tile._contentBoundingVolume2D : tile._contentBoundingVolume;
}


const scratchMatrix = new Matrix3();
const scratchScale = new Cartesian3();
const scratchHalfAxes = new Matrix3();
const scratchCenter = new Cartesian3();
const scratchRectangle = new Rectangle();
const scratchOrientedBoundingBox = new OrientedBoundingBox();
const scratchTransform = new Matrix4();

function createBox(box, transform, result) {
  const center = Cartesian3.fromElements(box[0], box[1], box[2], scratchCenter);
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

  const orientedBoundingBox = OrientedBoundingBox.fromRectangle(rectangle, minimumHeight, maximumHeight, Ellipsoid.WGS84, scratchOrientedBoundingBox);
  const center = orientedBoundingBox.center;
  const halfAxes = orientedBoundingBox.halfAxes;

  // A region bounding volume is not transformed by the transform in the tileset JSON,
  // but may be transformed by additional transforms applied in Cesium.
  // This is why the transform is calculated as the difference between the initial transform and the current transform.
  transform = Matrix4.multiplyTransformation(transform, Matrix4.inverseTransformation(initialTransform, scratchTransform), scratchTransform);
  center = Matrix4.multiplyByPoint(transform, center, center);
  const rotationScale = Matrix4.getRotation(transform, scratchMatrix);
  halfAxes = Matrix3.multiply(rotationScale, halfAxes, halfAxes);

  if (defined(result) && (result instanceof TileOrientedBoundingBox)) {
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
    rectangle : rectangleRegion,
    minimumHeight : region[4],
    maximumHeight : region[5]
  });
}

function createSphere(sphere, transform, result) {
  const center = Cartesian3.fromElements(sphere[0], sphere[1], sphere[2], scratchCenter);
  const radius = sphere[3];

  // Find the transformed center and radius
  center = Matrix4.multiplyByPoint(transform, center, center);
  const scale = Matrix4.getScale(transform, scratchScale);
  const uniformScale = Cartesian3.maximumComponent(scale);
  radius *= uniformScale;

  if (defined(result)) {
    result.update(center, radius);
    return result;
  }
  return new TileBoundingSphere(center, radius);
}

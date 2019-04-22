/* eslint-disable */
export default class TileSet3DRenderer {
  constructor() {
    this._styleEngine = new Tile3DStyleEngine();
  }

  async loadUrl(options) {
    var that = this;
    var resource;

    try {
      const url = await options.url;

      var basePath;
      resource = Resource.createIfNeeded(url);

      // ion resources have a credits property we can use for additional attribution.
      that._credits = resource.credits;

      if (resource.extension === 'json') {
        basePath = resource.getBaseUri(true);
      } else if (resource.isDataUri) {
        basePath = '';
      }

      that._url = resource.url;
      that._basePath = basePath;

      const tilesetJson = await Tileset3D.loadJson(resource);

      that._root = that.loadTileset(resource, tilesetJson);
      var gltfUpAxis = defined(tilesetJson.asset.gltfUpAxis)
        ? Axis.fromName(tilesetJson.asset.gltfUpAxis)
        : Axis.Y;
      var asset = tilesetJson.asset;
      that._asset = asset;
      that._properties = tilesetJson.properties;
      that._geometricError = tilesetJson.geometricError;
      that._extensionsUsed = tilesetJson.extensionsUsed;
      that._gltfUpAxis = gltfUpAxis;
      that._extras = tilesetJson.extras;

      var extras = asset.extras;
      if (defined(extras) && defined(extras.cesium) && defined(extras.cesium.credits)) {
        var extraCredits = extras.cesium.credits;
        var credits = that._credits;
        if (!defined(credits)) {
          credits = [];
          that._credits = credits;
        }
        for (var i = 0; i < extraCredits.length; i++) {
          var credit = extraCredits[i];
          credits.push(new Credit(credit.html, credit.showOnScreen));
        }
      }

      // Save the original, untransformed bounding volume position so we can apply
      // the tile transform and model matrix at run time
      var boundingVolume = that._root.createBoundingVolume(
        tilesetJson.root.boundingVolume,
        Matrix4.IDENTITY
      );
      var clippingPlanesOrigin = boundingVolume.boundingSphere.center;
      // If this origin is above the surface of the earth
      // we want to apply an ENU orientation as our best guess of orientation.
      // Otherwise, we assume it gets its position/orientation completely from the
      // root tile transform and the tileset's model matrix
      var originCartographic = that._ellipsoid.cartesianToCartographic(clippingPlanesOrigin);
      if (
        defined(originCartographic) &&
        originCartographic.height > ApproximateTerrainHeights._defaultMinTerrainHeight
      ) {
        that._initialClippingPlanesOriginMatrix = Transforms.eastNorthUpToFixedFrame(
          clippingPlanesOrigin
        );
      }
      that._clippingPlanesOriginMatrix = Matrix4.clone(that._initialClippingPlanesOriginMatrix);
      that._readyPromise.resolve(that);
    } catch (error) {
      that._readyPromise.reject(error);
    }
  }

  /**
   * The style, defined using the
   * {@link https://github.com/AnalyticalGraphicsInc/3d-tiles/tree/master/specification/Styling|3D Tiles Styling language},
   * applied to each feature in the tileset.
   * <p>
   * Assign <code>undefined</code> to remove the style, which will restore the visual
   * appearance of the tileset to its default when no style was applied.
   * </p>
   * <p>
   * The style is applied to a tile before the {@link Tileset3D#tileVisible}
   * event is raised, so code in <code>tileVisible</code> can manually set a feature's
   * properties (e.g. color and show) after the style is applied. When
   * a new style is assigned any manually set properties are overwritten.
   * </p>
   *
   * @memberof Tileset3D.prototype
   *
   * @type {Tile3DStyle}
   *
   * @default undefined
   *
   * @example
   * tileset.style = new Cesium.Tile3DStyle({
   *    color : {
   *        conditions : [
   *            ['${Height} >= 100', 'color("purple", 0.5)'],
   *            ['${Height} >= 50', 'color("red")'],
   *            ['true', 'color("blue")']
   *        ]
   *    },
   *    show : '${Height} > 0',
   *    meta : {
   *        description : '"Building id ${id} has height ${Height}."'
   *    }
   * });
   *
   * @see {@link https://github.com/AnalyticalGraphicsInc/3d-tiles/tree/master/specification/Styling|3D Tiles Styling language}
   */
  get style() {
    return this._styleEngine.style;
  }

  set style(value) {
    this._styleEngine.style = value;
  }
}

/**
 * Provides a hook to override the method used to request the tileset json
 * useful when fetching tilesets from remote servers
 * @param {Resource|String} tilesetUrl The url of the json file to be fetched
 * @returns {Promise.<Object>} A promise that resolves with the fetched json data
 */
Tileset3D.loadJson = function(tilesetUrl) {
  var resource = Resource.createIfNeeded(tilesetUrl);
  return resource.fetchJson();
};

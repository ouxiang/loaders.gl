export {default as ImageLoader, HTMLImageLoader, ImageBitmapLoader} from './image-loader';
export {default as ImageWriter} from './image-writer';

export {loadImage} from './lib/parse-image';

// UTILS
export {isImage, getImageMetadata} from './lib/get-image-metadata';

// Experimental
export {decodeImage} from './lib/image-utils-browser';

// Deprecated
export {getImageSize} from './lib/get-image-metadata';

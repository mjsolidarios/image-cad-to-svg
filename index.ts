/**
 * CAD to SVG Converter
 * 
 * A robust JavaScript/TypeScript library for converting 2D CAD images (PNG/JPG) to SVG format
 * with accurate vectorization and comprehensive features.
 * 
 * @packageDocumentation
 */

// Main converter class and convenience functions
export {
  CADToSVGConverter,
  imageToSVG,
  convertImage,
  createConverter,
} from './converter';

// Types and interfaces
export * from './types';

// Image processing utilities
export {
  loadImage,
  extractImageData,
  createImageData,
  getPixel,
  setPixel,
  toGrayscale,
  colorDistance,
  isColorSimilar,
  colorToHex,
  colorToRgba,
  grayscale,
  gaussianBlur,
  medianFilter,
  threshold,
  adaptiveThreshold,
  sobelEdgeDetection,
  prewittEdgeDetection,
  robertsEdgeDetection,
  laplacianEdgeDetection,
  cannyEdgeDetection,
  detectEdges,
  invertImage,
  dilate,
  erode,
  morphClose,
  morphOpen,
} from './image-processor';

// Contour detection utilities
export {
  mooreContourTracing,
  suzukiContourTracing,
  marchingSquares,
  calculateContourArea,
  calculateContourPerimeter,
  calculateContourCentroid,
  isPointInContour,
  isContourInside,
  filterContoursByArea,
  mergeNearbyContours,
  detectContours,
} from './contour-detector';

// Path simplification utilities
export {
  douglasPeucker,
  douglasPeuckerRelative,
  visvalingamWhyatt,
  reumannWitkam,
  chaikinSmooth,
  movingAverageSmooth,
  gaussianSmooth,
  fitCubicBezier,
  getBoundingBox,
  pathLength,
  resamplePath,
  simplifyPath,
} from './path-simplification';

// SVG generation utilities
export {
  pointsToPathString,
  pointsToSmoothPath,
  bezierSegmentsToPath,
  generateSVG,
  contoursToPathData,
  groupPathsByColor,
  createLayersFromColors,
  calculatePathsBoundingBox,
  pathsToSVGPaths,
  generateInlineSVG,
  generateSVGDataURI,
  generateSVGBlob,
  createSVGDownloadLink,
} from './svg-generator';

// Color analysis utilities
export {
  extractColors,
  quantizeColor,
  medianCutQuantize,
  extractDominantColors,
  findNearestColor,
  groupPathsBySimilarColor,
  detectBackgroundColor,
  hasTransparentBackground,
  detectCADLineColors,
  rgbToHsl,
  hslToRgb,
} from './color-analyzer';

// Version
export const VERSION = '1.0.0';

/**
 * Library capabilities:
 * 
 * 1. Image Processing
 *    - Load PNG, JPG, GIF, BMP, WebP images
 *    - Grayscale conversion
 *    - Gaussian blur for noise reduction
 *    - Median filtering
 *    - Adaptive thresholding
 * 
 * 2. Edge Detection
 *    - Canny edge detection (recommended for CAD)
 *    - Sobel edge detection
 *    - Prewitt edge detection
 *    - Roberts cross edge detection
 *    - Laplacian edge detection
 * 
 * 3. Contour Detection
 *    - Moore neighborhood tracing
 *    - Suzuki-Abe algorithm (handles holes)
 *    - Marching squares (sub-pixel precision)
 * 
 * 4. Path Simplification
 *    - Douglas-Peucker algorithm
 *    - Visvalingam-Whyatt algorithm
 *    - Reumann-Witkam algorithm
 *    - Chaikin curve smoothing
 *    - Bezier curve fitting
 * 
 * 5. Color Analysis
 *    - Automatic background detection
 *    - CAD line color detection
 *    - K-means color clustering
 *    - Median cut quantization
 * 
 * 6. SVG Generation
 *    - Optimized path output
 *    - Layer group support
 *    - Metadata inclusion
 *    - Precision control
 */

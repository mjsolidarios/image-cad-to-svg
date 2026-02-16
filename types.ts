/**
 * CAD to SVG Converter - Type Definitions
 * A robust library for converting 2D CAD images (PNG/JPG) to SVG format
 */

// ============================================================================
// Core Types
// ============================================================================

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface PathData {
  points: Point[];
  color: Color;
  strokeWidth: number;
  closed: boolean;
  layer?: string;
  id?: string;
}

export interface SVGPath {
  d: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  fillRule?: 'nonzero' | 'evenodd';
  transform?: string;
  id?: string;
  className?: string;
}

// ============================================================================
// Image Processing Types
// ============================================================================

export interface ImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface ProcessedImage {
  original: ImageData;
  grayscale?: Uint8ClampedArray;
  edges?: Uint8ClampedArray;
  binary?: Uint8ClampedArray;
}

export interface Pixel {
  x: number;
  y: number;
  color: Color;
}

// ============================================================================
// Edge Detection Types
// ============================================================================

export type EdgeDetectionMethod = 'canny' | 'sobel' | 'prewitt' | 'roberts' | 'laplacian';

export interface EdgeDetectionOptions {
  method: EdgeDetectionMethod;
  lowThreshold?: number;
  highThreshold?: number;
  gaussianBlur?: number;
  applyNoiseReduction?: boolean;
}

export interface GradientData {
  magnitude: Float32Array;
  direction: Float32Array;
  width: number;
  height: number;
}

// ============================================================================
// Contour Detection Types
// ============================================================================

export type ContourTracingMethod = 'moore' | 'suzuki' | 'marching-squares';

export interface Contour {
  points: Point[];
  isClosed: boolean;
  isHole: boolean;
  boundingBox: BoundingBox;
  area: number;
  perimeter: number;
}

export interface ContourDetectionOptions {
  method: ContourTracingMethod;
  minArea?: number;
  maxArea?: number;
  simplify?: boolean;
  tolerance?: number;
}

// ============================================================================
// Color Analysis Types
// ============================================================================

export interface ColorGroup {
  color: Color;
  count: number;
  percentage: number;
  paths: PathData[];
}

export interface ColorExtractionOptions {
  maxColors?: number;
  minPercentage?: number;
  quantize?: boolean;
  ignoreBackground?: boolean;
  backgroundColor?: Color;
}

export interface Layer {
  id: string;
  name: string;
  color: Color;
  paths: PathData[];
  visible: boolean;
  locked: boolean;
}

// ============================================================================
// SVG Generation Types
// ============================================================================

export interface SVGOptions {
  width?: number;
  height?: number;
  viewBox?: BoundingBox;
  preserveAspectRatio?: string;
  fillRule?: 'nonzero' | 'evenodd';
  strokeWidth?: number;
  precision?: number;
  optimize?: boolean;
  addMetadata?: boolean;
  addLayerGroups?: boolean;
  scale?: number;
}

export interface SVGMetadata {
  title?: string;
  description?: string;
  creator?: string;
  date?: string;
  source?: string;
}

// ============================================================================
// Conversion Options
// ============================================================================

export interface ConversionOptions {
  // Edge Detection
  edgeDetection?: EdgeDetectionOptions;
  
  // Contour Detection
  contourDetection?: ContourDetectionOptions;
  
  // Color Extraction
  colorExtraction?: ColorExtractionOptions;
  
  // SVG Generation
  svg?: SVGOptions;
  
  // Metadata
  metadata?: SVGMetadata;
  
  // General
  invertColors?: boolean;
  backgroundColor?: Color;
  targetDPI?: number;
  preserveAspectRatio?: boolean;
  
  // CAD-specific
  detectLayers?: boolean;
  mergeSimilarPaths?: boolean;
  pathMergeThreshold?: number;
  smoothCurves?: boolean;
  curveTension?: number;
}

export interface ConversionResult {
  svg: string;
  width: number;
  height: number;
  paths: PathData[];
  layers: Layer[];
  colorGroups: ColorGroup[];
  metadata: {
    originalFormat: string;
    conversionTime: number;
    pathCount: number;
    layerCount: number;
  };
}

// ============================================================================
// Worker Types (for async processing)
// ============================================================================

export interface WorkerMessage {
  type: 'process' | 'progress' | 'complete' | 'error';
  payload: unknown;
}

export interface ProcessingProgress {
  stage: 'loading' | 'edge-detection' | 'contour-tracing' | 'path-simplification' | 'svg-generation';
  progress: number;
  message: string;
}

export type ProgressCallback = (progress: ProcessingProgress) => void;

// ============================================================================
// Error Types
// ============================================================================

export class CADConverterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'CADConverterError';
  }
}

export const ErrorCodes = {
  INVALID_IMAGE: 'INVALID_IMAGE',
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  PROCESSING_FAILED: 'PROCESSING_FAILED',
  EDGE_DETECTION_FAILED: 'EDGE_DETECTION_FAILED',
  CONTOUR_TRACING_FAILED: 'CONTOUR_TRACING_FAILED',
  SVG_GENERATION_FAILED: 'SVG_GENERATION_FAILED',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

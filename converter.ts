/**
 * CAD to SVG Converter - Main Converter Class
 * Comprehensive library for converting 2D CAD images (PNG/JPG) to SVG
 */

import {
  ConversionOptions,
  ConversionResult,
  PathData,
  Layer,
  ColorGroup,
  ProcessingProgress,
  ProgressCallback,
  Color,
  ImageData as CADImageData,
  CADConverterError,
  ErrorCodes,
} from './types';
import {
  loadImage,
  extractImageData,
  detectEdges,
  threshold,
  adaptiveThreshold,
  invertImage,
  morphClose,
} from './image-processor';
import {
  detectContours,
} from './contour-detector';
import {
  douglasPeucker,
  chaikinSmooth,
  simplifyPath,
  pathLength,
} from './path-simplification';
import {
  generateSVG,
  contoursToPathData,
  calculatePathsBoundingBox,
  createLayersFromColors,
} from './svg-generator';
import {
  extractColors,
  detectBackgroundColor,
  detectCADLineColors,
  groupPathsBySimilarColor,
} from './color-analyzer';

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_OPTIONS: ConversionOptions = {
  edgeDetection: {
    method: 'canny',
    lowThreshold: 50,
    highThreshold: 150,
    gaussianBlur: 1.4,
    applyNoiseReduction: true,
  },
  contourDetection: {
    method: 'suzuki',
    minArea: 10,
    maxArea: Infinity,
    simplify: true,
    tolerance: 1.0,
  },
  colorExtraction: {
    maxColors: 256,
    minPercentage: 0.01,
    quantize: true,
    ignoreBackground: true,
  },
  svg: {
    precision: 3,
    optimize: true,
    addMetadata: true,
    addLayerGroups: true,
    strokeWidth: 1,
  },
  invertColors: false,
  detectLayers: true,
  mergeSimilarPaths: true,
  pathMergeThreshold: 2,
  smoothCurves: false,
  curveTension: 0.5,
};

// ============================================================================
// Main Converter Class
// ============================================================================

/**
 * CADToSVGConverter - Main class for converting CAD images to SVG
 * 
 * @example
 * ```typescript
 * const converter = new CADToSVGConverter();
 * const result = await converter.convert('/path/to/image.png');
 * console.log(result.svg);
 * ```
 */
export class CADToSVGConverter {
  private options: ConversionOptions;
  private progressCallback?: ProgressCallback;

  constructor(options: Partial<ConversionOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Set progress callback for monitoring conversion progress
   */
  onProgress(callback: ProgressCallback): this {
    this.progressCallback = callback;
    return this;
  }

  /**
   * Convert image to SVG
   */
  async convert(
    source: string | Blob | File | HTMLImageElement,
    options?: Partial<ConversionOptions>
  ): Promise<ConversionResult> {
    const startTime = performance.now();
    const mergedOptions = { ...this.options, ...options };

    try {
      // Stage 1: Load image
      this.reportProgress('loading', 0, 'Loading image...');
      const img = await loadImage(source);
      let imageData = extractImageData(img);

      this.reportProgress('loading', 100, 'Image loaded successfully');

      // Stage 2: Preprocess image
      this.reportProgress('edge-detection', 0, 'Preprocessing image...');

      // Invert colors if requested (useful for white-on-black CAD drawings)
      if (mergedOptions.invertColors) {
        imageData = invertImage(imageData);
      }

      // Stage 3: Edge detection
      this.reportProgress('edge-detection', 20, 'Detecting edges...');
      const edgeOptions = mergedOptions.edgeDetection!;
      const edges = detectEdges(imageData, edgeOptions);

      // Apply morphological operations to clean up edges
      this.reportProgress('edge-detection', 60, 'Cleaning up edges...');
      const cleanedEdges = morphClose(edges, imageData.width, imageData.height, 1);

      this.reportProgress('edge-detection', 100, 'Edge detection complete');

      // Stage 4: Contour detection
      this.reportProgress('contour-tracing', 0, 'Tracing contours...');
      const contourOptions = mergedOptions.contourDetection!;
      const contours = detectContours(cleanedEdges, imageData.width, imageData.height, contourOptions);

      this.reportProgress('contour-tracing', 100, `Found ${contours.length} contours`);

      // Stage 5: Path simplification
      this.reportProgress('path-simplification', 0, 'Simplifying paths...');

      // Extract colors for paths
      const backgroundColor = detectBackgroundColor(imageData);
      const lineColors = detectCADLineColors(imageData);

      // Convert contours to paths
      let paths: PathData[] = [];

      if (lineColors.length > 0) {
        // Assign colors based on proximity to line colors
        paths = this.assignColorsToContours(contours, imageData, lineColors, mergedOptions);
      } else {
        // Use black as default color
        const defaultColor: Color = { r: 0, g: 0, b: 0, a: 255 };
        paths = contoursToPathData(contours, defaultColor, mergedOptions.svg?.strokeWidth || 1);
      }

      // Apply path simplification
      paths = this.simplifyPaths(paths, mergedOptions);

      this.reportProgress('path-simplification', 100, 'Path simplification complete');

      // Stage 6: SVG generation
      this.reportProgress('svg-generation', 0, 'Generating SVG...');

      // Create layers if requested
      let layers: Layer[] = [];
      if (mergedOptions.detectLayers) {
        const colorGroups = groupPathsBySimilarColor(paths, 30);
        layers = this.createLayers(colorGroups);
      }

      // Generate SVG string
      const svgOptions = mergedOptions.svg!;
      const svg = generateSVG(
        paths,
        imageData.width,
        imageData.height,
        svgOptions,
        mergedOptions.metadata,
        layers
      );

      // Calculate color groups for result
      const colorGroups = this.calculateColorGroups(paths);

      const conversionTime = performance.now() - startTime;

      this.reportProgress('svg-generation', 100, 'SVG generation complete');

      return {
        svg,
        width: imageData.width,
        height: imageData.height,
        paths,
        layers,
        colorGroups,
        metadata: {
          originalFormat: this.detectFormat(source),
          conversionTime,
          pathCount: paths.length,
          layerCount: layers.length,
        },
      };

    } catch (error) {
      throw new CADConverterError(
        `Conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.PROCESSING_FAILED,
        error
      );
    }
  }

  /**
   * Convert with custom edge image (for advanced use)
   */
  async convertFromEdges(
    edges: Uint8ClampedArray,
    width: number,
    height: number,
    originalImage?: CADImageData,
    options?: Partial<ConversionOptions>
  ): Promise<ConversionResult> {
    const startTime = performance.now();
    const mergedOptions = { ...this.options, ...options };

    this.reportProgress('contour-tracing', 0, 'Tracing contours...');
    const contourOptions = mergedOptions.contourDetection!;
    const contours = detectContours(edges, width, height, contourOptions);

    this.reportProgress('contour-tracing', 100, `Found ${contours.length} contours`);

    // Extract colors if original image provided
    let lineColors: Color[] = [];
    let backgroundColor: Color = { r: 255, g: 255, b: 255, a: 255 };

    if (originalImage) {
      backgroundColor = detectBackgroundColor(originalImage);
      lineColors = detectCADLineColors(originalImage);
    }

    // Convert contours to paths
    let paths: PathData[] = [];
    if (lineColors.length > 0) {
      paths = this.assignColorsToContours(contours, originalImage!, lineColors, mergedOptions);
    } else {
      const defaultColor: Color = { r: 0, g: 0, b: 0, a: 255 };
      paths = contoursToPathData(contours, defaultColor, mergedOptions.svg?.strokeWidth || 1);
    }

    paths = this.simplifyPaths(paths, mergedOptions);

    // Create layers
    let layers: Layer[] = [];
    if (mergedOptions.detectLayers) {
      const colorGroups = groupPathsBySimilarColor(paths, 30);
      layers = this.createLayers(colorGroups);
    }

    const svg = generateSVG(
      paths,
      width,
      height,
      mergedOptions.svg,
      mergedOptions.metadata,
      layers
    );

    const colorGroups = this.calculateColorGroups(paths);
    const conversionTime = performance.now() - startTime;

    return {
      svg,
      width,
      height,
      paths,
      layers,
      colorGroups,
      metadata: {
        originalFormat: 'unknown',
        conversionTime,
        pathCount: paths.length,
        layerCount: layers.length,
      },
    };
  }

  /**
   * Quick conversion with minimal options
   */
  async quickConvert(source: string | Blob | File | HTMLImageElement): Promise<string> {
    const result = await this.convert(source, {
      edgeDetection: { method: 'canny' },
      contourDetection: { method: 'suzuki', simplify: true },
      svg: { optimize: true },
    });
    return result.svg;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private reportProgress(
    stage: ProcessingProgress['stage'],
    progress: number,
    message: string
  ): void {
    if (this.progressCallback) {
      this.progressCallback({ stage, progress, message });
    }
  }

  private assignColorsToContours(
    contours: Array<{ points: Array<{ x: number; y: number }>; isClosed: boolean }>,
    imageData: CADImageData,
    lineColors: Color[],
    options: ConversionOptions
  ): PathData[] {
    // For each contour, sample colors along the path
    const paths: PathData[] = [];

    for (let i = 0; i < contours.length; i++) {
      const contour = contours[i];
      const sampledColor = this.sampleColorAlongPath(imageData, contour.points);

      // Find nearest line color
      let assignedColor = sampledColor;
      let minDist = Infinity;

      for (const lineColor of lineColors) {
        const dist = Math.sqrt(
          Math.pow(sampledColor.r - lineColor.r, 2) +
          Math.pow(sampledColor.g - lineColor.g, 2) +
          Math.pow(sampledColor.b - lineColor.b, 2)
        );
        if (dist < minDist) {
          minDist = dist;
          assignedColor = lineColor;
        }
      }

      paths.push({
        points: contour.points,
        color: assignedColor,
        strokeWidth: options.svg?.strokeWidth || 1,
        closed: contour.isClosed,
        id: `path-${i}`,
      });
    }

    return paths;
  }

  private sampleColorAlongPath(
    imageData: CADImageData,
    points: Array<{ x: number; y: number }>
  ): Color {
    // Sample colors at regular intervals along the path
    const step = Math.max(1, Math.floor(points.length / 10));
    let r = 0, g = 0, b = 0, count = 0;

    for (let i = 0; i < points.length; i += step) {
      const p = points[i];
      const x = Math.floor(p.x);
      const y = Math.floor(p.y);

      if (x >= 0 && x < imageData.width && y >= 0 && y < imageData.height) {
        const idx = (y * imageData.width + x) * 4;
        r += imageData.data[idx];
        g += imageData.data[idx + 1];
        b += imageData.data[idx + 2];
        count++;
      }
    }

    if (count === 0) {
      return { r: 0, g: 0, b: 0, a: 255 };
    }

    return {
      r: Math.round(r / count),
      g: Math.round(g / count),
      b: Math.round(b / count),
      a: 255,
    };
  }

  private simplifyPaths(paths: PathData[], options: ConversionOptions): PathData[] {
    const tolerance = options.contourDetection?.tolerance || 1.0;
    const smoothCurves = options.smoothCurves;
    const curveTension = options.curveTension || 0.5;

    return paths.map(path => {
      let points = [...path.points];

      // Apply Douglas-Peucker simplification
      if (points.length > 3) {
        points = douglasPeucker(points, tolerance);
      }

      // Apply curve smoothing if requested
      if (smoothCurves && points.length > 3) {
        points = chaikinSmooth(points, 2);
      }

      return {
        ...path,
        points,
      };
    });
  }

  private createLayers(colorGroups: Map<Color, PathData[]>): Layer[] {
    const layers: Layer[] = [];
    let index = 0;

    for (const [color, paths] of colorGroups) {
      layers.push({
        id: `layer-${index}`,
        name: `Layer ${index + 1}`,
        color,
        paths,
        visible: true,
        locked: false,
      });
      index++;
    }

    return layers;
  }

  private calculateColorGroups(paths: PathData[]): ColorGroup[] {
    const groups = new Map<string, ColorGroup>();

    for (const path of paths) {
      const key = `${path.color.r}-${path.color.g}-${path.color.b}`;

      if (groups.has(key)) {
        const group = groups.get(key)!;
        group.paths.push(path);
        group.count++;
      } else {
        groups.set(key, {
          color: path.color,
          count: 1,
          percentage: 0,
          paths: [path],
        });
      }
    }

    const totalPaths = paths.length;
    const result = Array.from(groups.values());

    for (const group of result) {
      group.percentage = (group.count / totalPaths) * 100;
    }

    return result.sort((a, b) => b.count - a.count);
  }

  private detectFormat(source: unknown): string {
    if (typeof source === 'string') {
      if (source.toLowerCase().endsWith('.png')) return 'PNG';
      if (source.toLowerCase().endsWith('.jpg') || source.toLowerCase().endsWith('.jpeg')) return 'JPEG';
      if (source.toLowerCase().endsWith('.gif')) return 'GIF';
      if (source.toLowerCase().endsWith('.bmp')) return 'BMP';
      if (source.toLowerCase().endsWith('.webp')) return 'WebP';
    }

    if (source instanceof File) {
      const type = source.type;
      if (type === 'image/png') return 'PNG';
      if (type === 'image/jpeg') return 'JPEG';
      if (type === 'image/gif') return 'GIF';
      if (type === 'image/bmp') return 'BMP';
      if (type === 'image/webp') return 'WebP';
    }

    return 'Unknown';
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick convert image to SVG
 */
export async function imageToSVG(
  source: string | Blob | File | HTMLImageElement,
  options?: Partial<ConversionOptions>
): Promise<string> {
  const converter = new CADToSVGConverter(options);
  const result = await converter.convert(source);
  return result.svg;
}

/**
 * Convert image with full result
 */
export async function convertImage(
  source: string | Blob | File | HTMLImageElement,
  options?: Partial<ConversionOptions>
): Promise<ConversionResult> {
  const converter = new CADToSVGConverter(options);
  return converter.convert(source);
}

/**
 * Create converter instance with options
 */
export function createConverter(options?: Partial<ConversionOptions>): CADToSVGConverter {
  return new CADToSVGConverter(options);
}

// ============================================================================
// Export Types and Submodules
// ============================================================================

export * from './types';
export * from './image-processor';
export * from './contour-detector';
export * from './path-simplification';
export * from './svg-generator';
export * from './color-analyzer';

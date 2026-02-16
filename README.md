# CAD to SVG Converter

A robust JavaScript/TypeScript library for converting 2D CAD images (PNG/JPG) to SVG format with accurate vectorization.

## Features

### Edge Detection
- **Canny Edge Detection** - Recommended for CAD drawings with adjustable thresholds
- **Sobel Operator** - Fast gradient-based edge detection
- **Prewitt Operator** - Similar to Sobel with different kernel weights
- **Roberts Cross** - Diagonal edge emphasis
- **Laplacian** - Second derivative edge detection

### Contour Detection
- **Suzuki-Abe Algorithm** - Handles holes and hierarchy (recommended)
- **Moore Neighborhood Tracing** - Simple boundary tracing
- **Marching Squares** - Sub-pixel precision contours

### Path Simplification
- **Douglas-Peucker Algorithm** - Preserves shape while reducing points
- **Visvalingam-Whyatt** - Area-based simplification
- **Reumann-Witkam** - Distance-based simplification
- **Chaikin Smoothing** - Curve interpolation
- **Bezier Curve Fitting** - Smooth vector paths

### Color Analysis
- **Automatic Background Detection** - Identifies background color from edges
- **CAD Line Color Extraction** - Detects drawing line colors
- **K-Means Clustering** - Color palette extraction
- **Median Cut Quantization** - Color reduction

## Installation

```bash
npm install cad-to-svg
# or
yarn add cad-to-svg
# or
bun add cad-to-svg
```

## Quick Start

```typescript
import { imageToSVG, CADToSVGConverter } from 'cad-to-svg';

// Simple conversion
const svg = await imageToSVG('/path/to/cad-drawing.png');
console.log(svg);

// With options
const converter = new CADToSVGConverter({
  edgeDetection: {
    method: 'canny',
    lowThreshold: 50,
    highThreshold: 150,
  },
  contourDetection: {
    method: 'suzuki',
    minArea: 10,
    simplify: true,
    tolerance: 1.0,
  },
  svg: {
    strokeWidth: 1,
    precision: 3,
  },
});

const result = await converter.convert('/path/to/cad-drawing.png');
console.log(result.svg);
console.log(`Found ${result.pathCount} paths in ${result.conversionTime}ms`);
```

## API Reference

### CADToSVGConverter

Main converter class with configurable options.

```typescript
const converter = new CADToSVGConverter(options?: Partial<ConversionOptions>);
```

#### Methods

##### `convert(source, options?)`

Convert an image to SVG.

```typescript
const result = await converter.convert(
  source: string | Blob | File | HTMLImageElement,
  options?: Partial<ConversionOptions>
);
```

##### `quickConvert(source)`

Quick conversion with default settings.

```typescript
const svg = await converter.quickConvert(source);
```

##### `onProgress(callback)`

Set progress callback for monitoring.

```typescript
converter.onProgress((progress) => {
  console.log(`${progress.stage}: ${progress.progress}% - ${progress.message}`);
});
```

### ConversionOptions

```typescript
interface ConversionOptions {
  edgeDetection?: {
    method: 'canny' | 'sobel' | 'prewitt' | 'roberts' | 'laplacian';
    lowThreshold?: number;      // Canny: 0-255, default: 50
    highThreshold?: number;     // Canny: 0-255, default: 150
    gaussianBlur?: number;      // Sigma value, default: 1.4
    applyNoiseReduction?: boolean;
  };
  
  contourDetection?: {
    method: 'moore' | 'suzuki' | 'marching-squares';
    minArea?: number;           // Minimum contour area, default: 10
    maxArea?: number;           // Maximum contour area
    simplify?: boolean;         // Apply path simplification
    tolerance?: number;         // Simplification tolerance, default: 1.0
  };
  
  colorExtraction?: {
    maxColors?: number;         // Maximum colors to extract
    minPercentage?: number;     // Minimum percentage threshold
    quantize?: boolean;         // Apply color quantization
    ignoreBackground?: boolean; // Ignore background color
  };
  
  svg?: {
    width?: number;
    height?: number;
    viewBox?: BoundingBox;
    precision?: number;         // Decimal precision, default: 3
    optimize?: boolean;         // Optimize SVG output
    strokeWidth?: number;       // Default stroke width
    addMetadata?: boolean;
    addLayerGroups?: boolean;
  };
  
  invertColors?: boolean;       // Invert before processing
  detectLayers?: boolean;       // Group paths by color
  smoothCurves?: boolean;       // Apply curve smoothing
  curveTension?: number;        // Curve smoothing tension
}
```

### ConversionResult

```typescript
interface ConversionResult {
  svg: string;                  // SVG string
  width: number;                // Image width
  height: number;               // Image height
  paths: PathData[];            // Extracted paths
  layers: Layer[];              // Color-based layers
  colorGroups: ColorGroup[];    // Color statistics
  metadata: {
    originalFormat: string;
    conversionTime: number;
    pathCount: number;
    layerCount: number;
  };
}
```

## Usage Examples

### Basic Conversion

```typescript
import { imageToSVG } from 'cad-to-svg';

// From URL
const svg = await imageToSVG('https://example.com/drawing.png');

// From File input
const fileInput = document.querySelector('input[type="file"]');
const svg = await imageToSVG(fileInput.files[0]);

// From base64
const svg = await imageToSVG('data:image/png;base64,...');
```

### With Progress Monitoring

```typescript
const converter = new CADToSVGConverter();

converter.onProgress((progress) => {
  updateProgressBar(progress.progress);
  updateStatusText(progress.message);
});

const result = await converter.convert(imageUrl);
```

### Optimizing for Different CAD Types

#### Line Drawings (Black on White)

```typescript
const result = await converter.convert(imageUrl, {
  edgeDetection: {
    method: 'canny',
    lowThreshold: 30,
    highThreshold: 100,
  },
  contourDetection: {
    method: 'suzuki',
    minArea: 5,
    tolerance: 0.5,
  },
});
```

#### Blueprints (Blue Lines)

```typescript
const result = await converter.convert(imageUrl, {
  invertColors: false,
  edgeDetection: {
    method: 'canny',
    lowThreshold: 40,
    highThreshold: 120,
  },
});
```

#### White-on-Black (Inverted)

```typescript
const result = await converter.convert(imageUrl, {
  invertColors: true,
  edgeDetection: {
    method: 'canny',
  },
});
```

### Working with Results

```typescript
const result = await converter.convert(imageUrl);

// Access individual paths
result.paths.forEach((path, i) => {
  console.log(`Path ${i}: ${path.points.length} points, color: ${path.color}`);
});

// Download SVG
const blob = new Blob([result.svg], { type: 'image/svg+xml' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'converted.svg';
a.click();

// Display in browser
const container = document.getElementById('svg-container');
container.innerHTML = result.svg;
```

## Algorithm Details

### Edge Detection Pipeline

1. **Gaussian Blur** - Noise reduction with configurable sigma
2. **Gradient Calculation** - Sobel kernels for magnitude and direction
3. **Non-Maximum Suppression** - Thin edges to single pixel width
4. **Double Threshold** - Classify edge pixels as strong/weak
5. **Hysteresis** - Connect weak edges to strong edges

### Contour Detection

The Suzuki-Abe algorithm:
1. Raster scan to find contour starting points
2. Trace boundaries using 8-connected neighborhood
3. Label regions and detect holes
4. Build contour hierarchy

### Path Simplification

Douglas-Peucker algorithm:
1. Connect endpoints with a line
2. Find point with maximum distance
3. If distance exceeds tolerance, split recursively
4. Result: simplified polyline preserving shape

## Browser Support

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## Performance Tips

1. **Image Size**: Resize large images before conversion
2. **Edge Detection**: Canny is most accurate but slower; Sobel is faster
3. **Simplification**: Higher tolerance = fewer points = smaller SVG
4. **Min Area**: Filter small contours to reduce noise

## License

MIT License

## Contributing

Contributions welcome! Please read our contributing guidelines.

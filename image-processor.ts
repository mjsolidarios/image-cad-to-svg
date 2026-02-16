/**
 * CAD to SVG Converter - Image Processing Module
 * Handles image loading, preprocessing, and pixel manipulation
 */

import {
  ImageData as CADImageData,
  Color,
  Point,
  GradientData,
  EdgeDetectionOptions,
  EdgeDetectionMethod,
} from './types';

// ============================================================================
// Image Loading
// ============================================================================

/**
 * Load image from various sources
 */
export async function loadImage(source: string | Blob | File | HTMLImageElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (source instanceof HTMLImageElement) {
      if (source.complete) {
        resolve(source);
      } else {
        source.onload = () => resolve(source);
        source.onerror = () => reject(new Error('Failed to load image'));
      }
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));

    if (typeof source === 'string') {
      img.src = source;
    } else if (source instanceof Blob || source instanceof File) {
      img.src = URL.createObjectURL(source);
    }
  });
}

/**
 * Extract image data from HTML image element
 */
export function extractImageData(img: HTMLImageElement): CADImageData {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get canvas context');
  }

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  return {
    width: imageData.width,
    height: imageData.height,
    data: imageData.data,
  };
}

/**
 * Create image data from scratch
 */
export function createImageData(width: number, height: number): CADImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}

// ============================================================================
// Color Operations
// ============================================================================

/**
 * Get pixel color at specific position
 */
export function getPixel(imageData: CADImageData, x: number, y: number): Color {
  if (x < 0 || x >= imageData.width || y < 0 || y >= imageData.height) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const index = (y * imageData.width + x) * 4;
  return {
    r: imageData.data[index],
    g: imageData.data[index + 1],
    b: imageData.data[index + 2],
    a: imageData.data[index + 3],
  };
}

/**
 * Set pixel color at specific position
 */
export function setPixel(imageData: CADImageData, x: number, y: number, color: Color): void {
  if (x < 0 || x >= imageData.width || y < 0 || y >= imageData.height) {
    return;
  }

  const index = (y * imageData.width + x) * 4;
  imageData.data[index] = color.r;
  imageData.data[index + 1] = color.g;
  imageData.data[index + 2] = color.b;
  imageData.data[index + 3] = color.a;
}

/**
 * Convert color to grayscale
 */
export function toGrayscale(color: Color): number {
  return Math.round(0.299 * color.r + 0.587 * color.g + 0.114 * color.b);
}

/**
 * Calculate color distance (Euclidean)
 */
export function colorDistance(c1: Color, c2: Color): number {
  return Math.sqrt(
    Math.pow(c1.r - c2.r, 2) +
    Math.pow(c1.g - c2.g, 2) +
    Math.pow(c1.b - c2.b, 2)
  );
}

/**
 * Check if color is similar within threshold
 */
export function isColorSimilar(c1: Color, c2: Color, threshold: number = 30): boolean {
  return colorDistance(c1, c2) <= threshold;
}

/**
 * Convert color to hex string
 */
export function colorToHex(color: Color): string {
  const r = Math.round(color.r).toString(16).padStart(2, '0');
  const g = Math.round(color.g).toString(16).padStart(2, '0');
  const b = Math.round(color.b).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * Convert color to RGBA string
 */
export function colorToRgba(color: Color): string {
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${(color.a / 255).toFixed(3)})`;
}

// ============================================================================
// Image Preprocessing
// ============================================================================

/**
 * Convert image to grayscale
 */
export function grayscale(imageData: CADImageData): Uint8ClampedArray {
  const result = new Uint8ClampedArray(imageData.width * imageData.height);
  
  for (let i = 0; i < imageData.data.length; i += 4) {
    const pixelIndex = i / 4;
    result[pixelIndex] = toGrayscale({
      r: imageData.data[i],
      g: imageData.data[i + 1],
      b: imageData.data[i + 2],
      a: imageData.data[i + 3],
    });
  }

  return result;
}

/**
 * Apply Gaussian blur
 */
export function gaussianBlur(imageData: CADImageData, sigma: number = 1.4): CADImageData {
  const width = imageData.width;
  const height = imageData.height;
  const result = createImageData(width, height);
  
  // Create Gaussian kernel
  const kernelSize = Math.ceil(sigma * 3) * 2 + 1;
  const kernel: number[] = [];
  const halfKernel = Math.floor(kernelSize / 2);
  let sum = 0;

  for (let i = 0; i < kernelSize; i++) {
    for (let j = 0; j < kernelSize; j++) {
      const x = i - halfKernel;
      const y = j - halfKernel;
      const value = Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
      kernel.push(value);
      sum += value;
    }
  }

  // Normalize kernel
  for (let i = 0; i < kernel.length; i++) {
    kernel[i] /= sum;
  }

  // Apply convolution (separable for performance)
  const temp = new Float32Array(width * height * 4);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      
      for (let k = -halfKernel; k <= halfKernel; k++) {
        const xx = Math.min(Math.max(x + k, 0), width - 1);
        const idx = (y * width + xx) * 4;
        const weight = kernel[k + halfKernel];
        
        r += imageData.data[idx] * weight;
        g += imageData.data[idx + 1] * weight;
        b += imageData.data[idx + 2] * weight;
        a += imageData.data[idx + 3] * weight;
      }

      const idx = (y * width + x) * 4;
      temp[idx] = r;
      temp[idx + 1] = g;
      temp[idx + 2] = b;
      temp[idx + 3] = a;
    }
  }

  // Vertical pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      
      for (let k = -halfKernel; k <= halfKernel; k++) {
        const yy = Math.min(Math.max(y + k, 0), height - 1);
        const idx = (yy * width + x) * 4;
        const weight = kernel[k + halfKernel];
        
        r += temp[idx] * weight;
        g += temp[idx + 1] * weight;
        b += temp[idx + 2] * weight;
        a += temp[idx + 3] * weight;
      }

      const idx = (y * width + x) * 4;
      result.data[idx] = Math.round(r);
      result.data[idx + 1] = Math.round(g);
      result.data[idx + 2] = Math.round(b);
      result.data[idx + 3] = Math.round(a);
    }
  }

  return result;
}

/**
 * Apply median filter for noise reduction
 */
export function medianFilter(imageData: CADImageData, kernelSize: number = 3): CADImageData {
  const width = imageData.width;
  const height = imageData.height;
  const result = createImageData(width, height);
  const halfKernel = Math.floor(kernelSize / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rValues: number[] = [];
      const gValues: number[] = [];
      const bValues: number[] = [];

      for (let ky = -halfKernel; ky <= halfKernel; ky++) {
        for (let kx = -halfKernel; kx <= halfKernel; kx++) {
          const yy = Math.min(Math.max(y + ky, 0), height - 1);
          const xx = Math.min(Math.max(x + kx, 0), width - 1);
          const idx = (yy * width + xx) * 4;
          
          rValues.push(imageData.data[idx]);
          gValues.push(imageData.data[idx + 1]);
          bValues.push(imageData.data[idx + 2]);
        }
      }

      rValues.sort((a, b) => a - b);
      gValues.sort((a, b) => a - b);
      bValues.sort((a, b) => a - b);

      const mid = Math.floor(rValues.length / 2);
      const idx = (y * width + x) * 4;
      
      result.data[idx] = rValues[mid];
      result.data[idx + 1] = gValues[mid];
      result.data[idx + 2] = bValues[mid];
      result.data[idx + 3] = imageData.data[idx + 3];
    }
  }

  return result;
}

/**
 * Apply threshold to create binary image
 */
export function threshold(imageData: CADImageData, thresholdValue: number = 128): Uint8ClampedArray {
  const result = new Uint8ClampedArray(imageData.width * imageData.height);

  for (let i = 0; i < imageData.data.length; i += 4) {
    const gray = toGrayscale({
      r: imageData.data[i],
      g: imageData.data[i + 1],
      b: imageData.data[i + 2],
      a: imageData.data[i + 3],
    });
    result[i / 4] = gray > thresholdValue ? 255 : 0;
  }

  return result;
}

/**
 * Adaptive threshold using local mean
 */
export function adaptiveThreshold(
  imageData: CADImageData,
  blockSize: number = 11,
  c: number = 2
): Uint8ClampedArray {
  const width = imageData.width;
  const height = imageData.height;
  const result = new Uint8ClampedArray(width * height);
  const halfBlock = Math.floor(blockSize / 2);

  // Compute integral image for efficient mean calculation
  const integral = new Float64Array((width + 1) * (height + 1));
  
  for (let y = 1; y <= height; y++) {
    let rowSum = 0;
    for (let x = 1; x <= width; x++) {
      const idx = ((y - 1) * width + (x - 1)) * 4;
      const gray = toGrayscale({
        r: imageData.data[idx],
        g: imageData.data[idx + 1],
        b: imageData.data[idx + 2],
        a: imageData.data[idx + 3],
      });
      rowSum += gray;
      integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + rowSum;
    }
  }

  // Apply adaptive threshold
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - halfBlock);
      const y1 = Math.max(0, y - halfBlock);
      const x2 = Math.min(width - 1, x + halfBlock);
      const y2 = Math.min(height - 1, y + halfBlock);

      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum = 
        integral[(y2 + 1) * (width + 1) + (x2 + 1)] -
        integral[y1 * (width + 1) + (x2 + 1)] -
        integral[(y2 + 1) * (width + 1) + x1] +
        integral[y1 * (width + 1) + x1];

      const mean = sum / count;
      const idx = (y * width + x) * 4;
      const gray = toGrayscale({
        r: imageData.data[idx],
        g: imageData.data[idx + 1],
        b: imageData.data[idx + 2],
        a: imageData.data[idx + 3],
      });

      result[y * width + x] = gray > mean - c ? 255 : 0;
    }
  }

  return result;
}

// ============================================================================
// Edge Detection
// ============================================================================

/**
 * Sobel edge detection
 */
export function sobelEdgeDetection(imageData: CADImageData): GradientData {
  const width = imageData.width;
  const height = imageData.height;
  const grayData = grayscale(imageData);

  const magnitude = new Float32Array(width * height);
  const direction = new Float32Array(width * height);

  // Sobel kernels
  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0, gy = 0;

      // Apply kernels
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = (y + ky) * width + (x + kx);
          const kernelIdx = (ky + 1) * 3 + (kx + 1);
          
          gx += grayData[idx] * sobelX[kernelIdx];
          gy += grayData[idx] * sobelY[kernelIdx];
        }
      }

      const idx = y * width + x;
      magnitude[idx] = Math.sqrt(gx * gx + gy * gy);
      direction[idx] = Math.atan2(gy, gx);
    }
  }

  return { magnitude, direction, width, height };
}

/**
 * Prewitt edge detection
 */
export function prewittEdgeDetection(imageData: CADImageData): GradientData {
  const width = imageData.width;
  const height = imageData.height;
  const grayData = grayscale(imageData);

  const magnitude = new Float32Array(width * height);
  const direction = new Float32Array(width * height);

  // Prewitt kernels
  const prewittX = [-1, 0, 1, -1, 0, 1, -1, 0, 1];
  const prewittY = [-1, -1, -1, 0, 0, 0, 1, 1, 1];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0, gy = 0;

      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = (y + ky) * width + (x + kx);
          const kernelIdx = (ky + 1) * 3 + (kx + 1);
          
          gx += grayData[idx] * prewittX[kernelIdx];
          gy += grayData[idx] * prewittY[kernelIdx];
        }
      }

      const idx = y * width + x;
      magnitude[idx] = Math.sqrt(gx * gx + gy * gy);
      direction[idx] = Math.atan2(gy, gx);
    }
  }

  return { magnitude, direction, width, height };
}

/**
 * Roberts cross edge detection
 */
export function robertsEdgeDetection(imageData: CADImageData): GradientData {
  const width = imageData.width;
  const height = imageData.height;
  const grayData = grayscale(imageData);

  const magnitude = new Float32Array(width * height);
  const direction = new Float32Array(width * height);

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const idx = y * width + x;
      const idx1 = y * width + (x + 1);
      const idx2 = (y + 1) * width + x;
      const idx3 = (y + 1) * width + (x + 1);

      const gx = grayData[idx] - grayData[idx3];
      const gy = grayData[idx1] - grayData[idx2];

      magnitude[idx] = Math.sqrt(gx * gx + gy * gy);
      direction[idx] = Math.atan2(gy, gx);
    }
  }

  return { magnitude, direction, width, height };
}

/**
 * Laplacian edge detection
 */
export function laplacianEdgeDetection(imageData: CADImageData): GradientData {
  const width = imageData.width;
  const height = imageData.height;
  const grayData = grayscale(imageData);

  const magnitude = new Float32Array(width * height);
  const direction = new Float32Array(width * height);

  // Laplacian kernel
  const laplacian = [0, 1, 0, 1, -4, 1, 0, 1, 0];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let value = 0;

      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = (y + ky) * width + (x + kx);
          const kernelIdx = (ky + 1) * 3 + (kx + 1);
          
          value += grayData[idx] * laplacian[kernelIdx];
        }
      }

      const idx = y * width + x;
      magnitude[idx] = Math.abs(value);
      direction[idx] = 0; // Laplacian doesn't have direction
    }
  }

  return { magnitude, direction, width, height };
}

/**
 * Non-maximum suppression for Canny edge detection
 */
export function nonMaximumSuppression(gradient: GradientData): Float32Array {
  const { magnitude, direction, width, height } = gradient;
  const result = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const angle = direction[idx];
      const mag = magnitude[idx];

      // Quantize angle to 4 directions
      const quantized = ((angle + Math.PI) / (Math.PI / 4)) % 8;
      const dir = Math.floor(quantized + 0.5) % 4;

      let neighbor1 = 0, neighbor2 = 0;

      switch (dir) {
        case 0: // Horizontal
          neighbor1 = magnitude[idx - 1];
          neighbor2 = magnitude[idx + 1];
          break;
        case 1: // Diagonal /
          neighbor1 = magnitude[(y - 1) * width + (x + 1)];
          neighbor2 = magnitude[(y + 1) * width + (x - 1)];
          break;
        case 2: // Vertical
          neighbor1 = magnitude[(y - 1) * width + x];
          neighbor2 = magnitude[(y + 1) * width + x];
          break;
        case 3: // Diagonal \
          neighbor1 = magnitude[(y - 1) * width + (x - 1)];
          neighbor2 = magnitude[(y + 1) * width + (x + 1)];
          break;
      }

      result[idx] = (mag >= neighbor1 && mag >= neighbor2) ? mag : 0;
    }
  }

  return result;
}

/**
 * Double threshold and hysteresis for Canny edge detection
 */
export function doubleThreshold(
  suppressed: Float32Array,
  width: number,
  height: number,
  lowThreshold: number,
  highThreshold: number
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(width * height);
  const STRONG = 255;
  const WEAK = 50;

  // Apply thresholds
  for (let i = 0; i < suppressed.length; i++) {
    if (suppressed[i] >= highThreshold) {
      result[i] = STRONG;
    } else if (suppressed[i] >= lowThreshold) {
      result[i] = WEAK;
    }
  }

  // Hysteresis - connect weak edges to strong edges
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (result[idx] === WEAK) {
          // Check 8-connected neighborhood for strong edge
          let hasStrong = false;
          for (let ky = -1; ky <= 1 && !hasStrong; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              if (result[(y + ky) * width + (x + kx)] === STRONG) {
                hasStrong = true;
                break;
              }
            }
          }
          if (hasStrong) {
            result[idx] = STRONG;
            changed = true;
          }
        }
      }
    }
  }

  // Remove remaining weak edges
  for (let i = 0; i < result.length; i++) {
    if (result[i] === WEAK) {
      result[i] = 0;
    }
  }

  return result;
}

/**
 * Canny edge detection - complete pipeline
 */
export function cannyEdgeDetection(
  imageData: CADImageData,
  lowThreshold: number = 50,
  highThreshold: number = 150,
  sigma: number = 1.4
): Uint8ClampedArray {
  // Step 1: Apply Gaussian blur
  const blurred = gaussianBlur(imageData, sigma);

  // Step 2: Compute gradients
  const gradient = sobelEdgeDetection(blurred);

  // Step 3: Non-maximum suppression
  const suppressed = nonMaximumSuppression(gradient);

  // Step 4: Double threshold and hysteresis
  return doubleThreshold(suppressed, imageData.width, imageData.height, lowThreshold, highThreshold);
}

/**
 * Unified edge detection function
 */
export function detectEdges(
  imageData: CADImageData,
  options: EdgeDetectionOptions
): Uint8ClampedArray {
  const {
    method,
    lowThreshold = 50,
    highThreshold = 150,
    gaussianBlur: sigma = 1.4,
    applyNoiseReduction = true,
  } = options;

  // Apply noise reduction if requested
  let processedImage = applyNoiseReduction ? medianFilter(imageData) : imageData;

  switch (method) {
    case 'canny':
      return cannyEdgeDetection(processedImage, lowThreshold, highThreshold, sigma);
    
    case 'sobel': {
      const gradient = sobelEdgeDetection(processedImage);
      const result = new Uint8ClampedArray(gradient.magnitude.length);
      const maxMag = Math.max(...gradient.magnitude);
      const scale = 255 / maxMag;
      for (let i = 0; i < result.length; i++) {
        result[i] = Math.min(255, Math.round(gradient.magnitude[i] * scale));
      }
      return result;
    }
    
    case 'prewitt': {
      const gradient = prewittEdgeDetection(processedImage);
      const result = new Uint8ClampedArray(gradient.magnitude.length);
      const maxMag = Math.max(...gradient.magnitude);
      const scale = 255 / maxMag;
      for (let i = 0; i < result.length; i++) {
        result[i] = Math.min(255, Math.round(gradient.magnitude[i] * scale));
      }
      return result;
    }
    
    case 'roberts': {
      const gradient = robertsEdgeDetection(processedImage);
      const result = new Uint8ClampedArray(gradient.magnitude.length);
      const maxMag = Math.max(...gradient.magnitude);
      const scale = 255 / maxMag;
      for (let i = 0; i < result.length; i++) {
        result[i] = Math.min(255, Math.round(gradient.magnitude[i] * scale));
      }
      return result;
    }
    
    case 'laplacian': {
      const gradient = laplacianEdgeDetection(processedImage);
      const result = new Uint8ClampedArray(gradient.magnitude.length);
      const maxMag = Math.max(...gradient.magnitude);
      const scale = 255 / maxMag;
      for (let i = 0; i < result.length; i++) {
        result[i] = Math.min(255, Math.round(gradient.magnitude[i] * scale));
      }
      return result;
    }
    
    default:
      throw new Error(`Unknown edge detection method: ${method}`);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Invert image colors
 */
export function invertImage(imageData: CADImageData): CADImageData {
  const result = createImageData(imageData.width, imageData.height);

  for (let i = 0; i < imageData.data.length; i += 4) {
    result.data[i] = 255 - imageData.data[i];
    result.data[i + 1] = 255 - imageData.data[i + 1];
    result.data[i + 2] = 255 - imageData.data[i + 2];
    result.data[i + 3] = imageData.data[i + 3];
  }

  return result;
}

/**
 * Dilate binary image
 */
export function dilate(binary: Uint8ClampedArray, width: number, height: number, iterations: number = 1): Uint8ClampedArray {
  let result = new Uint8ClampedArray(binary);

  for (let iter = 0; iter < iterations; iter++) {
    const temp = new Uint8ClampedArray(result);

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        
        if (result[idx] > 0) continue;

        // Check 8-connected neighborhood
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            if (result[(y + ky) * width + (x + kx)] > 0) {
              temp[idx] = 255;
              break;
            }
          }
        }
      }
    }

    result = temp;
  }

  return result;
}

/**
 * Erode binary image
 */
export function erode(binary: Uint8ClampedArray, width: number, height: number, iterations: number = 1): Uint8ClampedArray {
  let result = new Uint8ClampedArray(binary);

  for (let iter = 0; iter < iterations; iter++) {
    const temp = new Uint8ClampedArray(result);

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        
        if (result[idx] === 0) continue;

        // Check 8-connected neighborhood
        let hasZero = false;
        for (let ky = -1; ky <= 1 && !hasZero; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            if (result[(y + ky) * width + (x + kx)] === 0) {
              hasZero = true;
              break;
            }
          }
        }

        if (hasZero) {
          temp[idx] = 0;
        }
      }
    }

    result = temp;
  }

  return result;
}

/**
 * Morphological closing (dilation followed by erosion)
 */
export function morphClose(binary: Uint8ClampedArray, width: number, height: number, iterations: number = 1): Uint8ClampedArray {
  return erode(dilate(binary, width, height, iterations), width, height, iterations);
}

/**
 * Morphological opening (erosion followed by dilation)
 */
export function morphOpen(binary: Uint8ClampedArray, width: number, height: number, iterations: number = 1): Uint8ClampedArray {
  return dilate(erode(binary, width, height, iterations), width, height, iterations);
}

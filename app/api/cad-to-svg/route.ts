import { NextRequest, NextResponse } from 'next/server';

// Allow large request bodies for image data
export const runtime = 'nodejs';
export const maxDuration = 60;

// Types
interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Point {
  x: number;
  y: number;
}

interface ConversionOptions {
  edgeDetection?: {
    method: string;
    lowThreshold?: number;
    highThreshold?: number;
    gaussianBlur?: number;
  };
  contourDetection?: {
    method: string;
    minArea?: number;
    simplify?: boolean;
    tolerance?: number;
  };
  svg?: {
    strokeWidth?: number;
    precision?: number;
  };
  smoothCurves?: boolean;
  detectLayers?: boolean;
  invertColors?: boolean;
}

// ============================================================================
// Image Processing Functions
// ============================================================================

function createImageData(data: number[], width: number, height: number) {
  return {
    width,
    height,
    data: new Uint8ClampedArray(data),
  };
}

function toGrayscale(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

// Gaussian blur
function gaussianBlur(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sigma: number
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length);
  const kernelSize = Math.ceil(sigma * 3) * 2 + 1;
  const halfKernel = Math.floor(kernelSize / 2);
  const kernel: number[] = [];
  let sum = 0;

  // Build a 1D Gaussian kernel for separable convolution
  for (let i = 0; i < kernelSize; i++) {
    const x = i - halfKernel;
    const value = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel.push(value);
    sum += value;
  }

  for (let i = 0; i < kernel.length; i++) {
    kernel[i] /= sum;
  }

  const temp = new Float32Array(width * height * 4);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -halfKernel; k <= halfKernel; k++) {
        const xx = Math.min(Math.max(x + k, 0), width - 1);
        const idx = (y * width + xx) * 4;
        const weight = kernel[k + halfKernel];
        r += data[idx] * weight;
        g += data[idx + 1] * weight;
        b += data[idx + 2] * weight;
        a += data[idx + 3] * weight;
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
      result[idx] = Math.round(r);
      result[idx + 1] = Math.round(g);
      result[idx + 2] = Math.round(b);
      result[idx + 3] = Math.round(a);
    }
  }

  return result;
}

// Sobel edge detection
function sobelEdgeDetection(
  data: Uint8ClampedArray,
  width: number,
  height: number
): { magnitude: Float32Array; direction: Float32Array } {
  const grayData = new Uint8ClampedArray(width * height);

  for (let i = 0; i < data.length; i += 4) {
    grayData[i / 4] = toGrayscale(data[i], data[i + 1], data[i + 2]);
  }

  const magnitude = new Float32Array(width * height);
  const direction = new Float32Array(width * height);

  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0, gy = 0;
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

  return { magnitude, direction };
}

// Non-maximum suppression
function nonMaximumSuppression(
  magnitude: Float32Array,
  direction: Float32Array,
  width: number,
  height: number
): Float32Array {
  const result = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const angle = direction[idx];
      const mag = magnitude[idx];
      const quantized = ((angle + Math.PI) / (Math.PI / 4)) % 8;
      const dir = Math.floor(quantized + 0.5) % 4;

      let neighbor1 = 0, neighbor2 = 0;
      switch (dir) {
        case 0:
          neighbor1 = magnitude[idx - 1];
          neighbor2 = magnitude[idx + 1];
          break;
        case 1:
          neighbor1 = magnitude[(y - 1) * width + (x + 1)];
          neighbor2 = magnitude[(y + 1) * width + (x - 1)];
          break;
        case 2:
          neighbor1 = magnitude[(y - 1) * width + x];
          neighbor2 = magnitude[(y + 1) * width + x];
          break;
        case 3:
          neighbor1 = magnitude[(y - 1) * width + (x - 1)];
          neighbor2 = magnitude[(y + 1) * width + (x + 1)];
          break;
      }

      result[idx] = mag >= neighbor1 && mag >= neighbor2 ? mag : 0;
    }
  }

  return result;
}

// Double threshold and hysteresis
function doubleThreshold(
  suppressed: Float32Array,
  width: number,
  height: number,
  lowThreshold: number,
  highThreshold: number
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(width * height);
  const STRONG = 255;
  const WEAK = 50;

  for (let i = 0; i < suppressed.length; i++) {
    if (suppressed[i] >= highThreshold) {
      result[i] = STRONG;
    } else if (suppressed[i] >= lowThreshold) {
      result[i] = WEAK;
    }
  }

  // Hysteresis
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (result[idx] === WEAK) {
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

  for (let i = 0; i < result.length; i++) {
    if (result[i] === WEAK) result[i] = 0;
  }

  return result;
}

// Canny edge detection
function cannyEdgeDetection(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  lowThreshold: number,
  highThreshold: number,
  sigma: number
): Uint8ClampedArray {
  const blurred = gaussianBlur(data, width, height, sigma);
  const { magnitude, direction } = sobelEdgeDetection(blurred, width, height);
  const suppressed = nonMaximumSuppression(magnitude, direction, width, height);
  return doubleThreshold(suppressed, width, height, lowThreshold, highThreshold);
}

// ============================================================================
// Skeletonization (Centerline Tracing)
// ============================================================================

function binarize(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number = 128
): Uint8ClampedArray {
  const binary = new Uint8ClampedArray(width * height);
  for (let i = 0; i < data.length; i += 4) {
    // Invert: assume input is dark lines on light background
    // We want lines to be white (1) and background black (0) for thinning
    const gray = toGrayscale(data[i], data[i + 1], data[i + 2]);
    binary[i / 4] = gray < threshold ? 1 : 0;
  }
  return binary;
}

function zhangSuenThinning(
  binary: Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray {
  const skeleton = new Uint8ClampedArray(binary);
  let changed = true;

  const getPixel = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return 0;
    return skeleton[y * width + x];
  };

  const setPixel = (x: number, y: number, val: number) => {
    skeleton[y * width + x] = val;
  };

  while (changed) {
    changed = false;
    const pixelsToRemove: number[] = [];

    // Step 1
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const p1 = getPixel(x, y);
        if (p1 === 0) continue;

        const p2 = getPixel(x, y - 1);
        const p3 = getPixel(x + 1, y - 1);
        const p4 = getPixel(x + 1, y);
        const p5 = getPixel(x + 1, y + 1);
        const p6 = getPixel(x, y + 1);
        const p7 = getPixel(x - 1, y + 1);
        const p8 = getPixel(x - 1, y);
        const p9 = getPixel(x - 1, y - 1);

        const A = (p2 === 0 && p3 === 1 ? 1 : 0) +
          (p3 === 0 && p4 === 1 ? 1 : 0) +
          (p4 === 0 && p5 === 1 ? 1 : 0) +
          (p5 === 0 && p6 === 1 ? 1 : 0) +
          (p6 === 0 && p7 === 1 ? 1 : 0) +
          (p7 === 0 && p8 === 1 ? 1 : 0) +
          (p8 === 0 && p9 === 1 ? 1 : 0) +
          (p9 === 0 && p2 === 1 ? 1 : 0);

        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;

        const m1 = p2 * p4 * p6;
        const m2 = p4 * p6 * p8;

        if (A === 1 && (B >= 2 && B <= 6) && m1 === 0 && m2 === 0) {
          pixelsToRemove.push(y * width + x);
        }
      }
    }

    if (pixelsToRemove.length > 0) {
      for (const idx of pixelsToRemove) skeleton[idx] = 0;
      changed = true;
      pixelsToRemove.length = 0;
    }

    // Step 2
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const p1 = getPixel(x, y);
        if (p1 === 0) continue;

        const p2 = getPixel(x, y - 1);
        const p3 = getPixel(x + 1, y - 1);
        const p4 = getPixel(x + 1, y);
        const p5 = getPixel(x + 1, y + 1);
        const p6 = getPixel(x, y + 1);
        const p7 = getPixel(x - 1, y + 1);
        const p8 = getPixel(x - 1, y);
        const p9 = getPixel(x - 1, y - 1);

        const A = (p2 === 0 && p3 === 1 ? 1 : 0) +
          (p3 === 0 && p4 === 1 ? 1 : 0) +
          (p4 === 0 && p5 === 1 ? 1 : 0) +
          (p5 === 0 && p6 === 1 ? 1 : 0) +
          (p6 === 0 && p7 === 1 ? 1 : 0) +
          (p7 === 0 && p8 === 1 ? 1 : 0) +
          (p8 === 0 && p9 === 1 ? 1 : 0) +
          (p9 === 0 && p2 === 1 ? 1 : 0);

        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;

        const m1 = p2 * p4 * p8;
        const m2 = p2 * p6 * p8;

        if (A === 1 && (B >= 2 && B <= 6) && m1 === 0 && m2 === 0) {
          pixelsToRemove.push(y * width + x);
        }
      }
    }

    if (pixelsToRemove.length > 0) {
      for (const idx of pixelsToRemove) skeleton[idx] = 0;
      changed = true;
    }
  }

  // Convert binary 1/0 back to 255/0 for consistency with other functions
  for (let i = 0; i < skeleton.length; i++) {
    skeleton[i] = skeleton[i] * 255;
  }
  return skeleton;
}

// ============================================================================
// Contour Detection - Edge Chain Tracing (single-line output)
// ============================================================================

// Trace a chain of connected edge pixels (walks ALONG the edge, not around it)
// This produces a single polyline per edge chain instead of a double-outline loop.
function traceEdgeChain(
  binary: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  visited: Uint8ClampedArray
): Point[] {
  const points: Point[] = [];
  // 8-connectivity directions
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];

  let x = startX;
  let y = startY;

  while (true) {
    points.push({ x, y });
    visited[y * width + x] = 1;

    // Find next unvisited connected edge pixel
    let found = false;
    for (let i = 0; i < 8; i++) {
      const nx = x + dx[i];
      const ny = y + dy[i];
      if (
        nx >= 0 && nx < width && ny >= 0 && ny < height &&
        binary[ny * width + nx] > 0 &&
        !visited[ny * width + nx]
      ) {
        x = nx;
        y = ny;
        found = true;
        break;
      }
    }

    if (!found) break;
    if (points.length > width * height) break; // safety limit
  }

  return points;
}

// Count how many 8-connected edge neighbors a pixel has
function countEdgeNeighbors(
  binary: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];
  let count = 0;
  for (let i = 0; i < 8; i++) {
    const nx = x + dx[i];
    const ny = y + dy[i];
    if (nx >= 0 && nx < width && ny >= 0 && ny < height && binary[ny * width + nx] > 0) {
      count++;
    }
  }
  return count;
}

function detectContours(
  binary: Uint8ClampedArray,
  width: number,
  height: number
): Point[][] {
  const contours: Point[][] = [];
  const visited = new Uint8ClampedArray(width * height);

  // First pass: start tracing from chain endpoints (pixels with exactly 1 neighbor)
  // This ensures we trace from one end to the other for open chains
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (binary[idx] === 0 || visited[idx]) continue;

      const neighbors = countEdgeNeighbors(binary, width, height, x, y);
      if (neighbors === 1) {
        const chain = traceEdgeChain(binary, width, height, x, y, visited);
        if (chain.length >= 3) {
          contours.push(chain);
        }
      }
    }
  }

  // Second pass: pick up any remaining closed loops
  // (every pixel in a closed loop has 2 neighbors, so no endpoints exist)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (binary[idx] === 0 || visited[idx]) continue;

      const chain = traceEdgeChain(binary, width, height, x, y, visited);
      if (chain.length >= 3) {
        contours.push(chain);
      }
    }
  }

  return contours;
}

// ============================================================================
// Path Simplification (Douglas-Peucker)
// ============================================================================

function perpendicularDistance(
  point: Point,
  lineStart: Point,
  lineEnd: Point
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lineLengthSq = dx * dx + dy * dy;

  if (lineLengthSq === 0) {
    return Math.sqrt(
      Math.pow(point.x - lineStart.x, 2) + Math.pow(point.y - lineStart.y, 2)
    );
  }

  const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lineLengthSq;
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;

  let distX: number, distY: number;
  if (t < 0) {
    distX = point.x - lineStart.x;
    distY = point.y - lineStart.y;
  } else if (t > 1) {
    distX = point.x - lineEnd.x;
    distY = point.y - lineEnd.y;
  } else {
    distX = point.x - projX;
    distY = point.y - projY;
  }

  return Math.sqrt(distX * distX + distY * distY);
}

function douglasPeucker(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return [...points];

  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  function simplify(startIndex: number, endIndex: number) {
    if (endIndex <= startIndex + 1) return;

    let maxDist = 0;
    let maxIndex = startIndex;

    const lineStart = points[startIndex];
    const lineEnd = points[endIndex];

    for (let i = startIndex + 1; i < endIndex; i++) {
      const dist = perpendicularDistance(points[i], lineStart, lineEnd);
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }

    if (maxDist > tolerance) {
      keep[maxIndex] = true;
      simplify(startIndex, maxIndex);
      simplify(maxIndex, endIndex);
    }
  }

  simplify(0, points.length - 1);
  return points.filter((_, i) => keep[i]);
}

// ============================================================================
// SVG Generation
// ============================================================================

function pointsToPathString(points: Point[], closed: boolean, precision: number): string {
  if (points.length === 0) return '';
  const round = (n: number) => n.toFixed(precision);

  let d = `M${round(points[0].x)},${round(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L${round(points[i].x)},${round(points[i].y)}`;
  }
  if (closed) d += ' Z';

  return d;
}

function colorToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function generateSVG(
  contours: Point[][],
  width: number,
  height: number,
  strokeWidth: number,
  precision: number
): string {
  let paths = '';

  for (let i = 0; i < contours.length; i++) {
    const points = contours[i];
    const d = pointsToPathString(points, true, precision);
    paths += `<path d="${d}" stroke="#000000" stroke-width="${strokeWidth}" fill="none"/>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${paths}</svg>`;
}

// ============================================================================
// Color Analysis
// ============================================================================

function detectBackgroundColor(data: Uint8ClampedArray, width: number, height: number): Color {
  const edgeColors: Color[] = [];

  for (let x = 0; x < width; x++) {
    edgeColors.push({
      r: data[x * 4],
      g: data[x * 4 + 1],
      b: data[x * 4 + 2],
      a: data[x * 4 + 3],
    });
    edgeColors.push({
      r: data[((height - 1) * width + x) * 4],
      g: data[((height - 1) * width + x) * 4 + 1],
      b: data[((height - 1) * width + x) * 4 + 2],
      a: data[((height - 1) * width + x) * 4 + 3],
    });
  }

  for (let y = 0; y < height; y++) {
    edgeColors.push({
      r: data[y * width * 4],
      g: data[y * width * 4 + 1],
      b: data[y * width * 4 + 2],
      a: data[y * width * 4 + 3],
    });
    edgeColors.push({
      r: data[(y * width + width - 1) * 4],
      g: data[(y * width + width - 1) * 4 + 1],
      b: data[(y * width + width - 1) * 4 + 2],
      a: data[(y * width + width - 1) * 4 + 3],
    });
  }

  const colorMap = new Map<string, { color: Color; count: number }>();

  for (const color of edgeColors) {
    if (color.a < 128) continue;
    const key = `${Math.round(color.r / 16)},${Math.round(color.g / 16)},${Math.round(color.b / 16)}`;
    const existing = colorMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      colorMap.set(key, { color, count: 1 });
    }
  }

  let maxCount = 0;
  let backgroundColor: Color = { r: 255, g: 255, b: 255, a: 255 };

  for (const { color, count } of colorMap.values()) {
    if (count > maxCount) {
      maxCount = count;
      backgroundColor = color;
    }
  }

  return backgroundColor;
}

function extractLineColors(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  backgroundColor: Color
): Color[] {
  const colorMap = new Map<string, { r: number; g: number; b: number; count: number }>();
  const totalPixels = width * height;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a < 128) continue;

    // Skip background colors
    const bgDist = Math.sqrt(
      Math.pow(r - backgroundColor.r, 2) +
      Math.pow(g - backgroundColor.g, 2) +
      Math.pow(b - backgroundColor.b, 2)
    );
    if (bgDist < 30) continue;

    // Skip white/near-white
    if (r > 240 && g > 240 && b > 240) continue;

    const key = `${Math.round(r / 8) * 8},${Math.round(g / 8) * 8},${Math.round(b / 8) * 8}`;
    const existing = colorMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      colorMap.set(key, { r: Math.round(r / 8) * 8, g: Math.round(g / 8) * 8, b: Math.round(b / 8) * 8, count: 1 });
    }
  }

  const colors = Array.from(colorMap.values())
    .filter(c => c.count > totalPixels * 0.001)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map(c => ({ r: c.r, g: c.g, b: c.b, a: 255 }));

  return colors.length > 0 ? colors : [{ r: 0, g: 0, b: 0, a: 255 }];
}

function sampleColorAlongPath(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  points: Point[]
): Color {
  const step = Math.max(1, Math.floor(points.length / 10));
  let r = 0, g = 0, b = 0, count = 0;

  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);

    if (x >= 0 && x < width && y >= 0 && y < height) {
      const idx = (y * width + x) * 4;
      r += data[idx];
      g += data[idx + 1];
      b += data[idx + 2];
      count++;
    }
  }

  if (count === 0) return { r: 0, g: 0, b: 0, a: 255 };

  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
    a: 255,
  };
}

function findNearestColor(color: Color, palette: Color[]): Color {
  let minDist = Infinity;
  let nearest = palette[0];

  for (const paletteColor of palette) {
    const dist = Math.sqrt(
      Math.pow(color.r - paletteColor.r, 2) +
      Math.pow(color.g - paletteColor.g, 2) +
      Math.pow(color.b - paletteColor.b, 2)
    );
    if (dist < minDist) {
      minDist = dist;
      nearest = paletteColor;
    }
  }

  return nearest;
}

// ============================================================================
// Main Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageData: imageDataArray, width, height, options = {} } = body as {
      imageData: number[];
      width: number;
      height: number;
      options: ConversionOptions;
    };

    const opts: ConversionOptions = {
      edgeDetection: {
        method: 'skeleton', // Default to skeleton for better single-line output
        lowThreshold: 50,
        highThreshold: 150,
        gaussianBlur: 1.4,
        ...options.edgeDetection,
      },
      contourDetection: {
        method: 'suzuki',
        minArea: 10,
        simplify: true,
        tolerance: 1,
        ...options.contourDetection,
      },
      svg: {
        strokeWidth: 1,
        precision: 3,
        ...options.svg,
      },
      smoothCurves: options.smoothCurves || false,
      detectLayers: options.detectLayers ?? true,
      invertColors: options.invertColors || false,
    };

    // Convert array back to Uint8ClampedArray
    const data = new Uint8ClampedArray(imageDataArray);

    // Invert colors if requested
    if (opts.invertColors) {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i];
        data[i + 1] = 255 - data[i + 1];
        data[i + 2] = 255 - data[i + 2];
      }
    }

    // Detect background and line colors
    const backgroundColor = detectBackgroundColor(data, width, height);
    const lineColors = extractLineColors(data, width, height, backgroundColor);

    // Edge extraction or Skeletonization
    let edges: Uint8ClampedArray;

    // Check method - default to skeleton if not specified
    const method = opts.edgeDetection!.method || 'skeleton';

    if (method === 'skeleton') {
      // 1. Binarize (Thresholding)
      // Invert logic: lines are dark, background is light -> lines become 1, background 0
      const binary = binarize(data, width, height, 128);

      // 2. Skeletonize (Zhang-Suen Thinning)
      edges = zhangSuenThinning(binary, width, height);

    } else {
      // 1. Canny Edge Detection (fallback)
      edges = cannyEdgeDetection(
        data,
        width,
        height,
        opts.edgeDetection!.lowThreshold!,
        opts.edgeDetection!.highThreshold!,
        opts.edgeDetection!.gaussianBlur!
      );
    }

    // Contour detection via edge chain tracing (produces single-line paths)
    let contours = detectContours(edges, width, height);

    // Filter by minimum point count (perimeter-based for edge chains)
    const minArea = opts.contourDetection!.minArea!;
    contours = contours.filter(points => points.length >= Math.max(minArea, 4));

    // Simplify paths
    const tolerance = opts.contourDetection!.tolerance!;
    contours = contours.map(points => douglasPeucker(points, tolerance));

    // Assign colors to contours
    const colorGroups = new Map<string, { color: Color; count: number }>();

    const coloredContours = contours.map(points => {
      const sampledColor = sampleColorAlongPath(data, width, height, points);
      const assignedColor = findNearestColor(sampledColor, lineColors);

      const key = `${assignedColor.r}-${assignedColor.g}-${assignedColor.b}`;
      const existing = colorGroups.get(key);
      if (existing) {
        existing.count++;
      } else {
        colorGroups.set(key, { color: assignedColor, count: 1 });
      }

      return { points, color: assignedColor };
    });

    // Generate SVG
    const strokeWidth = opts.svg!.strokeWidth!;
    const precision = opts.svg!.precision!;

    let paths = '';
    for (let i = 0; i < coloredContours.length; i++) {
      const { points, color } = coloredContours[i];
      const d = pointsToPathString(points, false, precision);
      const hexColor = colorToHex(color.r, color.g, color.b);
      paths += `<path d="${d}" stroke="${hexColor}" stroke-width="${strokeWidth}" fill="none"/>\n`;
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${paths}</svg>`;

    // Prepare color groups for response
    const colorGroupsArray = Array.from(colorGroups.values()).map(g => ({
      color: g.color,
      count: g.count,
      percentage: (g.count / contours.length) * 100,
    }));

    return NextResponse.json({
      svg,
      width,
      height,
      pathCount: contours.length,
      layerCount: colorGroups.size,
      conversionTime: 0,
      colorGroups: colorGroupsArray,
    });

  } catch (error) {
    console.error('CAD to SVG conversion error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Conversion failed' },
      { status: 500 }
    );
  }
}

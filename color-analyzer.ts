/**
 * CAD to SVG Converter - Color Analysis Module
 * Handles color extraction, quantization, and grouping
 */

import {
  Color,
  ColorGroup,
  ColorExtractionOptions,
  ImageData as CADImageData,
  PathData,
} from './types';
import {
  getPixel,
  colorDistance,
  isColorSimilar,
} from './image-processor';

// ============================================================================
// Color Extraction
// ============================================================================

/**
 * Extract unique colors from image
 */
export function extractColors(
  imageData: CADImageData,
  options: ColorExtractionOptions = {}
): ColorGroup[] {
  const {
    maxColors = 256,
    minPercentage = 0.01,
    quantize = true,
    ignoreBackground = true,
    backgroundColor,
  } = options;

  const colorMap = new Map<string, { color: Color; count: number }>();
  const totalPixels = imageData.width * imageData.height;

  // Collect colors
  for (let y = 0; y < imageData.height; y++) {
    for (let x = 0; x < imageData.width; x++) {
      let color = getPixel(imageData, x, y);

      // Skip transparent pixels
      if (color.a < 128) continue;

      // Quantize if requested
      if (quantize) {
        color = quantizeColor(color);
      }

      // Skip background if requested
      if (ignoreBackground) {
        if (backgroundColor && isColorSimilar(color, backgroundColor, 30)) continue;
        // Skip white/near-white backgrounds
        if (color.r > 240 && color.g > 240 && color.b > 240) continue;
      }

      const key = colorToKey(color);
      const existing = colorMap.get(key);

      if (existing) {
        existing.count++;
      } else {
        colorMap.set(key, { color, count: 1 });
      }
    }
  }

  // Convert to array and calculate percentages
  let colors = Array.from(colorMap.values()).map(item => ({
    color: item.color,
    count: item.count,
    percentage: (item.count / totalPixels) * 100,
    paths: [],
  }));

  // Filter by minimum percentage
  colors = colors.filter(c => c.percentage >= minPercentage);

  // Sort by count (most common first)
  colors.sort((a, b) => b.count - a.count);

  // Limit to max colors
  if (colors.length > maxColors) {
    colors = colors.slice(0, maxColors);
  }

  return colors;
}

/**
 * Convert color to map key
 */
function colorToKey(color: Color): string {
  return `${color.r},${color.g},${color.b}`;
}

/**
 * Quantize color to reduce color depth
 */
export function quantizeColor(color: Color, levels: number = 32): Color {
  const step = 256 / levels;
  return {
    r: Math.round(color.r / step) * step,
    g: Math.round(color.g / step) * step,
    b: Math.round(color.b / step) * step,
    a: color.a,
  };
}

// ============================================================================
// Color Quantization (Median Cut)
// ============================================================================

interface ColorBox {
  colors: Color[];
  rMin: number;
  rMax: number;
  gMin: number;
  gMax: number;
  bMin: number;
  bMax: number;
}

/**
 * Median cut color quantization
 */
export function medianCutQuantize(
  imageData: CADImageData,
  maxColors: number = 16
): Color[] {
  // Collect all colors
  const colors: Color[] = [];

  for (let y = 0; y < imageData.height; y++) {
    for (let x = 0; x < imageData.width; x++) {
      const color = getPixel(imageData, x, y);
      if (color.a >= 128) {
        colors.push(color);
      }
    }
  }

  if (colors.length === 0) return [];

  // Initial box containing all colors
  const initialBox = createColorBox(colors);

  // Recursively split boxes
  let boxes: ColorBox[] = [initialBox];

  while (boxes.length < maxColors) {
    // Find box with largest range
    let maxRange = -1;
    let maxBoxIndex = -1;

    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      const range = Math.max(
        box.rMax - box.rMin,
        box.gMax - box.gMin,
        box.bMax - box.bMin
      );

      if (range > maxRange) {
        maxRange = range;
        maxBoxIndex = i;
      }
    }

    if (maxBoxIndex < 0 || maxRange === 0) break;

    // Split the box
    const box = boxes[maxBoxIndex];
    const [box1, box2] = splitColorBox(box);

    boxes.splice(maxBoxIndex, 1, box1, box2);
  }

  // Calculate average color for each box
  return boxes.map(box => averageColor(box.colors));
}

function createColorBox(colors: Color[]): ColorBox {
  let rMin = 255, rMax = 0;
  let gMin = 255, gMax = 0;
  let bMin = 255, bMax = 0;

  for (const color of colors) {
    rMin = Math.min(rMin, color.r);
    rMax = Math.max(rMax, color.r);
    gMin = Math.min(gMin, color.g);
    gMax = Math.max(gMax, color.g);
    bMin = Math.min(bMin, color.b);
    bMax = Math.max(bMax, color.b);
  }

  return { colors, rMin, rMax, gMin, gMax, bMin, bMax };
}

function splitColorBox(box: ColorBox): [ColorBox, ColorBox] {
  const { colors, rMin, rMax, gMin, gMax, bMin, bMax } = box;

  // Determine which channel has the largest range
  const rRange = rMax - rMin;
  const gRange = gMax - gMin;
  const bRange = bMax - bMin;

  let sortKey: keyof Color;
  if (rRange >= gRange && rRange >= bRange) {
    sortKey = 'r';
  } else if (gRange >= bRange) {
    sortKey = 'g';
  } else {
    sortKey = 'b';
  }

  // Sort colors by the selected channel
  const sorted = [...colors].sort((a, b) => a[sortKey] - b[sortKey]);

  // Split at median
  const mid = Math.floor(sorted.length / 2);

  return [
    createColorBox(sorted.slice(0, mid)),
    createColorBox(sorted.slice(mid)),
  ];
}

function averageColor(colors: Color[]): Color {
  let r = 0, g = 0, b = 0, a = 0;

  for (const color of colors) {
    r += color.r;
    g += color.g;
    b += color.b;
    a += color.a;
  }

  const n = colors.length;
  return {
    r: Math.round(r / n),
    g: Math.round(g / n),
    b: Math.round(b / n),
    a: Math.round(a / n),
  };
}

// ============================================================================
// Dominant Color Extraction
// ============================================================================

/**
 * Extract dominant colors using k-means clustering
 */
export function extractDominantColors(
  imageData: CADImageData,
  k: number = 5
): Color[] {
  // Collect unique colors
  const colorMap = new Map<string, { color: Color; count: number }>();

  for (let y = 0; y < imageData.height; y++) {
    for (let x = 0; x < imageData.width; x++) {
      const color = getPixel(imageData, x, y);
      if (color.a < 128) continue;

      // Quantize for faster processing
      const qColor = quantizeColor(color, 64);
      const key = colorToKey(qColor);

      const existing = colorMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        colorMap.set(key, { color: qColor, count: 1 });
      }
    }
  }

  // Get top colors by frequency
  const sortedColors = Array.from(colorMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.min(k * 10, colorMap.size))
    .map(item => item.color);

  // Run k-means clustering
  return kMeansClustering(sortedColors, k);
}

/**
 * K-means clustering for colors
 */
function kMeansClustering(colors: Color[], k: number, maxIterations: number = 20): Color[] {
  if (colors.length <= k) return colors;

  // Initialize centroids using k-means++
  const centroids = initializeCentroids(colors, k);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign colors to nearest centroid
    const clusters: Color[][] = Array.from({ length: k }, () => []);

    for (const color of colors) {
      let minDist = Infinity;
      let minIndex = 0;

      for (let i = 0; i < centroids.length; i++) {
        const dist = colorDistance(color, centroids[i]);
        if (dist < minDist) {
          minDist = dist;
          minIndex = i;
        }
      }

      clusters[minIndex].push(color);
    }

    // Update centroids
    let converged = true;

    for (let i = 0; i < k; i++) {
      if (clusters[i].length === 0) continue;

      const newCentroid = averageColor(clusters[i]);
      if (colorDistance(newCentroid, centroids[i]) > 1) {
        converged = false;
      }
      centroids[i] = newCentroid;
    }

    if (converged) break;
  }

  return centroids;
}

/**
 * Initialize centroids using k-means++ algorithm
 */
function initializeCentroids(colors: Color[], k: number): Color[] {
  const centroids: Color[] = [];

  // First centroid: random
  centroids.push(colors[Math.floor(Math.random() * colors.length)]);

  // Remaining centroids: proportional to squared distance
  while (centroids.length < k) {
    const distances: number[] = [];

    for (const color of colors) {
      let minDist = Infinity;
      for (const centroid of centroids) {
        minDist = Math.min(minDist, colorDistance(color, centroid));
      }
      distances.push(minDist * minDist);
    }

    // Weighted random selection
    const totalDist = distances.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalDist;

    for (let i = 0; i < colors.length; i++) {
      random -= distances[i];
      if (random <= 0) {
        centroids.push(colors[i]);
        break;
      }
    }
  }

  return centroids;
}

// ============================================================================
// Color Matching and Grouping
// ============================================================================

/**
 * Find nearest color from palette
 */
export function findNearestColor(color: Color, palette: Color[]): Color {
  let minDist = Infinity;
  let nearest = palette[0];

  for (const paletteColor of palette) {
    const dist = colorDistance(color, paletteColor);
    if (dist < minDist) {
      minDist = dist;
      nearest = paletteColor;
    }
  }

  return nearest;
}

/**
 * Group paths by similar colors
 */
export function groupPathsBySimilarColor(
  paths: PathData[],
  threshold: number = 30
): Map<Color, PathData[]> {
  const groups = new Map<Color, PathData[]>();

  for (const path of paths) {
    let foundGroup: Color | null = null;

    // Find existing similar color group
    for (const groupColor of groups.keys()) {
      if (colorDistance(path.color, groupColor) <= threshold) {
        foundGroup = groupColor;
        break;
      }
    }

    if (foundGroup) {
      groups.get(foundGroup)!.push(path);
    } else {
      groups.set(path.color, [path]);
    }
  }

  return groups;
}

// ============================================================================
// Background Detection
// ============================================================================

/**
 * Detect background color (most common color at edges)
 */
export function detectBackgroundColor(imageData: CADImageData): Color {
  const edgeColors: Color[] = [];
  const { width, height } = imageData;

  // Sample colors from edges
  for (let x = 0; x < width; x++) {
    edgeColors.push(getPixel(imageData, x, 0));
    edgeColors.push(getPixel(imageData, x, height - 1));
  }

  for (let y = 0; y < height; y++) {
    edgeColors.push(getPixel(imageData, 0, y));
    edgeColors.push(getPixel(imageData, width - 1, y));
  }

  // Find most common edge color
  const colorMap = new Map<string, { color: Color; count: number }>();

  for (const color of edgeColors) {
    if (color.a < 128) continue;

    const key = colorToKey(quantizeColor(color, 16));
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

/**
 * Check if image has transparent background
 */
export function hasTransparentBackground(imageData: CADImageData): boolean {
  const { width, height } = imageData;

  // Check edge pixels for transparency
  for (let x = 0; x < width; x++) {
    if (getPixel(imageData, x, 0).a < 128) return true;
    if (getPixel(imageData, x, height - 1).a < 128) return true;
  }

  for (let y = 0; y < height; y++) {
    if (getPixel(imageData, 0, y).a < 128) return true;
    if (getPixel(imageData, width - 1, y).a < 128) return true;
  }

  return false;
}

// ============================================================================
// Line Color Detection (CAD-specific)
// ============================================================================

/**
 * Detect primary line colors in CAD drawing
 * CAD drawings typically use black, blue, or colored lines
 */
export function detectCADLineColors(imageData: CADImageData): Color[] {
  const backgroundColor = detectBackgroundColor(imageData);
  const allColors = extractColors(imageData, {
    maxColors: 64,
    minPercentage: 0.1,
    ignoreBackground: true,
    backgroundColor,
  });

  // Filter for likely line colors (darker colors, higher saturation)
  const lineColors = allColors.filter(({ color, percentage }) => {
    const brightness = (color.r + color.g + color.b) / 3;
    const saturation = getSaturation(color);

    // Lines are typically darker and more saturated
    return brightness < 200 && (saturation > 20 || brightness < 100);
  });

  // If no line colors found, return dark colors
  if (lineColors.length === 0) {
    return allColors
      .filter(({ color }) => (color.r + color.g + color.b) / 3 < 128)
      .map(({ color }) => color)
      .slice(0, 5);
  }

  return lineColors.map(({ color }) => color);
}

/**
 * Calculate color saturation
 */
function getSaturation(color: Color): number {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);

  if (max === 0) return 0;

  return ((max - min) / max) * 100;
}

// ============================================================================
// Color Conversion Utilities
// ============================================================================

/**
 * Convert RGB to HSL
 */
export function rgbToHsl(color: Color): { h: number; s: number; l: number } {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let h = 0, s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Convert HSL to RGB
 */
export function hslToRgb(h: number, s: number, l: number): Color {
  h /= 360;
  s /= 100;
  l /= 100;

  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
    a: 255,
  };
}

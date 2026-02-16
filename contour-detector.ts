/**
 * CAD to SVG Converter - Contour Detection Module
 * Implements contour tracing algorithms for extracting shapes from edge images
 */

import {
  Point,
  Contour,
  BoundingBox,
  ContourDetectionOptions,
} from './types';

// ============================================================================
// Contour Tracing Algorithms
// ============================================================================

/**
 * Moore Neighborhood Contour Tracing
 * Traces the boundary of a connected component using Moore neighborhood
 */
export function mooreContourTracing(
  binary: Uint8ClampedArray,
  width: number,
  height: number
): Contour[] {
  const contours: Contour[] = [];
  const visited = new Uint8ClampedArray(width * height);
  
  // Moore neighborhood directions (8-connected, clockwise starting from right)
  const directions = [
    { dx: 1, dy: 0 },   // 0: right
    { dx: 1, dy: 1 },   // 1: bottom-right
    { dx: 0, dy: 1 },   // 2: bottom
    { dx: -1, dy: 1 },  // 3: bottom-left
    { dx: -1, dy: 0 },  // 4: left
    { dx: -1, dy: -1 }, // 5: top-left
    { dx: 0, dy: -1 },  // 6: top
    { dx: 1, dy: -1 },  // 7: top-right
  ];

  // Find contour starting points
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      
      // Skip if not an edge pixel or already visited
      if (binary[idx] === 0 || visited[idx]) continue;

      // Check if this is a contour starting point (leftmost pixel of a contour)
      if (x > 0 && binary[idx - 1] > 0) continue;

      // Trace the contour
      const contour = traceMooreContour(binary, visited, width, height, x, y, directions);
      if (contour.points.length >= 3) {
        contours.push(contour);
      }
    }
  }

  return contours;
}

function traceMooreContour(
  binary: Uint8ClampedArray,
  visited: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  directions: { dx: number; dy: number }[]
): Contour {
  const points: Point[] = [];
  let x = startX;
  let y = startY;
  let dir = 0; // Start looking right
  const startXx = startX;
  const startYy = startY;
  let firstStep = true;

  // Initialize bounding box
  let minX = x, maxX = x, minY = y, maxY = y;

  do {
    // Add current point to contour
    points.push({ x, y });
    visited[y * width + x] = 1;

    // Update bounding box
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    // Find next boundary pixel using Moore neighborhood
    let found = false;
    const startDir = (dir + 5) % 8; // Start from backtrack direction

    for (let i = 0; i < 8; i++) {
      const checkDir = (startDir + i) % 8;
      const nx = x + directions[checkDir].dx;
      const ny = y + directions[checkDir].dy;

      // Check bounds
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      // Check if this is a boundary pixel
      if (binary[ny * width + nx] > 0) {
        x = nx;
        y = ny;
        dir = checkDir;
        found = true;
        break;
      }
    }

    if (!found) break;

    // Check if we've returned to start (allow at least 3 points)
    if (!firstStep && x === startXx && y === startYy) break;
    firstStep = false;

  } while (points.length < width * height); // Safety limit

  // Calculate area and perimeter
  const boundingBox: BoundingBox = {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };

  const area = calculateContourArea(points);
  const perimeter = calculateContourPerimeter(points);

  return {
    points,
    isClosed: points.length >= 3,
    isHole: false, // Will be determined later
    boundingBox,
    area,
    perimeter,
  };
}

/**
 * Suzuki-Abe Contour Tracing Algorithm
 * More robust algorithm that handles holes and hierarchy
 */
export function suzukiContourTracing(
  binary: Uint8ClampedArray,
  width: number,
  height: number
): Contour[] {
  const contours: Contour[] = [];
  const labeled = new Int32Array(width * height);
  let currentLabel = 0;
  const hierarchy: Map<number, number> = new Map(); // child -> parent

  // First pass: detect outer contours and label regions
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const prevIdx = x > 0 ? idx - 1 : -1;

      if (binary[idx] > 0) {
        // Check for outer contour start
        if (x === 0 || binary[prevIdx] === 0) {
          currentLabel++;
          const contour = traceSuzukiContour(
            binary, labeled, width, height, x, y, currentLabel, true
          );
          if (contour.points.length >= 3) {
            contours.push(contour);
          }
        } else {
          // Inherit label from left neighbor
          labeled[idx] = labeled[prevIdx];
        }

        // Check for inner contour (hole) start
        if (y < height - 1 && binary[(y + 1) * width + x] === 0) {
          currentLabel++;
          const parentLabel = labeled[idx];
          hierarchy.set(currentLabel, parentLabel);
          
          const contour = traceSuzukiContour(
            binary, labeled, width, height, x, y, currentLabel, false
          );
          if (contour.points.length >= 3) {
            contour.isHole = true;
            contours.push(contour);
          }
        }
      }
    }
  }

  return contours;
}

function traceSuzukiContour(
  binary: Uint8ClampedArray,
  labeled: Int32Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  label: number,
  isOuter: boolean
): Contour {
  const points: Point[] = [];
  
  // 8-directional neighbors (clockwise from right)
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];

  let x = startX;
  let y = startY;
  let dir = isOuter ? 0 : 4; // Outer: start from right, Inner: start from left
  let minX = x, maxX = x, minY = y, maxY = y;

  do {
    // Add point
    points.push({ x, y });
    labeled[y * width + x] = label;

    // Update bounds
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    // Find next pixel
    let found = false;
    const startDir = (dir + 6) % 8; // Start from backtrack + 1

    for (let i = 0; i < 8; i++) {
      const checkDir = (startDir + i) % 8;
      const nx = x + dx[checkDir];
      const ny = y + dy[checkDir];

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (binary[ny * width + nx] > 0) {
          x = nx;
          y = ny;
          dir = checkDir;
          found = true;
          break;
        }
      }
    }

    if (!found) break;

  } while (!(x === startX && y === startY) && points.length < width * height);

  return {
    points,
    isClosed: points.length >= 3,
    isHole: !isOuter,
    boundingBox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    area: calculateContourArea(points),
    perimeter: calculateContourPerimeter(points),
  };
}

/**
 * Marching Squares Algorithm
 * Generates smooth contours with sub-pixel precision
 */
export function marchingSquares(
  binary: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number = 128
): Contour[] {
  const contours: Contour[] = [];
  const visited = new Set<string>();

  // Marching squares lookup table for 16 cases
  // Each entry contains list of edge connections
  const edgeTable = [
    [],                    // 0: all outside
    [[3, 0]],             // 1: bottom-left inside
    [[2, 3]],             // 2: bottom-right inside
    [[2, 0]],             // 3: bottom half inside
    [[1, 2]],             // 4: top-right inside
    [[1, 0], [2, 3]],     // 5: saddle (ambiguous)
    [[1, 3]],             // 6: right half inside
    [[1, 0]],             // 7: bottom-left outside
    [[0, 1]],             // 8: top-left inside
    [[0, 3]],             // 9: left half inside
    [[0, 2], [1, 3]],     // 10: saddle (ambiguous)
    [[0, 2]],             // 11: top-left outside
    [[3, 2]],             // 12: top half inside
    [[3, 1]],             // 13: top-right outside
    [[2, 1]],             // 14: bottom-right outside
    [],                    // 15: all inside
  ];

  // Interpolate edge crossing point
  const interpolate = (
    x1: number, y1: number, v1: number,
    x2: number, y2: number, v2: number
  ): Point => {
    if (Math.abs(v1 - v2) < 0.001) {
      return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    }
    const t = (threshold - v1) / (v2 - v1);
    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1),
    };
  };

  // Get edge points for a cell
  const getEdgePoint = (x: number, y: number, edge: number): Point => {
    const getValue = (px: number, py: number): number => {
      if (px < 0 || px >= width || py < 0 || py >= height) return 0;
      return binary[py * width + px];
    };

    switch (edge) {
      case 0: return interpolate(x, y + 0.5, getValue(x, y), x + 1, y + 0.5, getValue(x + 1, y)); // top
      case 1: return interpolate(x + 0.5, y, getValue(x + 1, y), x + 0.5, y + 1, getValue(x + 1, y + 1)); // right
      case 2: return interpolate(x, y + 0.5, getValue(x, y + 1), x + 1, y + 0.5, getValue(x + 1, y + 1)); // bottom
      case 3: return interpolate(x + 0.5, y, getValue(x, y), x + 0.5, y + 1, getValue(x, y + 1)); // left
      default: return { x, y };
    }
  };

  // Process each cell
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      // Get corner values
      const v0 = binary[y * width + x]; // top-left
      const v1 = binary[y * width + (x + 1)]; // top-right
      const v2 = binary[(y + 1) * width + (x + 1)]; // bottom-right
      const v3 = binary[(y + 1) * width + x]; // bottom-left

      // Determine case index (0-15)
      let caseIndex = 0;
      if (v0 >= threshold) caseIndex |= 1;
      if (v1 >= threshold) caseIndex |= 2;
      if (v2 >= threshold) caseIndex |= 4;
      if (v3 >= threshold) caseIndex |= 8;

      // Skip if all inside or all outside
      if (caseIndex === 0 || caseIndex === 15) continue;

      // Get edge connections
      const edges = edgeTable[caseIndex];
      
      for (const [e1, e2] of edges) {
        const key = `${x},${y},${e1}-${e2}`;
        if (visited.has(key)) continue;
        visited.add(key);

        // Trace contour starting from this edge
        const contour = traceMarchingSquaresContour(
          binary, width, height, threshold, x, y, e1, e2, edgeTable, getEdgePoint, visited
        );
        
        if (contour.points.length >= 3) {
          contours.push(contour);
        }
      }
    }
  }

  return contours;
}

function traceMarchingSquaresContour(
  binary: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
  startX: number,
  startY: number,
  startEdge1: number,
  startEdge2: number,
  edgeTable: number[][][],
  getEdgePoint: (x: number, y: number, edge: number) => Point,
  visited: Set<string>
): Contour {
  const points: Point[] = [];
  
  // Add initial edge points
  points.push(getEdgePoint(startX, startY, startEdge1));
  points.push(getEdgePoint(startX, startY, startEdge2));

  let x = startX;
  let y = startY;
  let lastEdge = startEdge2;
  
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  // Follow the contour
  const maxIterations = width * height * 4;
  for (let i = 0; i < maxIterations; i++) {
    // Move to adjacent cell based on exit edge
    let nextX = x, nextY = y;
    switch (lastEdge) {
      case 0: nextY--; break; // exited top
      case 1: nextX++; break; // exited right
      case 2: nextY++; break; // exited bottom
      case 3: nextX--; break; // exited left
    }

    // Check bounds
    if (nextX < 0 || nextX >= width - 1 || nextY < 0 || nextY >= height - 1) break;

    // Get corner values for next cell
    const v0 = binary[nextY * width + nextX];
    const v1 = binary[nextY * width + (nextX + 1)];
    const v2 = binary[(nextY + 1) * width + (nextX + 1)];
    const v3 = binary[(nextY + 1) * width + nextX];

    let caseIndex = 0;
    if (v0 >= threshold) caseIndex |= 1;
    if (v1 >= threshold) caseIndex |= 2;
    if (v2 >= threshold) caseIndex |= 4;
    if (v3 >= threshold) caseIndex |= 8;

    if (caseIndex === 0 || caseIndex === 15) break;

    // Find exit edge (different from entry edge)
    const entryEdge = (lastEdge + 2) % 4;
    const edges = edgeTable[caseIndex];
    
    let found = false;
    for (const [e1, e2] of edges) {
      if (e1 === entryEdge) {
        points.push(getEdgePoint(nextX, nextY, e1));
        points.push(getEdgePoint(nextX, nextY, e2));
        
        // Update bounds
        const lastPoint = points[points.length - 1];
        minX = Math.min(minX, lastPoint.x);
        maxX = Math.max(maxX, lastPoint.x);
        minY = Math.min(minY, lastPoint.y);
        maxY = Math.max(maxY, lastPoint.y);
        
        x = nextX;
        y = nextY;
        lastEdge = e2;
        
        const key = `${x},${y},${e1}-${e2}`;
        visited.add(key);
        found = true;
        break;
      } else if (e2 === entryEdge) {
        points.push(getEdgePoint(nextX, nextY, e2));
        points.push(getEdgePoint(nextX, nextY, e1));
        
        const lastPoint = points[points.length - 1];
        minX = Math.min(minX, lastPoint.x);
        maxX = Math.max(maxX, lastPoint.x);
        minY = Math.min(minY, lastPoint.y);
        maxY = Math.max(maxY, lastPoint.y);
        
        x = nextX;
        y = nextY;
        lastEdge = e1;
        
        const key = `${x},${y},${e2}-${e1}`;
        visited.add(key);
        found = true;
        break;
      }
    }

    if (!found) break;

    // Check if returned to start
    if (x === startX && y === startY) break;
  }

  // Calculate area and perimeter
  if (points.length > 0) {
    minX = Math.min(...points.map(p => p.x));
    maxX = Math.max(...points.map(p => p.x));
    minY = Math.min(...points.map(p => p.y));
    maxY = Math.max(...points.map(p => p.y));
  }

  return {
    points,
    isClosed: points.length >= 3,
    isHole: false,
    boundingBox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    area: calculateContourArea(points),
    perimeter: calculateContourPerimeter(points),
  };
}

// ============================================================================
// Contour Utilities
// ============================================================================

/**
 * Calculate contour area using Shoelace formula
 */
export function calculateContourArea(points: Point[]): number {
  if (points.length < 3) return 0;

  let area = 0;
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }

  return Math.abs(area) / 2;
}

/**
 * Calculate contour perimeter
 */
export function calculateContourPerimeter(points: Point[]): number {
  if (points.length < 2) return 0;

  let perimeter = 0;
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = points[j].x - points[i].x;
    const dy = points[j].y - points[i].y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }

  return perimeter;
}

/**
 * Calculate contour centroid
 */
export function calculateContourCentroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };

  let sumX = 0, sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }

  return {
    x: sumX / points.length,
    y: sumY / points.length,
  };
}

/**
 * Check if point is inside contour
 */
export function isPointInContour(point: Point, contour: Point[]): boolean {
  if (contour.length < 3) return false;

  let inside = false;
  const n = contour.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = contour[i].x, yi = contour[i].y;
    const xj = contour[j].x, yj = contour[j].y;

    if (((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Check if contour A contains contour B
 */
export function isContourInside(outer: Contour, inner: Contour): boolean {
  // Check if inner's centroid is inside outer
  const centroid = calculateContourCentroid(inner.points);
  return isPointInContour(centroid, outer.points);
}

/**
 * Filter contours by area
 */
export function filterContoursByArea(
  contours: Contour[],
  minArea: number = 0,
  maxArea: number = Infinity
): Contour[] {
  return contours.filter(c => c.area >= minArea && c.area <= maxArea);
}

/**
 * Merge nearby contours
 */
export function mergeNearbyContours(contours: Contour[], threshold: number = 2): Contour[] {
  if (contours.length === 0) return [];

  const merged: Contour[] = [];
  const used = new Set<number>();

  for (let i = 0; i < contours.length; i++) {
    if (used.has(i)) continue;

    let currentContour = { ...contours[i], points: [...contours[i].points] };

    for (let j = i + 1; j < contours.length; j++) {
      if (used.has(j)) continue;

      // Check if contours are close
      const dist = distanceBetweenContours(currentContour, contours[j]);
      if (dist < threshold) {
        // Merge contours
        currentContour.points.push(...contours[j].points);
        used.add(j);
      }
    }

    // Recalculate properties
    currentContour.area = calculateContourArea(currentContour.points);
    currentContour.perimeter = calculateContourPerimeter(currentContour.points);

    merged.push(currentContour);
  }

  return merged;
}

/**
 * Calculate minimum distance between two contours
 */
export function distanceBetweenContours(c1: Contour, c2: Contour): number {
  let minDist = Infinity;

  for (const p1 of c1.points) {
    for (const p2 of c2.points) {
      const dist = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
      minDist = Math.min(minDist, dist);
    }
  }

  return minDist;
}

// ============================================================================
// Main Contour Detection Function
// ============================================================================

/**
 * Detect contours using specified method
 */
export function detectContours(
  binary: Uint8ClampedArray,
  width: number,
  height: number,
  options: ContourDetectionOptions
): Contour[] {
  const {
    method,
    minArea = 10,
    maxArea = Infinity,
    simplify = true,
    tolerance = 1.0,
  } = options;

  let contours: Contour[];

  switch (method) {
    case 'moore':
      contours = mooreContourTracing(binary, width, height);
      break;
    case 'suzuki':
      contours = suzukiContourTracing(binary, width, height);
      break;
    case 'marching-squares':
      contours = marchingSquares(binary, width, height);
      break;
    default:
      throw new Error(`Unknown contour detection method: ${method}`);
  }

  // Filter by area
  contours = filterContoursByArea(contours, minArea, maxArea);

  // Simplify contours if requested
  if (simplify) {
    contours = contours.map(c => ({
      ...c,
      points: simplifyContour(c.points, tolerance),
    }));
  }

  return contours;
}

/**
 * Simple point reduction (interim until path-simplification is imported)
 */
function simplifyContour(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;

  // Use Douglas-Peucker algorithm (imported from path-simplification module)
  // For now, use simple decimation
  const result: Point[] = [points[0]];
  let lastPoint = points[0];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = Math.sqrt(
      Math.pow(points[i].x - lastPoint.x, 2) +
      Math.pow(points[i].y - lastPoint.y, 2)
    );
    if (dist >= tolerance) {
      result.push(points[i]);
      lastPoint = points[i];
    }
  }

  result.push(points[points.length - 1]);
  return result;
}

/**
 * CAD to SVG Converter - Path Simplification Module
 * Implements algorithms for reducing path points while preserving shape
 */

import { Point, BoundingBox } from './types';

// ============================================================================
// Douglas-Peucker Algorithm
// ============================================================================

/**
 * Calculate perpendicular distance from point to line segment
 */
function perpendicularDistance(
  point: Point,
  lineStart: Point,
  lineEnd: Point
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  // Handle case where line segment is a point
  const lineLengthSq = dx * dx + dy * dy;
  if (lineLengthSq === 0) {
    return Math.sqrt(
      Math.pow(point.x - lineStart.x, 2) +
      Math.pow(point.y - lineStart.y, 2)
    );
  }

  // Calculate perpendicular distance
  const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lineLengthSq;

  // Project point onto line
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;

  // Clamp projection to line segment
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

/**
 * Recursive Douglas-Peucker simplification
 */
function douglasPeuckerRecursive(
  points: Point[],
  startIndex: number,
  endIndex: number,
  tolerance: number,
  keep: boolean[]
): void {
  if (endIndex <= startIndex + 1) return;

  // Find the point with maximum distance
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

  // If max distance exceeds tolerance, recursively simplify
  if (maxDist > tolerance) {
    keep[maxIndex] = true;
    douglasPeuckerRecursive(points, startIndex, maxIndex, tolerance, keep);
    douglasPeuckerRecursive(points, maxIndex, endIndex, tolerance, keep);
  }
}

/**
 * Douglas-Peucker line simplification algorithm
 * Reduces number of points while preserving shape
 */
export function douglasPeucker(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return [...points];

  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  douglasPeuckerRecursive(points, 0, points.length - 1, tolerance, keep);

  return points.filter((_, i) => keep[i]);
}

/**
 * Douglas-Peucker with relative tolerance
 */
export function douglasPeuckerRelative(
  points: Point[],
  tolerancePercent: number = 0.5
): Point[] {
  if (points.length < 3) return [...points];

  // Calculate bounding box diagonal for relative tolerance
  const bbox = getBoundingBox(points);
  const diagonal = Math.sqrt(bbox.width * bbox.width + bbox.height * bbox.height);
  const tolerance = diagonal * tolerancePercent / 100;

  return douglasPeucker(points, tolerance);
}

// ============================================================================
// Visvalingam-Whyatt Algorithm
// ============================================================================

interface Triangle {
  index: number;
  area: number;
  prev: number;
  next: number;
}

/**
 * Calculate triangle area for Visvalingam-Whyatt algorithm
 */
function triangleArea(p1: Point, p2: Point, p3: Point): number {
  return Math.abs(
    (p2.x - p1.x) * (p3.y - p1.y) -
    (p3.x - p1.x) * (p2.y - p1.y)
  ) / 2;
}

/**
 * Visvalingam-Whyatt simplification algorithm
 * Iteratively removes least significant points
 */
export function visvalingamWhyatt(points: Point[], targetCount: number): Point[] {
  if (points.length <= targetCount || points.length < 3) {
    return [...points];
  }

  // Create linked list structure
  const nodes = points.map((p, i) => ({
    point: p,
    index: i,
    area: i === 0 || i === points.length - 1 ? Infinity : 0,
    prev: i - 1,
    next: i === points.length - 1 ? -1 : i + 1,
    removed: false,
  }));

  // Calculate initial areas
  for (let i = 1; i < nodes.length - 1; i++) {
    if (nodes[i].prev >= 0 && nodes[i].next >= 0) {
      nodes[i].area = triangleArea(
        nodes[nodes[i].prev].point,
        nodes[i].point,
        nodes[nodes[i].next].point
      );
    }
  }

  // Create min-heap for efficient area lookup
  const heap = nodes.slice(1, -1);
  heap.sort((a, b) => a.area - b.area);

  // Remove points until target count reached
  let removeCount = points.length - targetCount;

  while (removeCount > 0 && heap.length > 0) {
    // Get point with smallest area
    let node = heap.shift()!;

    while (node.removed && heap.length > 0) {
      node = heap.shift()!;
    }

    if (node.removed) break;

    // Mark as removed
    node.removed = true;
    removeCount--;

    // Update neighbors
    const prevNode = nodes[node.prev];
    const nextNode = nodes[node.next];

    if (prevNode && prevNode.prev >= 0) {
      prevNode.next = node.next;
      prevNode.area = triangleArea(
        nodes[prevNode.prev].point,
        prevNode.point,
        nextNode?.point || prevNode.point
      );
      heap.push(prevNode);
    }

    if (nextNode && nextNode.next >= 0) {
      nextNode.prev = node.prev;
      nextNode.area = triangleArea(
        prevNode?.point || nextNode.point,
        nextNode.point,
        nodes[nextNode.next].point
      );
      heap.push(nextNode);
    }

    // Re-sort heap
    heap.sort((a, b) => a.area - b.area);
  }

  // Return remaining points
  return nodes.filter(n => !n.removed).map(n => n.point);
}

// ============================================================================
// Reumann-Witkam Algorithm
// ============================================================================

/**
 * Reumann-Witkam simplification algorithm
 * Uses a perpendicular distance threshold
 */
export function reumannWitkam(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return [...points];

  const result: Point[] = [points[0], points[1]];
  let keyIndex = 0;
  let firstPoint = points[0];

  for (let i = 2; i < points.length; i++) {
    const dist = perpendicularDistance(points[i], firstPoint, points[keyIndex + 1]);

    if (dist > tolerance) {
      result.push(points[i]);
      firstPoint = points[keyIndex + 1];
      keyIndex++;
    }
  }

  return result;
}

// ============================================================================
// Curve Smoothing
// ============================================================================

/**
 * Chaikin's corner cutting algorithm for curve smoothing
 */
export function chaikinSmooth(points: Point[], iterations: number = 1): Point[] {
  if (points.length < 3 || iterations < 1) return [...points];

  let result = [...points];

  for (let iter = 0; iter < iterations; iter++) {
    const smoothed: Point[] = [];

    for (let i = 0; i < result.length - 1; i++) {
      const p0 = result[i];
      const p1 = result[i + 1];

      // Create two new points at 1/4 and 3/4 along the segment
      smoothed.push({
        x: 0.75 * p0.x + 0.25 * p1.x,
        y: 0.75 * p0.y + 0.25 * p1.y,
      });
      smoothed.push({
        x: 0.25 * p0.x + 0.75 * p1.x,
        y: 0.25 * p0.y + 0.75 * p1.y,
      });
    }

    // For closed paths, close the loop
    if (result.length > 2) {
      const p0 = result[result.length - 1];
      const p1 = result[0];
      smoothed.push({
        x: 0.75 * p0.x + 0.25 * p1.x,
        y: 0.75 * p0.y + 0.25 * p1.y,
      });
      smoothed.push({
        x: 0.25 * p0.x + 0.75 * p1.x,
        y: 0.25 * p0.y + 0.75 * p1.y,
      });
    }

    result = smoothed;
  }

  return result;
}

/**
 * Moving average smoothing
 */
export function movingAverageSmooth(points: Point[], windowSize: number = 3): Point[] {
  if (points.length < windowSize) return [...points];

  const halfWindow = Math.floor(windowSize / 2);
  const result: Point[] = [];

  for (let i = 0; i < points.length; i++) {
    let sumX = 0, sumY = 0;
    let count = 0;

    for (let j = -halfWindow; j <= halfWindow; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < points.length) {
        sumX += points[idx].x;
        sumY += points[idx].y;
        count++;
      }
    }

    result.push({
      x: sumX / count,
      y: sumY / count,
    });
  }

  return result;
}

/**
 * Gaussian smoothing
 */
export function gaussianSmooth(points: Point[], sigma: number = 1.0): Point[] {
  if (points.length < 3) return [...points];

  const result: Point[] = [];
  const windowSize = Math.ceil(sigma * 3) * 2 + 1;
  const halfWindow = Math.floor(windowSize / 2);

  // Create Gaussian weights
  const weights: number[] = [];
  let weightSum = 0;

  for (let i = -halfWindow; i <= halfWindow; i++) {
    const weight = Math.exp(-(i * i) / (2 * sigma * sigma));
    weights.push(weight);
    weightSum += weight;
  }

  // Normalize weights
  for (let i = 0; i < weights.length; i++) {
    weights[i] /= weightSum;
  }

  // Apply Gaussian filter
  for (let i = 0; i < points.length; i++) {
    let sumX = 0, sumY = 0;

    for (let j = -halfWindow; j <= halfWindow; j++) {
      let idx = i + j;

      // Handle boundary (mirror)
      if (idx < 0) idx = -idx;
      if (idx >= points.length) idx = 2 * points.length - idx - 2;

      idx = Math.max(0, Math.min(points.length - 1, idx));

      sumX += points[idx].x * weights[j + halfWindow];
      sumY += points[idx].y * weights[j + halfWindow];
    }

    result.push({ x: sumX, y: sumY });
  }

  return result;
}

// ============================================================================
// Bezier Curve Fitting
// ============================================================================

export interface BezierSegment {
  start: Point;
  control1: Point;
  control2: Point;
  end: Point;
}

/**
 * Fit cubic Bezier curve to points
 */
export function fitCubicBezier(points: Point[], error: number = 4.0): BezierSegment[] {
  if (points.length < 2) return [];
  if (points.length === 2) {
    return [{
      start: points[0],
      control1: points[0],
      control2: points[1],
      end: points[1],
    }];
  }

  const segments: BezierSegment[] = [];
  const tangent1 = computeTangent(points[0], points[1]);
  const tangent2 = computeTangent(points[points.length - 1], points[points.length - 2]);

  fitCubicBezierRecursive(points, 0, points.length - 1, tangent1, tangent2, error, segments);

  return segments;
}

function computeTangent(p1: Point, p2: Point): Point {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  return { x: dx / len, y: dy / len };
}

function fitCubicBezierRecursive(
  points: Point[],
  first: number,
  last: number,
  tangent1: Point,
  tangent2: Point,
  error: number,
  segments: BezierSegment[]
): void {
  if (last - first === 1) {
    const p0 = points[first];
    const p1 = points[last];
    const dist = Math.sqrt(Math.pow(p1.x - p0.x, 2) + Math.pow(p1.y - p0.y, 2)) / 3;
    segments.push({
      start: p0,
      control1: { x: p0.x + tangent1.x * dist, y: p0.y + tangent1.y * dist },
      control2: { x: p1.x - tangent2.x * dist, y: p1.y - tangent2.y * dist },
      end: p1,
    });
    return;
  }

  // Parameterize points
  const u = chordLengthParameterize(points, first, last);

  // Generate Bezier curve
  let bezCurve = generateBezier(points, first, last, u, tangent1, tangent2);

  // Find max error
  const { maxError, splitPoint } = computeMaxError(points, first, last, bezCurve, u);

  if (maxError < error) {
    segments.push(bezCurve);
    return;
  }

  // Subdivide at point of max error
  const tanCenter = computeTangent(points[splitPoint - 1], points[splitPoint + 1]);

  fitCubicBezierRecursive(points, first, splitPoint, tangent1, tanCenter, error, segments);
  fitCubicBezierRecursive(points, splitPoint, last, tanCenter, tangent2, error, segments);
}

function chordLengthParameterize(points: Point[], first: number, last: number): number[] {
  const u = [0];

  for (let i = first + 1; i <= last; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    u.push(u[u.length - 1] + Math.sqrt(dx * dx + dy * dy));
  }

  // Normalize
  const lastU = u[u.length - 1];
  for (let i = 0; i < u.length; i++) {
    u[i] /= lastU;
  }

  return u;
}

function generateBezier(
  points: Point[],
  first: number,
  last: number,
  uPrime: number[],
  tangent1: Point,
  tangent2: Point
): BezierSegment {
  const p0 = points[first];
  const p3 = points[last];

  // Compute A and B matrices
  const nPts = last - first + 1;
  const A: Point[] = [];

  for (let i = 0; i < nPts; i++) {
    A.push({
      x: tangent1.x * bezierB1(uPrime[i]) + tangent2.x * bezierB2(uPrime[i]),
      y: tangent1.y * bezierB1(uPrime[i]) + tangent2.y * bezierB2(uPrime[i]),
    });
  }

  // Create C and X matrices
  let C00 = 0, C01 = 0, C10 = 0, C11 = 0;
  let X0 = 0, X1 = 0;

  for (let i = 0; i < nPts; i++) {
    C00 += dot(A[i], A[i]);
    C01 += dot(A[i], { x: -A[i].y, y: A[i].x });
    C11 += dot({ x: -A[i].y, y: A[i].x }, { x: -A[i].y, y: A[i].x });

    const tmp = {
      x: points[first + i].x - bezierQ0(uPrime[i], p0, p3),
      y: points[first + i].y - bezierQ1(uPrime[i], p0, p3),
    };

    X0 += dot(A[i], tmp);
    X1 += dot({ x: -A[i].y, y: A[i].x }, tmp);
  }

  // Solve for alpha1 and alpha2
  const det = C00 * C11 - C01 * C01;
  let alpha1, alpha2;

  if (Math.abs(det) > 1e-6) {
    alpha1 = (C11 * X0 - C01 * X1) / det;
    alpha2 = (C00 * X1 - C01 * X0) / det;
  } else {
    const s = C00 + C01;
    alpha1 = X0 / s;
    alpha2 = X1 / s;
  }

  // If alpha is negative, use a fallback
  if (alpha1 < 0 || alpha2 < 0) {
    const dist = Math.sqrt(Math.pow(p3.x - p0.x, 2) + Math.pow(p3.y - p0.y, 2)) / 3;
    alpha1 = dist;
    alpha2 = dist;
  }

  return {
    start: p0,
    control1: { x: p0.x + tangent1.x * alpha1, y: p0.y + tangent1.y * alpha1 },
    control2: { x: p3.x - tangent2.x * alpha2, y: p3.y - tangent2.y * alpha2 },
    end: p3,
  };
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

function bezierB1(t: number): number {
  return 3 * t * (1 - t) * (1 - t);
}

function bezierB2(t: number): number {
  return 3 * t * t * (1 - t);
}

function bezierQ0(t: number, p0: Point, p3: Point): number {
  return (1 - t) * (1 - t) * (1 - t) * p0.x + t * t * t * p3.x;
}

function bezierQ1(t: number, p0: Point, p3: Point): number {
  return (1 - t) * (1 - t) * (1 - t) * p0.y + t * t * t * p3.y;
}

function computeMaxError(
  points: Point[],
  first: number,
  last: number,
  bez: BezierSegment,
  u: number[]
): { maxError: number; splitPoint: number } {
  let maxError = 0;
  let splitPoint = Math.floor((last - first + 1) / 2) + first;

  for (let i = first + 1; i < last; i++) {
    const p = points[i];
    const bezPt = bezierPoint(bez, u[i - first]);
    const dist = Math.sqrt(Math.pow(p.x - bezPt.x, 2) + Math.pow(p.y - bezPt.y, 2));

    if (dist >= maxError) {
      maxError = dist;
      splitPoint = i;
    }
  }

  return { maxError, splitPoint };
}

function bezierPoint(bez: BezierSegment, t: number): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;

  return {
    x: mt3 * bez.start.x + 3 * mt2 * t * bez.control1.x + 3 * mt * t2 * bez.control2.x + t3 * bez.end.x,
    y: mt3 * bez.start.y + 3 * mt2 * t * bez.control1.y + 3 * mt * t2 * bez.control2.y + t3 * bez.end.y,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get bounding box of points
 */
export function getBoundingBox(points: Point[]): BoundingBox {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Calculate path length
 */
export function pathLength(points: Point[]): number {
  let length = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    length += Math.sqrt(dx * dx + dy * dy);
  }

  return length;
}

/**
 * Resample path to have uniform point distribution
 */
export function resamplePath(points: Point[], targetCount: number): Point[] {
  if (points.length < 2 || targetCount < 2) return [...points];
  if (points.length === targetCount) return [...points];

  const totalLength = pathLength(points);
  const step = totalLength / (targetCount - 1);

  const result: Point[] = [points[0]];
  let currentLength = 0;
  let currentSegment = 0;
  let segmentStart = 0;

  for (let i = 1; i < targetCount - 1; i++) {
    const targetLength = i * step;

    while (currentSegment < points.length - 1) {
      const p1 = points[currentSegment];
      const p2 = points[currentSegment + 1];
      const segmentLength = Math.sqrt(
        Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)
      );

      if (segmentStart + segmentLength >= targetLength) {
        const t = (targetLength - segmentStart) / segmentLength;
        result.push({
          x: p1.x + t * (p2.x - p1.x),
          y: p1.y + t * (p2.y - p1.y),
        });
        break;
      }

      segmentStart += segmentLength;
      currentSegment++;
    }
  }

  result.push(points[points.length - 1]);
  return result;
}

// ============================================================================
// Main Simplification Function
// ============================================================================

export type SimplificationMethod = 'douglas-peucker' | 'visvalingam-whyatt' | 'reumann-witkam';
export type SmoothingMethod = 'chaikin' | 'moving-average' | 'gaussian' | 'bezier';

export interface SimplificationOptions {
  method?: SimplificationMethod;
  tolerance?: number;
  targetPointCount?: number;
  smoothing?: SmoothingMethod;
  smoothingIterations?: number;
  smoothingSigma?: number;
  preserveEndpoints?: boolean;
}

/**
 * Simplify path with configurable options
 */
export function simplifyPath(
  points: Point[],
  options: SimplificationOptions = {}
): Point[] {
  const {
    method = 'douglas-peucker',
    tolerance = 1.0,
    targetPointCount,
    smoothing,
    smoothingIterations = 1,
    smoothingSigma = 1.0,
  } = options;

  if (points.length < 3) return [...points];

  let result = [...points];

  // Apply simplification
  switch (method) {
    case 'douglas-peucker':
      result = douglasPeucker(result, tolerance);
      break;
    case 'visvalingam-whyatt':
      if (targetPointCount) {
        result = visvalingamWhyatt(result, targetPointCount);
      } else {
        // Use tolerance as percentage of points to keep
        const keepCount = Math.max(3, Math.floor(points.length * (100 - tolerance) / 100));
        result = visvalingamWhyatt(result, keepCount);
      }
      break;
    case 'reumann-witkam':
      result = reumannWitkam(result, tolerance);
      break;
  }

  // Apply smoothing
  if (smoothing) {
    switch (smoothing) {
      case 'chaikin':
        result = chaikinSmooth(result, smoothingIterations);
        break;
      case 'moving-average':
        result = movingAverageSmooth(result, smoothingIterations * 2 + 1);
        break;
      case 'gaussian':
        result = gaussianSmooth(result, smoothingSigma);
        break;
      case 'bezier':
        // Bezier fitting produces different structure, handled separately
        break;
    }
  }

  return result;
}

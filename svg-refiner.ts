/**
 * CAD to SVG Converter - SVG Refinement Module
 * 
 * Post-processing refinement stage that validates the generated SVG paths
 * against the original reference image edges and iteratively improves accuracy.
 * 
 * The refinement pipeline:
 * 1. Rasterize SVG paths to a binary edge map
 * 2. Compare against the reference edge map (precision, recall, F1)
 * 3. Apply corrective strategies (snap-to-edge, gap fill, spurious removal)
 * 4. Iterate until target accuracy is met or max iterations reached
 */

import {
    Point,
    PathData,
    Color,
    ImageData as CADImageData,
    RefinementOptions,
    RefinementScore,
    RefinementResult,
} from './types';
import { detectContours } from './contour-detector';
import { douglasPeucker } from './path-simplification';

// ============================================================================
// Distance Transform
// ============================================================================

/**
 * Compute a distance transform of a binary edge image.
 * For each pixel, stores the distance to the nearest edge pixel (value > 0).
 * Uses a two-pass approximation (Rosenfeld & Pfaltz) for O(n) performance.
 */
export function computeDistanceTransform(
    edges: Uint8ClampedArray,
    width: number,
    height: number
): Float32Array {
    const size = width * height;
    const dist = new Float32Array(size);
    const INF = width + height; // Larger than any possible distance

    // Initialize: 0 for edge pixels, INF for non-edge pixels
    for (let i = 0; i < size; i++) {
        dist[i] = edges[i] > 0 ? 0 : INF;
    }

    // Forward pass (top-left to bottom-right)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (dist[idx] === 0) continue;

            // Check top neighbor
            if (y > 0) {
                dist[idx] = Math.min(dist[idx], dist[(y - 1) * width + x] + 1);
            }
            // Check left neighbor
            if (x > 0) {
                dist[idx] = Math.min(dist[idx], dist[y * width + (x - 1)] + 1);
            }
            // Check top-left diagonal
            if (y > 0 && x > 0) {
                dist[idx] = Math.min(dist[idx], dist[(y - 1) * width + (x - 1)] + 1.414);
            }
            // Check top-right diagonal
            if (y > 0 && x < width - 1) {
                dist[idx] = Math.min(dist[idx], dist[(y - 1) * width + (x + 1)] + 1.414);
            }
        }
    }

    // Backward pass (bottom-right to top-left)
    for (let y = height - 1; y >= 0; y--) {
        for (let x = width - 1; x >= 0; x--) {
            const idx = y * width + x;
            if (dist[idx] === 0) continue;

            // Check bottom neighbor
            if (y < height - 1) {
                dist[idx] = Math.min(dist[idx], dist[(y + 1) * width + x] + 1);
            }
            // Check right neighbor
            if (x < width - 1) {
                dist[idx] = Math.min(dist[idx], dist[y * width + (x + 1)] + 1);
            }
            // Check bottom-right diagonal
            if (y < height - 1 && x < width - 1) {
                dist[idx] = Math.min(dist[idx], dist[(y + 1) * width + (x + 1)] + 1.414);
            }
            // Check bottom-left diagonal
            if (y < height - 1 && x > 0) {
                dist[idx] = Math.min(dist[idx], dist[(y + 1) * width + (x - 1)] + 1.414);
            }
        }
    }

    return dist;
}

// ============================================================================
// SVG Rasterization
// ============================================================================

/**
 * Rasterize SVG paths to a binary edge image by drawing path segments 
 * using Bresenham's line algorithm. This avoids needing a full SVG renderer
 * and produces a comparable edge map for accuracy comparison.
 */
export function rasterizePaths(
    paths: PathData[],
    width: number,
    height: number
): Uint8ClampedArray {
    const result = new Uint8ClampedArray(width * height);

    for (const path of paths) {
        const points = path.points;
        if (points.length < 2) continue;

        for (let i = 0; i < points.length - 1; i++) {
            drawLine(result, width, height, points[i], points[i + 1]);
        }

        // Close the path if needed
        if (path.closed && points.length > 2) {
            drawLine(result, width, height, points[points.length - 1], points[0]);
        }
    }

    return result;
}

/**
 * Draw a line between two points using Bresenham's algorithm.
 */
function drawLine(
    buffer: Uint8ClampedArray,
    width: number,
    height: number,
    p0: Point,
    p1: Point
): void {
    let x0 = Math.round(p0.x);
    let y0 = Math.round(p0.y);
    const x1 = Math.round(p1.x);
    const y1 = Math.round(p1.y);

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
        if (x0 >= 0 && x0 < width && y0 >= 0 && y0 < height) {
            buffer[y0 * width + x0] = 255;
        }

        if (x0 === x1 && y0 === y1) break;

        const e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x0 += sx;
        }
        if (e2 < dx) {
            err += dx;
            y0 += sy;
        }
    }
}

// ============================================================================
// Accuracy Computation
// ============================================================================

/**
 * Compute accuracy metrics comparing SVG rasterized edges to reference edges.
 * 
 * Uses distance transforms for efficient nearest-neighbor lookups:
 * - Precision: What fraction of SVG edge pixels are near a reference edge?
 * - Recall: What fraction of reference edge pixels are near an SVG edge?
 * - F1 Score: Harmonic mean of precision and recall
 * - Mean Distance Error: Average pixel distance from SVG to nearest reference edge
 */
export function computeAccuracy(
    referenceEdges: Uint8ClampedArray,
    svgEdges: Uint8ClampedArray,
    width: number,
    height: number,
    distanceTolerance: number = 2
): RefinementScore {
    // Build distance transforms
    const refDistTransform = computeDistanceTransform(referenceEdges, width, height);
    const svgDistTransform = computeDistanceTransform(svgEdges, width, height);

    let totalSvgPixels = 0;
    let totalRefPixels = 0;
    let svgMatchedPixels = 0;  // SVG pixels near a reference pixel (precision numerator)
    let refMatchedPixels = 0;  // Reference pixels near an SVG pixel (recall numerator)
    let totalDistance = 0;

    const size = width * height;

    for (let i = 0; i < size; i++) {
        const isSvgEdge = svgEdges[i] > 0;
        const isRefEdge = referenceEdges[i] > 0;

        if (isSvgEdge) {
            totalSvgPixels++;
            const distToRef = refDistTransform[i];
            totalDistance += distToRef;
            if (distToRef <= distanceTolerance) {
                svgMatchedPixels++;
            }
        }

        if (isRefEdge) {
            totalRefPixels++;
            const distToSvg = svgDistTransform[i];
            if (distToSvg <= distanceTolerance) {
                refMatchedPixels++;
            }
        }
    }

    const precision = totalSvgPixels > 0 ? svgMatchedPixels / totalSvgPixels : 0;
    const recall = totalRefPixels > 0 ? refMatchedPixels / totalRefPixels : 0;
    const f1Score = (precision + recall) > 0
        ? 2 * (precision * recall) / (precision + recall)
        : 0;
    const meanDistanceError = totalSvgPixels > 0 ? totalDistance / totalSvgPixels : 0;

    return {
        precision,
        recall,
        f1Score,
        meanDistanceError,
        matchedPixels: svgMatchedPixels,
        totalSvgPixels,
        totalRefPixels,
    };
}

// ============================================================================
// Path Refinement Strategies
// ============================================================================

/**
 * Snap path points to the nearest reference edge pixel within a given radius.
 * This corrects small deviations caused by path simplification.
 */
export function snapPathsToEdges(
    paths: PathData[],
    referenceEdges: Uint8ClampedArray,
    width: number,
    height: number,
    snapRadius: number = 3
): PathData[] {
    return paths.map(path => {
        const snappedPoints = path.points.map(point => {
            const px = Math.round(point.x);
            const py = Math.round(point.y);

            // Check if already on an edge pixel
            if (px >= 0 && px < width && py >= 0 && py < height) {
                if (referenceEdges[py * width + px] > 0) {
                    return point; // Already accurate
                }
            }

            // Search within radius for nearest edge pixel
            let bestDist = Infinity;
            let bestX = point.x;
            let bestY = point.y;

            for (let dy = -snapRadius; dy <= snapRadius; dy++) {
                for (let dx = -snapRadius; dx <= snapRadius; dx++) {
                    const nx = px + dx;
                    const ny = py + dy;

                    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

                    if (referenceEdges[ny * width + nx] > 0) {
                        const dist = dx * dx + dy * dy;
                        if (dist < bestDist) {
                            bestDist = dist;
                            bestX = nx;
                            bestY = ny;
                        }
                    }
                }
            }

            return { x: bestX, y: bestY };
        });

        return { ...path, points: snappedPoints };
    });
}

/**
 * Remove spurious paths whose points mostly don't correspond to reference edges.
 * These are typically noise artifacts from over-sensitive edge detection.
 */
export function removeSpuriousPaths(
    paths: PathData[],
    referenceEdges: Uint8ClampedArray,
    width: number,
    height: number,
    spuriousThreshold: number = 0.7,
    checkRadius: number = 2
): PathData[] {
    return paths.filter(path => {
        if (path.points.length < 3) return false;

        let unmatchedCount = 0;
        let totalChecked = 0;

        for (const point of path.points) {
            const px = Math.round(point.x);
            const py = Math.round(point.y);
            totalChecked++;

            // Check if there's a reference edge pixel nearby
            let found = false;
            for (let dy = -checkRadius; dy <= checkRadius && !found; dy++) {
                for (let dx = -checkRadius; dx <= checkRadius; dx++) {
                    const nx = px + dx;
                    const ny = py + dy;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        if (referenceEdges[ny * width + nx] > 0) {
                            found = true;
                            break;
                        }
                    }
                }
            }

            if (!found) {
                unmatchedCount++;
            }
        }

        const unmatchedFraction = totalChecked > 0 ? unmatchedCount / totalChecked : 1;
        return unmatchedFraction < spuriousThreshold;
    });
}

/**
 * Fill gaps where reference edges exist but SVG paths are missing.
 * Identifies clusters of unmatched reference pixels and re-traces contours
 * in those regions.
 */
export function fillGaps(
    existingPaths: PathData[],
    referenceEdges: Uint8ClampedArray,
    svgEdges: Uint8ClampedArray,
    width: number,
    height: number,
    gapFillMinCluster: number = 20,
    distanceTolerance: number = 2
): PathData[] {
    // Find unmatched reference pixels (reference edge pixels with no nearby SVG edge)
    const svgDistTransform = computeDistanceTransform(svgEdges, width, height);
    const unmatchedMask = new Uint8ClampedArray(width * height);

    let unmatchedCount = 0;
    for (let i = 0; i < width * height; i++) {
        if (referenceEdges[i] > 0 && svgDistTransform[i] > distanceTolerance) {
            unmatchedMask[i] = 255;
            unmatchedCount++;
        }
    }

    // If very few unmatched pixels, don't bother
    if (unmatchedCount < gapFillMinCluster) {
        return existingPaths;
    }

    // Cluster unmatched pixels using connected components
    const clusters = findConnectedComponents(unmatchedMask, width, height);

    // For each large enough cluster, extract contours and create new paths
    const newPaths: PathData[] = [];
    const defaultColor: Color = { r: 0, g: 0, b: 0, a: 255 };

    for (const cluster of clusters) {
        if (cluster.length < gapFillMinCluster) continue;

        // Create a local binary image for this cluster
        const clusterMask = new Uint8ClampedArray(width * height);
        for (const pixelIdx of cluster) {
            clusterMask[pixelIdx] = 255;
        }

        // Detect contours in the cluster region
        try {
            const contours = detectContours(clusterMask, width, height, {
                method: 'moore',
                minArea: 5,
                simplify: true,
                tolerance: 1.0,
            });

            for (const contour of contours) {
                if (contour.points.length < 3) continue;

                // Simplify the new contour
                const simplified = douglasPeucker(contour.points, 1.0);

                newPaths.push({
                    points: simplified,
                    color: defaultColor,
                    strokeWidth: 1,
                    closed: contour.isClosed,
                    id: `gap-fill-${newPaths.length}`,
                });
            }
        } catch {
            // If contour detection fails for a cluster, skip it
            continue;
        }
    }

    return [...existingPaths, ...newPaths];
}

/**
 * Find connected components in a binary image.
 * Returns an array of components, where each component is an array of pixel indices.
 */
function findConnectedComponents(
    binary: Uint8ClampedArray,
    width: number,
    height: number
): number[][] {
    const visited = new Uint8ClampedArray(width * height);
    const components: number[][] = [];

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (binary[idx] > 0 && !visited[idx]) {
                // BFS to find connected component
                const component: number[] = [];
                const queue: number[] = [idx];
                visited[idx] = 1;

                while (queue.length > 0) {
                    const current = queue.shift()!;
                    component.push(current);

                    const cx = current % width;
                    const cy = Math.floor(current / width);

                    // Check 8-connected neighbors
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            const nx = cx + dx;
                            const ny = cy + dy;
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                const nIdx = ny * width + nx;
                                if (binary[nIdx] > 0 && !visited[nIdx]) {
                                    visited[nIdx] = 1;
                                    queue.push(nIdx);
                                }
                            }
                        }
                    }
                }

                components.push(component);
            }
        }
    }

    return components;
}

/**
 * Adaptively re-simplify paths that have poor local accuracy.
 * Segments with high error are re-simplified with tighter tolerance.
 */
export function adaptiveResimplify(
    paths: PathData[],
    referenceEdges: Uint8ClampedArray,
    width: number,
    height: number,
    checkRadius: number = 2
): PathData[] {
    const refDistTransform = computeDistanceTransform(referenceEdges, width, height);

    return paths.map(path => {
        if (path.points.length < 4) return path;

        // Compute per-point accuracy
        const pointErrors: number[] = path.points.map(p => {
            const px = Math.round(p.x);
            const py = Math.round(p.y);
            if (px >= 0 && px < width && py >= 0 && py < height) {
                return refDistTransform[py * width + px];
            }
            return Infinity;
        });

        // Calculate average error
        const validErrors = pointErrors.filter(e => e !== Infinity);
        if (validErrors.length === 0) return path;
        const avgError = validErrors.reduce((a, b) => a + b, 0) / validErrors.length;

        // If average error is high, re-simplify with tighter tolerance
        if (avgError > checkRadius) {
            // Use a tighter tolerance (halved) to preserve more detail
            const tighterPoints = douglasPeucker(path.points, 0.5);
            return { ...path, points: tighterPoints };
        }

        return path;
    });
}

// ============================================================================
// Main Refinement Orchestrator
// ============================================================================

/** Default refinement options */
export const DEFAULT_REFINEMENT_OPTIONS: Required<RefinementOptions> = {
    enabled: true,
    targetAccuracy: 0.85,
    maxIterations: 3,
    snapRadius: 3,
    gapFillMinCluster: 20,
    spuriousThreshold: 0.7,
    distanceTolerance: 2,
};

/**
 * Refine SVG paths to maximize accuracy against the reference edge image.
 * 
 * Runs an iterative refinement loop:
 * 1. Rasterize current paths → compute accuracy
 * 2. If accuracy meets target, stop
 * 3. Apply refinement strategies (snap, remove spurious, fill gaps, re-simplify)
 * 4. Re-measure accuracy, repeat up to maxIterations
 * 
 * @param paths - Current SVG path data
 * @param referenceEdges - Binary edge map from the original image
 * @param width - Image width
 * @param height - Image height
 * @param options - Refinement configuration
 * @returns Refined paths with before/after accuracy metrics
 */
export function refineConversion(
    paths: PathData[],
    referenceEdges: Uint8ClampedArray,
    width: number,
    height: number,
    options: RefinementOptions = {}
): RefinementResult {
    const startTime = performance.now();
    const opts = { ...DEFAULT_REFINEMENT_OPTIONS, ...options };

    // Compute initial accuracy
    const initialEdges = rasterizePaths(paths, width, height);
    const beforeScore = computeAccuracy(
        referenceEdges, initialEdges, width, height, opts.distanceTolerance
    );

    let currentPaths = [...paths];
    let currentScore = { ...beforeScore };
    let iterationsUsed = 0;

    // Iterative refinement loop
    for (let iter = 0; iter < opts.maxIterations; iter++) {
        // Check if we've already met the target
        if (currentScore.f1Score >= opts.targetAccuracy) {
            break;
        }

        iterationsUsed = iter + 1;

        // Get current SVG edge rasterization for this iteration
        let currentSvgEdges = rasterizePaths(currentPaths, width, height);

        // Strategy 1: Remove spurious paths (improves precision)
        if (currentScore.precision < opts.targetAccuracy) {
            currentPaths = removeSpuriousPaths(
                currentPaths, referenceEdges, width, height, opts.spuriousThreshold
            );
        }

        // Strategy 2: Snap points to reference edges (improves both precision and recall)
        currentPaths = snapPathsToEdges(
            currentPaths, referenceEdges, width, height, opts.snapRadius
        );

        // Strategy 3: Adaptive re-simplification for high-error paths
        currentPaths = adaptiveResimplify(
            currentPaths, referenceEdges, width, height, opts.distanceTolerance
        );

        // Strategy 4: Fill gaps in recall (adds missing paths)
        if (currentScore.recall < opts.targetAccuracy) {
            currentSvgEdges = rasterizePaths(currentPaths, width, height);
            currentPaths = fillGaps(
                currentPaths,
                referenceEdges,
                currentSvgEdges,
                width,
                height,
                opts.gapFillMinCluster,
                opts.distanceTolerance
            );
        }

        // Re-measure accuracy after refinement
        const refinedEdges = rasterizePaths(currentPaths, width, height);
        currentScore = computeAccuracy(
            referenceEdges, refinedEdges, width, height, opts.distanceTolerance
        );
    }

    const refinementTime = performance.now() - startTime;

    return {
        paths: currentPaths,
        beforeScore,
        afterScore: currentScore,
        iterationsUsed,
        refinementTime,
    };
}

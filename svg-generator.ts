/**
 * CAD to SVG Converter - SVG Generation Module
 * Converts extracted paths to optimized SVG format
 */

import {
  Point,
  PathData,
  SVGPath,
  Layer,
  Color,
  SVGOptions,
  SVGMetadata,
  BoundingBox,
} from './types';
import {
  colorToHex,
  colorToRgba,
} from './image-processor';
import { BezierSegment } from './path-simplification';

// ============================================================================
// Path String Generation
// ============================================================================

/**
 * Convert point to SVG path command string
 */
export function pointsToPathString(
  points: Point[],
  closed: boolean = true,
  precision: number = 3
): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M${toFixed(points[0].x, precision)},${toFixed(points[0].y, precision)}`;
  }

  const round = (n: number) => toFixed(n, precision);

  // Start with move command
  let d = `M${round(points[0].x)},${round(points[0].y)}`;

  // Add line commands
  for (let i = 1; i < points.length; i++) {
    d += ` L${round(points[i].x)},${round(points[i].y)}`;
  }

  // Close path if requested
  if (closed) {
    d += ' Z';
  }

  return d;
}

/**
 * Convert points to smooth curve path using quadratic curves
 */
export function pointsToSmoothPath(
  points: Point[],
  closed: boolean = true,
  tension: number = 0.5,
  precision: number = 3
): string {
  if (points.length < 3) return pointsToPathString(points, closed, precision);

  const round = (n: number) => toFixed(n, precision);

  // Calculate control points for smooth curves
  const controlPoints = calculateSmoothControlPoints(points, tension);

  let d = `M${round(points[0].x)},${round(points[0].y)}`;

  for (let i = 0; i < points.length - 1; i++) {
    const cp1 = controlPoints[i * 2];
    const cp2 = controlPoints[i * 2 + 1];

    d += ` C${round(cp1.x)},${round(cp1.y)} ${round(cp2.x)},${round(cp2.y)} ${round(points[i + 1].x)},${round(points[i + 1].y)}`;
  }

  if (closed && points.length > 2) {
    const cp1 = controlPoints[(points.length - 1) * 2];
    const cp2 = controlPoints[1]; // Wrap around

    d += ` C${round(cp1.x)},${round(cp1.y)} ${round(cp2.x)},${round(cp2.y)} ${round(points[0].x)},${round(points[0].y)}`;
    d += ' Z';
  }

  return d;
}

/**
 * Calculate control points for smooth cubic Bezier curves
 */
function calculateSmoothControlPoints(
  points: Point[],
  tension: number
): Point[] {
  const n = points.length;
  const controlPoints: Point[] = [];

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];

    // Calculate tangent direction
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist === 0) {
      controlPoints.push({ x: curr.x, y: curr.y });
      controlPoints.push({ x: curr.x, y: curr.y });
      continue;
    }

    // Normalize and scale by tension
    const scale = dist * tension * 0.25;
    const tx = (dx / dist) * scale;
    const ty = (dy / dist) * scale;

    // Two control points per point
    controlPoints.push({
      x: curr.x - tx,
      y: curr.y - ty,
    });
    controlPoints.push({
      x: curr.x + tx,
      y: curr.y + ty,
    });
  }

  return controlPoints;
}

/**
 * Convert Bezier segments to SVG path string
 */
export function bezierSegmentsToPath(
  segments: BezierSegment[],
  closed: boolean = false,
  precision: number = 3
): string {
  if (segments.length === 0) return '';

  const round = (n: number) => toFixed(n, precision);
  let d = `M${round(segments[0].start.x)},${round(segments[0].start.y)}`;

  for (const seg of segments) {
    d += ` C${round(seg.control1.x)},${round(seg.control1.y)} ${round(seg.control2.x)},${round(seg.control2.y)} ${round(seg.end.x)},${round(seg.end.y)}`;
  }

  if (closed) d += ' Z';

  return d;
}

/**
 * Convert relative/absolute coordinates
 */
export function optimizePathString(d: string): string {
  // Simple optimization: convert to relative commands where shorter
  const commands = d.split(/(?=[MLHVCSQTAZmlhvcsqtaz])/);
  
  let optimized = '';
  let currentX = 0, currentY = 0;
  let firstMove = true;

  for (const cmd of commands) {
    if (!cmd.trim()) continue;

    const type = cmd[0];
    const args = cmd.slice(1).trim().split(/[\s,]+/).map(Number);

    switch (type) {
      case 'M':
        currentX = args[0];
        currentY = args[1];
        if (firstMove) {
          optimized += cmd;
          firstMove = false;
        } else {
          optimized += ` L${args[0]},${args[1]}`;
        }
        break;
      case 'L':
        for (let i = 0; i < args.length; i += 2) {
          const x = args[i], y = args[i + 1];
          // Use horizontal/vertical lines when possible
          if (Math.abs(x - currentX) < 0.1) {
            optimized += ` V${toFixed(y, 3)}`;
          } else if (Math.abs(y - currentY) < 0.1) {
            optimized += ` H${toFixed(x, 3)}`;
          } else {
            optimized += ` L${toFixed(x, 3)},${toFixed(y, 3)}`;
          }
          currentX = x;
          currentY = y;
        }
        break;
      case 'Z':
        optimized += ' Z';
        break;
      default:
        optimized += cmd;
    }
  }

  return optimized;
}

// ============================================================================
// SVG Document Generation
// ============================================================================

const SVG_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" 
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="{{width}}" 
     height="{{height}}" 
     viewBox="{{viewBox}}"
     preserveAspectRatio="{{preserveAspectRatio}}">
{{metadata}}
{{defs}}
{{content}}
</svg>`;

/**
 * Generate complete SVG document
 */
export function generateSVG(
  paths: PathData[],
  width: number,
  height: number,
  options: SVGOptions = {},
  metadata?: SVGMetadata,
  layers?: Layer[]
): string {
  const {
    viewBox = { x: 0, y: 0, width, height },
    preserveAspectRatio = 'xMidYMid meet',
    precision = 3,
    optimize = true,
    addMetadata = true,
    addLayerGroups = true,
    strokeWidth = 1,
  } = options;

  // Generate metadata section
  const metadataSection = addMetadata ? generateMetadataSection(metadata) : '';

  // Generate defs section (gradients, patterns, etc.)
  const defsSection = generateDefsSection(paths);

  // Generate content
  let content: string;

  if (addLayerGroups && layers && layers.length > 0) {
    content = generateLayeredContent(paths, layers, precision, strokeWidth);
  } else {
    content = generateFlatContent(paths, precision, strokeWidth);
  }

  // Build SVG string
  let svg = SVG_TEMPLATE
    .replace('{{width}}', String(width))
    .replace('{{height}}', String(height))
    .replace('{{viewBox}}', `${toFixed(viewBox.x, precision)} ${toFixed(viewBox.y, precision)} ${toFixed(viewBox.width, precision)} ${toFixed(viewBox.height, precision)}`)
    .replace('{{preserveAspectRatio}}', preserveAspectRatio)
    .replace('{{metadata}}', metadataSection)
    .replace('{{defs}}', defsSection)
    .replace('{{content}}', content);

  // Optimize if requested
  if (optimize) {
    svg = optimizeSVG(svg);
  }

  return svg;
}

/**
 * Generate metadata section
 */
function generateMetadataSection(metadata?: SVGMetadata): string {
  if (!metadata) return '';

  let section = '<metadata>\n';

  if (metadata.title) {
    section += `  <title>${escapeXML(metadata.title)}</title>\n`;
  }
  if (metadata.description) {
    section += `  <desc>${escapeXML(metadata.description)}</desc>\n`;
  }

  section += '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n';
  section += '    <rdf:Description>\n';

  if (metadata.creator) {
    section += `      <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">${escapeXML(metadata.creator)}</dc:creator>\n`;
  }
  if (metadata.date) {
    section += `      <dc:date xmlns:dc="http://purl.org/dc/elements/1.1/">${escapeXML(metadata.date)}</dc:date>\n`;
  }
  if (metadata.source) {
    section += `      <dc:source xmlns:dc="http://purl.org/dc/elements/1.1/">${escapeXML(metadata.source)}</dc:source>\n`;
  }

  section += '    </rdf:Description>\n';
  section += '  </rdf:RDF>\n';
  section += '</metadata>\n';

  return section;
}

/**
 * Generate defs section
 */
function generateDefsSection(paths: PathData[]): string {
  const uniqueColors = new Map<string, string>();
  let id = 0;

  // Collect unique colors
  for (const path of paths) {
    const colorKey = `${path.color.r}-${path.color.g}-${path.color.b}`;
    if (!uniqueColors.has(colorKey)) {
      uniqueColors.set(colorKey, `color-${id++}`);
    }
  }

  // If only one or two colors, no need for defs
  if (uniqueColors.size <= 2) return '<defs></defs>';

  // Generate color definitions
  let defs = '<defs>\n';

  for (const [colorKey, colorId] of uniqueColors) {
    const [r, g, b] = colorKey.split('-').map(Number);
    defs += `  <solidColor id="${colorId}" solid-color="rgb(${r},${g},${b})"/>\n`;
  }

  defs += '</defs>\n';

  return defs;
}

/**
 * Generate flat content (no layers)
 */
function generateFlatContent(
  paths: PathData[],
  precision: number,
  defaultStrokeWidth: number
): string {
  let content = '<g id="main">\n';

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const d = pointsToPathString(path.points, path.closed, precision);

    const style = generatePathStyle(path, defaultStrokeWidth);

    content += `  <path d="${d}"${style}/>\n`;
  }

  content += '</g>\n';

  return content;
}

/**
 * Generate layered content
 */
function generateLayeredContent(
  paths: PathData[],
  layers: Layer[],
  precision: number,
  defaultStrokeWidth: number
): string {
  let content = '';

  for (const layer of layers) {
    content += `<g id="${escapeXML(layer.id)}" data-name="${escapeXML(layer.name)}"${layer.visible ? '' : ' style="display:none"'}>\n`;

    for (const path of layer.paths) {
      const d = pointsToPathString(path.points, path.closed, precision);
      const style = generatePathStyle(path, defaultStrokeWidth);

      content += `  <path d="${d}"${style}/>\n`;
    }

    content += '</g>\n';
  }

  return content;
}

/**
 * Generate path style attributes
 */
function generatePathStyle(path: PathData, defaultStrokeWidth: number): string {
  const strokeColor = colorToHex(path.color);
  const strokeWidth = path.strokeWidth || defaultStrokeWidth;

  let style = ` stroke="${strokeColor}" stroke-width="${strokeWidth}"`;

  if (path.closed) {
    // For closed paths, fill with transparent or the color
    style += ' fill="none"';
  } else {
    style += ' fill="none"';
  }

  if (path.id) {
    style += ` id="${escapeXML(path.id)}"`;
  }

  return style;
}

/**
 * Optimize SVG string
 */
function optimizeSVG(svg: string): string {
  // Remove unnecessary whitespace
  svg = svg.replace(/>\s+</g, '><');

  // Remove leading/trailing whitespace in path data
  svg = svg.replace(/ d="([^"]+)"/g, (_, d) => {
    // Collapse multiple spaces
    let optimized = d.replace(/\s+/g, ' ').trim();
    // Remove space around commands
    optimized = optimized.replace(/\s*([MLHVCSQTAZmlhvcsqtaz])\s*/g, '$1');
    // Remove space before numbers after commands
    optimized = optimized.replace(/([MLHVCSQTAZmlhvcsqtaz])\s+(-?\d)/g, '$1$2');
    // Remove unnecessary decimals
    optimized = optimized.replace(/\.(\d{3,})/g, (_, digits) => {
      const trimmed = digits.replace(/0+$/, '');
      return trimmed ? `.${trimmed}` : '';
    });
    return ` d="${optimized}"`;
  });

  return svg;
}

// ============================================================================
// Path Extraction and Organization
// ============================================================================

/**
 * Convert contours to path data
 */
export function contoursToPathData(
  contours: Array<{
    points: Point[];
    isClosed: boolean;
    isHole: boolean;
  }>,
  color: Color,
  strokeWidth: number = 1
): PathData[] {
  return contours.map((contour, index) => ({
    points: contour.points,
    color,
    strokeWidth,
    closed: contour.isClosed,
    id: `path-${index}`,
  }));
}

/**
 * Group paths by color
 */
export function groupPathsByColor(paths: PathData[]): Map<string, PathData[]> {
  const groups = new Map<string, PathData[]>();

  for (const path of paths) {
    const colorKey = colorToHex(path.color);

    if (!groups.has(colorKey)) {
      groups.set(colorKey, []);
    }

    groups.get(colorKey)!.push(path);
  }

  return groups;
}

/**
 * Create layers from color groups
 */
export function createLayersFromColors(
  colorGroups: Map<string, PathData[]>
): Layer[] {
  const layers: Layer[] = [];
  let index = 0;

  for (const [colorKey, paths] of colorGroups) {
    const layer: Layer = {
      id: `layer-${index}`,
      name: `Layer ${index + 1}`,
      color: paths[0].color,
      paths,
      visible: true,
      locked: false,
    };

    layers.push(layer);
    index++;
  }

  return layers;
}

/**
 * Calculate bounding box for multiple paths
 */
export function calculatePathsBoundingBox(paths: PathData[]): BoundingBox {
  if (paths.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const path of paths) {
    for (const point of path.points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Round number to specified decimal places
 */
function toFixed(num: number, precision: number): string {
  const factor = Math.pow(10, precision);
  return (Math.round(num * factor) / factor).toFixed(precision).replace(/\.?0+$/, '');
}

/**
 * Escape XML special characters
 */
function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convert path data to individual SVG path elements
 */
export function pathsToSVGPaths(
  paths: PathData[],
  precision: number = 3,
  defaultStrokeWidth: number = 1
): SVGPath[] {
  return paths.map((path, index) => ({
    d: pointsToPathString(path.points, path.closed, precision),
    fill: 'none',
    stroke: colorToHex(path.color),
    strokeWidth: path.strokeWidth || defaultStrokeWidth,
    id: path.id || `path-${index}`,
  }));
}

/**
 * Generate inline SVG element string
 */
export function generateInlineSVG(
  paths: PathData[],
  width: number,
  height: number,
  options: SVGOptions = {}
): string {
  const { strokeWidth = 1, precision = 3 } = options;

  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const d = pointsToPathString(path.points, path.closed, precision);
    svg += `<path d="${d}" stroke="${colorToHex(path.color)}" stroke-width="${path.strokeWidth || strokeWidth}" fill="none"/>`;
  }

  svg += '</svg>';

  return svg;
}

/**
 * Generate SVG with data URI encoding
 */
export function generateSVGDataURI(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/**
 * Generate downloadable SVG blob
 */
export function generateSVGBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml' });
}

/**
 * Create download link for SVG
 */
export function createSVGDownloadLink(svg: string, filename: string = 'converted.svg'): string {
  const blob = generateSVGBlob(svg);
  return URL.createObjectURL(blob);
}

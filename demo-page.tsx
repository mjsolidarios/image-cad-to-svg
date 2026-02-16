'use client'

import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { 
  Upload, 
  Download, 
  Settings, 
  Image as ImageIcon, 
  Code, 
  Layers, 
  Palette,
  Loader2,
  CheckCircle,
  AlertCircle,
  Zap,
  Info
} from 'lucide-react'

// Types for our converter
interface ConversionResult {
  svg: string
  width: number
  height: number
  pathCount: number
  layerCount: number
  conversionTime: number
  colorGroups: Array<{
    color: { r: number; g: number; b: number }
    count: number
    percentage: number
  }>
}

interface ConversionProgress {
  stage: string
  progress: number
  message: string
}

export default function CADToSVGPage() {
  const [originalImage, setOriginalImage] = useState<string | null>(null)
  const [originalFileName, setOriginalFileName] = useState<string>('')
  const [result, setResult] = useState<ConversionResult | null>(null)
  const [isConverting, setIsConverting] = useState(false)
  const [progress, setProgress] = useState<ConversionProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  // Conversion options
  const [edgeMethod, setEdgeMethod] = useState<string>('canny')
  const [lowThreshold, setLowThreshold] = useState<number>(50)
  const [highThreshold, setHighThreshold] = useState<number>(150)
  const [gaussianBlur, setGaussianBlur] = useState<number>(1.4)
  const [contourMethod, setContourMethod] = useState<string>('suzuki')
  const [simplifyTolerance, setSimplifyTolerance] = useState<number>(1)
  const [minArea, setMinArea] = useState<number>(10)
  const [strokeWidth, setStrokeWidth] = useState<number>(1)
  const [precision, setPrecision] = useState<number>(3)
  const [smoothCurves, setSmoothCurves] = useState<boolean>(false)
  const [detectLayers, setDetectLayers] = useState<boolean>(true)
  const [invertColors, setInvertColors] = useState<boolean>(false)
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Handle file upload
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setError(null)
    setResult(null)
    setOriginalFileName(file.name)

    const reader = new FileReader()
    reader.onload = (event) => {
      setOriginalImage(event.target?.result as string)
    }
    reader.readAsDataURL(file)
  }, [])

  // Handle drag and drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) {
      setError(null)
      setResult(null)
      setOriginalFileName(file.name)

      const reader = new FileReader()
      reader.onload = (event) => {
        setOriginalImage(event.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  // Perform conversion
  const handleConvert = useCallback(async () => {
    if (!originalImage) return

    setIsConverting(true)
    setError(null)
    setProgress({ stage: 'loading', progress: 0, message: 'Starting conversion...' })

    try {
      // Load image onto canvas for processing
      const img = new Image()
      img.crossOrigin = 'anonymous'
      
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Failed to load image'))
        img.src = originalImage
      })

      const canvas = canvasRef.current
      if (!canvas) throw new Error('Canvas not available')

      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not get canvas context')

      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

      setProgress({ stage: 'edge-detection', progress: 10, message: 'Processing image...' })

      // Call our conversion API
      const response = await fetch('/api/cad-to-svg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageData: Array.from(imageData.data),
          width: imageData.width,
          height: imageData.height,
          options: {
            edgeDetection: {
              method: edgeMethod,
              lowThreshold,
              highThreshold,
              gaussianBlur,
            },
            contourDetection: {
              method: contourMethod,
              minArea,
              simplify: true,
              tolerance: simplifyTolerance,
            },
            svg: {
              strokeWidth,
              precision,
            },
            smoothCurves,
            detectLayers,
            invertColors,
          },
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Conversion failed')
      }

      const data = await response.json()
      setResult(data)
      setProgress({ stage: 'complete', progress: 100, message: 'Conversion complete!' })

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred during conversion')
      setProgress(null)
    } finally {
      setIsConverting(false)
    }
  }, [originalImage, edgeMethod, lowThreshold, highThreshold, gaussianBlur, contourMethod, minArea, simplifyTolerance, strokeWidth, precision, smoothCurves, detectLayers, invertColors])

  // Download SVG
  const handleDownload = useCallback(() => {
    if (!result) return

    const blob = new Blob([result.svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = originalFileName.replace(/\.[^.]+$/, '.svg')
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [result, originalFileName])

  // Copy SVG to clipboard
  const handleCopy = useCallback(() => {
    if (!result) return
    navigator.clipboard.writeText(result.svg)
  }, [result])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="border-b border-slate-700 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <Layers className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">CAD to SVG Converter</h1>
                <p className="text-sm text-slate-400">Accurate 2D CAD image vectorization</p>
              </div>
            </div>
            <Badge variant="outline" className="text-slate-300 border-slate-600">
              v1.0.0
            </Badge>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Panel - Upload & Settings */}
          <div className="lg:col-span-1 space-y-6">
            {/* Upload Section */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Upload className="w-5 h-5" />
                  Upload Image
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Upload a PNG, JPG, or other image file to convert
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                    originalImage 
                      ? 'border-green-500 bg-green-500/10' 
                      : 'border-slate-600 hover:border-slate-500 hover:bg-slate-700/50'
                  }`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/*"
                    onChange={handleFileUpload}
                  />
                  {originalImage ? (
                    <div className="space-y-2">
                      <CheckCircle className="w-10 h-10 text-green-500 mx-auto" />
                      <p className="text-slate-300 font-medium">{originalFileName}</p>
                      <p className="text-slate-500 text-sm">Click to change</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <ImageIcon className="w-10 h-10 text-slate-500 mx-auto" />
                      <p className="text-slate-400">Drag & drop an image here</p>
                      <p className="text-slate-500 text-sm">or click to browse</p>
                    </div>
                  )}
                </div>

                {/* Convert Button */}
                <Button
                  className="w-full mt-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                  onClick={handleConvert}
                  disabled={!originalImage || isConverting}
                >
                  {isConverting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Converting...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 mr-2" />
                      Convert to SVG
                    </>
                  )}
                </Button>

                {/* Progress */}
                {progress && (
                  <div className="mt-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">{progress.stage}</span>
                      <span className="text-slate-300">{progress.progress}%</span>
                    </div>
                    <Progress value={progress.progress} className="h-2" />
                    <p className="text-xs text-slate-500">{progress.message}</p>
                  </div>
                )}

                {/* Error */}
                {error && (
                  <Alert variant="destructive" className="mt-4">
                    <AlertCircle className="w-4 h-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Settings */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Settings className="w-5 h-5" />
                  Conversion Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Edge Detection */}
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-slate-300">Edge Detection</h4>
                  
                  <div className="space-y-2">
                    <Label className="text-slate-400">Method</Label>
                    <Select value={edgeMethod} onValueChange={setEdgeMethod}>
                      <SelectTrigger className="bg-slate-700 border-slate-600">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="canny">Canny (Recommended)</SelectItem>
                        <SelectItem value="sobel">Sobel</SelectItem>
                        <SelectItem value="prewitt">Prewitt</SelectItem>
                        <SelectItem value="roberts">Roberts Cross</SelectItem>
                        <SelectItem value="laplacian">Laplacian</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {edgeMethod === 'canny' && (
                    <>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Label className="text-slate-400">Low Threshold</Label>
                          <span className="text-slate-500 text-sm">{lowThreshold}</span>
                        </div>
                        <Slider
                          value={[lowThreshold]}
                          onValueChange={([v]) => setLowThreshold(v)}
                          min={0}
                          max={255}
                          step={1}
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Label className="text-slate-400">High Threshold</Label>
                          <span className="text-slate-500 text-sm">{highThreshold}</span>
                        </div>
                        <Slider
                          value={[highThreshold]}
                          onValueChange={([v]) => setHighThreshold(v)}
                          min={0}
                          max={255}
                          step={1}
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Label className="text-slate-400">Gaussian Blur</Label>
                          <span className="text-slate-500 text-sm">{gaussianBlur.toFixed(1)}</span>
                        </div>
                        <Slider
                          value={[gaussianBlur * 10]}
                          onValueChange={([v]) => setGaussianBlur(v / 10)}
                          min={1}
                          max={50}
                          step={1}
                        />
                      </div>
                    </>
                  )}
                </div>

                <Separator className="bg-slate-700" />

                {/* Contour Detection */}
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-slate-300">Contour Detection</h4>
                  
                  <div className="space-y-2">
                    <Label className="text-slate-400">Method</Label>
                    <Select value={contourMethod} onValueChange={setContourMethod}>
                      <SelectTrigger className="bg-slate-700 border-slate-600">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="suzuki">Suzuki-Abe (Recommended)</SelectItem>
                        <SelectItem value="moore">Moore Neighborhood</SelectItem>
                        <SelectItem value="marching-squares">Marching Squares</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label className="text-slate-400">Simplify Tolerance</Label>
                      <span className="text-slate-500 text-sm">{simplifyTolerance}</span>
                    </div>
                    <Slider
                      value={[simplifyTolerance]}
                      onValueChange={([v]) => setSimplifyTolerance(v)}
                      min={0.5}
                      max={10}
                      step={0.5}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label className="text-slate-400">Minimum Area</Label>
                      <span className="text-slate-500 text-sm">{minArea}px²</span>
                    </div>
                    <Slider
                      value={[minArea]}
                      onValueChange={([v]) => setMinArea(v)}
                      min={1}
                      max={1000}
                      step={1}
                    />
                  </div>
                </div>

                <Separator className="bg-slate-700" />

                {/* SVG Options */}
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-slate-300">SVG Output</h4>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label className="text-slate-400">Stroke Width</Label>
                      <span className="text-slate-500 text-sm">{strokeWidth}px</span>
                    </div>
                    <Slider
                      value={[strokeWidth]}
                      onValueChange={([v]) => setStrokeWidth(v)}
                      min={0.5}
                      max={5}
                      step={0.5}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label className="text-slate-400">Precision</Label>
                      <span className="text-slate-500 text-sm">{precision} decimals</span>
                    </div>
                    <Slider
                      value={[precision]}
                      onValueChange={([v]) => setPrecision(v)}
                      min={1}
                      max={6}
                      step={1}
                    />
                  </div>
                </div>

                <Separator className="bg-slate-700" />

                {/* Advanced Options */}
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-slate-300">Advanced</h4>
                  
                  <div className="flex items-center justify-between">
                    <Label className="text-slate-400">Smooth Curves</Label>
                    <Switch
                      checked={smoothCurves}
                      onCheckedChange={setSmoothCurves}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label className="text-slate-400">Detect Layers</Label>
                    <Switch
                      checked={detectLayers}
                      onCheckedChange={setDetectLayers}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label className="text-slate-400">Invert Colors</Label>
                    <Switch
                      checked={invertColors}
                      onCheckedChange={setInvertColors}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Panel - Preview & Results */}
          <div className="lg:col-span-2 space-y-6">
            {/* Preview Tabs */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white">Preview</CardTitle>
                  {result && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopy}
                        className="border-slate-600 text-slate-300"
                      >
                        Copy SVG
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleDownload}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="result" className="w-full">
                  <TabsList className="bg-slate-700 w-full">
                    <TabsTrigger value="result" className="flex-1">
                      <ImageIcon className="w-4 h-4 mr-2" />
                      Result
                    </TabsTrigger>
                    <TabsTrigger value="original" className="flex-1">
                      <ImageIcon className="w-4 h-4 mr-2" />
                      Original
                    </TabsTrigger>
                    <TabsTrigger value="code" className="flex-1">
                      <Code className="w-4 h-4 mr-2" />
                      SVG Code
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="result" className="mt-4">
                    <div className="bg-slate-900 rounded-lg p-4 min-h-[400px] flex items-center justify-center">
                      {result ? (
                        <div 
                          className="max-w-full max-h-[600px] overflow-auto"
                          dangerouslySetInnerHTML={{ __html: result.svg }}
                        />
                      ) : (
                        <div className="text-center text-slate-500">
                          <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
                          <p>Converted SVG will appear here</p>
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="original" className="mt-4">
                    <div className="bg-slate-900 rounded-lg p-4 min-h-[400px] flex items-center justify-center">
                      {originalImage ? (
                        <img
                          src={originalImage}
                          alt="Original"
                          className="max-w-full max-h-[600px] object-contain"
                        />
                      ) : (
                        <div className="text-center text-slate-500">
                          <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
                          <p>Original image will appear here</p>
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="code" className="mt-4">
                    <div className="bg-slate-900 rounded-lg p-4 min-h-[400px] max-h-[600px] overflow-auto">
                      {result ? (
                        <pre className="text-xs text-slate-300 whitespace-pre-wrap break-all font-mono">
                          {result.svg}
                        </pre>
                      ) : (
                        <div className="text-center text-slate-500">
                          <Code className="w-16 h-16 mx-auto mb-4 opacity-50" />
                          <p>SVG code will appear here</p>
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* Results Stats */}
            {result && (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Info className="w-5 h-5" />
                    Conversion Results
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-slate-700/50 rounded-lg p-4">
                      <p className="text-slate-400 text-sm">Dimensions</p>
                      <p className="text-white font-medium">{result.width} × {result.height}</p>
                    </div>
                    <div className="bg-slate-700/50 rounded-lg p-4">
                      <p className="text-slate-400 text-sm">Paths</p>
                      <p className="text-white font-medium">{result.pathCount}</p>
                    </div>
                    <div className="bg-slate-700/50 rounded-lg p-4">
                      <p className="text-slate-400 text-sm">Layers</p>
                      <p className="text-white font-medium">{result.layerCount}</p>
                    </div>
                    <div className="bg-slate-700/50 rounded-lg p-4">
                      <p className="text-slate-400 text-sm">Time</p>
                      <p className="text-white font-medium">{result.conversionTime.toFixed(0)}ms</p>
                    </div>
                  </div>

                  {/* Color Groups */}
                  {result.colorGroups.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                        <Palette className="w-4 h-4" />
                        Detected Colors
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {result.colorGroups.slice(0, 10).map((group, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 bg-slate-700/50 rounded-full px-3 py-1"
                          >
                            <div
                              className="w-4 h-4 rounded-full border border-slate-500"
                              style={{
                                backgroundColor: `rgb(${group.color.r}, ${group.color.g}, ${group.color.b})`
                              }}
                            />
                            <span className="text-xs text-slate-300">
                              {group.count} paths ({group.percentage.toFixed(1)}%)
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Features */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white">Library Features</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium text-slate-300">Edge Detection</h4>
                    <ul className="text-sm text-slate-400 space-y-1">
                      <li>• Canny edge detection (recommended)</li>
                      <li>• Sobel operator</li>
                      <li>• Prewitt operator</li>
                      <li>• Roberts cross</li>
                      <li>• Laplacian</li>
                    </ul>
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium text-slate-300">Contour Detection</h4>
                    <ul className="text-sm text-slate-400 space-y-1">
                      <li>• Suzuki-Abe algorithm</li>
                      <li>• Moore neighborhood tracing</li>
                      <li>• Marching squares</li>
                      <li>• Hole detection</li>
                      <li>• Area filtering</li>
                    </ul>
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium text-slate-300">Path Optimization</h4>
                    <ul className="text-sm text-slate-400 space-y-1">
                      <li>• Douglas-Peucker simplification</li>
                      <li>• Visvalingam-Whyatt</li>
                      <li>• Chaikin curve smoothing</li>
                      <li>• Bezier curve fitting</li>
                      <li>• Gaussian smoothing</li>
                    </ul>
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium text-slate-300">Color Analysis</h4>
                    <ul className="text-sm text-slate-400 space-y-1">
                      <li>• Automatic background detection</li>
                      <li>• CAD line color extraction</li>
                      <li>• K-means clustering</li>
                      <li>• Median cut quantization</li>
                      <li>• Layer grouping</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Hidden canvas for processing */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}

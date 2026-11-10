// GPU fill layer for the fan chart: wedges are tessellated once per zoom band into a static vertex
// buffer (world coordinates + RGBA), and each frame is a single draw call with the camera as uniforms.

const VS = `
attribute vec2 a_pos;
attribute vec4 a_col;
uniform vec2 u_center;   // world point shown at the screen center
uniform vec2 u_screen;   // screen-center in CSS px
uniform float u_k;       // zoom (CSS px per world unit)
uniform vec2 u_size;     // canvas size in CSS px
varying vec4 v_col;
void main() {
  vec2 s = (a_pos - u_center) * u_k + u_screen;
  vec2 clip = s / u_size * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_col = a_col;
}`
const FS = `
precision mediump float;
varying vec4 v_col;
void main() { gl_FragColor = vec4(v_col.rgb * v_col.a, v_col.a); }`

export interface GLMesh { buf: WebGLBuffer; count: number }

export class GLFill {
  gl: WebGLRenderingContext
  private prog: WebGLProgram
  private loc: { pos: number; col: number; center: WebGLUniformLocation; screen: WebGLUniformLocation; k: WebGLUniformLocation; size: WebGLUniformLocation }
  w = 0; h = 0; dpr = 1

  static create(canvas: HTMLCanvasElement): GLFill | null {
    try {
      const gl = canvas.getContext('webgl', { antialias: true, alpha: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }) as WebGLRenderingContext | null
      return gl ? new GLFill(gl) : null
    } catch { return null }
  }
  private constructor(gl: WebGLRenderingContext) {
    this.gl = gl
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader')
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link')
    this.prog = p
    this.loc = {
      pos: gl.getAttribLocation(p, 'a_pos'), col: gl.getAttribLocation(p, 'a_col'),
      center: gl.getUniformLocation(p, 'u_center')!, screen: gl.getUniformLocation(p, 'u_screen')!,
      k: gl.getUniformLocation(p, 'u_k')!, size: gl.getUniformLocation(p, 'u_size')!,
    }
    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  }
  resize(w: number, h: number, dpr: number) {
    this.w = w; this.h = h; this.dpr = dpr
    const c = this.gl.canvas as HTMLCanvasElement
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr)
    c.style.width = w + 'px'; c.style.height = h + 'px'
  }
  upload(data: ArrayBuffer, count: number): GLMesh {
    const gl = this.gl
    const buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    return { buf, count }
  }
  free(m: GLMesh) { this.gl.deleteBuffer(m.buf) }
  clear(rgb: [number, number, number]) {
    const gl = this.gl
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
    gl.clearColor(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }
  draw(m: GLMesh, view: { x: number; y: number; k: number }) {
    if (!m.count) return
    const gl = this.gl, L = this.loc
    gl.useProgram(this.prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buf)
    gl.enableVertexAttribArray(L.pos)
    gl.vertexAttribPointer(L.pos, 2, gl.FLOAT, false, 12, 0)
    gl.enableVertexAttribArray(L.col)
    gl.vertexAttribPointer(L.col, 4, gl.UNSIGNED_BYTE, true, 12, 8)
    // express the camera as (world point at screen center, zoom) to keep float32 precision near the view
    const sx = this.w / 2, sy = this.h / 2
    gl.uniform2f(L.center, (sx - view.x) / view.k, (sy - view.y) / view.k)
    gl.uniform2f(L.screen, sx, sy)
    gl.uniform1f(L.k, view.k)
    gl.uniform2f(L.size, this.w, this.h)
    gl.drawArrays(gl.TRIANGLES, 0, m.count)
  }
}

/** Growable interleaved vertex buffer: [x f32, y f32, r u8, g u8, b u8, a u8] = 12 bytes per vertex. */
export class Tess {
  private buf = new ArrayBuffer(12 * 65536)
  private f32 = new Float32Array(this.buf)
  private u8 = new Uint8Array(this.buf)
  count = 0
  private grow(n: number) {
    if ((this.count + n) * 12 <= this.buf.byteLength) return
    let size = this.buf.byteLength
    while ((this.count + n) * 12 > size) size *= 2
    const nb = new ArrayBuffer(size)
    new Uint8Array(nb).set(this.u8.subarray(0, this.count * 12))
    this.buf = nb; this.f32 = new Float32Array(nb); this.u8 = new Uint8Array(nb)
  }
  private v(x: number, y: number, c: number) {
    const o = this.count * 12
    this.f32[o >> 2] = x; this.f32[(o >> 2) + 1] = y
    this.u8[o + 8] = c >>> 24; this.u8[o + 9] = (c >>> 16) & 255; this.u8[o + 10] = (c >>> 8) & 255; this.u8[o + 11] = c & 255
    this.count++
  }
  /** annular sector b0..b1 (radians) x ri..ro (world), split into n angular segments */
  sector(b0: number, b1: number, ri: number, ro: number, n: number, rgba: number) {
    this.grow(n * 6)
    let c0 = Math.cos(b0), s0 = Math.sin(b0)
    for (let j = 1; j <= n; j++) {
      const a = b0 + ((b1 - b0) * j) / n
      const c1 = Math.cos(a), s1 = Math.sin(a)
      const ix0 = ri * c0, iy0 = ri * s0, ox0 = ro * c0, oy0 = ro * s0
      const ix1 = ri * c1, iy1 = ri * s1, ox1 = ro * c1, oy1 = ro * s1
      this.v(ix0, iy0, rgba); this.v(ox0, oy0, rgba); this.v(ox1, oy1, rgba)
      this.v(ix0, iy0, rgba); this.v(ox1, oy1, rgba); this.v(ix1, iy1, rgba)
      c0 = c1; s0 = s1
    }
  }
  data(): ArrayBuffer { return this.buf.slice(0, this.count * 12) }
}

const colCache = new Map<string, number>()
/** css color ('rgb(...)', 'rgba(...)', '#rrggbb') -> packed 0xRRGGBBAA with alpha multiplied by `alpha` */
export function packColor(css: string, alpha = 1): number {
  const key = css + '|' + alpha
  let v = colCache.get(key)
  if (v !== undefined) return v
  let r = 0, g = 0, b = 0, a = 1
  if (css[0] === '#') { r = parseInt(css.slice(1, 3), 16); g = parseInt(css.slice(3, 5), 16); b = parseInt(css.slice(5, 7), 16) }
  else { const m = css.match(/[\d.]+/g)!; r = +m[0]; g = +m[1]; b = +m[2]; if (m[3] !== undefined) a = +m[3] }
  a = Math.round(Math.max(0, Math.min(1, a * alpha)) * 255)
  v = ((r & 255) << 24 | (g & 255) << 16 | (b & 255) << 8 | a) >>> 0
  colCache.set(key, v)
  return v
}
export function rgbOf(css: string): [number, number, number] {
  const p = packColor(css)
  return [p >>> 24, (p >>> 16) & 255, (p >>> 8) & 255]
}

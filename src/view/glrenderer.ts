// WebGL layer for solid-linetype curves. Geometry is tessellated once into a GPU buffer
// (world coordinates relative to an origin) so pan/zoom only update a matrix uniform.

import { type Vec, type Mat, flattenArc, flattenBulge, mxApply, mxScaleFactor, TAU } from '../core/geom.ts';
import {
  type Entity, forEachInsertInstance, inheritFromInsert, flattenEllipse, flattenSpline,
} from '../core/entities.ts';
import type { Drawing } from '../core/document.ts';
import type { Viewport } from './viewport.ts';

type Inherit = Pick<Entity, 'layer' | 'color' | 'trueColor' | 'ltype'>;

const VS = `
attribute vec2 a_pos;
attribute vec3 a_col;
uniform vec2 u_scale;
uniform vec2 u_offset;
varying vec3 v_col;
void main() {
  gl_Position = vec4(a_pos * u_scale + u_offset, 0.0, 1.0);
  v_col = a_col;
}`;
const FS = `
precision mediump float;
varying vec3 v_col;
void main() { gl_FragColor = vec4(v_col, 1.0); }`;

export interface GLStyle {
  /** RGB 0..1 for an entity (with block inheritance applied), or null if it is hidden. */
  color(e: Entity, inherit: Inherit | undefined): [number, number, number] | null;
  /** True if the entity must be drawn by the 2D renderer (dashed linetype, wide polyline...). */
  needs2D(e: Entity, inherit: Inherit | undefined): boolean;
}

export class GLLayer {
  canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private posBuf: WebGLBuffer;
  private colBuf: WebGLBuffer;
  private aPos: number;
  private aCol: number;
  private uScale: WebGLUniformLocation;
  private uOffset: WebGLUniformLocation;
  private count = 0;
  private origin: Vec = { x: 0, y: 0 };
  /** View scale the tessellation was built for; rebuilt when zoom drifts far from it. */
  builtScale = 0;
  dpr = 1;
  segments = 0;

  static create(canvas: HTMLCanvasElement): GLLayer | null {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) return null;
    try {
      return new GLLayer(canvas, gl);
    } catch (e) {
      console.warn('WebGL unavailable:', e);
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    this.posBuf = gl.createBuffer()!;
    this.colBuf = gl.createBuffer()!;
    this.aPos = gl.getAttribLocation(p, 'a_pos');
    this.aCol = gl.getAttribLocation(p, 'a_col');
    this.uScale = gl.getUniformLocation(p, 'u_scale')!;
    this.uOffset = gl.getUniformLocation(p, 'u_offset')!;
  }

  resize(w: number, h: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  /** Tessellates all GL-drawable geometry for the given zoom level. */
  build(doc: Drawing, scale: number, style: GLStyle): void {
    const ext = doc.extents();
    this.origin = ext.minX <= ext.maxX ? { x: (ext.minX + ext.maxX) / 2, y: (ext.minY + ext.maxY) / 2 } : { x: 0, y: 0 };
    const ox = this.origin.x, oy = this.origin.y;
    // Max chord error ≈ 0.25 px at the build zoom.
    const tol = 0.25 / scale;
    let pos = new Float32Array(1 << 16);
    let col = new Float32Array(1 << 16 + 1);
    let n = 0; // vertices
    const grow = () => {
      const p2 = new Float32Array(pos.length * 2); p2.set(pos); pos = p2;
      const c2 = new Float32Array(col.length * 2); c2.set(col); col = c2;
    };
    let r = 1, g = 1, b = 1;
    let m: Mat | null = null;
    const seg = (a: Vec, c: Vec) => {
      if (n * 2 + 4 > pos.length || n * 3 + 6 > col.length) grow();
      const A = m ? mxApply(m, a) : a, C = m ? mxApply(m, c) : c;
      pos[n * 2] = A.x - ox; pos[n * 2 + 1] = A.y - oy;
      col[n * 3] = r; col[n * 3 + 1] = g; col[n * 3 + 2] = b;
      n++;
      pos[n * 2] = C.x - ox; pos[n * 2 + 1] = C.y - oy;
      col[n * 3] = r; col[n * 3 + 1] = g; col[n * 3 + 2] = b;
      n++;
    };
    const strip = (pts: Vec[], closed = false) => {
      for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);
      if (closed && pts.length > 2) seg(pts[pts.length - 1], pts[0]);
    };

    const emit = (e: Entity, inherit: Inherit | undefined, mat: Mat | null, depth: number, localTol: number) => {
      if (e.type === 'insert') {
        if (depth > 10) return;
        const blk = doc.blocks.get(e.name);
        if (!blk) return;
        const inh: Inherit = inherit ? inheritFromInsert(e, inherit) : e;
        forEachInsertInstance(e, blk, (im) => {
          const full = mat ? mul(mat, im) : im;
          const sf = mxScaleFactor(full) || 1;
          for (const be of blk.entities) emit(be, inh, full, depth + 1, tol / sf);
        });
        return;
      }
      if (!GL_TYPES.has(e.type) || style.needs2D(e, inherit)) return;
      const c = style.color(e, inherit);
      if (!c) return;
      [r, g, b] = c;
      m = mat;
      switch (e.type) {
        case 'line': seg(e.p1, e.p2); break;
        case 'circle': strip(flattenArc(e.c, e.r, 0, TAU, localTol, true)); break;
        case 'arc': strip(flattenArc(e.c, e.r, e.a0, e.a1, localTol)); break;
        case 'polyline': {
          const k = e.pts.length;
          if (k < 2) break;
          const segs = e.closed ? k : k - 1;
          for (let i = 0; i < segs; i++) {
            const a = e.pts[i], bb = e.pts[(i + 1) % k], bu = e.bulges[i] || 0;
            if (Math.abs(bu) < 1e-12) seg(a, bb);
            else strip([a, ...flattenBulge(a, bb, bu, localTol)]);
          }
          break;
        }
        case 'ellipse': strip(flattenEllipse(e, localTol)); break;
        case 'spline': strip(flattenSpline(e, localTol), e.closed); break;
      }
      m = null;
    };

    for (const e of doc.entities.values()) {
      if (!doc.isVisible(e)) continue;
      emit(e, undefined, null, 0, tol);
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos.subarray(0, n * 2), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, col.subarray(0, n * 3), gl.STATIC_DRAW);
    this.count = n;
    this.segments = n / 2;
    this.builtScale = scale;
  }

  draw(v: Viewport): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.count) return;
    gl.useProgram(this.prog);
    // clip = (world - center) * scale * 2 / size ; world = local + origin
    const sx = (2 * v.scale) / v.w, sy = (2 * v.scale) / v.h;
    gl.uniform2f(this.uScale, sx, sy);
    gl.uniform2f(this.uOffset, (this.origin.x - v.cx) * sx, (this.origin.y - v.cy) * sy);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.enableVertexAttribArray(this.aCol);
    gl.vertexAttribPointer(this.aCol, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, this.count);
  }

  clear(): void {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}

export const GL_TYPES = new Set(['line', 'circle', 'arc', 'polyline', 'ellipse', 'spline']);

function mul(a: Mat, b: Mat): Mat {
  return {
    a: a.a * b.a + a.c * b.b, b: a.b * b.a + a.d * b.b,
    c: a.a * b.c + a.c * b.d, d: a.b * b.c + a.d * b.d,
    e: a.a * b.e + a.c * b.f + a.e, f: a.b * b.e + a.d * b.f + a.f,
  };
}

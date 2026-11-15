import { launch } from './browser.mjs';
const b = await launch({ width: 800, height: 450 });
const p = await b.newPage();
await p.goto('about:blank');
const info = await p.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 3840; c.height = 2160;
  const gl = c.getContext('webgl2');
  if (!gl) return { err: 'no webgl2' };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : '',
    maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE), max3D: gl.getParameter(gl.MAX_3D_TEXTURE_SIZE),
    maxRB: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), maxDraw: gl.getParameter(gl.MAX_DRAW_BUFFERS),
    cbf: !!gl.getExtension('EXT_color_buffer_float'), cbhf: !!gl.getExtension('EXT_color_buffer_half_float'),
    floatLinear: !!gl.getExtension('OES_texture_float_linear'), clip: !!gl.getExtension('EXT_clip_control'),
    aniso: !!gl.getExtension('EXT_texture_filter_anisotropic'), dbw: gl.drawingBufferWidth, dbh: gl.drawingBufferHeight,
    ua: navigator.userAgent, cores: navigator.hardwareConcurrency, mem: navigator.deviceMemory,
  };
});
console.log(JSON.stringify(info, null, 1));
await b.close();

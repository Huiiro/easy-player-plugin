<template>
  <canvas ref="canvasRef" class="aurora-canvas"></canvas>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const canvasRef = ref(null)

let animationId = null
let gl = null
let program = null
let timeLocation = null
let resolutionLocation = null

// 顶点着色器
const vertexShaderSource = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`

// 片元着色器 - 修复版极光算法，消除空白区域
const fragmentShaderSource = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  
  // 随机函数
  float random (vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
  }
  
  // 噪声函数
  float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 st) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 4.0;
    for(int i = 0; i < 5; i++) {
      value += amplitude * noise(st * frequency);
      amplitude *= 0.5;
      frequency *= 2.0;
    }
    return value;
  }

  float auroraCurve(float x, float y, float time) {
    float width = 0.3;
    float center = 0.4 + sin(time * 0.2) * 0.05;
    return exp(-pow((y - center - sin(x * 3.14159 * 1.5 + time) * 0.1) / width, 2.0));
  }
  
  void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;

    float auroraIntensity = 0.0;

    float layer1 = 0.0;
    float y1 = 0.35 + sin(uv.x * 2.5 + iTime * 0.5) * 0.08;
    float width1 = 0.25 + sin(iTime * 0.3) * 0.03;
    layer1 = exp(-pow((uv.y - y1) / width1, 2.0));
    layer1 *= (0.6 + sin(uv.x * 8.0 - iTime * 1.2) * 0.2);

    float layer2 = 0.0;
    float y2 = 0.55 + cos(uv.x * 2.0 + iTime * 0.4) * 0.1;
    float width2 = 0.2 + cos(iTime * 0.2) * 0.02;
    layer2 = exp(-pow((uv.y - y2) / width2, 2.0));
    layer2 *= (0.5 + sin(uv.x * 6.0 + iTime * 1.0) * 0.25);

    float layer3 = 0.0;
    float y3 = 0.2 + sin(uv.x * 3.0 + iTime * 0.6) * 0.05;
    float width3 = 0.18;
    layer3 = exp(-pow((uv.y - y3) / width3, 2.0)) * 0.4;

    float layer4 = 0.0;
    float y4 = 0.75 + sin(uv.x * 1.8 - iTime * 0.3) * 0.06;
    float width4 = 0.22;
    layer4 = exp(-pow((uv.y - y4) / width4, 2.0)) * 0.35;

    float backgroundGlow = 0.15 * (0.8 + sin(uv.x * 2.0 + iTime) * 0.1) * (0.7 + cos(uv.y * 3.0) * 0.1);

    auroraIntensity = layer1 + layer2 + layer3 + layer4 + backgroundGlow;

    vec2 noiseUv = uv * 8.0;
    noiseUv.x += iTime * 0.05;
    float grain = noise(noiseUv) * 0.08;
    auroraIntensity += grain;

    vec3 color1 = vec3(0.0, 0.9, 0.3);
    vec3 color2 = vec3(0.2, 0.5, 0.9);
    vec3 color3 = vec3(0.8, 0.3, 0.9);
    vec3 color4 = vec3(0.0, 0.8, 0.7);

    float mix1 = sin(uv.x * 3.14159 * 1.2 + iTime * 0.3) * 0.5 + 0.5;
    float mix2 = sin(uv.x * 3.14159 * 2.5 - iTime * 0.4) * 0.5 + 0.5;
    float mix3 = cos(uv.x * 3.14159 * 1.8 + iTime * 0.5) * 0.5 + 0.5;
    
    vec3 color = mix(color1, color2, mix1);
    color = mix(color, color3, mix2);
    color = mix(color, color4, mix3);

    float heightFactor = 1.0 - uv.y * 0.5;
    color *= (0.6 + auroraIntensity * 1.2) * heightFactor;

    vec2 starUv = uv * 25.0;
    vec2 starUv2 = uv * 40.0;
    float stars = step(0.993, random(floor(starUv)));
    stars += step(0.996, random(floor(starUv2))) * 0.5;
    stars *= (0.5 + sin(iTime) * 0.2);

    vec3 bgColor = vec3(0.03, 0.04, 0.08);

    vec3 finalColor = bgColor + color + stars * vec3(0.7);

    finalColor = pow(finalColor, vec3(0.9));
    
    gl_FragColor = vec4(finalColor, 1.0);
  }
`

// 初始化 WebGL
const initWebGL = () => {
  const canvas = canvasRef.value
  if (!canvas) return false
  
  gl = canvas.getContext('webgl', { 
    alpha: false,
    depth: false,
    stencil: false,
    antialias: true
  })
  
  if (!gl) {
    console.error('WebGL not supported')
    return false
  }
  
  // 编译着色器
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)
  
  program = createProgram(gl, vertexShader, fragmentShader)
  if (!program) return false
  
  gl.useProgram(program)
  
  // 获取 uniform 位置
  timeLocation = gl.getUniformLocation(program, 'iTime')
  resolutionLocation = gl.getUniformLocation(program, 'iResolution')
  
  // 设置顶点数据
  const positions = new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
     1,  1
  ])
  
  const positionBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
  
  const positionLocation = gl.getAttribLocation(program, 'a_position')
  gl.enableVertexAttribArray(positionLocation)
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)
  
  return true
}

const createShader = (gl, type, source) => {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  
  return shader
}

const createProgram = (gl, vertexShader, fragmentShader) => {
  const program = gl.createProgram()
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program))
    return null
  }
  
  return program
}

let startTime = null

const render = (timestamp) => {
  if (!gl || !program) return
  
  if (!startTime) startTime = timestamp
  const time = (timestamp - startTime) / 1000
  
  const canvas = canvasRef.value
  if (!canvas) return
  
  const width = window.innerWidth
  const height = window.innerHeight
  
  // 更新画布尺寸
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
    gl.viewport(0, 0, width, height)
  }
  
  gl.uniform2f(resolutionLocation, width, height)
  gl.uniform1f(timeLocation, time)
  
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  
  animationId = requestAnimationFrame(render)
}

const handleResize = () => {
  const canvas = canvasRef.value
  if (canvas && gl) {
    const width = window.innerWidth
    const height = window.innerHeight
    canvas.width = width
    canvas.height = height
    gl.viewport(0, 0, width, height)
  }
}

onMounted(() => {
  if (initWebGL()) {
    animationId = requestAnimationFrame(render)
    window.addEventListener('resize', handleResize)
  }
})

onBeforeUnmount(() => {
  if (animationId) {
    cancelAnimationFrame(animationId)
  }
  if (gl && program) {
    gl.deleteProgram(program)
  }
  window.removeEventListener('resize', handleResize)
})
</script>

<style scoped>
.aurora-canvas {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: block;
  z-index: 1;
}
</style>
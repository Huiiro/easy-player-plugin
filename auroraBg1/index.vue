<template>
  <div class="webgl-aurora" ref="containerRef">
    <canvas ref="canvasRef"></canvas>
    <div class="overlay">
      <slot>
      </slot>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const containerRef = ref(null)
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

// 片元着色器 - 极光算法
const fragmentShaderSource = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;

  float random (vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
  }
  
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
  
  void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    uv.y = 1.0 - uv.y;

    float auroraMask = smoothstep(0.2, 0.8, uv.y) * (1.0 - smoothstep(0.6, 0.9, uv.y));
    auroraMask *= 1.0 - smoothstep(0.7, 0.95, uv.x);

    vec2 q = uv;
    q.x += sin(iTime * 0.5) * 0.1;
    q.y += cos(iTime * 0.3) * 0.05;
    
    float r = 0.0;
    r += sin(fbm(vec2(q.x * 2.0 + iTime * 0.2, q.y * 1.5)) * 8.0) * 0.5;
    r += sin(fbm(vec2(q.x * 4.0 - iTime * 0.3, q.y * 3.0)) * 4.0) * 0.3;

    vec3 color1 = vec3(0.0, 0.8, 0.3);  // 绿色
    vec3 color2 = vec3(0.2, 0.4, 0.8);  // 蓝色
    vec3 color3 = vec3(0.8, 0.2, 0.6);  // 紫色
    
    vec3 color = mix(color1, color2, sin(uv.x * 3.14159 + iTime) * 0.5 + 0.5);
    color = mix(color, color3, sin(uv.y * 2.0 + iTime * 0.8) * 0.3 + 0.3);

    float intensity = (r + 0.5) * auroraMask;
    color *= intensity * 1.2;

    vec2 starUv = uv * 10.0;
    float stars = step(0.995, random(floor(starUv)));
    stars += step(0.998, random(floor(starUv * 2.0))) * 0.5;
    
    vec3 bgColor = vec3(0.05, 0.05, 0.15);
    vec3 finalColor = bgColor + color + stars * vec3(1.0);
    
    gl_FragColor = vec4(finalColor, 1.0);
  }
`

// 初始化 WebGL
const initWebGL = () => {
  const canvas = canvasRef.value
  if (!canvas) return false
  
  gl = canvas.getContext('webgl')
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
  const container = containerRef.value
  
  if (canvas && container) {
    const width = container.clientWidth
    const height = container.clientHeight
    
    canvas.width = width
    canvas.height = height
    gl.viewport(0, 0, width, height)
    
    gl.uniform2f(resolutionLocation, width, height)
    gl.uniform1f(timeLocation, time)
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
  
  animationId = requestAnimationFrame(render)
}

const handleResize = () => {
  const canvas = canvasRef.value
  const container = containerRef.value
  if (canvas && container) {
    canvas.width = container.clientWidth
    canvas.height = container.clientHeight
    gl.viewport(0, 0, canvas.width, canvas.height)
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
.webgl-aurora {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
}

.webgl-aurora canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.overlay {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  color: white;
  text-align: center;
  pointer-events: none;
  background: rgba(0,0,0,0.2);
}

.overlay h1 {
  font-size: 4rem;
  margin-bottom: 1rem;
  text-shadow: 0 0 30px rgba(0,0,0,0.5);
  animation: fadeIn 1s ease-out;
}

.overlay p {
  font-size: 1.2rem;
  opacity: 0.9;
  animation: fadeInUp 1s ease-out 0.3s both;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
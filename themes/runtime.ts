import { createApp, h, nextTick, reactive, type Component } from 'vue'

/** Official background-only runtime. It has no preload, host SDK or network API. */
export function mountTheme(component: Component, css: string): void {
  const state = reactive({ paused: true })
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  document.documentElement.classList.add('theme-paused')
  const report = (type: 'ready' | 'failed'): void => {
    window.parent.postMessage({ channel: 'easy-player-theme', type }, '*')
  }
  const app = createApp({ render: () => h(component, { paused: state.paused }) })
  app.config.errorHandler = (error) => {
    console.warn('[OfficialTheme] Render failed', error)
    report('failed')
  }
  let disposed = false
  function dispose(): void {
    if (disposed) return
    disposed = true
    window.removeEventListener('message', message)
    window.removeEventListener('pagehide', dispose)
    app.unmount()
    style.remove()
  }
  function message(event: MessageEvent): void {
    if (event.source !== window.parent || event.data?.channel !== 'easy-player-theme') return
    if (event.data.type === 'dispose') dispose()
    else if (event.data.type === 'state' && typeof event.data.paused === 'boolean') {
      state.paused = event.data.paused
      document.documentElement.classList.toggle('theme-paused', state.paused)
    }
  }
  window.addEventListener('message', message)
  window.addEventListener('pagehide', dispose)
  try {
    app.mount('#app')
    void nextTick(() => {
      if (!disposed) report('ready')
    })
  } catch (error) {
    console.warn('[OfficialTheme] Mount failed', error)
    report('failed')
  }
}

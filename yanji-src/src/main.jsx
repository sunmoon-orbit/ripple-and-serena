import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'

class ErrorBoundary extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('[ErrorBoundary]', error, info?.componentStack) }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'system-ui', color: '#333' }}>
          <h2 style={{ color: '#c44' }}>页面出了点问题</h2>
          <p style={{ fontSize: 14, color: '#666' }}>刷新试试，或者清除站点数据后重新打开。</p>
          <pre style={{ fontSize: 12, background: '#f5f5f5', padding: 12, borderRadius: 8, overflow: 'auto', maxHeight: 200 }}>
            {this.state.error?.message}{'\n'}{this.state.error?.stack}
          </pre>
          <button onClick={() => location.reload()} style={{ marginTop: 12, padding: '8px 20px', borderRadius: 8, border: 'none', background: '#5b4dc7', color: '#fff', cursor: 'pointer' }}>
            刷新页面
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)

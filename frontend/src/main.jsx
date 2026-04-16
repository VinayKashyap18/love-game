import React from 'react'
import ReactDOM from 'react-dom/client'

// Polyfill for simple-peer
if (typeof global === 'undefined') {
  window.global = window;
}

import App from './App.jsx'
import './App.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

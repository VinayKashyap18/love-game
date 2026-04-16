import React from 'react'
import ReactDOM from 'react-dom/client'

import { Buffer } from 'buffer'

// Polyfills for simple-peer
if (typeof global === 'undefined') {
  window.global = window;
}
if (typeof window.Buffer === 'undefined') {
  window.Buffer = Buffer;
}

import App from './App.jsx'
import './App.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

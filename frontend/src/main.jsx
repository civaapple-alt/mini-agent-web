import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ResourceManager from './components/ResourceManager.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {window.location.pathname === '/resources' ? <ResourceManager /> : <App />}
  </React.StrictMode>,
)

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import './ErrorBoundary.css';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleReset);
      }

      return (
        <div className={`error-boundary-fallback ${this.props.compact ? 'compact' : ''}`}>
          <div className="error-boundary-header">
            <AlertTriangle size={this.props.compact ? 14 : 18} className="error-icon" />
            <span className="error-title">
              {this.props.title || '组件渲染异常 (Component Render Error)'}
            </span>
          </div>
          <p className="error-message">
            {this.state.error?.message || '未知渲染错误'}
          </p>
          <button
            type="button"
            className="btn-error-reset"
            onClick={this.handleReset}
            title="重试该组件"
          >
            <RotateCcw size={12} />
            <span>重试</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

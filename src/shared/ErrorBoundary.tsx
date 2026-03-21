import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[DropHunter][ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div
          style={{
            background: 'rgba(20, 20, 25, 0.95)',
            color: '#fff',
            padding: '16px',
            borderRadius: '12px',
            fontFamily: 'system-ui, sans-serif',
            fontSize: '13px',
          }}
        >
          <strong>Something went wrong.</strong>
          <p style={{ marginTop: '6px', color: '#cbd5e1' }}>{this.state.error?.message ?? 'Unknown error'}</p>
          <button
            style={{
              marginTop: '8px',
              background: '#9146FF',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '6px 12px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

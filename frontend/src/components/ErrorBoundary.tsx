import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** When this changes (for example the route), the boundary clears itself so moving to another screen works. */
  resetKey?: string
  home?: string
}

interface State { failed: boolean }

/**
 * A render error in one screen must not blank the whole app. The shell and navigation stay usable, the owner gets a plain
 * message and a way out, and the technical detail goes to the console for whoever is debugging.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen crashed:', error.message, info.componentStack?.split('\n').slice(0, 4).join(' | '))
  }

  componentDidUpdate(previous: Props) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="page" role="alert">
        <h1 className="h1">This screen hit a problem</h1>
        <p className="muted" style={{ maxWidth: '60ch' }}>
          Nothing in your books was changed. You can try the screen again, reload the page, or go back to the start.
        </p>
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary" onClick={() => this.setState({ failed: false })}>Try again</button>
          <button className="btn btn-secondary" onClick={() => window.location.reload()}>Reload the page</button>
          <a className="btn btn-quiet" href={this.props.home ?? '/app/today'}>Go to {this.props.home === '/app/orders' ? 'Orders' : 'Today'}</a>
        </div>
      </div>
    )
  }
}

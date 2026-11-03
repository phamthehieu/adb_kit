import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'

interface Props {
  /** Shown in the message, e.g. "panel Logcat". */
  name: string
  children: ReactNode
  /** Extra classes for the fallback box (so it keeps the panel's place in the layout). */
  className?: string
}

interface State {
  error: Error | null
}

/**
 * Keeps a crash in one panel from blanking the whole app (React unmounts the entire
 * tree on an uncaught render error). Scripts and suites are autosaved to localStorage,
 * so "Thử lại" picks up where the tester was.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.name}]`, error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className={`crash-box ${this.props.className ?? ''}`}>
        <TriangleAlert size={22} />
        <b>{this.props.name} gặp lỗi và đã dừng</b>
        <span className="muted">Phần còn lại của ADB Kit vẫn chạy bình thường. Kịch bản đang soạn đã được tự lưu.</span>
        <pre>{error.message}</pre>
        <div className="row">
          <button className="iconbtn primary" onClick={() => this.setState({ error: null })}>
            <RefreshCw size={12} /> Thử lại
          </button>
          <button className="iconbtn" onClick={() => void navigator.clipboard.writeText(`${error.message}\n${error.stack ?? ''}`)}>
            Chép chi tiết lỗi
          </button>
        </div>
      </div>
    )
  }
}

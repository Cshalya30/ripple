import { Logo } from './Glyph'

type LoginRippleProps = {
  className?: string
}

export function LoginRipple({ className = '' }: LoginRippleProps) {
  return (
    <div className={`login-ripple ${className}`} aria-hidden="true">
      <div className="login-ripple-glow" />
      <div className="login-ripple-wave login-ripple-wave-1" />
      <div className="login-ripple-wave login-ripple-wave-2" />
      <div className="login-ripple-wave login-ripple-wave-3" />
      <div className="login-ripple-wave login-ripple-wave-4" />
      <div className="login-ripple-wave login-ripple-wave-5" />
      <div className="login-ripple-logo"><Logo compact /></div>
    </div>
  )
}

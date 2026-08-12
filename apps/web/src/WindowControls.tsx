import { useEffect, useState } from 'react';

const svg = {
  minimize: (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <line x1="0.5" y1="6" x2="11.5" y2="6" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  ),
  maximize: (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  ),
  restore: (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <rect x="2.5" y="2.5" width="7.5" height="7.5" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M2.5 4.5V1.5h8v8h-3" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  ),
  close: (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  ),
};

/** 自绘窗口控制按钮（仅桌面端无边框窗口显示）：最小化 / 最大化(还原) / 关闭 */
export default function WindowControls({ flushRight = false }: { flushRight?: boolean }) {
  const controls = window.acLedgerDesktop?.windowControls;

  // macOS 使用原生交通灯（titleBarStyle: hiddenInset），不显示自绘按钮
  const isMac = window.acLedgerDesktop?.platform === 'darwin';
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!controls || isMac) return;
    return controls.onMaximizedChange(setMaximized);
  }, [controls, isMac]);

  if (!controls || isMac) return null;

  return (
    <div
      className={`window-controls app-region-no-drag${flushRight ? ' window-controls-flush' : ''}`}
    >
      <button
        type="button"
        className="win-btn"
        title="最小化"
        aria-label="最小化"
        onClick={() => void controls.minimize()}
      >
        {svg.minimize}
      </button>
      <button
        type="button"
        className="win-btn"
        title={maximized ? '还原' : '最大化'}
        aria-label={maximized ? '还原' : '最大化'}
        onClick={() => void controls.toggleMaximize()}
      >
        {maximized ? svg.restore : svg.maximize}
      </button>
      <button
        type="button"
        className="win-btn win-btn-close"
        title="关闭"
        aria-label="关闭"
        onClick={() => void controls.close()}
      >
        {svg.close}
      </button>
    </div>
  );
}

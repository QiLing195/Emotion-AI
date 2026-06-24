import React, { useState, useEffect, type ReactNode } from 'react';

interface ErrorFallbackProps {
  error: Error | null;
  onReset: () => void;
}

function ErrorFallback({ error, onReset }: ErrorFallbackProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', fontFamily: 'system-ui, sans-serif', color: '#e0d5c1',
      backgroundColor: '#1a1410', textAlign: 'center', padding: '2rem',
    }}>
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>出错了</h2>
      <p style={{ color: '#8a7a6a', marginBottom: '2rem' }}>
        抱歉，页面遇到了一点问题。
      </p>
      <button
        onClick={onReset}
        style={{
          padding: '0.75rem 2rem', fontSize: '1rem',
          backgroundColor: '#c4a882', color: '#1a1410',
          border: 'none', borderRadius: '0.5rem', cursor: 'pointer',
        }}
      >
        刷新页面
      </button>
      {error && (
        <details style={{ marginTop: '2rem', color: '#6a5a6a', fontSize: '0.875rem' }}>
          <summary>错误详情</summary>
          <pre style={{ textAlign: 'left', marginTop: '0.5rem' }}>{error.message}</pre>
        </details>
      )}
    </div>
  );
}

/**
 * 错误边界 — React 19 使用自定义 Window 'error' 事件捕获
 * React 19 中 Class Component 已标记弃用，改用事件层兜底 + render 层 try-catch
 */
export function ErrorBoundary({ children }: { children: ReactNode }) {
  const [fatalError, setFatalError] = useState<Error | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error('[ErrorBoundary] 未处理异常:', event.error?.message || event.message);
      setFatalError(event.error || new Error(event.message));
      event.preventDefault();
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      // Promise 拒绝通常是网络/Firestore 问题，记录但不崩溃
      console.warn('[ErrorBoundary] 未处理 Promise 拒绝（已抑制）:', event.reason?.message);
      event.preventDefault(); // 阻止浏览器默认错误
      // 不调用 setFatalError — 让页面继续运行
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  if (fatalError) {
    return <ErrorFallback error={fatalError} onReset={() => window.location.reload()} />;
  }

  return <>{children}</>;
}

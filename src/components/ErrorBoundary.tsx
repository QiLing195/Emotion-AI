import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  title: string;
  message: string;
}

function formatErrorMessage(rawMessage: string): {
  title: string;
  message: string;
} {
  if (!rawMessage) {
    return {
      title: '页面出现异常',
      message: '界面运行出现未预期的异常，请重试或刷新页面。',
    };
  }

  try {
    const parsed = JSON.parse(rawMessage) as {
      error?: string;
      operationType?: string;
      path?: string | null;
    };
    if (typeof parsed.error === 'string') {
      if (parsed.error.includes('Quota exceeded')) {
        return {
          title: '云端数据库配额已达上限',
          message:
            '当前免费云端数据库今日读写配额已用尽，配额将于次日自动重置；您也可以先退出登录，继续使用浏览器本地存储模式。',
        };
      }
      if (
        parsed.error.includes('Missing or insufficient permissions') ||
        parsed.error.includes('PERMISSION_DENIED')
      ) {
        return {
          title: '云端数据访问受限',
          message: `操作（${parsed.operationType ?? 'read'}）未通过安全规则校验，请确认已使用已验证邮箱的 Google 账号登录并重试。`,
        };
      }
      return {
        title: '云端同步出现异常',
        message: parsed.error,
      };
    }
  } catch {
    // 非 JSON 错误，直接按普通文本展示
  }

  return {
    title: '页面出现异常',
    message: rawMessage,
  };
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, title: '页面出现异常', message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const formatted = formatErrorMessage(error.message);
    return {
      hasError: true,
      title: formatted.title,
      message: formatted.message,
    };
  }

  handleReset = () => {
    this.setState({ hasError: false, title: '页面出现异常', message: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <h1 className="text-base font-semibold text-slate-900">
              {this.state.title}
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              {this.state.message}
            </p>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors"
              >
                重试
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
              >
                刷新页面
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

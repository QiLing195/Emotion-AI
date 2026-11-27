import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  BookOpen,
  Cloud,
  CloudUpload,
  Compass,
  Download,
  GitBranch,
  Loader2,
  LogIn,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  RotateCcw,
  Save,
  Settings,
  Sparkles,
  Table2,
  Upload,
  X,
} from 'lucide-react';
import { auth, signInWithGoogle, signOutUser } from './firebase';
import {
  batchCreateAnnotations,
  createAnnotationDoc,
  deleteAnnotationDoc,
  ensureUserProfile,
  migrateLocalWorkspaceToCloud,
  replaceAllAnnotationsInCloud,
  sanitizeDocId,
  subscribeAnnotations,
  updateAnnotationDoc,
} from './services/cloudStore';
import { CurrentConcern, PersonaGrowthState } from './dual-loop/contracts';
import { sanitizePersonaGrowthState } from './dual-loop/personaGrowth';
import {
  AFFECT_LEXICON,
  CONTEXT_OPTIONS,
  EmotionAnnotation,
  INITIAL_ANNOTATIONS,
  QUADRANTS,
  QuadrantId,
  clampCoord,
  findNearestAffects,
  formatCoord,
  getIntensity,
  getQuadrant,
} from './data/affectLexicon';
import {
  parseImportedAnnotations,
  serializeAnnotationsToCsv,
} from './data/affectImportExport';
import { CircumplexPlot } from './components/CircumplexPlot';
import { AnnotationTable } from './components/AnnotationTable';
import { EmotionTagCloud } from './components/EmotionTagCloud';
import { EmotionTrendChart } from './components/EmotionTrendChart';
import { DualLoopLab } from './components/DualLoopLab';
import { ChatWorkspace } from './components/ChatWorkspace';
import {
  AppSettings,
  DEFAULT_APP_SETTINGS,
  SettingsView,
} from './components/SettingsView';

type WorkspaceView = 'chat' | 'map' | 'log' | 'lexicon' | 'dual-loop' | 'settings';

const STORAGE_KEY = 'emotion_ai_annotations_zh_v1';
const SETTINGS_STORAGE_KEY = 'emotion_ai_settings_v1';

function loadAppSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      deepseekModel:
        parsed.deepseekModel === 'deepseek-reasoner'
          ? 'deepseek-reasoner'
          : 'deepseek-chat',
      defaultExtractorSource:
        parsed.defaultExtractorSource === 'local_rules' ||
        parsed.defaultExtractorSource === 'server_llm'
          ? parsed.defaultExtractorSource
          : 'hybrid_fast_slow',
      defaultEngineMode:
        parsed.defaultEngineMode === 'bounded_live'
          ? 'bounded_live'
          : 'shadow_only',
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

const DYNAMIC_CONCERNS_STORAGE_KEY = 'emotion_ai_dynamic_concerns_v1';
const PERSONA_GROWTH_STORAGE_KEY = 'emotion_ai_persona_growth_v1';

function loadAnnotations(): EmotionAnnotation[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_ANNOTATIONS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return INITIAL_ANNOTATIONS;
    return parsed as EmotionAnnotation[];
  } catch {
    return INITIAL_ANNOTATIONS;
  }
}

function loadLocalDynamicConcerns(): CurrentConcern[] {
  try {
    const raw = window.localStorage.getItem(DYNAMIC_CONCERNS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as CurrentConcern[]).filter((c) => c.origin === 'dynamic');
  } catch {
    return [];
  }
}

function loadLocalPersonaGrowth(): PersonaGrowthState | null {
  try {
    const raw = window.localStorage.getItem(PERSONA_GROWTH_STORAGE_KEY);
    if (!raw) return null;
    return sanitizePersonaGrowthState(JSON.parse(raw), '2026-11-25T08:00:00Z');
  } catch {
    return null;
  }
}

function formatCurrentTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [activeView, setActiveView] = useState<WorkspaceView>('chat');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [annotations, setAnnotations] = useState<EmotionAnnotation[]>(loadAnnotations);
  const [valence, setValence] = useState<number>(0.42);
  const [arousal, setArousal] = useState<number>(0.52);
  const [utterance, setUtterance] = useState<string>('');
  const [context, setContext] = useState<string>(CONTEXT_OPTIONS[0]);
  const [customLabel, setCustomLabel] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  const [formError, setFormError] = useState<string>('');
  const [saveFeedback, setSaveFeedback] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [aiRationale, setAiRationale] = useState<string>('');
  const [aiSemanticMeta, setAiSemanticMeta] = useState<string>('');

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [quadrantFilter, setQuadrantFilter] = useState<'all' | QuadrantId>('all');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [importFeedback, setImportFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [confirmReset, setConfirmReset] = useState<boolean>(false);

  const [lexiconSort, setLexiconSort] = useState<'distance' | 'valence' | 'arousal'>('distance');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [authReady, setAuthReady] = useState<boolean>(false);
  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const [isAuthBusy, setIsAuthBusy] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string>('');
  const [cloudAnnotationsLoaded, setCloudAnnotationsLoaded] = useState<boolean>(false);
  const [isMigratingLocal, setIsMigratingLocal] = useState<boolean>(false);
  const [migrationFeedback, setMigrationFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [cloudFatalError, setCloudFatalError] = useState<Error | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(loadAppSettings);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify(appSettings)
      );
    } catch {
      // 忽略受限存储异常
    }
  }, [appSettings]);

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!active) return;
      setAuthError('');
      if (!user) {
        setCloudUser(null);
        setCloudAnnotationsLoaded(false);
        setAnnotations(loadAnnotations());
        setAuthReady(true);
        return;
      }
      setCloudAnnotationsLoaded(false);
      void ensureUserProfile(user)
        .then(() => {
          if (!active) return;
          setCloudUser(user);
          setAuthReady(true);
        })
        .catch((err: unknown) => {
          if (!active) return;
          setAuthReady(true);
          setCloudFatalError(err instanceof Error ? err : new Error(String(err)));
        });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady || !cloudUser) return;
    const unsub = subscribeAnnotations(
      cloudUser.uid,
      (cloudItems) => {
        setAnnotations(cloudItems);
        setCloudAnnotationsLoaded(true);
      },
      (err) => setCloudFatalError(err)
    );
    return () => unsub();
  }, [authReady, cloudUser]);

  useEffect(() => {
    if (cloudUser) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(annotations));
    } catch {
      // 忽略受限环境下的本地存储配额异常
    }
  }, [annotations, cloudUser]);

  const handleGoogleSignIn = async () => {
    setIsAuthBusy(true);
    setAuthError('');
    try {
      await signInWithGoogle();
    } catch (err) {
      const msg =
        err instanceof Error && err.message.includes('popup-closed-by-user')
          ? '已取消登录弹窗。'
          : 'Google 登录失败，请重试。';
      setAuthError(msg);
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleGoogleSignOut = async () => {
    setIsAuthBusy(true);
    setAuthError('');
    try {
      await signOutUser();
    } catch {
      setAuthError('退出登录失败，请稍后重试。');
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleMigrateLocalWorkspace = async () => {
    if (!cloudUser) return;
    setIsMigratingLocal(true);
    setAuthError('');
    setMigrationFeedback(null);
    try {
      const localItems = loadAnnotations();
      const localConcerns = loadLocalDynamicConcerns();
      const localPersona = loadLocalPersonaGrowth();
      const existingIds = new Set(
        annotations.map((item) => sanitizeDocId(item.id, 'ann'))
      );
      const summary = await migrateLocalWorkspaceToCloud({
        uid: cloudUser.uid,
        localAnnotations: localItems,
        existingCloudAnnotationIds: existingIds,
        localConcerns,
        localPersona,
      });

      const parts: string[] = [];
      if (summary.annotationsCreated > 0) {
        parts.push(`${summary.annotationsCreated} 条标注记录`);
      }
      if (summary.concernsCreated > 0) {
        parts.push(`${summary.concernsCreated} 条动态关切`);
      }
      if (summary.personaMigrated) {
        parts.push('人格成长档案');
      }

      const feedback = {
        type: 'success' as const,
        message:
          parts.length > 0
            ? `已将本地 ${parts.join('、')} 同步至个人云端账号。`
            : '本地标注、动态关切与人格成长状态均已与云端同步，无需重复迁移。',
      };
      setImportFeedback(feedback);
      setMigrationFeedback(feedback);
    } catch (err) {
      setCloudFatalError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsMigratingLocal(false);
    }
  };

  const nearestAffects = useMemo(
    () => findNearestAffects(valence, arousal, 4),
    [valence, arousal]
  );

  const activeQuadrantId = getQuadrant(valence, arousal);
  const activeQuadrant = QUADRANTS[activeQuadrantId];
  const activeIntensity = getIntensity(valence, arousal);
  const suggestedLabel = nearestAffects[0]?.label ?? '中性';

  const quadrantCounts = useMemo(() => {
    const counts: Record<QuadrantId, number> = {
      'high-positive': 0,
      'low-positive': 0,
      'high-negative': 0,
      'low-negative': 0,
    };
    for (const item of annotations) {
      counts[item.quadrant] += 1;
    }
    return counts;
  }, [annotations]);

  const baseFilteredAnnotations = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return annotations.filter((item) => {
      if (quadrantFilter !== 'all' && item.quadrant !== quadrantFilter) {
        return false;
      }
      if (!normalizedQuery) return true;
      return (
        item.utterance.toLowerCase().includes(normalizedQuery) ||
        item.primaryLabel.toLowerCase().includes(normalizedQuery) ||
        item.context.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [annotations, searchQuery, quadrantFilter]);

  const trendSourceAnnotations = useMemo(() => {
    if (!selectedLabel) return baseFilteredAnnotations;
    return baseFilteredAnnotations.filter(
      (item) => (item.primaryLabel.trim() || '未命名') === selectedLabel
    );
  }, [baseFilteredAnnotations, selectedLabel]);

  const sortedLexicon = useMemo(() => {
    const withDistance = AFFECT_LEXICON.map((term) => ({
      ...term,
      distance: Math.hypot(term.valence - valence, term.arousal - arousal),
    }));
    if (lexiconSort === 'valence') {
      return withDistance.sort((a, b) => b.valence - a.valence);
    }
    if (lexiconSort === 'arousal') {
      return withDistance.sort((a, b) => b.arousal - a.arousal);
    }
    return withDistance.sort((a, b) => a.distance - b.distance);
  }, [lexiconSort, valence, arousal]);

  const handleCoordinateChange = (nextV: number, nextA: number) => {
    setValence(clampCoord(nextV));
    setArousal(clampCoord(nextA));
    if (!editingId) {
      setSelectedAnnotationId(null);
    }
    setSaveFeedback('');
  };

  const handleInspectAnnotation = (annotation: EmotionAnnotation) => {
    setValence(annotation.valence);
    setArousal(annotation.arousal);
    setSelectedAnnotationId(annotation.id);
    setEditingId(null);
    setAiRationale('');
    setAiSemanticMeta('');
    setFormError('');
    setSaveFeedback('');
    setActiveView('map');
  };

  const handleStartEdit = (annotation: EmotionAnnotation) => {
    setValence(annotation.valence);
    setArousal(annotation.arousal);
    setUtterance(annotation.utterance);
    setContext(annotation.context);
    setCustomLabel(annotation.primaryLabel);
    setEditingId(annotation.id);
    setSelectedAnnotationId(annotation.id);
    setAiRationale('');
    setAiSemanticMeta('');
    setFormError('');
    setSaveFeedback('');
    setActiveView('map');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setUtterance('');
    setCustomLabel('');
    setAiRationale('');
    setAiSemanticMeta('');
    setFormError('');
    setSaveFeedback('');
  };

  const handleAnalyzeWithAi = async () => {
    const trimmed = utterance.trim();
    if (!trimmed) {
      setFormError('请先输入待分析的文本，再运行 AI 情绪分析。');
      return;
    }

    setIsAnalyzing(true);
    setFormError('');
    setSaveFeedback('');
    setAiRationale('');
    setAiSemanticMeta('');

    const recentHistory = annotations.slice(0, 3).map((item) => ({
      role: 'user' as const,
      text: item.utterance,
    }));

    const INTENT_TEXT: Record<string, string> = {
      venting: '倾诉表达',
      help_seeking: '寻求协助',
      factual_task: '事务处理',
      social_chat: '日常交流',
    };
    const TARGET_TEXT: Record<string, string> = {
      self: '指向自身',
      other: '指向他人',
      event_or_system: '指向事件/系统',
    };

    try {
      const response = await fetch('/api/analyze-emotion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          utterance: trimmed,
          context,
          recentHistory,
          model: appSettings.deepseekModel,
        }),
      });

      const payload = (await response.json()) as {
        valence?: number;
        arousal?: number;
        primaryLabel?: string;
        rationale?: string;
        intent?: string;
        emotionTarget?: string;
        error?: string;
      };

      if (!response.ok) {
        setFormError(payload.error || '情绪分析失败，请稍后重试。');
        return;
      }

      if (
        typeof payload.valence === 'number' &&
        typeof payload.arousal === 'number'
      ) {
        setValence(clampCoord(payload.valence));
        setArousal(clampCoord(payload.arousal));
      }
      if (typeof payload.primaryLabel === 'string' && payload.primaryLabel.trim()) {
        setCustomLabel(payload.primaryLabel.trim());
      }
      if (typeof payload.rationale === 'string' && payload.rationale.trim()) {
        setAiRationale(payload.rationale.trim());
      }
      const metaParts = [
        payload.intent && INTENT_TEXT[payload.intent],
        payload.emotionTarget && TARGET_TEXT[payload.emotionTarget],
      ].filter(Boolean);
      if (metaParts.length > 0) {
        setAiSemanticMeta(metaParts.join(' · '));
      }
    } catch {
      setFormError('无法连接情绪分析服务，请稍后重试。');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSaveAnnotation = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = utterance.trim();
    if (!trimmed) {
      setFormError('保存前请输入话语或观察记录。');
      return;
    }

    const label = customLabel.trim() || suggestedLabel;

    if (editingId) {
      const existingTarget = annotations.find((item) => item.id === editingId);
      const updatedEntry: EmotionAnnotation = {
        id: editingId,
        utterance: trimmed,
        context,
        valence,
        arousal,
        primaryLabel: label,
        quadrant: activeQuadrantId,
        createdAt: existingTarget?.createdAt ?? formatCurrentTimestamp(),
      };
      setAnnotations((prev) =>
        prev.map((item) => (item.id === editingId ? updatedEntry : item))
      );
      if (cloudUser) {
        void updateAnnotationDoc(cloudUser.uid, updatedEntry).catch((err) =>
          setCloudFatalError(err instanceof Error ? err : new Error(String(err)))
        );
      }
      setSelectedAnnotationId(editingId);
      setEditingId(null);
      setUtterance('');
      setCustomLabel('');
      setAiRationale('');
      setFormError('');
      setSaveFeedback(`已更新“${label}”（效价 ${formatCoord(valence)}，唤醒度 ${formatCoord(arousal)}）`);
      return;
    }

    const entry: EmotionAnnotation = {
      id: `ann-${Date.now()}`,
      utterance: trimmed,
      context,
      valence,
      arousal,
      primaryLabel: label,
      quadrant: activeQuadrantId,
      createdAt: formatCurrentTimestamp(),
    };

    setAnnotations((prev) => [entry, ...prev]);
    if (cloudUser) {
      void createAnnotationDoc(cloudUser.uid, entry).catch((err) =>
        setCloudFatalError(err instanceof Error ? err : new Error(String(err)))
      );
    }
    setSelectedAnnotationId(entry.id);
    setUtterance('');
    setCustomLabel('');
    setAiRationale('');
    setFormError('');
    setSaveFeedback(`已保存“${label}”（效价 ${formatCoord(valence)}，唤醒度 ${formatCoord(arousal)}）`);
  };

  const handleSaveAnnotationFromChat = (payload: {
    readonly utterance: string;
    readonly valence: number;
    readonly arousal: number;
    readonly primaryLabel: string;
    readonly context: string;
  }) => {
    const v = clampCoord(payload.valence);
    const a = clampCoord(payload.arousal);
    const entry: EmotionAnnotation = {
      id: `ann-${Date.now()}`,
      utterance: payload.utterance.trim(),
      context: payload.context,
      valence: v,
      arousal: a,
      primaryLabel: payload.primaryLabel.trim() || '平静',
      quadrant: getQuadrant(v, a),
      createdAt: formatCurrentTimestamp(),
    };
    setAnnotations((prev) => [entry, ...prev]);
    if (cloudUser) {
      void createAnnotationDoc(cloudUser.uid, entry).catch((err) =>
        setCloudFatalError(err instanceof Error ? err : new Error(String(err)))
      );
    }
  };

  const handleDeleteAnnotation = (id: string) => {
    setAnnotations((prev) => prev.filter((item) => item.id !== id));
    if (cloudUser) {
      void deleteAnnotationDoc(cloudUser.uid, id).catch((err) =>
        setCloudFatalError(err instanceof Error ? err : new Error(String(err)))
      );
    }
    if (selectedAnnotationId === id) {
      setSelectedAnnotationId(null);
    }
    if (editingId === id) {
      handleCancelEdit();
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setImportFeedback({
        type: 'error',
        message: '导入文件大小不能超过 2 MB。',
      });
      return;
    }

    try {
      const content = await file.text();
      const result = parseImportedAnnotations(
        content,
        file.name,
        formatCurrentTimestamp()
      );
      if (result.error) {
        setImportFeedback({ type: 'error', message: result.error });
        return;
      }

      if (cloudUser) {
        const existingIds = new Set(
          annotations.map((item) => sanitizeDocId(item.id, 'ann'))
        );
        await batchCreateAnnotations(
          cloudUser.uid,
          result.annotations,
          existingIds
        );
      } else {
        setAnnotations((prev) => [...result.annotations, ...prev]);
      }
      setImportFeedback({
        type: 'success',
        message: `已从 ${file.name} 导入 ${result.annotations.length} 条标注记录。`,
      });
    } catch (err) {
      if (cloudUser) {
        setCloudFatalError(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      setImportFeedback({
        type: 'error',
        message: '无法读取所选文件。',
      });
    }
  };

  const handleResetSamples = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    if (cloudUser) {
      const currentIds = annotations.map((item) => item.id);
      void replaceAllAnnotationsInCloud(
        cloudUser.uid,
        currentIds,
        INITIAL_ANNOTATIONS
      ).catch((err) =>
        setCloudFatalError(err instanceof Error ? err : new Error(String(err)))
      );
    } else {
      setAnnotations(INITIAL_ANNOTATIONS);
    }
    setSelectedAnnotationId(null);
    setEditingId(null);
    setSearchQuery('');
    setQuadrantFilter('all');
    setSelectedDate(null);
    setSelectedLabel(null);
    setConfirmReset(false);
    setImportFeedback({
      type: 'success',
      message: '已恢复默认示例数据集。',
    });
  };

  const handleExportCsv = () => {
    downloadFile(
      serializeAnnotationsToCsv(annotations),
      'emotion-ai-annotations.csv',
      'text/csv;charset=utf-8'
    );
  };

  const handleExportJson = () => {
    downloadFile(
      JSON.stringify(annotations, null, 2),
      'emotion-ai-annotations.json',
      'application/json;charset=utf-8'
    );
  };

  const navItems: Array<{ id: WorkspaceView; label: string; icon: React.ReactNode }> = [
    { id: 'chat', label: '情感对话', icon: <MessageSquare className="w-4 h-4" /> },
    { id: 'map', label: '情绪平面', icon: <Compass className="w-4 h-4" /> },
    { id: 'log', label: '标注日志', icon: <Table2 className="w-4 h-4" /> },
    { id: 'lexicon', label: '词汇参考', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'dual-loop', label: '双环实验台', icon: <GitBranch className="w-4 h-4" /> },
    { id: 'settings', label: '设置', icon: <Settings className="w-4 h-4" /> },
  ];

  const viewTitle =
    activeView === 'chat'
      ? '情感对话'
      : activeView === 'map'
        ? '情绪平面'
        : activeView === 'log'
          ? '标注日志'
          : activeView === 'lexicon'
            ? '词汇参考'
            : activeView === 'dual-loop'
              ? '双环实验台'
              : '设置';

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white border-r border-slate-200">
      <div className="h-14 px-5 flex items-center justify-between border-b border-slate-200">
        <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          Emotion-AI
        </span>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          aria-label="关闭导航菜单"
          className="lg:hidden p-1.5 text-slate-500 hover:text-slate-900 rounded-md"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="p-3 space-y-1" aria-label="工作区视图">
        {navItems.map((item) => {
          const active = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveView(item.id);
                setMobileNavOpen(false);
                setConfirmReset(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                active
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5">
                {item.icon}
                <span>{item.label}</span>
              </span>
              {item.id === 'log' && (
                <span
                  className={`font-mono tabular-nums text-xs ${
                    active ? 'text-slate-300' : 'text-slate-400'
                  }`}
                >
                  {annotations.length}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto p-4 border-t border-slate-200 space-y-4">
        <div>
          <p className="text-xs font-medium text-slate-500 mb-3">
            象限分布统计
          </p>
          <dl className="space-y-2 text-xs">
            {(Object.keys(QUADRANTS) as QuadrantId[]).map((qId) => (
              <div key={qId} className="flex items-center justify-between gap-2">
                <dt className="text-slate-600 truncate">{QUADRANTS[qId].shortLabel}</dt>
                <dd className="font-mono tabular-nums font-medium text-slate-900">
                  {quadrantCounts[qId]}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="pt-4 border-t border-slate-200 space-y-2.5">
          {cloudUser ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-900 truncate flex items-center gap-1.5">
                    <Cloud className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {cloudUser.displayName || cloudUser.email || '已登录用户'}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5 truncate">
                    {cloudAnnotationsLoaded ? '已连接个人云端存储' : '正在同步云端数据…'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleGoogleSignOut}
                  disabled={isAuthBusy}
                  aria-label="退出登录"
                  title="退出登录"
                  className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>

              {cloudAnnotationsLoaded && annotations.length === 0 && (
                <button
                  type="button"
                  onClick={handleMigrateLocalWorkspace}
                  disabled={isMigratingLocal}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-45 rounded-md transition-colors"
                >
                  {isMigratingLocal ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <CloudUpload className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{isMigratingLocal ? '迁移中…' : '导入本地数据到云端'}</span>
                </button>
              )}
            </>
          ) : (
            <>
              <div>
                <p className="text-xs font-medium text-slate-700">云端账号同步</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  当前保存在本机浏览器，登录可跨设备隔离同步。
                </p>
              </div>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isAuthBusy || !authReady}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 disabled:opacity-45 rounded-md transition-colors"
              >
                {isAuthBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{isAuthBusy ? '登录中…' : '使用 Google 账号登录'}</span>
              </button>
            </>
          )}

          {authError && (
            <p className="text-xs text-rose-700" role="alert">
              {authError}
            </p>
          )}
        </div>
      </div>
    </div>
  );

  if (cloudFatalError) {
    throw cloudFatalError;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* 桌面端侧边栏 */}
      <aside className="hidden lg:block w-62 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* 移动端抽屉导航 */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div className="w-64 max-w-[80vw] h-full shadow-xl">{sidebarContent}</div>
          <button
            type="button"
            aria-label="关闭遮罩层"
            onClick={() => setMobileNavOpen(false)}
            className="flex-1 bg-slate-900/30"
          />
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* 顶栏 */}
        <header className="h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-6 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="打开导航菜单"
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-md"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 whitespace-nowrap shrink-0">
                Emotion-AI
              </span>
              <span className="text-slate-300" aria-hidden="true">/</span>
              <h1 className="font-semibold text-slate-900 truncate">
                {viewTitle}
              </h1>
            </div>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={annotations.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>导出 CSV</span>
          </button>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1200px] w-full mx-auto space-y-6">
          {activeView === 'chat' && (
            <ChatWorkspace
              cloudUser={cloudUser}
              deepseekModel={appSettings.deepseekModel}
              defaultExtractorSource={appSettings.defaultExtractorSource}
              defaultEngineMode={appSettings.defaultEngineMode}
              onSaveAnnotationFromChat={handleSaveAnnotationFromChat}
            />
          )}

          {activeView === 'map' && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                {/* 交互式环形情绪平面 */}
                <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
                  <CircumplexPlot
                    valence={valence}
                    arousal={arousal}
                    annotations={annotations}
                    selectedAnnotationId={selectedAnnotationId}
                    onChange={handleCoordinateChange}
                    onSelectAnnotation={handleInspectAnnotation}
                  />
                </section>

                {/* 坐标检查器与标注表单 */}
                <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between gap-5">
                  <div>
                    <div className="pb-4 border-b border-slate-200">
                      <p className="text-xs text-slate-500">
                        {activeQuadrant.label}
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span className="font-mono">{activeQuadrant.axisHint}</span>
                      </p>
                      <div className="mt-1 flex items-baseline justify-between gap-3">
                        <h2 className="text-xl font-semibold text-slate-900">
                          {customLabel.trim() || suggestedLabel}
                        </h2>
                        <span className="text-xs font-mono tabular-nums text-slate-500">
                          强度 {activeIntensity.toFixed(2)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1.5">
                        {aiRationale || nearestAffects[0]?.description}
                      </p>
                      {aiSemanticMeta && (
                        <p className="text-xs text-slate-500 mt-1">
                          语义维度：{aiSemanticMeta}
                        </p>
                      )}
                    </div>

                    {/* 效价与唤醒度滑块 */}
                    <div className="py-4 space-y-4 border-b border-slate-200">
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <label htmlFor="valence-range" className="font-medium text-slate-700">
                            效价（消极 → 积极）
                          </label>
                          <span className="font-mono tabular-nums text-slate-900">
                            {formatCoord(valence)}
                          </span>
                        </div>
                        <input
                          id="valence-range"
                          type="range"
                          min={-1}
                          max={1}
                          step={0.01}
                          value={valence}
                          onChange={(event) =>
                            handleCoordinateChange(parseFloat(event.target.value), arousal)
                          }
                          className="w-full accent-blue-600"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <label htmlFor="arousal-range" className="font-medium text-slate-700">
                            唤醒度（低能量 → 高能量）
                          </label>
                          <span className="font-mono tabular-nums text-slate-900">
                            {formatCoord(arousal)}
                          </span>
                        </div>
                        <input
                          id="arousal-range"
                          type="range"
                          min={-1}
                          max={1}
                          step={0.01}
                          value={arousal}
                          onChange={(event) =>
                            handleCoordinateChange(valence, parseFloat(event.target.value))
                          }
                          className="w-full accent-blue-600"
                        />
                      </div>

                      <div>
                        <p className="text-xs font-medium text-slate-500 mb-2">
                          最近词库锚点
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {nearestAffects.map((term) => (
                            <button
                              key={term.id}
                              type="button"
                              onClick={() => handleCoordinateChange(term.valence, term.arousal)}
                              className="flex items-center justify-between px-2.5 py-1.5 text-xs text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors"
                            >
                              <span className="font-medium text-slate-800 truncate">
                                {term.label}
                              </span>
                              <span className="font-mono tabular-nums text-slate-500 ml-2">
                                {term.distance.toFixed(2)}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 新建 / 编辑标注表单 */}
                    <form onSubmit={handleSaveAnnotation} className="pt-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="utterance-input"
                          className="block text-xs font-medium text-slate-700"
                        >
                          {editingId ? '编辑标注文本' : '话语或观察记录'}
                        </label>
                        <button
                          type="button"
                          onClick={handleAnalyzeWithAi}
                          disabled={isAnalyzing || !utterance.trim()}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-45 disabled:cursor-not-allowed rounded-md transition-colors whitespace-nowrap shrink-0"
                        >
                          {isAnalyzing ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                          <span>{isAnalyzing ? '分析中…' : 'AI 情绪分析'}</span>
                        </button>
                      </div>

                      <textarea
                        id="utterance-input"
                        rows={3}
                        value={utterance}
                        onChange={(event) => {
                          setUtterance(event.target.value);
                          if (formError) setFormError('');
                        }}
                        placeholder="粘贴一段用户原话、访谈转写或情绪观察记录…"
                        className="w-full px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-blue-600 focus:outline-none transition-colors resize-none"
                      />

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label
                            htmlFor="context-select"
                            className="block text-xs font-medium text-slate-700 mb-1"
                          >
                            来源场景
                          </label>
                          <select
                            id="context-select"
                            value={context}
                            onChange={(event) => setContext(event.target.value)}
                            className="w-full px-2.5 py-2 text-xs text-slate-900 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-blue-600 focus:outline-none"
                          >
                            {CONTEXT_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                            {!CONTEXT_OPTIONS.includes(
                              context as (typeof CONTEXT_OPTIONS)[number]
                            ) && <option value={context}>{context}</option>}
                          </select>
                        </div>

                        <div>
                          <label
                            htmlFor="label-override"
                            className="block text-xs font-medium text-slate-700 mb-1"
                          >
                            主情绪标签
                          </label>
                          <input
                            id="label-override"
                            type="text"
                            value={customLabel}
                            onChange={(event) => setCustomLabel(event.target.value)}
                            placeholder={suggestedLabel}
                            className="w-full px-2.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-blue-600 focus:outline-none"
                          />
                        </div>
                      </div>

                      {formError && (
                        <p className="text-xs text-rose-700" role="alert">
                          {formError}
                        </p>
                      )}
                      {saveFeedback && (
                        <p className="text-xs text-emerald-700" role="status">
                          {saveFeedback}
                        </p>
                      )}

                      <div className="flex items-center gap-2">
                        <button
                          type="submit"
                          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-colors"
                        >
                          {editingId ? (
                            <Save className="w-4 h-4" aria-hidden="true" />
                          ) : (
                            <Plus className="w-4 h-4" aria-hidden="true" />
                          )}
                          <span>{editingId ? '更新标注' : '保存标注'}</span>
                        </button>
                        {editingId && (
                          <button
                            type="button"
                            onClick={handleCancelEdit}
                            className="px-3.5 py-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
                          >
                            取消
                          </button>
                        )}
                      </div>
                    </form>
                  </div>
                </section>
              </div>

              {/* 精简近期标注预览 */}
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      近期标注
                    </h2>
                    <p className="text-xs text-slate-500">
                      仅展示最新 5 条记录，可直接定位查看或进入编辑。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveView('log')}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0"
                  >
                    查看完整日志（{annotations.length}）
                  </button>
                </div>

                <AnnotationTable
                  annotations={annotations.slice(0, 5)}
                  selectedId={selectedAnnotationId}
                  compact
                  onInspect={handleInspectAnnotation}
                  onEdit={handleStartEdit}
                  onDelete={handleDeleteAnnotation}
                  onCreateFirst={() => {
                    const input = document.getElementById('utterance-input');
                    input?.focus();
                  }}
                />
              </section>
            </>
          )}

          {activeView === 'log' && (
            <section className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    标注数据集
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {cloudUser
                      ? `当前个人云端账号共保存 ${annotations.length} 条标注记录。`
                      : `当前浏览器本地共保存 ${annotations.length} 条标注记录。`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.json,application/json,text/csv"
                    onChange={handleImportFile}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>导入 CSV / JSON</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportJson}
                    disabled={annotations.length === 0}
                    className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
                  >
                    导出 JSON
                  </button>
                  <button
                    type="button"
                    onClick={handleResetSamples}
                    onBlur={() => setConfirmReset(false)}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                      confirmReset
                        ? 'text-rose-700 bg-rose-50 border-rose-200 hover:bg-rose-100'
                        : 'text-slate-700 bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{confirmReset ? '确认重置' : '重置示例'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleCancelEdit();
                      setActiveView('map');
                    }}
                    className="px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                  >
                    新建标注
                  </button>
                </div>
              </div>

              {importFeedback && (
                <div
                  role={importFeedback.type === 'error' ? 'alert' : 'status'}
                  className={`flex items-center justify-between gap-3 px-4 py-2.5 text-xs rounded-md border ${
                    importFeedback.type === 'error'
                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  }`}
                >
                  <span>{importFeedback.message}</span>
                  <button
                    type="button"
                    onClick={() => setImportFeedback(null)}
                    aria-label="关闭提示"
                    className="p-0.5 hover:opacity-75"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <EmotionTagCloud
                annotations={baseFilteredAnnotations}
                selectedLabel={selectedLabel}
                hasActiveTableFilters={
                  quadrantFilter !== 'all' || searchQuery.trim().length > 0
                }
                onSelectLabel={(label) => {
                  setSelectedLabel(label);
                  setSelectedDate(null);
                }}
              />

              <EmotionTrendChart
                annotations={trendSourceAnnotations}
                selectedDate={selectedDate}
                hasActiveTableFilters={
                  quadrantFilter !== 'all' ||
                  searchQuery.trim().length > 0 ||
                  Boolean(selectedLabel)
                }
                onSelectDate={setSelectedDate}
              />

              <AnnotationTable
                annotations={annotations}
                searchQuery={searchQuery}
                quadrantFilter={quadrantFilter}
                dateFilter={selectedDate}
                labelFilter={selectedLabel}
                selectedId={selectedAnnotationId}
                onSearchChange={setSearchQuery}
                onQuadrantFilterChange={setQuadrantFilter}
                onClearDateFilter={() => setSelectedDate(null)}
                onClearLabelFilter={() => setSelectedLabel(null)}
                onInspect={handleInspectAnnotation}
                onEdit={handleStartEdit}
                onDelete={handleDeleteAnnotation}
                onCreateFirst={() => setActiveView('map')}
              />
            </section>
          )}

          {activeView === 'lexicon' && (
            <section className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    罗素环形情绪词库
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    共 16 个标准情绪锚点，按当前坐标（效价 {formatCoord(valence)}，唤醒度 {formatCoord(arousal)}）动态计算欧氏距离。
                  </p>
                </div>

                <div
                  className="flex items-center gap-1 p-1 bg-slate-100 rounded-md self-start"
                  role="tablist"
                  aria-label="词库排序方式"
                >
                  {(
                    [
                      { id: 'distance', label: '最近距离' },
                      { id: 'valence', label: '按效价' },
                      { id: 'arousal', label: '按唤醒度' },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="tab"
                      aria-selected={lexiconSort === option.id}
                      onClick={() => setLexiconSort(option.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                        lexiconSort === option.id
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                        <th className="py-2.5 pl-4 pr-3">情绪词</th>
                        <th className="py-2.5 px-3">象限</th>
                        <th className="py-2.5 px-3">释义</th>
                        <th className="py-2.5 px-3 text-right">效价</th>
                        <th className="py-2.5 px-3 text-right">唤醒度</th>
                        <th className="py-2.5 px-3 text-right">距离</th>
                        <th className="py-2.5 pl-3 pr-4 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {sortedLexicon.map((term) => {
                        const quadrant = QUADRANTS[term.quadrant];
                        return (
                          <tr key={term.id} className="hover:bg-slate-50 transition-colors">
                            <td className="py-3 pl-4 pr-3 font-medium text-slate-900 whitespace-nowrap">
                              {term.label}
                            </td>
                            <td className={`py-3 px-3 text-xs whitespace-nowrap ${quadrant.accentText}`}>
                              {quadrant.shortLabel}
                            </td>
                            <td className="py-3 px-3 text-xs text-slate-600 max-w-sm">
                              {term.description}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                              {formatCoord(term.valence)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                              {formatCoord(term.arousal)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                              {term.distance.toFixed(2)}
                            </td>
                            <td className="py-3 pl-3 pr-4 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => {
                                  handleCoordinateChange(term.valence, term.arousal);
                                  setActiveView('map');
                                }}
                                className="px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors"
                              >
                                定位到平面
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {activeView === 'dual-loop' && (
            <DualLoopLab
              annotations={annotations}
              cloudUser={cloudUser}
              deepseekModel={appSettings.deepseekModel}
              defaultExtractorSource={appSettings.defaultExtractorSource}
              defaultEngineMode={appSettings.defaultEngineMode}
            />
          )}

          {activeView === 'settings' && (
            <SettingsView
              settings={appSettings}
              cloudUser={cloudUser}
              isAuthBusy={isAuthBusy}
              authReady={authReady}
              isMigratingLocal={isMigratingLocal}
              migrationFeedback={migrationFeedback}
              annotationCount={annotations.length}
              onChangeSettings={setAppSettings}
              onSignIn={handleGoogleSignIn}
              onSignOut={handleGoogleSignOut}
              onMigrateLocalWorkspace={handleMigrateLocalWorkspace}
              onExportJson={handleExportJson}
            />
          )}
        </main>
      </div>
    </div>
  );
}

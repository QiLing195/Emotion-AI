// ── 三栏布局 ──
// 左：ModelPanel | 中：ChatView | 右：MediaPanel（摄像头+音频）
import { lazy, Suspense, useEffect, useState, useRef, useCallback } from 'react';
import { useAIBrainStore } from './store/useAIBrainStore';
import { db } from './firebase';
import { doc, getDoc, setDoc, collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { handleFirestoreError, OperationType, getQuotaExceeded } from './lib/firestore-error';
import ModelPanel from './components/ModelPanel';
import ChatView from './views/ChatView';
const MediaPanel = lazy(() => import('./components/MediaPanel'));
const SettingsView = lazy(() => import('./views/SettingsView'));
const CognitiveOscilloscope = lazy(() => import('./components/overlays/CognitiveOscilloscope'));

function MediaPanelFallback() {
  return <div className="h-full bg-[#0d0d1a] border-l border-[#1e1e2e]" />;
}

function OverlayFallback() {
  return <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" />;
}

export default function App() {
  const persona = useAIBrainStore(s => s.persona);
  const decayEmotion = useAIBrainStore(s => s.decayEmotion);
  const calculateOfflineDecay = useAIBrainStore(s => s.calculateOfflineDecay);
  const userStatus = useAIBrainStore(s => s.userStatus);
  const settings = useAIBrainStore(s => s.settings);
  const setSettings = useAIBrainStore(s => s.setSettings);
  const [showOscilloscope, setShowOscilloscope] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // v1.5 语音播报默认开启：AI 回复时"文字 + 语音"同时给（可在 MediaPanel 开关或设置里关）
  const [voiceOn, setVoiceOn] = useState(true);
  const [voiceText, setVoiceText] = useState('');

  // ── 可拖拽分隔线 ──
  const [mediaWidth, setMediaWidth] = useState(38); // 百分比
  const dragging = useRef(false);
  const handleDragStart = useCallback(() => { dragging.current = true; }, []);
  const handleDrag = useCallback((e: { clientX: number; currentTarget: EventTarget | null }) => {
    if (!dragging.current) return;
    const el = e.currentTarget as HTMLElement | null;
    const container = el?.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const pct = ((rect.right - e.clientX) / rect.width) * 100;
    setMediaWidth(Math.max(20, Math.min(50, pct)));
  }, []);
  const handleDragEnd = useCallback(() => { dragging.current = false; }, []);

  useEffect(() => {
    const up = () => { dragging.current = false; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  // ── 启动时从服务器同步关系状态（防止刷新重置朋友阶段）──
  useEffect(() => {
    fetch('/state')
      .then(r => r.json())
      .then(data => {
        const store = useAIBrainStore.getState();
        const p = store.persona;
        if (!p.dynamicEmotion) return;
        useAIBrainStore.setState({
          persona: {
            ...p,
            emotionState: {
              ...p.emotionState,
              taiji: {
                valence: data.valence ?? 0,
                arousal: data.arousal ?? 0.2,
                expectation: data.expectation ?? 0,
              },
              emotions: data.emotions || p.emotionState?.emotions || {},
              intimacyToUser: Math.min(0.95, (data.affinityScore ?? 20) / 100),
            },
            // 直接使用服务端计算的亲密度分数
            affinityScore: data.affinityScore ?? 20,
            relationshipStageV2: data.relationshipStage,
          },
        });
      })
      .catch(() => {});
  }, []);

  // ── 启动时自动拉取 API key ──
  useEffect(() => {
    if (settings.apiKey || settings.serverConfigured) return;
    fetch('/api/ai-config')
      .then(r => r.json())
      .then(data => {
        if (data.success && data.serverConfigured) {
          setSettings({
            provider: data.provider || 'deepseek',
            apiKey: '',
            model: data.model || 'deepseek-chat',
            baseUrl: data.baseUrl || 'https://api.deepseek.com/v1',
            temperature: data.temperature ?? 0.7,
            serverConfigured: true,
          });
        }
      })
      .catch(() => {}); // 静默失败，用户手动配置
  }, []); // 仅首次挂载

  // ── 情感衰减定时器 ──
  useEffect(() => {
    if (!persona.dynamicEmotion) return;

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        const userDoc = await getDoc(doc(db, 'users', 'guest'));
        if (userDoc.exists()) {
          const data = userDoc.data();
          if (data.lastActiveAt) {
            calculateOfflineDecay(data.lastActiveAt);
            if (!getQuotaExceeded()) {
              setDoc(doc(db, 'users', 'guest'), { lastActiveAt: new Date().toISOString() }, { merge: true }).catch(() => {});
            }
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const decayTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && userStatus === 'active') {
        decayEmotion();
      }
    }, 30000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(decayTimer);
    };
  }, [decayEmotion, calculateOfflineDecay, persona.dynamicEmotion, userStatus]);

  // ── Firestore 同步 ──
  useEffect(() => {
    let unsubscribeMessages: (() => void) | undefined;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    const userId = 'guest';

    try {
      const userDocRef = doc(db, 'users', userId);
      getDoc(userDocRef).then(userDoc => {
        if (userDoc.exists()) {
          const data = userDoc.data();
          if (data.lastActiveAt && data.persona?.dynamicEmotion) {
            calculateOfflineDecay(data.lastActiveAt);
          }
          if (data.persona) {
            // 合并时保留当前内存中的 affinityScore（刚从服务端水合）
            const currentPersona = useAIBrainStore.getState().persona;
            useAIBrainStore.setState({
              persona: {
                ...currentPersona,
                ...data.persona,
                affinityScore: currentPersona.affinityScore ?? data.persona.affinityScore ?? 20,
                emotionState: data.persona.emotionState || currentPersona.emotionState,
              }
            });
          }
          if (data.settings) useAIBrainStore.setState({ settings: data.settings });
        } else {
          if (!getQuotaExceeded()) {
            setDoc(userDocRef, { uid: userId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
              .catch(err => handleFirestoreError(err, OperationType.CREATE, `users/${userId}`));
          }
        }
      }).catch(error => handleFirestoreError(error, OperationType.GET, `users/${userId}`));

      const messagesQuery = query(collection(db, 'users', userId, 'messages'), orderBy('timestamp', 'desc'), limit(50));
      unsubscribeMessages = onSnapshot(messagesQuery, (snapshot) => {
        const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)).reverse();
        // 只有 Firestore 实际有数据，或本地为空时才同步。防止 Firestore 重连时空快照清空内存中的对话。
        if (msgs.length > 0 || useAIBrainStore.getState().chatMessages.length === 0) {
          useAIBrainStore.setState({ chatMessages: msgs });
        }
      }, (error) => handleFirestoreError(error, OperationType.GET, `users/${userId}/messages`));

      heartbeatTimer = setInterval(() => {
        const currentStatus = useAIBrainStore.getState().userStatus;
        if (document.visibilityState === 'visible' && currentStatus === 'active' && !getQuotaExceeded()) {
          setDoc(doc(db, 'users', userId), { lastActiveAt: new Date().toISOString() }, { merge: true }).catch(() => {});
        }
      }, 60000);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `users/${userId}`);
    }

    return () => {
      if (unsubscribeMessages) unsubscribeMessages();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    };
  }, [calculateOfflineDecay]);

  return (
    <div className="h-screen flex overflow-hidden bg-gradient-to-br from-surface-50 via-surface-100 to-rose-50/20">
      <ModelPanel
        showSettings={showSettings}
        showOscilloscope={showOscilloscope}
        onSettingsClick={() => setShowSettings(!showSettings)}
        onOscilloscopeClick={() => setShowOscilloscope(!showOscilloscope)}
      />
      <div className="flex-1 flex min-w-0" onMouseMove={handleDrag} onMouseUp={handleDragEnd}>
        <ChatView voiceOn={voiceOn} voiceText={voiceText} onVoiceTextConsumed={() => setVoiceText('')} />
        {/* 可拖拽分隔线 */}
        <div
          onMouseDown={handleDragStart}
          className="w-1.5 cursor-col-resize bg-transparent hover:bg-indigo-300/60 active:bg-indigo-400/80 transition-colors shrink-0 select-none"
          title="拖拽调整宽度"
        />
        <div style={{ width: `${mediaWidth}%`, minWidth: 220, maxWidth: '50%' }} className="shrink-0">
          <Suspense fallback={<MediaPanelFallback />}>
            <MediaPanel
              voiceOn={voiceOn}
              onVoiceToggle={setVoiceOn}
              onSpeechResult={(text) => setVoiceText(text)}
            />
          </Suspense>
        </div>
      </div>

      {/* 设置页覆盖层 */}
      {showSettings && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <Suspense fallback={<div className="h-64 bg-[#f2f2f7]" />}>
              <SettingsView />
            </Suspense>
            <div className="sticky bottom-0 bg-white border-t p-4 flex justify-end">
              <button
                onClick={() => setShowSettings(false)}
                className="px-6 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 认知示波器覆盖层 */}
      {showOscilloscope && (
        <Suspense fallback={<OverlayFallback />}>
          <CognitiveOscilloscope onClose={() => setShowOscilloscope(false)} />
        </Suspense>
      )}
    </div>
  );
}

// ── OS 桌面外壳（v1.61）：壁纸 + 菜单栏 + Dock + 多窗口 ──
// 每个应用是一个可拖动/缩放/最小化的窗口；聊天、媒体、时间线与回放、设置、人格各占一窗。
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { MessageCircle, Camera, History, Settings as SettingsIcon, Sparkles } from 'lucide-react';
import { useAIBrainStore } from './store/useAIBrainStore';
import { db } from './firebase';
import { doc, getDoc, setDoc, collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { handleFirestoreError, OperationType, getQuotaExceeded } from './lib/firestore-error';
import ModelPanel from './components/ModelPanel';
import ChatView from './views/ChatView';
import OSShell, { type OSAppDef } from './components/os/OSShell';
import TimelineApp from './components/os/TimelineApp';
const MediaPanel = lazy(() => import('./components/MediaPanel'));
const SettingsView = lazy(() => import('./views/SettingsView'));
const PersonalityView = lazy(() => import('./views/PersonalityView'));
const CognitiveOscilloscope = lazy(() => import('./components/overlays/CognitiveOscilloscope'));

function PanelFallback({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center text-[12px] text-slate-400">{label}加载中…</div>;
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
  // v1.5 语音播报默认开启：AI 回复时"文字 + 语音"同时给（可在 MediaPanel 开关或设置里关）
  const [voiceOn, setVoiceOn] = useState(true);
  const [voiceText, setVoiceText] = useState('');

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

  // ── OS 应用定义（v1.61）──
  // 每个窗口的内容就是原有视图；窗口管理交给 OSShell。
  const apps = useMemo<OSAppDef[]>(() => [
    {
      id: 'chat',
      title: '聊天',
      icon: <MessageCircle size={20} />,
      accent: 'from-rose-400/80 to-orange-300/70',
      defaultOpen: true,
      window: { x: 64, y: 56, w: 1010, h: 660 },
      content: (
        <div className="os-app-dark flex h-full min-h-0 bg-[#0f1120]">
          <div className="w-[268px] shrink-0 overflow-y-auto border-r border-white/10">
            <ModelPanel
              showSettings={false}
              showOscilloscope={showOscilloscope}
              onSettingsClick={() => window.dispatchEvent(new CustomEvent('os:open', { detail: 'settings' }))}
              onOscilloscopeClick={() => setShowOscilloscope(v => !v)}
            />
          </div>
          <div className="min-w-0 flex-1">
            <ChatView voiceOn={voiceOn} voiceText={voiceText} onVoiceTextConsumed={() => setVoiceText('')} />
          </div>
        </div>
      ),
    },
    {
      id: 'media',
      title: '媒体',
      icon: <Camera size={20} />,
      accent: 'from-indigo-400/80 to-sky-300/70',
      defaultOpen: true,
      window: { x: 1104, y: 56, w: 340, h: 520 },
      content: (
        <Suspense fallback={<PanelFallback label="媒体" />}>
          <MediaPanel voiceOn={voiceOn} onVoiceToggle={setVoiceOn} onSpeechResult={text => setVoiceText(text)} />
        </Suspense>
      ),
    },
    {
      id: 'timeline',
      title: '她的状态线',
      icon: <History size={20} />,
      accent: 'from-fuchsia-400/80 to-rose-300/70',
      defaultOpen: true,
      window: { x: 120, y: 118, w: 900, h: 560 },
      content: <TimelineApp />,
    },
    {
      id: 'settings',
      title: '设置',
      icon: <SettingsIcon size={20} />,
      accent: 'from-slate-400/80 to-slate-500/70',
      window: { x: 260, y: 90, w: 760, h: 600 },
      content: (
        <Suspense fallback={<PanelFallback label="设置" />}>
          <div className="os-app-dark h-full overflow-y-auto">
            <SettingsView />
          </div>
        </Suspense>
      ),
    },
    {
      id: 'personality',
      title: '人格',
      icon: <Sparkles size={20} />,
      accent: 'from-amber-300/85 to-yellow-200/70',
      window: { x: 380, y: 120, w: 720, h: 580 },
      content: (
        <Suspense fallback={<PanelFallback label="人格" />}>
          <div className="os-app-dark h-full overflow-y-auto">
            <PersonalityView />
          </div>
        </Suspense>
      ),
    },
  ], [showOscilloscope, voiceOn, voiceText]);

  return (
    <>
      <OSShell apps={apps} />
      {/* 认知示波器：仍是右侧抽屉（不属于窗口层，避免遮挡桌面） */}
      {showOscilloscope && (
        <Suspense fallback={<OverlayFallback />}>
          <CognitiveOscilloscope onClose={() => setShowOscilloscope(false)} />
        </Suspense>
      )}
    </>
  );
}

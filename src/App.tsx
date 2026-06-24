// ── 三模型观测台 · 最小化 UI ──
// 左侧：ModelPanel（实时参数）  右侧：ChatView（精简聊天）
// 后端管道完全不受影响（useAIBrainStore / eventBus / emotionEngine / curiosity 全保留）
import { useEffect, useState } from 'react';
import { useAIBrainStore } from './store/useAIBrainStore';
import { db } from './firebase';
import { doc, getDoc, setDoc, collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { handleFirestoreError, OperationType, getQuotaExceeded } from './lib/firestore-error';
import ModelPanel from './components/ModelPanel';
import ChatView from './views/ChatView';
import SettingsView from './views/SettingsView';
import CognitiveOscilloscope from './components/overlays/CognitiveOscilloscope';

export default function App() {
  const persona = useAIBrainStore(s => s.persona);
  const decayEmotion = useAIBrainStore(s => s.decayEmotion);
  const calculateOfflineDecay = useAIBrainStore(s => s.calculateOfflineDecay);
  const userStatus = useAIBrainStore(s => s.userStatus);
  const settings = useAIBrainStore(s => s.settings);
  const setSettings = useAIBrainStore(s => s.setSettings);
  const [showOscilloscope, setShowOscilloscope] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // ── 启动时从服务器同步关系状态（防止刷新重置朋友阶段）──
  useEffect(() => {
    fetch('/state')
      .then(r => r.json())
      .then(data => {
        const store = useAIBrainStore.getState();
        const p = store.persona;
        if (!p.dynamicEmotion) return;
        // 用服务器当前情感状态覆盖前端默认值
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
              // tick 反映对话轮数，用于推断关系阶段
              intimacyToUser: Math.min(0.9, 0.3 + (data.tick || 0) * 0.01),
            },
            // 简单推算：每轮对话 +1 亲密度，从 20 起步
            affinityScore: Math.min(80, 20 + (data.tick || 0)),
          },
        });
      })
      .catch(() => {}); // 静默失败，服务器不可用时保持默认
  }, []);

  // ── 启动时自动拉取 API key ──
  useEffect(() => {
    if (settings.apiKey) return;
    fetch('/api/ai-config')
      .then(r => r.json())
      .then(data => {
        if (data.success && data.apiKey) {
          setSettings({
            provider: data.provider || 'deepseek',
            apiKey: data.apiKey,
            model: data.model || 'deepseek-chat',
            baseUrl: data.baseUrl || 'https://api.deepseek.com/v1',
            temperature: data.temperature ?? 0.7,
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
            // 合并 emotionState：Firestore 保存时剥离了动态状态，从内存补上
            const currentPersona = useAIBrainStore.getState().persona;
            useAIBrainStore.setState({
              persona: {
                ...currentPersona,
                ...data.persona,
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
      <ChatView />

      {/* 设置页覆盖层 */}
      {showSettings && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <SettingsView />
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
        <CognitiveOscilloscope onClose={() => setShowOscilloscope(false)} />
      )}
    </div>
  );
}

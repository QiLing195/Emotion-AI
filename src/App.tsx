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
import CognitiveOscilloscope from './components/overlays/CognitiveOscilloscope';
import { Activity } from 'lucide-react';

export default function App() {
  const persona = useAIBrainStore(s => s.persona);
  const decayEmotion = useAIBrainStore(s => s.decayEmotion);
  const calculateOfflineDecay = useAIBrainStore(s => s.calculateOfflineDecay);
  const userStatus = useAIBrainStore(s => s.userStatus);
  const [showOscilloscope, setShowOscilloscope] = useState(false);

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
          if (data.persona) useAIBrainStore.setState({ persona: data.persona });
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
        useAIBrainStore.setState({ chatMessages: msgs });
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
      <ModelPanel />
      <ChatView />

      {/* 认知示波器切换按钮 */}
      <button
        onClick={() => setShowOscilloscope(!showOscilloscope)}
        className={`fixed bottom-4 right-4 z-50 p-2.5 rounded-full shadow-lg border transition-all ${
          showOscilloscope
            ? 'bg-coral-500 border-coral-400 text-white shadow-glow'
            : 'glass border-surface-300 text-moon-400 hover:text-moon-600 hover:border-rose-300 hover:shadow-soft'
        }`}
        title="认知示波器"
      >
        <Activity className="w-4 h-4" />
      </button>

      {/* 认知示波器覆盖层 */}
      {showOscilloscope && (
        <CognitiveOscilloscope onClose={() => setShowOscilloscope(false)} />
      )}
    </div>
  );
}

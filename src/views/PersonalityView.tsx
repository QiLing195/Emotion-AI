import React, { useEffect, useRef, useState } from 'react';
import { useAIBrainStore } from '../store/useAIBrainStore';
import PresetSelector from './PersonalityView/PresetSelector';
import PersonalityForm from './PersonalityView/PersonalityForm';
import EmotionSettings from './PersonalityView/EmotionSettings';
import BehaviorParams from './PersonalityView/BehaviorParams';
import SafetyCompliance from './PersonalityView/SafetyCompliance';
import DeepPersona from './PersonalityView/DeepPersona';
import SystemPrompt from './PersonalityView/SystemPrompt';
import NewPresetModal from './PersonalityView/NewPresetModal';

type RoomActivity = 'deskRead' | 'waterPlant' | 'drinkTea' | 'bedRead';
type RoomTimePhase = 'day' | 'dusk' | 'night';
type RoomWeatherKind = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';

interface RoomWeather {
  kind: RoomWeatherKind;
  label: string;
  sunrise: string;
  sunset: string;
  updatedAt: Date;
}

const ROOM_ACTIVITY_SCENES: Record<RoomActivity, string> = {
  deskRead: '/character/bedroom/read-desk.webp',
  waterPlant: '/character/bedroom/water-plant.webp',
  drinkTea: '/character/bedroom/drink-tea.webp',
  bedRead: '/character/bedroom/read-bed.webp',
};

function getRoomTimePhase(date: Date, sunrise?: string, sunset?: string): RoomTimePhase {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === type)?.value ?? 0);
  const now = part('hour') * 60 + part('minute') + part('second') / 60;
  const apiMinutes = (value?: string) => {
    const time = value?.split('T')[1];
    if (!time) return null;
    const [hour, minute] = time.split(':').map(Number);
    return hour * 60 + minute;
  };

  let rise = apiMinutes(sunrise);
  let set = apiMinutes(sunset);
  if (rise === null || set === null) {
    // NOAA solar-time approximation for Hangzhou, used when the weather API is offline.
    const day = Math.floor((Date.UTC(part('year'), part('month') - 1, part('day')) - Date.UTC(part('year'), 0, 0)) / 86_400_000);
    const gamma = 2 * Math.PI / 365 * (day - 1);
    const equation = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
      - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
    const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
      - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
      - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
    const latitude = 30.2741 * Math.PI / 180;
    const cosHourAngle = Math.cos(90.833 * Math.PI / 180) / (Math.cos(latitude) * Math.cos(declination))
      - Math.tan(latitude) * Math.tan(declination);
    const hourAngle = Math.acos(Math.max(-1, Math.min(1, cosHourAngle))) * 180 / Math.PI;
    const solarNoon = 720 - 4 * 120.1551 - equation + 8 * 60;
    rise = solarNoon - 4 * hourAngle;
    set = solarNoon + 4 * hourAngle;
  }
  if (Math.abs(now - rise) <= 45 || Math.abs(now - set) <= 45) return 'dusk';
  return now > rise && now < set ? 'day' : 'night';
}

function getWeatherKind(code: number): { kind: RoomWeatherKind; label: string } {
  if (code === 0) return { kind: 'clear', label: '晴' };
  if (code <= 3) return { kind: 'cloudy', label: code === 1 ? '大致晴朗' : code === 2 ? '局部多云' : '阴天' };
  if (code === 45 || code === 48) return { kind: 'fog', label: '有雾' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { kind: 'snow', label: '降雪' };
  if ([95, 96, 99].includes(code)) return { kind: 'storm', label: '雷雨' };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { kind: 'rain', label: '降雨' };
  return { kind: 'cloudy', label: '多云' };
}

export default function PersonalityView() {
  const {
    presets,
    activePresetId,
    persona,
    setPersona,
    setActivePresetId,
    addPreset,
    deletePreset,
  } = useAIBrainStore();
  const characterPresence = useAIBrainStore(s => s.characterPresence);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [roomActivity, setRoomActivity] = useState<RoomActivity>('deskRead');
  const [roomTime, setRoomTime] = useState(() => new Date());
  const [roomWeather, setRoomWeather] = useState<RoomWeather | null>(null);
  const conversationScene = '/character/bedroom/conversation.webp';
  const sceneSrc = characterPresence === 'idle' ? ROOM_ACTIVITY_SCENES[roomActivity] : conversationScene;
  const [previousScene, setPreviousScene] = useState<string | null>(null);
  const [sceneTransitioning, setSceneTransitioning] = useState(false);
  const displayedSceneRef = useRef(sceneSrc);
  const timePhase = getRoomTimePhase(roomTime, roomWeather?.sunrise, roomWeather?.sunset);

  useEffect(() => {
    const timer = window.setInterval(() => setRoomTime(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const loadWeather = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const params = new URLSearchParams({
          latitude: '30.2741', longitude: '120.1551',
          current: 'weather_code,cloud_cover,precipitation,rain,showers,snowfall,is_day',
          daily: 'sunrise,sunset', timezone: 'Asia/Shanghai', forecast_days: '1',
        });
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`weather request failed: ${response.status}`);
        const payload = await response.json();
        const code = Number(payload?.current?.weather_code);
        const sunrise = payload?.daily?.sunrise?.[0];
        const sunset = payload?.daily?.sunset?.[0];
        if (!active || !Number.isFinite(code) || typeof sunrise !== 'string' || typeof sunset !== 'string') return;
        setRoomWeather({ ...getWeatherKind(code), sunrise, sunset, updatedAt: new Date() });
      } catch {
        // Weather is decorative context; offline/network failures must not affect chat or scene rendering.
      }
    };
    void loadWeather();
    const timer = window.setInterval(() => void loadWeather(), 30 * 60_000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (sceneSrc === displayedSceneRef.current) return;
    setPreviousScene(displayedSceneRef.current);
    displayedSceneRef.current = sceneSrc;
    setSceneTransitioning(true);
    let secondFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setSceneTransitioning(false));
    });
    const timer = window.setTimeout(() => setPreviousScene(null), 1_300);
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(timer);
    };
  }, [sceneSrc]);

  const handlePresetChange = (presetId: string) => {
    setActivePresetId(presetId);
  };

  const handleDeletePreset = (presetId: string) => {
    deletePreset(presetId);
    if (activePresetId === presetId) {
      handlePresetChange('gentle_girlfriend');
    }
  };

  const handleSaveNewPreset = () => {
    if (!newPresetName.trim()) return;
    const newId = 'custom_' + Date.now();
    const newPreset = {
      id: newId,
      label: newPresetName.trim(),
      ...persona,
    };
    addPreset(newPreset);
    setActivePresetId(newId);
    setIsModalOpen(false);
    setNewPresetName('');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <section
        className={`virtual-bedroom-stage virtual-bedroom--${timePhase} virtual-bedroom--${characterPresence}`}
        data-weather={roomWeather?.kind ?? 'unknown'}
        aria-label="安雅的虚拟卧室。可点击房间物品触发活动；语音对话时她会暂停并转向屏幕。"
      >
        {previousScene && (
          <img
            className={`virtual-bedroom-photo virtual-bedroom-photo--previous ${sceneTransitioning ? 'is-visible' : ''}`}
            src={previousScene}
            alt=""
            aria-hidden="true"
          />
        )}
        <img
          className={`virtual-bedroom-photo ${sceneTransitioning ? 'is-entering' : ''}`}
          src={sceneSrc}
          alt={characterPresence === 'idle' ? '安雅在自己的虚拟卧室中活动' : '安雅暂停活动，转向屏幕倾听和回应'}
        />
        <div className="virtual-bedroom-daylight" aria-hidden="true" />
        <div className="virtual-bedroom-lamp-glow" aria-hidden="true" />
        <button className="virtual-bedroom-hotspot virtual-bedroom-hotspot--book" aria-label="让安雅在书桌边看书" onClick={() => setRoomActivity('deskRead')} disabled={characterPresence !== 'idle'} />
        <button className="virtual-bedroom-hotspot virtual-bedroom-hotspot--plant" aria-label="让安雅给窗台绿植浇水" onClick={() => setRoomActivity('waterPlant')} disabled={characterPresence !== 'idle'} />
        <button className="virtual-bedroom-hotspot virtual-bedroom-hotspot--mug" aria-label="让安雅拿起马克杯喝茶" onClick={() => setRoomActivity('drinkTea')} disabled={characterPresence !== 'idle'} />
        <button className="virtual-bedroom-hotspot virtual-bedroom-hotspot--bed" aria-label="让安雅坐在床边看书" onClick={() => setRoomActivity('bedRead')} disabled={characterPresence !== 'idle'} />
        <span className="sr-only" aria-live="polite">
          {characterPresence === 'idle' ? `虚拟活动：${roomActivity}` : characterPresence === 'listening' ? '她已暂停活动，正在倾听' : characterPresence === 'thinking' ? '她正看着屏幕思考' : '她正看着屏幕回应'}
          ，卧室光线按杭州时区的日出日落变化，当前为{timePhase === 'day' ? '白天' : timePhase === 'dusk' ? '晨昏' : '夜晚'}；杭州天气：{roomWeather?.label ?? '暂不可用'}。
        </span>
      </section>
      <section className="rounded-2xl border border-rose-100 bg-white/80 px-5 py-4 shadow-sm">
        <span className="text-[11px] font-medium tracking-wide text-rose-500">虚拟卧室 · 安雅</span>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-800">让她在自己的小屋里生活</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          点击书、绿植、马克杯或床边物品切换活动。语音聊天开始时，她会停下手里的事并看向屏幕；结束后再接着原来的活动。杭州时区的日出日落决定昼夜，天气每半小时更新一次；离线时按杭州坐标估算日照。
        </p>
        <p className="mt-2 text-[11px] text-slate-400">
          杭州天气{roomWeather ? ` · 更新于 ${roomWeather.updatedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : ' · 暂无网络数据'} · 数据来源：<a className="underline underline-offset-2" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>
        </p>
      </section>

      <PresetSelector
        presets={presets}
        activePresetId={activePresetId}
        onPresetChange={handlePresetChange}
        onDeletePreset={handleDeletePreset}
        onOpenModal={() => setIsModalOpen(true)}
      />

      <PersonalityForm
        persona={persona}
        setPersona={setPersona}
        onOpenModal={() => setIsModalOpen(true)}
      />

      <EmotionSettings
        persona={persona}
        setPersona={setPersona}
      />

      <BehaviorParams
        persona={persona}
        setPersona={setPersona}
      />

      <SafetyCompliance
        persona={persona}
        setPersona={setPersona}
      />

      <DeepPersona
        persona={persona}
        setPersona={setPersona}
      />

      <SystemPrompt
        persona={persona}
        setPersona={setPersona}
      />

      <NewPresetModal
        isOpen={isModalOpen}
        newPresetName={newPresetName}
        setNewPresetName={setNewPresetName}
        onSave={handleSaveNewPreset}
        onClose={() => {
          setIsModalOpen(false);
          setNewPresetName('');
        }}
      />
    </div>
  );
}

import React, { useState } from 'react';
import { useAIBrainStore } from '../store/useAIBrainStore';
import PresetSelector from './PersonalityView/PresetSelector';
import PersonalityForm from './PersonalityView/PersonalityForm';
import EmotionSettings from './PersonalityView/EmotionSettings';
import BehaviorParams from './PersonalityView/BehaviorParams';
import SafetyCompliance from './PersonalityView/SafetyCompliance';
import DeepPersona from './PersonalityView/DeepPersona';
import SystemPrompt from './PersonalityView/SystemPrompt';
import NewPresetModal from './PersonalityView/NewPresetModal';

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

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');

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
import React from 'react';
import { User, Save, Plus } from 'lucide-react';
import { Persona } from '../../store/useAIBrainStore';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, CardHeader, CardBody } from '../../components/ui/Card';

export interface PersonalityFormProps {
  persona: Persona;
  setPersona: (persona: Persona) => void;
  onOpenModal: () => void;
}

const PersonalityForm: React.FC<PersonalityFormProps> = ({
  persona,
  setPersona,
  onOpenModal,
}) => {
  return (
    <Card rounded="2xl" shadow="md" border={true} className="overflow-hidden">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <User className="w-5 h-5 text-indigo-500" />
            基础设定
          </span>
        }
        description="定义AI管家的基本身份信息"
        action={
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              onClick={onOpenModal}
            >
              存为新预设
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Save className="w-4 h-4" />}
            >
              保存设置
            </Button>
          </div>
        }
      />

      <CardBody padding="lg">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Input
            label="称呼 (Name)"
            value={persona.name}
            onChange={e => setPersona({...persona, name: e.target.value})}
            placeholder="输入AI的称呼"
          />
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">年龄设定 (Age)</label>
          <input
            type="number"
            value={persona.age}
            onChange={e => setPersona({...persona, age: parseInt(e.target.value)})}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">性别倾向 (Gender)</label>
          <select
            value={persona.gender}
            onChange={e => setPersona({...persona, gender: e.target.value})}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all bg-white"
          >
            <option>中性</option>
            <option>女性</option>
            <option>男性</option>
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">语气风格 (Tone)</label>
          <input
            type="text"
            value={persona.tone}
            onChange={e => setPersona({...persona, tone: e.target.value})}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
            placeholder="例如：专业、活泼、严厉"
          />
        </div>
      </div>
    </CardBody>
    </Card>
  );
};

export default PersonalityForm;
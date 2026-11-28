import { describe, expect, it } from 'vitest';
import { taskPolicy } from './taskPolicy.ts';

describe('M2b server route and risk policy', () => {
  it('prefers an official API, falls back to native capabilities only for supported intents, and keeps Mika scoped', () => {
    expect(taskPolicy({ intent: 'calendar.create', inputs: { title: 'Planning' } })).toMatchObject({ route: 'official_api', risk: 'medium' });
    expect(taskPolicy({ intent: 'reminder.create', inputs: { title: 'Break' } })).toMatchObject({ route: 'android_native', risk: 'medium' });
    expect(taskPolicy({ intent: 'calendar.create', inputs: { title: 'Planning' } }, ['android_native', 'mika_sandbox'])).toMatchObject({ route: 'android_native' });
    expect(() => taskPolicy({ intent: 'calendar.create', inputs: { title: 'Planning' } }, ['mika_sandbox'])).toThrow();
    const app = { intent: 'app.open', inputs: {}, targetApp: 'sandbox.notes' };
    expect(taskPolicy(app)).toMatchObject({ route: 'android_native', risk: 'low' });
    expect(taskPolicy(app, ['mika_sandbox'])).toMatchObject({ route: 'mika_sandbox', grants: taskPolicy(app).grants });
    expect(taskPolicy({ intent: 'app.read', inputs: { section: 'overview' } })).toMatchObject({ route: 'mika_sandbox', risk: 'low' });
    expect(() => taskPolicy({ intent: 'app.open', inputs: {}, targetApp: 'arbitrary.app' })).toThrow();
    expect(taskPolicy({ intent: 'payment.execute', inputs: {} }, ['mika_sandbox'])).toMatchObject({ risk: 'critical' });
  });
});

import { describe, expect, it } from 'vitest';
import { buildRelationshipDemoScenarios, runRelationshipDemo } from '../relationshipDemo.js';

describe('relationshipDemo scenarios', () => {
  const scenarios = buildRelationshipDemoScenarios();

  it.each([
    ['support_only', 'friend'],
    ['single_confession', 'friend'],
    ['mutual_romance', 'crush'],
    ['mutual_commitment', 'lover'],
    ['boundary_rejection', 'crush'],
  ])('evaluates %s as %s', (scenarioId, expectedStage) => {
    const result = runRelationshipDemo(scenarios[scenarioId].events);
    expect(result.state.stage).toBe(expectedStage);
  });

  it('reports rejection as a romantic progression blocker', () => {
    const result = runRelationshipDemo(scenarios.boundary_rejection.events);
    expect(result.state.boundaryStatus).toBe('closed');
    expect(result.report.blockers).toContain('存在明确拒绝，浪漫阶段入口已关闭');
  });
});

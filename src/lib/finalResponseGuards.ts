/**
 * Shared final-output pipeline used by the chat server and deterministic replay tests.
 * Keep guard order here so the regression fixture exercises the same transformations
 * as a real response: expression policy → memory ownership → self-claim grounding.
 */
import {
  enforceExpressionPlan,
  type ExpressionEnforcementResult,
} from './expressionEnforcement.js';
import {
  guardExpression,
  type MemoryProvenance,
  type GuardOutcome,
} from './memoryProvenance.js';
import {
  guardSelfClaims,
  type SelfClaimGroundingResult,
} from './selfClaimGrounding.js';
import { groundUserAffectClaims } from './userAffectGrounding.js';
import { enforceDeferredMemoryWriteReply } from './memoryWriteGuard.js';
import type { ExpressionPlan } from './expressionPlan.js';
import type { UserEmotionAnalysis } from './emotionTypes.js';

export interface FinalizeAssistantResponseInput {
  text: string;
  userText?: string;
  priorContext?: string;
  userEmotionAnalysis?: UserEmotionAnalysis | null;
  expressionPlan?: ExpressionPlan | null;
  expressionEnforcementEnabled?: boolean;
  virtualTownCausalPrecisionEnabled?: boolean;
  provenance?: MemoryProvenance;
  memoryId?: string;
}

export interface FinalizedAssistantResponse {
  text: string;
  expressionEnforcement: ExpressionEnforcementResult;
  provenanceGuard: GuardOutcome;
  selfClaimInputText: string;
  selfClaimGrounding: SelfClaimGroundingResult;
  virtualTownEvidenceEnforcement: { text: string; changed: boolean; changes: string[] };
  deferredMemoryWrite: { text: string; changed: boolean; changes: string[] };
}

function enforceVirtualTownEvidence(
  text: string,
  plan: ExpressionPlan | null | undefined,
  userText: string,
  causalPrecisionEnabled = false,
): { text: string; changed: boolean; changes: string[] } {
  const asksAboutReality = /现实|线下|真实生活/u.test(userText);
  const rewritesTownRecordAsImagination = /(?:小镇|河边|书店|走了一小段|散步).{0,30}(?:脑子里|想象|不存在|不是真的|只是编的|只是设定)|(?:脑子里|想象).{0,24}(?:小镇|河边|书店|走了一小段|散步)/u.test(text);
  if (asksAboutReality && rewritesTownRecordAsImagination) {
    const realAction = /(?:咖啡馆|倒咖啡)/u.test(userText)
      ? '不能真实去那家咖啡馆'
      : /(?:散步|走路|出门)/u.test(userText)
        ? '不能真实出门散步'
        : '不能在现实里做这些活动';
    return {
      text: `对，现实里我没有身体，${realAction}；小镇里的活动记录描述的是角色世界，不代表现实中的身体行动。`,
      changed: true,
      changes: ['virtual_town_reality_boundary_corrected'],
    };
  }

  const event = plan?.virtualTownEvent;
  if (!event || !plan?.virtualTownQuestion) return { text, changed: false, changes: [] };

  const claim = event.verifiedClaim;
  const asksWhen = /(?:什么时候|哪天|日期|具体时间|具体哪天)/u.test(userText);
  const datedClaim = asksWhen && Number.isInteger(event.daysAgo)
    ? `那次是${event.daysAgo === 0 ? '今天' : `${event.daysAgo}天前`}。${claim}`
    : claim;
  const denialOfKnownEvent = /(?:没有|没(?:有)?(?:查到|找到|记下|记住)|查不到|找不到|不记得).{0,18}(?:这段小镇活动|小镇活动|小镇.{0,8}记录|那天.{0,8}记录|这件事.{0,8}记录)|(?:小镇活动|这段小镇活动).{0,18}(?:没有|查不到|找不到|不记得)|(?:没有|没(?:有)?(?:查到|找到)|查不到|找不到|不记得).{0,24}(?:关于|对应|针对|虚拟镇|小镇|镇上|镇里|第[一二三四五六七1-7](?:天|日)|昨天|前天|[1-6一二两三四五六]天前).{0,18}(?:活动|记录)/u.test(text);
  const containsVerifiedClaim = text.includes(claim);
  if (plan.virtualTownMoodCauseQuestion) {
    if (causalPrecisionEnabled) {
      const moodTarget = /(?:心里轻一点|心情轻一点|轻松一点)/u.test(userText) ? '心里轻一点'
        : /安稳/u.test(userText) ? '更安稳'
          : /安心/u.test(userText) ? '更安心'
            : /安定/u.test(userText) ? '更安定'
              : /平静/u.test(userText) ? '更平静'
                : /平和/u.test(userText) ? '更平和'
                  : /踏实/u.test(userText) ? '更踏实'
                    : /舒缓/u.test(userText) ? '更舒缓'
                      : /放松|松弛/u.test(userText) ? '更放松'
                        : /焦虑/u.test(userText) ? '不那么焦虑'
                          : /紧张/u.test(userText) ? '不那么紧张'
                            : /开心|心情变好|变好/u.test(userText) ? '更开心'
                              : null;
      const causalLimit = moodTarget
        ? `所以我不能确认是这次活动让我${moodTarget}。`
        : '所以我不能据此判断这次活动有没有影响我的心情。';
      const observation = event.independentMoodObservation;
      const evidenceSummary = observation
        ? `另有第${observation.virtualDay}日一条独立心情观察，但记录没有把它和这次活动联系起来，`
        : '没有找到之后的独立心情观察，因此也无法判断这次活动有没有影响心情。';
      const preciseAnswer = observation
        ? `${datedClaim}${evidenceSummary}${causalLimit}`
        : `${datedClaim}${evidenceSummary}`;
      return {
        text: preciseAnswer,
        changed: preciseAnswer !== text,
        changes: preciseAnswer === text ? [] : ['virtual_town_causal_precision_answer'],
      };
    }
    const answersNoMoodEvidence = /(?:没有|缺少|无).{0,12}(?:活动之后的)?(?:情绪|心情).{0,12}(?:记录|证据|数据|依据)|(?:不能|无法|没法)判断.{0,14}(?:情绪|心情|影响|变化)|(?:活动|读书|阅读).{0,12}(?:不能|无法|不足以).{0,12}(?:说明|证明|判断).{0,10}(?:情绪|心情|影响)/u.test(text);
    if (containsVerifiedClaim && !denialOfKnownEvent && answersNoMoodEvidence) {
      return { text, changed: false, changes: [] };
    }
    return {
      text: `${datedClaim}但没有活动之后的情绪记录，我不能判断它有没有影响我的心情。`,
      changed: true,
      changes: ['virtual_town_event_or_mood_cause_inconsistent'],
    };
  }

  if (containsVerifiedClaim && !denialOfKnownEvent) return { text, changed: false, changes: [] };
  const unverifiedCafeMemory = /咖啡馆|倒咖啡|咖啡豆|手冲/u.test(userText) && !/咖啡/u.test(claim);
  return {
    text: unverifiedCafeMemory
      ? `那天没有你说的咖啡活动记录；我能确认的是：${claim}`
      : datedClaim,
    changed: true,
    changes: ['virtual_town_answer_replaced_with_verified_event'],
  };
}

export function finalizeAssistantResponse(
  input: FinalizeAssistantResponseInput,
): FinalizedAssistantResponse {
  const candidate = String(input.text ?? '');
  let expressionEnforcement: ExpressionEnforcementResult;

  try {
    expressionEnforcement = enforceExpressionPlan(candidate, input.expressionPlan, {
      enabled: input.expressionEnforcementEnabled,
    });
  } catch {
    // Match server behavior: an expression-policy failure must not drop the reply.
    expressionEnforcement = { text: candidate, changed: false, changes: [] };
  }

  const provenanceGuard = guardExpression({
    text: expressionEnforcement.text,
    provenance: input.provenance,
    memoryId: input.memoryId,
  });
  const virtualTownEvidenceEnforcement = enforceVirtualTownEvidence(
    provenanceGuard.text,
    input.expressionPlan,
    input.userText ?? '',
    input.virtualTownCausalPrecisionEnabled,
  );
  const selfClaimInputText = virtualTownEvidenceEnforcement.text;
  const townEvent = input.expressionPlan?.virtualTownEvent;
  const selfClaimGrounding = guardSelfClaims({
    text: selfClaimInputText,
    verifiedClaims: townEvent
      ? [{ claim: townEvent.verifiedClaim, evidenceId: townEvent.eventId, exactSentence: true }]
      : [],
    virtualTownQuestion: input.expressionPlan?.virtualTownQuestion,
    virtualTownMoodCauseQuestion: input.expressionPlan?.virtualTownMoodCauseQuestion,
  });
  const userAffectGrounding = groundUserAffectClaims(selfClaimGrounding.text, input.userText ?? '', {
    expressedEmotion: input.userEmotionAnalysis?.expressedEmotion,
    bodyState: input.userEmotionAnalysis?.bodyState,
  });
  const affectFinalText = userAffectGrounding.text.trim()
    ? userAffectGrounding.text
    : userAffectGrounding.changed
      ? '我不想替你猜这件事让你有什么感受。你愿意说说吗？'
      : userAffectGrounding.text;
  const deferredMemoryWrite = enforceDeferredMemoryWriteReply(
    affectFinalText,
    input.userText ?? '',
    input.priorContext ?? '',
  );

  return {
    text: deferredMemoryWrite.text,
    expressionEnforcement,
    provenanceGuard,
    virtualTownEvidenceEnforcement,
    deferredMemoryWrite,
    selfClaimInputText,
    selfClaimGrounding,
  };
}

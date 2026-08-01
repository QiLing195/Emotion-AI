import { describe, expect, it } from 'vitest';
import { escapeXmlCdata } from '../channels/wechat.js';

describe('escapeXmlCdata', () => {
  it('splits CDATA terminators so generated text remains valid XML', () => {
    expect(escapeXmlCdata('before]]>after')).toBe('before]]]]><![CDATA[>after');
  });
});

export function extractJSON(text: string): any {
  if (!text) return {};

  // Clean up markdown code blocks if present
  let cleanText = text.trim();
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  }

  try {
    return JSON.parse(cleanText);
  } catch (e) {
    const match = cleanText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        console.error('Failed to parse extracted JSON:', match[0]);
        return {};
      }
    }
    console.error('No JSON object found in text:', text);
    return {};
  }
}

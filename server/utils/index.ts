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

export function convertSchemaToGemini(schema: any): any {
  if (!schema) return schema;
  if (Array.isArray(schema)) return schema.map(convertSchemaToGemini);
  if (typeof schema === 'object') {
    const newSchema: any = {};
    for (const key in schema) {
      if (key === 'type' && typeof schema[key] === 'string') {
        newSchema[key] = schema[key].toUpperCase();
      } else {
        newSchema[key] = convertSchemaToGemini(schema[key]);
      }
    }
    return newSchema;
  }
  return schema;
}
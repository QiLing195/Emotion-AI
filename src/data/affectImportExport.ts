import {
  EmotionAnnotation,
  QUADRANTS,
  clampCoord,
  findNearestAffects,
  getIntensity,
  getQuadrant,
} from './affectLexicon';

const MAX_IMPORT_ROWS = 500;

export function serializeAnnotationsToCsv(annotations: EmotionAnnotation[]): string {
  const header = [
    'id',
    'primary_label',
    'quadrant',
    'valence',
    'arousal',
    'intensity',
    'context',
    'created_at',
    'utterance',
  ];

  const escapeCsv = (value: string | number): string => {
    const str = String(value);
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = annotations.map((item) =>
    [
      item.id,
      item.primaryLabel,
      QUADRANTS[item.quadrant].label,
      item.valence.toFixed(2),
      item.arousal.toFixed(2),
      getIntensity(item.valence, item.arousal).toFixed(2),
      item.context,
      item.createdAt,
      item.utterance,
    ]
      .map(escapeCsv)
      .join(',')
  );

  return [header.join(','), ...rows].join('\n');
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) => r.some((value) => value.trim().length > 0));
}

function normalizeRecord(
  record: Record<string, unknown>,
  index: number,
  fallbackTimestamp: string
): EmotionAnnotation | null {
  const rawUtterance =
    record.utterance ?? record.text ?? record.note ?? record['文本'] ?? record['话语'];
  if (typeof rawUtterance !== 'string' || !rawUtterance.trim()) {
    return null;
  }

  const valenceNum = Number(record.valence ?? record['效价']);
  const arousalNum = Number(record.arousal ?? record['唤醒度']);
  const valence = Number.isFinite(valenceNum) ? clampCoord(valenceNum) : 0;
  const arousal = Number.isFinite(arousalNum) ? clampCoord(arousalNum) : 0;

  const rawLabel =
    record.primaryLabel ??
    record.primary_label ??
    record.label ??
    record['情绪标签'] ??
    record['主情绪'];
  const fallbackLabel = findNearestAffects(valence, arousal, 1)[0]?.label ?? '中性';
  const primaryLabel =
    typeof rawLabel === 'string' && rawLabel.trim()
      ? rawLabel.trim().slice(0, 60)
      : fallbackLabel;

  const rawContext = record.context ?? record['来源场景'] ?? record['场景'];
  const context =
    typeof rawContext === 'string' && rawContext.trim()
      ? rawContext.trim().slice(0, 80)
      : '导入数据';

  const rawCreatedAt = record.createdAt ?? record.created_at ?? record['记录时间'];
  const createdAt =
    typeof rawCreatedAt === 'string' && rawCreatedAt.trim()
      ? rawCreatedAt.trim().slice(0, 32)
      : fallbackTimestamp;

  const rawId = record.id;
  const id =
    typeof rawId === 'string' && rawId.trim()
      ? `${rawId.trim().slice(0, 48)}-${index}`
      : `imp-${Date.now()}-${index}`;

  return {
    id,
    utterance: rawUtterance.trim().slice(0, 2000),
    context,
    valence,
    arousal,
    primaryLabel,
    quadrant: getQuadrant(valence, arousal),
    createdAt,
  };
}

export function parseImportedAnnotations(
  content: string,
  filename: string,
  fallbackTimestamp: string
): { annotations: EmotionAnnotation[]; error?: string } {
  const trimmed = content.trim();
  if (!trimmed) {
    return { annotations: [], error: '所选文件内容为空。' };
  }

  const isJson =
    filename.toLowerCase().endsWith('.json') ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('{');

  if (isJson) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const list = Array.isArray(parsed)
        ? parsed
        : typeof parsed === 'object' &&
            parsed !== null &&
            Array.isArray((parsed as { annotations?: unknown }).annotations)
          ? (parsed as { annotations: unknown[] }).annotations
          : null;

      if (!list) {
        return {
          annotations: [],
          error: 'JSON 文件必须包含标注对象数组。',
        };
      }

      const normalized = list
        .slice(0, MAX_IMPORT_ROWS)
        .map((item, index) =>
          typeof item === 'object' && item !== null
            ? normalizeRecord(item as Record<string, unknown>, index, fallbackTimestamp)
            : null
        )
        .filter((item): item is EmotionAnnotation => item !== null);

      if (normalized.length === 0) {
        return {
          annotations: [],
          error: '未找到有效的标注条目（需包含 utterance 或 文本 字段）。',
        };
      }

      return { annotations: normalized };
    } catch {
      return { annotations: [], error: '导入的 JSON 文件格式无效。' };
    }
  }

  const rows = parseCsvRows(trimmed);
  if (rows.length < 2) {
    return {
      annotations: [],
      error: 'CSV 文件需包含表头行及至少一行数据。',
    };
  }

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  if (
    !headers.includes('utterance') &&
    !headers.includes('text') &&
    !headers.includes('文本') &&
    !headers.includes('话语')
  ) {
    return {
      annotations: [],
      error: 'CSV 表头需包含 utterance、text 或 文本 列。',
    };
  }

  const normalized: EmotionAnnotation[] = [];
  const dataRows = rows.slice(1, MAX_IMPORT_ROWS + 1);

  dataRows.forEach((cells, index) => {
    const record: Record<string, unknown> = {};
    headers.forEach((header, colIdx) => {
      record[header] = cells[colIdx] ?? '';
    });
    const entry = normalizeRecord(record, index, fallbackTimestamp);
    if (entry) normalized.push(entry);
  });

  if (normalized.length === 0) {
    return {
      annotations: [],
      error: 'CSV 文件中没有找到包含非空文本的有效记录。',
    };
  }

  return { annotations: normalized };
}

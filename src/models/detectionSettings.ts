import { sql } from "@databases/mysql";

import { storage } from "./storage";

export const DETECTION_CONFIDENCE_PERCENT_OPTIONS = [40, 50, 60, 70, 80, 90] as const;
export type DetectionConfidencePercent = (typeof DETECTION_CONFIDENCE_PERCENT_OPTIONS)[number];

export type DetectionConfidencePercents = {
  bees: DetectionConfidencePercent;
  drones: DetectionConfidencePercent;
  queens: DetectionConfidencePercent;
  queenCups: DetectionConfidencePercent;
  varroa: DetectionConfidencePercent;
  varroaBottom: DetectionConfidencePercent;
};

export type DetectionThresholds = {
  bees: number;
  drones: number;
  queens: number;
  queenCups: number;
  varroa: number;
  varroaBottom: number;
};

const DEFAULT_PERCENT: DetectionConfidencePercent = 60;

export type UserDetectionSettings = {
  userId: number;
  confidencePercents: DetectionConfidencePercents;
  thresholds: DetectionThresholds;
};

export type DetectionPayload = {
  detectionConfidencePercents?: Partial<Record<keyof DetectionConfidencePercents, number>>;
  detectionThresholds?: Partial<DetectionThresholds>;
};

function normalizePercent(value: any): DetectionConfidencePercent {
  const parsed = Number(value);
  if ((DETECTION_CONFIDENCE_PERCENT_OPTIONS as readonly number[]).includes(parsed)) {
    return parsed as DetectionConfidencePercent;
  }
  return DEFAULT_PERCENT;
}

function percentToThreshold(percent: number): number {
  return Math.max(0, Math.min(1, percent / 100));
}

function normalizeConfidencePercents(input?: Partial<Record<keyof DetectionConfidencePercents, any>>): DetectionConfidencePercents {
  return {
    bees: normalizePercent(input?.bees),
    drones: normalizePercent(input?.drones),
    queens: normalizePercent(input?.queens),
    queenCups: normalizePercent(input?.queenCups),
    varroa: normalizePercent(input?.varroa),
    varroaBottom: normalizePercent(input?.varroaBottom),
  };
}

function buildThresholds(confidencePercents: DetectionConfidencePercents): DetectionThresholds {
  return {
    bees: percentToThreshold(confidencePercents.bees),
    drones: percentToThreshold(confidencePercents.drones),
    queens: percentToThreshold(confidencePercents.queens),
    queenCups: percentToThreshold(confidencePercents.queenCups),
    varroa: percentToThreshold(confidencePercents.varroa),
    varroaBottom: percentToThreshold(confidencePercents.varroaBottom),
  };
}

function normalizeThreshold(value: any, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

function getDefaultConfidencePercents(): DetectionConfidencePercents {
  return {
    bees: DEFAULT_PERCENT,
    drones: DEFAULT_PERCENT,
    queens: DEFAULT_PERCENT,
    queenCups: DEFAULT_PERCENT,
    varroa: DEFAULT_PERCENT,
    varroaBottom: DEFAULT_PERCENT,
  };
}

export function resolveThresholdFromPayload(
  payload: DetectionPayload | null | undefined,
  key: keyof DetectionThresholds
): number {
  const defaultThresholds = buildThresholds(getDefaultConfidencePercents());
  const confidencePercents = normalizeConfidencePercents(payload?.detectionConfidencePercents as any);
  const thresholdsFromPercents = buildThresholds(confidencePercents);
  const fallback = thresholdsFromPercents[key] ?? defaultThresholds[key];
  return normalizeThreshold(payload?.detectionThresholds?.[key], fallback);
}

const detectionSettingsModel = {
  getByUserId: async (uid: number): Promise<UserDetectionSettings> => {
    const rows = await storage().query(sql`
      SELECT
        user_id as userId,
        min_confidence_percent as minConfidencePercent,
        bees_confidence_percent as bees,
        drones_confidence_percent as drones,
        queens_confidence_percent as queens,
        queen_cups_confidence_percent as queenCups,
        varroa_confidence_percent as varroa,
        varroa_bottom_confidence_percent as varroaBottom
      FROM user_detection_settings
      WHERE user_id = ${uid}
      LIMIT 1
    `);

    const row = rows?.[0];
    const legacyFallbackPercent = normalizePercent(row?.minConfidencePercent);
    const confidencePercents = normalizeConfidencePercents({
      bees: row?.bees ?? legacyFallbackPercent,
      drones: row?.drones ?? legacyFallbackPercent,
      queens: row?.queens ?? legacyFallbackPercent,
      queenCups: row?.queenCups ?? legacyFallbackPercent,
      varroa: row?.varroa ?? legacyFallbackPercent,
      varroaBottom: row?.varroaBottom ?? legacyFallbackPercent,
    });

    return {
      userId: uid,
      confidencePercents,
      thresholds: buildThresholds(confidencePercents),
    };
  },

  setConfidencePercents: async (
    uid: number,
    input: Partial<Record<keyof DetectionConfidencePercents, number>>
  ): Promise<UserDetectionSettings> => {
    const normalized = normalizeConfidencePercents(input);

    await storage().query(sql`
      INSERT INTO user_detection_settings (
        user_id,
        min_confidence_percent,
        bees_confidence_percent,
        drones_confidence_percent,
        queens_confidence_percent,
        queen_cups_confidence_percent,
        varroa_confidence_percent,
        varroa_bottom_confidence_percent
      )
      VALUES (
        ${uid},
        ${normalized.queens},
        ${normalized.bees},
        ${normalized.drones},
        ${normalized.queens},
        ${normalized.queenCups},
        ${normalized.varroa},
        ${normalized.varroaBottom}
      )
      ON DUPLICATE KEY UPDATE
        min_confidence_percent = VALUES(min_confidence_percent),
        bees_confidence_percent = VALUES(bees_confidence_percent),
        drones_confidence_percent = VALUES(drones_confidence_percent),
        queens_confidence_percent = VALUES(queens_confidence_percent),
        queen_cups_confidence_percent = VALUES(queen_cups_confidence_percent),
        varroa_confidence_percent = VALUES(varroa_confidence_percent),
        varroa_bottom_confidence_percent = VALUES(varroa_bottom_confidence_percent),
        updated_at = CURRENT_TIMESTAMP
    `);

    return detectionSettingsModel.getByUserId(uid);
  },

  getJobPayloadForUser: async (uid: number): Promise<DetectionPayload> => {
    const settings = await detectionSettingsModel.getByUserId(uid);
    return {
      detectionConfidencePercents: settings.confidencePercents,
      detectionThresholds: settings.thresholds,
    };
  },
};

export default detectionSettingsModel;

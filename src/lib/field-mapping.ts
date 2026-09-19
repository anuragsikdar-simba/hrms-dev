/**
 * Central mapping between onboarding form field IDs and employees table columns.
 *
 * - Known fields map to real DB columns (structured, queryable).
 * - Any field NOT in this map is treated as a custom/dynamic field and
 *   stored in `employees.custom_fields` JSONB.
 *
 * The employee profile page uses this to decide where to read/write values.
 *
 * ── Schema alignment (v2) ──────────────────────────────────────────────
 * Every key in FIELD_TO_COLUMN corresponds to a real column in the
 * `employees` table or a nested key inside the `bank_details` JSONB column.
 *
 * Columns added in v2 that were missing in v1:
 *   personal_email, current_address, current_city, current_state,
 *   current_pin_code, pan, aadhaar, bank_details (JSONB),
 *   must_reset_password
 */

/** Maps onboarding field ID -> employees table column name.
 *  `bank_details.*` fields are nested inside the `bank_details` JSONB column. */
export const FIELD_TO_COLUMN: Record<string, string> = {
  // Personal
  full_name: 'name',
  personal_email: 'personal_email',
  mobile_number: 'phone',
  date_of_birth: 'date_of_birth',
  gender: 'gender',
  blood_group: 'blood_group',

  // Permanent address
  permanent_address: 'address',
  permanent_city: 'city',
  permanent_state: 'state',
  permanent_pin_code: 'pin_code',

  // Current address
  // NOTE: the employees table only has a single `current_address` column.
  // There are no current_city/current_state/current_pin_code columns, so
  // those field IDs are intentionally NOT mapped here; they fall through to
  // `custom_fields` instead. (Mapping them to non-existent columns made the
  // entire approve UPDATE fail silently.)
  current_address: 'current_address',

  // Emergency contact
  emergency_contact_name: 'emergency_contact_name',
  emergency_contact_phone: 'emergency_contact_phone',
  emergency_contact_relationship: 'emergency_contact_relation',

  // Identity documents
  pan_number: 'pan',
  aadhaar_number: 'aadhaar',

  // Bank details (nested inside bank_details JSONB column)
  bank_name: 'bank_details.bankName',
  account_number: 'bank_details.accountNumber',
  ifsc_code: 'bank_details.ifsc',
  account_type: 'bank_details.accountType',
};

/** Reverse map: DB column -> onboarding field ID */
export const COLUMN_TO_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(FIELD_TO_COLUMN).map(([k, v]) => [v, k])
);

/** Set of known field IDs that map to real columns */
export const KNOWN_FIELD_IDS = new Set(Object.keys(FIELD_TO_COLUMN));

/** Fields that should be masked in display (not when editing) */
export const MASKED_FIELDS: Record<string, (v: string) => string> = {
  pan_number: (v) => v.length >= 6 ? v.slice(0, 5) + '****' + v.slice(-1) : v,
  aadhaar_number: (v) => v.length >= 4 ? 'XXXX XXXX ' + v.slice(-4) : v,
  account_number: (v) => v.length >= 4 ? '****' + v.slice(-4) : v,
};

/** Fields in the File Upload type (these don't go to employee columns or custom_fields) */
export const FILE_UPLOAD_FIELDS = new Set([
  'aadhaar_doc', 'pan_doc', 'education_docs',
]);

/**
 * Check if a field ID is a known/core field that maps to a DB column.
 * Custom/dynamic fields (e.g. "field_1779805396993") return false.
 */
export function isKnownField(fieldId: string): boolean {
  return KNOWN_FIELD_IDS.has(fieldId);
}

/**
 * Check if a column mapping points to a bank_details sub-key.
 */
export function isBankField(column: string): boolean {
  return column.startsWith('bank_details.');
}

/**
 * Given onboarding responses, split into:
 * - columnUpdates: Record that maps to employees table columns
 * - bankUpdates: Record of bank_details sub-keys (to merge into bank_details JSONB)
 * - customFields: Record of dynamic fields for custom_fields JSONB
 */
export function splitResponses(
  responses: Record<string, string>,
  configFields?: Array<{ id: string; label: string; type: string }>
): {
  columnUpdates: Record<string, unknown>;
  bankUpdates: Record<string, string>;
  customFields: Record<string, string>;
  customFieldLabels: Record<string, string>;
} {
  const columnUpdates: Record<string, unknown> = {};
  const bankUpdates: Record<string, string> = {};
  const customFields: Record<string, string> = {};
  const customFieldLabels: Record<string, string> = {};

  // Build a label map from config if available
  const labelMap = new Map<string, string>();
  if (configFields) {
    for (const f of configFields) {
      labelMap.set(f.id, f.label);
    }
  }

  for (const [fieldId, value] of Object.entries(responses)) {
    if (!value || fieldId.startsWith('_')) continue; // skip internal flags like _same_as_permanent
    if (FILE_UPLOAD_FIELDS.has(fieldId)) continue;   // file uploads handled separately

    if (isKnownField(fieldId)) {
      const col = FIELD_TO_COLUMN[fieldId];
      if (isBankField(col)) {
        const bankKey = col.split('.')[1];
        bankUpdates[bankKey] = value;
      } else {
        columnUpdates[col] = value;
      }
    } else {
      customFields[fieldId] = value;
      if (labelMap.has(fieldId)) {
        customFieldLabels[fieldId] = labelMap.get(fieldId)!;
      }
    }
  }

  return { columnUpdates, bankUpdates, customFields, customFieldLabels };
}

/**
 * Read a field value from employee data.
 * Known fields read from the respective column.
 * Unknown fields read from custom_fields JSONB.
 */
export function readFieldValue(
  fieldId: string,
  employeeData: Record<string, unknown>
): string {
  if (isKnownField(fieldId)) {
    const col = FIELD_TO_COLUMN[fieldId];
    if (isBankField(col)) {
      const bankKey = col.split('.')[1];
      const bank = employeeData.bank_details as Record<string, string> | null;
      return bank?.[bankKey] ?? '';
    }
    return (employeeData[col] as string) ?? '';
  }

  // Custom field - read from custom_fields JSONB
  const custom = employeeData.custom_fields as Record<string, string> | null;
  return custom?.[fieldId] ?? '';
}

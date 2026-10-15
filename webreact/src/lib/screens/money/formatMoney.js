/**
 * Format a money value in minor units (cents) to a currency string.
 * @param {number} amountMinor - The amount in minor units (e.g., cents)
 * @param {string} currency - The currency code (e.g., 'USD')
 * @returns {string} Formatted currency string (e.g., '$100.00')
 */
export function formatMoney(amountMinor, currency = 'USD') {
  if (amountMinor == null) return '—';
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatter.format(amountMinor / 100);
}

/**
 * Format a date/timestamp to a readable date string.
 * @param {string|Date} dateValue - The date to format
 * @returns {string} Formatted date string
 */
export function formatDate(dateValue) {
  if (!dateValue) return '—';
  const date = new Date(dateValue);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a datetime/timestamp to a readable datetime string.
 * @param {string|Date} dateValue - The datetime to format
 * @returns {string} Formatted datetime string
 */
export function formatDateTime(dateValue) {
  if (!dateValue) return '—';
  const date = new Date(dateValue);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function isHttpUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (!url.hostname) return false;
  if (url.username || url.password) return false;
  return true;
}

function isDigest(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isIsoTimestamp(value) {
  return (
    typeof value === 'string' &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

module.exports = {
  hasOwn,
  isCalendarDate,
  isDigest,
  isHttpUrl,
  isIsoTimestamp,
  isNonEmptyString,
  isPlainObject,
};

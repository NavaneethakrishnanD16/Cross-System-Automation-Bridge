export function toSqliteDatetime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
// month/day only -- a birthday recurs every year, the stored `birthday`
// column's year is just whatever the signup form happened to be given.
// birthdayStr is a plain date-only string (a Postgres DATE column has no
// timezone), which JS always parses as UTC midnight -- .getUTCMonth/Date()
// is what correctly recovers the calendar day as originally entered,
// compared against the viewer's own local "today" so the banner shows on
// their real-world today, not a UTC-shifted one.
export function isTodayBirthday(birthdayStr) {
  if (!birthdayStr) return false;
  const b = new Date(birthdayStr);
  const today = new Date();
  return b.getUTCMonth() === today.getMonth() && b.getUTCDate() === today.getDate();
}

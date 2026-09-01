import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

// month/day only -- a birthday recurs every year, the stored `birthday`
// column's year is just whatever the signup form happened to be given
function isTodayBirthday(birthdayStr) {
  if (!birthdayStr) return false;
  const b = new Date(birthdayStr);
  const today = new Date();
  return b.getUTCMonth() === today.getMonth() && b.getUTCDate() === today.getDate();
}

// powers the site-wide "happy birthday" banner + auto-confetti when
// today is the founder's actual birthday
export function useFounderBirthday() {
  const [founder, setFounder] = useState(null);

  useEffect(() => {
    api.users
      .getFounder()
      .then(setFounder)
      .catch(() => setFounder(null));
  }, []);

  return { founder, isBirthdayToday: !!founder && isTodayBirthday(founder.birthday) };
}

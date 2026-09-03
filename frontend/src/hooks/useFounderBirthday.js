import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { isTodayBirthday } from '../lib/birthday.js';

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

import Layout from './Layout.jsx';
import Feed from '../pages/Feed.jsx';
import Landing from '../pages/Landing.jsx';
import { useAuth } from '../context/AuthContext.jsx';

// "/" is the one route that isn't simply public or simply gated -- it's
// the feed for a signed-in visitor and the video-hero landing page for
// everyone else, same address either way. Every other page is still a
// hard RequireAuth redirect to /login; landing here on a bare
// "you have to sign in first" bounce is a bad first impression for
// someone who's never signed up.
export default function HomeGate() {
  const { user, loading } = useAuth();

  // same reasoning as RequireAuth: render nothing while the session check
  // is still in flight, rather than flashing the landing page for a beat
  // and then yanking to the feed once a valid session turns up
  if (loading) return null;

  return user ? (
    <Layout>
      <Feed />
    </Layout>
  ) : (
    <Landing />
  );
}

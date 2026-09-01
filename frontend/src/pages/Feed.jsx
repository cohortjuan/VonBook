import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import CreatePost from '../components/CreatePost.jsx';
import PostCard from '../components/PostCard.jsx';

export default function Feed() {
  const [posts, setPosts] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async (before) => {
    const page = await api.posts.feed(before);
    setPosts((prev) => (before ? [...(prev || []), ...page] : page));
    setHasMore(page.length === 20);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (!posts || posts.length === 0) return;
    setLoadingMore(true);
    await load(posts[posts.length - 1].id).finally(() => setLoadingMore(false));
  }

  function handleCreated(post) {
    setPosts((prev) => [post, ...(prev || [])]);
  }

  function handleRemoved(postId) {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  }

  return (
    <div className="page feed-page">
      <CreatePost onCreated={handleCreated} />

      {posts === null && <p className="muted center">Loading your feed…</p>}
      {posts?.length === 0 && (
        <p className="muted center">
          Nothing here yet. Add some friends and share your first post!
        </p>
      )}

      {posts?.map((post) => (
        <PostCard key={post.id} post={post} onRemoved={handleRemoved} />
      ))}

      {hasMore && posts?.length > 0 && (
        <button className="btn-secondary load-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

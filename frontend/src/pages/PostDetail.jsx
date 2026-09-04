import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import PostCard from '../components/PostCard.jsx';

export default function PostDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setPost(null);
    setNotFound(false);
    api.posts
      .get(id)
      .then(setPost)
      .catch(() => setNotFound(true));
  }, [id]);

  if (notFound) return <p className="muted center page">That post doesn't exist, or you don't have access to it.</p>;
  if (!post) return <p className="muted center page">Loading…</p>;

  return (
    <div className="page">
      <PostCard post={post} onRemoved={() => navigate(-1)} />
    </div>
  );
}

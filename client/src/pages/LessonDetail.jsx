import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import LessonBoard from '../components/LessonBoard.jsx';

export default function LessonDetail() {
  const { lessonId } = useParams();
  const [lesson, setLesson] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getLesson(lessonId).then(setLesson).catch((e) => setError(e.message));
  }, [lessonId]);

  if (error) return <div className="card error-banner" role="alert">{error}</div>;
  if (!lesson) return <p role="status" aria-live="polite">Loading…</p>;

  return (
    <div>
      <Link className="btn secondary" to="/lessons" style={{ marginBottom: 16, display: 'inline-block' }}>
        ← Back to lessons
      </Link>
      <h1>{lesson.title}</h1>
      <div className="badge-row">
        <span className="tag">{lesson.category}</span>
        <span className="tag">{lesson.level}</span>
        {lesson.themeTags.map((t) => (
          <span key={t} className="tag">{t}</span>
        ))}
      </div>

      <div className="board-layout-2col-narrow" style={{ marginTop: 18 }}>
        {lesson.startFen && (
          <div>
            <LessonBoard fen={lesson.startFen} />
            <p className="text-hint" style={{ marginTop: 8 }}>
              Try it yourself — move either side to explore the idea. Reset any time.
            </p>
          </div>
        )}

        <div>
          <div className="card">
            <p>{lesson.summary}</p>
            <ul>
              {lesson.content.map((point, i) => (
                <li key={i} style={{ marginBottom: 10, lineHeight: 1.6 }}>{point}</li>
              ))}
            </ul>
            {lesson.source && (
              <p style={{ fontSize: '0.9rem', color: 'var(--text-dim)', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                Grounded in: {lesson.source}
              </p>
            )}
          </div>
          <div className="card" style={{ marginTop: 18 }}>
            <h3>Practice what you learned</h3>
            <p>Head to the puzzle trainer and filter for related themes to reinforce this lesson.</p>
            <Link className="btn" to="/puzzles">Go to puzzles</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useAuth } from '../context/AuthContext';
import FeedbackAdminTriage from '../components/feedback/FeedbackAdminTriage';
import FeedbackSubmitForm from '../components/feedback/FeedbackSubmitForm';
import MyFeedbackList from '../components/feedback/MyFeedbackList';

export default function FeedbackPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="space-y-8">
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="font-display font-bold text-2xl text-grey-900">Feedback</h1>
          <p className="text-grey-600 text-sm mt-0.5">Report a bug or share an idea — we read everything</p>
        </div>

        <FeedbackSubmitForm />
        <MyFeedbackList />
      </div>

      {/* Wider than the form/list above — the admin table wants more horizontal room. */}
      {isAdmin && (
        <div className="max-w-5xl mx-auto">
          <FeedbackAdminTriage />
        </div>
      )}
    </div>
  );
}

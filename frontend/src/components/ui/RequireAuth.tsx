import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import TermsGate from '../legal/TermsGate';

export default function RequireAuth() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return null;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  // Deleting the account stays open without accepting the Terms: declining
  // them mustn't trap someone in an account (Apple 5.1.1(v)).
  if (user.termsRequired && location.pathname !== '/profile/delete-account') return <TermsGate />;
  return <Outlet />;
}

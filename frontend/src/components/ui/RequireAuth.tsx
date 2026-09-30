import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import TermsGate from '../legal/TermsGate';

export default function RequireAuth() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return null;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (user.termsRequired) return <TermsGate />;
  return <Outlet />;
}

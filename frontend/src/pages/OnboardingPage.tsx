import { Link } from 'react-router-dom';
import JoinByCodeCard from '../components/team/JoinByCodeCard';

interface OnboardingPageProps {
  /** Which action leads, from the signup intent question — never a permission gate. */
  lead: 'coach' | 'player';
}

// Merged from the former OnboardingCoachPage / OnboardingPlayerPage (Phase
// 4.5): anyone can create or join a team now, so both actions are always
// offered — signup intent only decides which one leads.
function CreateTeamBlock() {
  return (
    <div className="card p-5 text-left space-y-3">
      <p className="text-xs font-semibold text-grey-600">Create a team</p>
      <ol className="space-y-2 text-sm text-grey-600 list-decimal list-inside">
        <li>Name your team and season</li>
        <li>Add players to your roster</li>
        <li>Schedule or record a match</li>
      </ol>
      <Link to="/teams?new=1" className="btn-primary w-full text-center block">
        Create my first team
      </Link>
    </div>
  );
}

function JoinTeamBlock() {
  return (
    <div className="text-left">
      <p className="text-xs font-semibold text-grey-600 mb-2">Join with a code</p>
      <JoinByCodeCard />
    </div>
  );
}

export default function OnboardingPage({ lead }: OnboardingPageProps) {
  const isCoachLead = lead === 'coach';

  return (
    <div className="min-h-screen bg-grey-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md text-center space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-grey-900">Welcome to VolleyVision</h1>
          <p className="text-grey-600 text-sm mt-2 leading-relaxed">
            Your account is ready. Create a team, or join one with a code from your coach.
          </p>
        </div>

        {isCoachLead ? (
          <>
            <CreateTeamBlock />
            <JoinTeamBlock />
          </>
        ) : (
          <>
            <JoinTeamBlock />
            <CreateTeamBlock />
          </>
        )}

        <Link to="/teams" className="btn-secondary w-full text-center text-sm block">
          Go to my teams
        </Link>
      </div>
    </div>
  );
}

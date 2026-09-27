import { Position } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { isAllowedProfileImageUrl } from '../lib/profileImage';

const profileSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  profileImage: true,
  bio: true,
  phoneNumber: true,
  dateOfBirth: true,
  city: true,
  country: true,
  heightCm: true,
  weightKg: true,
  // Iteration 3 — the athlete's own stated position preference.
  preferredPosition: true,
  createdAt: true,
} as const;

const VALID_POSITIONS = new Set<string>([
  'SETTER', 'OUTSIDE_HITTER', 'OPPOSITE', 'MIDDLE_BLOCKER', 'LIBERO', 'DEFENSIVE_SPECIALIST',
]);

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: profileSelect });
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
  return user;
}

export async function updateProfile(
  userId: string,
  data: {
    firstName?: string;
    lastName?: string;
    bio?: string;
    phoneNumber?: string;
    dateOfBirth?: string | null;
    city?: string;
    country?: string;
    profileImage?: string;
    heightCm?: number | null;
    weightKg?: number | null;
    preferredPosition?: string | null;
  },
) {
  const { dateOfBirth, heightCm, weightKg, preferredPosition, ...rest } = data;

  // Physical-profile validation: plausible adult athlete ranges.
  if (heightCm != null && (!Number.isInteger(heightCm) || heightCm < 100 || heightCm > 250)) {
    throw Object.assign(new Error('Height must be between 100 and 250 cm'), { statusCode: 400 });
  }
  if (weightKg != null && (!Number.isInteger(weightKg) || weightKg < 30 || weightKg > 200)) {
    throw Object.assign(new Error('Weight must be between 30 and 200 kg'), { statusCode: 400 });
  }
  if (preferredPosition != null && preferredPosition !== '' && !VALID_POSITIONS.has(preferredPosition)) {
    throw Object.assign(new Error('Invalid preferred position.'), { statusCode: 400 });
  }
  // A profile image is rendered to every teammate (chat, members list), so an
  // arbitrary URL is a tracking pixel pointed at other users' browsers. Only
  // our own storage host is allowed. There is no avatar upload yet, so today
  // this effectively only permits clearing it; the Profile page no longer
  // offers a free-text URL field.
  if (rest.profileImage != null && rest.profileImage !== '' && !isAllowedProfileImageUrl(rest.profileImage, process.env.SUPABASE_URL)) {
    throw Object.assign(new Error('profileImage must be an https URL on our storage host.'), { statusCode: 400 });
  }

  return prisma.user.update({
    where: { id: userId },
    data: {
      ...rest,
      ...(dateOfBirth !== undefined
        ? { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null }
        : {}),
      ...(heightCm !== undefined ? { heightCm } : {}),
      ...(weightKg !== undefined ? { weightKg } : {}),
      ...(preferredPosition !== undefined
        ? { preferredPosition: preferredPosition ? (preferredPosition as Position) : null }
        : {}),
    },
    select: profileSelect,
  });
}

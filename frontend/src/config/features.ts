// Feature flags — refocus VolleyVision on its core (coaches and players seeing
// team and personal stats). Leagues, video, assistant, scouting, heat maps,
// recommendations, rotation analytics and momentum were removed entirely
// (not just hidden) — see CHANGELOG. Flip teamChat off only if the polled
// channel needs to be pulled temporarily.

export const features = {
  // Team chat — one shared channel per team (polled).
  teamChat: true,
} as const;

export type FeatureFlag = keyof typeof features;

export function isEnabled(flag: FeatureFlag): boolean {
  return features[flag];
}
